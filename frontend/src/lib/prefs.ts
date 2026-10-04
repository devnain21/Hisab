import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";

/** App settings kept on this phone. Slips and sheets read them synchronously through `getPrefs()`. */
export type Prefs = {
  /** Printed at the foot of every slip, e.g. return policy. */
  receiptNote: string;
  showGst: boolean;
  /** Custom WhatsApp reminder; "" uses the built-in text. Placeholders: {नाम} {रकम} {दुकान} */
  reminderText: string;
  defaultMode: "cash" | "online";
  /** Masks totals on the home screen, for when a customer can see the phone. */
  hideAmounts: boolean;
  /** How long the app may stay in the background before the PIN is asked again. */
  lockAfterMs: number;
  /** ISO time of the last Excel or full backup made from this phone. */
  lastBackupAt: string;
};

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
  reminderText: "",
  defaultMode: "cash",
  hideAmounts: false,
  lockAfterMs: 30_000,
  lastBackupAt: "",
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

export function getPrefs(): Prefs {
  return memory ?? DEFAULTS;
}

export async function savePrefs(patch: Partial<Prefs>) {
  const next = { ...getPrefs(), ...patch };
  memory = next;
  listeners.forEach((fn) => fn(next));
  await AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
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
