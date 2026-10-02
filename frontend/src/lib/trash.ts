import AsyncStorage from "@react-native-async-storage/async-storage";
import { formatINR } from "./format";
import { store } from "./store";

export type TrashColl = "customers" | "entries" | "jobs" | "aeps";

export type TrashItem = {
  id: string;
  coll: TrashColl;
  title: string;
  subtitle: string;
  deletedAt: string;
  data: Record<string, any>;
};

const TRASH_KEY = "hisab_recycle_bin_v1";
const MAX_TRASH_ITEMS = 50;

let trashMemory: TrashItem[] | null = null;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((fn) => fn());
}

export async function getTrashList(): Promise<TrashItem[]> {
  if (trashMemory) return trashMemory;
  try {
    const raw = await AsyncStorage.getItem(TRASH_KEY);
    trashMemory = raw ? JSON.parse(raw) : [];
  } catch {
    trashMemory = [];
  }
  return trashMemory || [];
}

export async function putInTrash(
  coll: TrashColl,
  data: Record<string, any>
): Promise<TrashItem> {
  const list = await getTrashList();
  let title = "अज्ञात रिकॉर्ड";
  let subtitle = "";

  if (coll === "customers") {
    title = data.name || "ग्राहक";
    subtitle = data.phone ? `फ़ोन: ${data.phone}` : "खाता रिकॉर्ड";
  } else if (coll === "entries") {
    title = data.description || (data.type === "payment" ? "भुगतान" : "काम");
    subtitle = `${data.type === "payment" ? "मिले" : "रकम"}: ${formatINR(data.amount || 0)} (${data.date || ""})`;
  } else if (coll === "jobs") {
    title = data.title || "काम";
    subtitle = `तारीख: ${data.dueDate || ""} · ${formatINR(data.estimatedAmount || 0)}`;
  } else if (coll === "aeps") {
    title = data.customerName || data.type || "काउंटर सेवा";
    subtitle = `रकम: ${formatINR(data.amount || 0)}`;
  }

  const trashItem: TrashItem = {
    id: `trash_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    coll,
    title,
    subtitle,
    deletedAt: new Date().toISOString(),
    data,
  };

  const updated = [trashItem, ...list].slice(0, MAX_TRASH_ITEMS);
  trashMemory = updated;
  await AsyncStorage.setItem(TRASH_KEY, JSON.stringify(updated)).catch(() => {});
  notify();
  return trashItem;
}

export async function removeFromTrash(trashId: string): Promise<TrashItem | null> {
  const list = await getTrashList();
  const target = list.find((t) => t.id === trashId) || null;
  if (!target) return null;
  const updated = list.filter((t) => t.id !== trashId);
  trashMemory = updated;
  await AsyncStorage.setItem(TRASH_KEY, JSON.stringify(updated)).catch(() => {});
  notify();
  return target;
}

export async function clearAllTrash(): Promise<void> {
  trashMemory = [];
  await AsyncStorage.removeItem(TRASH_KEY).catch(() => {});
  notify();
}

export async function restoreTrashItem(trashId: string): Promise<boolean> {
  const item = await removeFromTrash(trashId);
  if (!item || !item.data) return false;
  store.restoreRaw(item.coll, item.data as any);
  return true;
}

export function subscribeTrash(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
