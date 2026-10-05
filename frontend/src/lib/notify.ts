import { useEffect } from "react";
import { Platform } from "react-native";
import { useRouter } from "expo-router";
import { computeBalance, useCustomers, useEntries, type Customer, type Entry } from "./data";
import { formatINR, todayISO } from "./format";

type Notifications = typeof import("expo-notifications");

const CHANNEL = "udhaar";
const KIND = "udhaar";
const REPORT = "report";
const MONTHLY_ID = "report-monthly";
const HOUR = 9;
// Android keeps at most ~50 alarms per app; the nearest dates matter most.
const MAX_SCHEDULED = 40;

let mod: Notifications | null | undefined;

/** The native side only exists in APKs built after notifications were added; OTA JS runs on older ones too. */
function notifications(): Notifications | null {
  if (mod !== undefined) return mod;
  mod = null;
  if (Platform.OS === "web") return mod;
  const g = globalThis as { expo?: { modules?: Record<string, unknown> } };
  if (!g.expo?.modules?.ExpoNotificationScheduler) return mod;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require("expo-notifications") as Notifications;
    mod.setNotificationHandler({
      handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
    });
  } catch {
    mod = null;
  }
  return mod;
}

export const remindersSupported = () => notifications() !== null;

type Plan = { id: string; customerId: string; when: Date; title: string; body: string };

function plan(customers: Customer[], entries: Entry[]): Plan[] {
  const today = todayISO();
  const now = Date.now();
  const out: Plan[] = [];
  for (const c of customers) {
    if (!c.remindOn || c.remindOn < today) continue;
    const due = computeBalance(entries, c.id);
    if (due <= 0) continue;
    const [y, m, d] = c.remindOn.split("-").map(Number);
    const when = new Date(y, m - 1, d, HOUR, 0, 0);
    if (when.getTime() <= now) continue;
    out.push({
      id: `${KIND}-${c.id}-${c.remindOn}`,
      customerId: c.id,
      when,
      title: `${c.name} से ${formatINR(due)} लेने हैं`,
      body: "आज वसूली की तारीख है — तगादा भेजें या पैसे लिखें",
    });
  }
  return out.sort((a, b) => a.when.getTime() - b.when.getTime()).slice(0, MAX_SCHEDULED);
}

let lastKey = "";

async function sync(customers: Customer[], entries: Entry[]) {
  const N = notifications();
  if (!N) return;
  const wanted = plan(customers, entries);
  const key = wanted.map((p) => `${p.id}|${p.title}`).join(",");
  if (key === lastKey) return;
  lastKey = key;
  try {
    const scheduled = await N.getAllScheduledNotificationsAsync();
    const ours = scheduled.filter((s) => (s.content.data as { kind?: string } | null)?.kind === KIND);
    const keep = new Set(wanted.map((p) => p.id));
    await Promise.all(ours.filter((s) => !keep.has(s.identifier)).map((s) => N.cancelScheduledNotificationAsync(s.identifier)));

    // Asked only once there is a date to remind about.
    const perm = await N.getPermissionsAsync();
    let granted = perm.granted;
    if (!granted && wanted.length && perm.canAskAgain) granted = (await N.requestPermissionsAsync()).granted;
    if (!granted) return;
    if (Platform.OS === "android") {
      await N.setNotificationChannelAsync(CHANNEL, { name: "वसूली व रिपोर्ट की याद", importance: N.AndroidImportance.HIGH });
    }
    if (!scheduled.some((s) => s.identifier === MONTHLY_ID)) {
      await N.scheduleNotificationAsync({
        identifier: MONTHLY_ID,
        content: { title: "पिछले महीने की रिपोर्ट तैयार है", body: "कमाई, खर्च और बकाया देखें — PDF / Excel भेज सकते हैं", data: { kind: REPORT } },
        trigger: { type: N.SchedulableTriggerInputTypes.MONTHLY, day: 1, hour: 10, minute: 0, channelId: CHANNEL },
      });
    }
    // Rescheduling the same identifier replaces it, so amounts stay current.
    for (const p of wanted) {
      await N.scheduleNotificationAsync({
        identifier: p.id,
        content: { title: p.title, body: p.body, data: { kind: KIND, customerId: p.customerId } },
        trigger: { type: N.SchedulableTriggerInputTypes.DATE, date: p.when, channelId: CHANNEL },
      });
    }
  } catch {
    lastKey = "";
  }
}

export async function clearUdhaarReminders() {
  lastKey = "";
  const N = notifications();
  if (!N) return;
  try {
    const scheduled = await N.getAllScheduledNotificationsAsync();
    await Promise.all(
      scheduled
        .filter((s) => [KIND, REPORT].includes((s.content.data as { kind?: string } | null)?.kind ?? ""))
        .map((s) => N.cancelScheduledNotificationAsync(s.identifier)),
    );
  } catch {}
}

/** Keeps phone alarms in step with the khata, and opens the customer when one is tapped. */
export function useUdhaarReminders() {
  const router = useRouter();
  const customers = useCustomers().data;
  const entries = useEntries().data;

  useEffect(() => {
    if (customers && entries) void sync(customers, entries);
  }, [customers, entries]);

  useEffect(() => {
    const N = notifications();
    if (!N) return;
    const open = (data: unknown) => {
      const d = data as { kind?: string; customerId?: string } | null;
      if (d?.kind === KIND && d.customerId) router.push(`/customer/${d.customerId}` as never);
      else if (d?.kind === REPORT) router.push("/report?month=prev" as never);
    };
    N.getLastNotificationResponseAsync()
      .then((r) => {
        if (r) {
          open(r.notification.request.content.data);
          void N.clearLastNotificationResponseAsync?.();
        }
      })
      .catch(() => {});
    const sub = N.addNotificationResponseReceivedListener((r) => open(r.notification.request.content.data));
    return () => sub.remove();
  }, [router]);
}
