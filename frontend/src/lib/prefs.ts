import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";

/** App settings kept on this phone. Slips and sheets read them synchronously through `getPrefs()`. */
export type Prefs = {
  /** Printed at the foot of every slip, e.g. return policy. */
  receiptNote: string;
  showGst: boolean;
  /** Shop logo for slips, as a small JPEG data URI. */
  logo: string;
  /** Custom WhatsApp reminder; "" uses the built-in text. Placeholders: {नाम} {रकम} {दुकान} */
  reminderText: string;
  defaultMode: "cash" | "online";
  /** Masks totals on the home screen, for when a customer can see the phone. */
  hideAmounts: boolean;
  /** How long the app may stay in the background before the PIN is asked again. */
  lockAfterMs: number;
  /** ISO time of the last Excel or full backup made from this phone. */
  lastBackupAt: string;
  /** Terms printed on vendor work orders; the last ones typed become the default. */
  vendorTerms: string;
  /** Last line of a shared slip text while money is still due; "" uses DUE_NOTE_DEFAULT. */
  dueNote: string;
  /** Last line of a shared slip text once fully paid; "" uses PAID_NOTE_DEFAULT. */
  paidNote: string;
};

export const DUE_NOTE_DEFAULT = "कृपया बकाया राशि का भुगतान जल्द करें। धन्यवाद 🙏";
export const PAID_NOTE_DEFAULT = "आपके भुगतान के लिए धन्यवाद। फिर सेवा का अवसर दें 🙏";

/** What a masked amount looks like while `hideAmounts` is on. */
export const HIDDEN = "₹ ••••";

export const REMINDER_PLACEHOLDERS = ["{नाम}", "{रकम}", "{दुकान}"] as const;
export const LOCK_CHOICES: { ms: number; label: string }[] = [
  { ms: 0, label: "तुरंत" },
  { ms: 30_000, label: "30 सेकंड" },
  { ms: 60_000, label: "1 मिनट" },
  { ms: 300_000, label: "5 मिनट" },
];

const KEY = "hisab_prefs_v1";
const DEFAULTS: Prefs = {
  receiptNote: "",
  showGst: true,
  logo: "",
  reminderText: "",
  defaultMode: "cash",
  hideAmounts: false,
  lockAfterMs: 30_000,
  lastBackupAt: "",
  vendorTerms: "",
  dueNote: "",
  paidNote: "",
};

let memory: Prefs | null = null;
const listeners = new Set<(p: Prefs) => void>();

export async function loadPrefs(): Promise<Prefs> {
  if (memory) return memory;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    memory = raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
  } catch {
    memory = DEFAULTS;
  }
  return memory!;
}

/** Re-reads storage after sign-out wiped it or sign-in restored it. */
export async function reloadPrefs() {
  memory = null;
  const p = await loadPrefs();
  listeners.forEach((fn) => fn(p));
}

export function getPrefs(): Prefs {
  return memory ?? DEFAULTS;
}

let onSaved: ((patch: Partial<Prefs>) => void) | null = null;
/** Lets settings sync hear about changes without prefs importing it. */
export function setPrefsSaveHook(fn: ((patch: Partial<Prefs>) => void) | null) {
  onSaved = fn;
}

/** `silent` writes a copy that came from the server, so it isn't sent back. */
export async function savePrefs(patch: Partial<Prefs>, silent = false) {
  const next = { ...getPrefs(), ...patch };
  memory = next;
  listeners.forEach((fn) => fn(next));
  await AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
  if (!silent) onSaved?.(patch);
}

export function usePrefs(): Prefs {
  const [p, setP] = useState<Prefs>(getPrefs());
  useEffect(() => {
    let alive = true;
    loadPrefs().then((v) => alive && setP(v));
    listeners.add(setP);
    return () => {
      alive = false;
      listeners.delete(setP);
    };
  }, []);
  return p;
}

/** Whole days since the last backup, or null if none was ever made here. */
export function daysSinceBackup(p: Prefs): number | null {
  if (!p.lastBackupAt) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(p.lastBackupAt).getTime()) / 86400000));
}
