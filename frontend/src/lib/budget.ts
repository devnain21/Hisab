import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";

/** Monthly spending limit of the personal account: one total, and optional limits per expense category. Kept on this phone. */
export type Budget = { total: number; byCat: Record<string, number> };

const KEY = "hisab_personal_budget_v1";
const EMPTY: Budget = { total: 0, byCat: {} };

let memory: Budget | null = null;
const listeners = new Set<(b: Budget) => void>();

async function load(): Promise<Budget> {
  if (memory) return memory;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    memory = raw ? { ...EMPTY, ...JSON.parse(raw) } : EMPTY;
  } catch {
    memory = EMPTY;
  }
  return memory!;
}

/** Re-reads storage after sign-out wiped it or sign-in restored it. */
export async function reloadBudget() {
  memory = null;
  const b = await load();
  listeners.forEach((fn) => fn(b));
}

export async function saveBudget(b: Budget) {
  memory = b;
  listeners.forEach((fn) => fn(b));
  await AsyncStorage.setItem(KEY, JSON.stringify(b)).catch(() => {});
}

export function useBudget(): Budget {
  const [b, setB] = useState<Budget>(memory ?? EMPTY);
  useEffect(() => {
    let alive = true;
    load().then((v) => alive && setB(v));
    listeners.add(setB);
    return () => {
      alive = false;
      listeners.delete(setB);
    };
  }, []);
  return b;
}
