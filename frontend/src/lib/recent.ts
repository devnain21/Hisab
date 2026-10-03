import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

const RECENT_KEY = "hisab_recent_customers_v1";
const MAX_RECENT = 6;

let recentCache: string[] | null = null;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((fn) => fn());
}

export function resetRecentCustomers() {
  recentCache = [];
  notify();
}

export async function addRecentCustomer(customerId: string): Promise<void> {
  if (!customerId) return;
  try {
    const raw = await AsyncStorage.getItem(RECENT_KEY);
    const list: string[] = raw ? JSON.parse(raw) : [];
    const updated = [customerId, ...list.filter((id) => id !== customerId)].slice(0, MAX_RECENT);
    recentCache = updated;
    await AsyncStorage.setItem(RECENT_KEY, JSON.stringify(updated));
    notify();
  } catch {}
}

export function useRecentCustomerIds(): string[] {
  const [ids, setIds] = useState<string[]>(recentCache || []);

  useEffect(() => {
    if (!recentCache) {
      AsyncStorage.getItem(RECENT_KEY).then((raw) => {
        if (raw) {
          const list = JSON.parse(raw);
          recentCache = list;
          setIds(list);
        }
      }).catch(() => {});
    }

    const listener = () => {
      setIds(recentCache || []);
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return ids;
}
