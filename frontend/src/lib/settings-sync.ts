import AsyncStorage from "@react-native-async-storage/async-storage";
import { api } from "@/src/lib/api";
import { getPrefs, loadPrefs, savePrefs, setPrefsSaveHook, type Prefs } from "@/src/lib/prefs";
import { getBudget, saveBudget, setBudgetSaveHook, type Budget } from "@/src/lib/budget";

/**
 * Account settings that follow the user to a new phone or the website. Lock timer, hidden amounts and
 * backup time describe this phone only and stay here.
 */
const SYNCED: (keyof Prefs)[] = ["receiptNote", "showGst", "logo", "reminderText", "defaultMode"];

// Under the "hisab_" prefix so sign-out wipes it with the rest of the account.
const META_KEY = "hisab_settings_meta_v1";
type Meta = { updatedAt: string; dirty: boolean };

async function readMeta(): Promise<Meta> {
  try {
    const raw = await AsyncStorage.getItem(META_KEY);
    if (raw) return { updatedAt: "", dirty: false, ...JSON.parse(raw) };
  } catch {}
  return { updatedAt: "", dirty: false };
}
const writeMeta = (m: Meta) => AsyncStorage.setItem(META_KEY, JSON.stringify(m)).catch(() => {});

async function snapshot(): Promise<Record<string, unknown>> {
  const p = await loadPrefs();
  const prefs: Record<string, unknown> = {};
  for (const k of SYNCED) prefs[k] = p[k];
  return { prefs, budget: await getBudget() };
}

let timer: ReturnType<typeof setTimeout> | null = null;
let enabled = false;

async function push() {
  if (!enabled) return;
  const meta = await readMeta();
  if (!meta.dirty) return;
  try {
    const res = await api.putSettings({ data: await snapshot(), updatedAt: meta.updatedAt });
    // Another phone saved later: take its copy instead.
    if (res?.updatedAt && res.updatedAt > meta.updatedAt && res.data) await apply(res.data, res.updatedAt);
    else await writeMeta({ updatedAt: meta.updatedAt, dirty: false });
  } catch {
    // Stays dirty; the next change or app start sends it.
  }
}

async function changed() {
  await writeMeta({ updatedAt: new Date().toISOString(), dirty: true });
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void push(), 1500);
}

async function apply(data: Record<string, unknown>, updatedAt: string) {
  const prefs = (data.prefs ?? {}) as Partial<Prefs>;
  const patch: Partial<Prefs> = {};
  for (const k of SYNCED) if (k in prefs) (patch as Record<string, unknown>)[k] = prefs[k];
  if (Object.keys(patch).length) await savePrefs(patch, true);
  const b = data.budget as Budget | undefined;
  if (b && typeof b === "object" && typeof b.total === "number") await saveBudget({ total: b.total, byCat: b.byCat ?? {} }, true);
  await writeMeta({ updatedAt, dirty: false });
}

/**
 * Called once the account is known: newer settings on the server replace this phone's, newer
 * local edits are sent up, and from then on every change is sent shortly after it is made.
 */
export async function startSettingsSync() {
  enabled = true;
  setPrefsSaveHook((patch) => {
    if (Object.keys(patch).some((k) => SYNCED.includes(k as keyof Prefs))) void changed();
  });
  setBudgetSaveHook(() => void changed());
  try {
    const meta = await readMeta();
    const remote = await api.getSettings();
    if (remote?.data && remote.updatedAt > meta.updatedAt && !meta.dirty) {
      await apply(remote.data, remote.updatedAt);
    } else if (meta.dirty || (!remote?.data && hasLocalSettings())) {
      // First phone on the account, or edits made offline: this copy goes up.
      if (!meta.dirty) await writeMeta({ updatedAt: new Date().toISOString(), dirty: true });
      await push();
    }
  } catch {}
}

export function stopSettingsSync() {
  enabled = false;
  if (timer) clearTimeout(timer);
  timer = null;
  setPrefsSaveHook(null);
  setBudgetSaveHook(null);
}

function hasLocalSettings() {
  const p = getPrefs();
  return !!(p.logo || p.receiptNote || p.reminderText || p.defaultMode !== "cash" || !p.showGst);
}
