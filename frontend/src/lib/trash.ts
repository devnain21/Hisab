import { formatINR } from "./format";
import { store } from "./store";
import { syncAepsDue } from "./aeps-due";
import { fileStore } from "./file-store";
import { accountLabel, type Move } from "./wallet";
import { queryClient } from "@/src/query-client";
import type { AepsTxn, Customer, Entry, Job } from "./data";

export type TrashColl = "customers" | "entries" | "jobs" | "aeps" | "expenses" | "moves";

/** Rows the server removes (or unlinks) together with a customer, so a restore brings the whole khata back. */
export type CustomerBundle = { entries: Entry[]; jobs: Job[]; aepsIds: string[] };

export type TrashItem = {
  id: string;
  coll: TrashColl;
  title: string;
  subtitle: string;
  deletedAt: string;
  data: Record<string, any>;
  bundle?: CustomerBundle;
};

export type RestoreResult = "ok" | "missing" | "no-customer";

const TRASH_KEY = "hisab_recycle_bin_v1";
const MAX_TRASH_ITEMS = 50;

let trashMemory: TrashItem[] | null = null;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((fn) => fn());
}

function save(list: TrashItem[]) {
  trashMemory = list;
  notify();
  return fileStore.setItem(TRASH_KEY, JSON.stringify(list)).catch(() => {});
}

export async function getTrashList(): Promise<TrashItem[]> {
  if (trashMemory) return trashMemory;
  try {
    const raw = await fileStore.getItem(TRASH_KEY);
    trashMemory = raw ? JSON.parse(raw) : [];
  } catch {
    trashMemory = [];
  }
  return trashMemory || [];
}

const cached = <T,>(coll: string) => queryClient.getQueryData<T[]>([coll]) ?? [];

/** Everything that goes away with this customer, read before the delete is applied. */
export function bundleFor(customerId: string): CustomerBundle {
  return {
    entries: cached<Entry>("entries").filter((e) => e.customerId === customerId),
    jobs: cached<Job>("jobs").filter((j) => j.customerId === customerId),
    aepsIds: cached<AepsTxn>("aeps").filter((t) => t.customerId === customerId).map((t) => t.id),
  };
}

function describe(coll: TrashColl, data: Record<string, any>, bundle?: CustomerBundle) {
  if (coll === "customers") {
    const parts = [data.phone ? `फ़ोन: ${data.phone}` : "खाता"];
    if (bundle?.entries.length) parts.push(`${bundle.entries.length} एंट्री`);
    if (bundle?.jobs.length) parts.push(`${bundle.jobs.length} काम`);
    return { title: data.name || "खाता", subtitle: parts.join(" · ") };
  }
  if (coll === "entries") {
    return {
      title: data.description || (data.type === "payment" ? "भुगतान" : "काम"),
      subtitle: `${data.type === "payment" ? "मिले" : "रकम"}: ${formatINR(data.amount || 0)} (${data.date || ""})`,
    };
  }
  if (coll === "jobs") {
    return { title: data.title || "काम", subtitle: `तारीख: ${data.dueDate || ""} · ${formatINR(data.estimatedAmount || 0)}` };
  }
  if (coll === "aeps") {
    return { title: data.customerName || data.type || "काउंटर सेवा", subtitle: `रकम: ${formatINR(data.amount || 0)}` };
  }
  if (coll === "expenses") {
    return { title: data.title || "खर्च", subtitle: `${formatINR(data.amount || 0)} · ${data.mode === "online" ? "बैंक / UPI" : "नकद"} (${data.date || ""})` };
  }
  const m = data as Move;
  return { title: `${accountLabel(m.from)} → ${accountLabel(m.to)}`, subtitle: `${formatINR(m.amount || 0)} (${m.date || ""})` };
}

export async function putInTrash(coll: TrashColl, data: Record<string, any>, bundle?: CustomerBundle): Promise<TrashItem> {
  const list = await getTrashList();
  const trashItem: TrashItem = {
    id: `trash_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    coll,
    ...describe(coll, data, bundle),
    deletedAt: new Date().toISOString(),
    data,
    ...(bundle ? { bundle } : {}),
  };
  await save([trashItem, ...list].slice(0, MAX_TRASH_ITEMS));
  return trashItem;
}

/** Forget the cached list (sign-out); the stored copy is removed by the caller. */
export function resetTrashMemory() {
  trashMemory = null;
  notify();
}

export async function clearAllTrash(): Promise<void> {
  trashMemory = [];
  await fileStore.removeItem(TRASH_KEY).catch(() => {});
  notify();
}

function restoreCustomer(item: TrashItem) {
  const customer = item.data as Customer;
  store.restoreRaw("customers", customer as any);
  const b = item.bundle;
  if (!b) return;
  const aeps = cached<AepsTxn>("aeps");
  const aepsIds = new Set(aeps.map((t) => t.id));
  // A counter due whose counter row was deleted meanwhile would be udhaar with nothing behind it.
  for (const e of b.entries) if (e.type !== "aeps" || (e.linkId && aepsIds.has(e.linkId))) store.restoreRaw("entries", e as any);
  for (const j of b.jobs) store.restoreRaw("jobs", j as any);
  for (const id of b.aepsIds) {
    const row = aeps.find((t) => t.id === id);
    // Only rows still unlinked; one moved to another customer since then stays there.
    if (!row || row.customerId) continue;
    const { id: _id, createdAt: _c, ...body } = row;
    const relinked = { ...body, customerId: customer.id };
    store.updateAeps(id, relinked);
    syncAepsDue(id, relinked);
  }
}

export async function restoreTrashItem(trashId: string): Promise<RestoreResult> {
  const list = await getTrashList();
  const item = list.find((t) => t.id === trashId);
  if (!item || !item.data) return "missing";
  const customerId = (item.data as { customerId?: string }).customerId;
  if ((item.coll === "entries" || item.coll === "jobs") && customerId && !cached<Customer>("customers").some((c) => c.id === customerId)) {
    return "no-customer";
  }
  await save(list.filter((t) => t.id !== trashId));
  if (item.coll === "customers") {
    restoreCustomer(item);
  } else {
    let data = item.data;
    // A counter row keeps its money even if its customer is gone; it just comes back unlinked.
    if (item.coll === "aeps" && customerId && !cached<Customer>("customers").some((c) => c.id === customerId)) data = { ...data, customerId: "" };
    store.restoreRaw(item.coll, data as any);
    if (item.coll === "aeps") {
      const { id, createdAt: _c, ...body } = data as AepsTxn;
      syncAepsDue(id, body);
    }
  }
  return "ok";
}

export function subscribeTrash(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
