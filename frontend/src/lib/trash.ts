import { formatINR } from "./format";
import { store } from "./store";
import { syncAepsDue } from "./aeps-due";
import { fileStore } from "./file-store";
import { accountLabel, type Move } from "./wallet";
import { queryClient } from "@/src/query-client";
import type { Persona } from "./persona";
import type { AepsTxn, Customer, Entry, Job } from "./data";

export type TrashColl = "customers" | "entries" | "jobs" | "aeps" | "expenses" | "moves";

/** Rows the server removes (or unlinks) together with a customer, so a restore brings the whole khata back. */
export type CustomerBundle = { entries: Entry[]; jobs: Job[]; aepsIds: string[]; jamaMoveIds?: string[] };

/** Rows one delete took away together (a work with its payments, vendor cost, job card), and links it cut. */
export type TrashGroup = { entries: Entry[]; jobs: Job[]; relink: { id: string; linkId: string; notes: string }[]; aeps?: AepsTxn[] };

export type TrashItem = {
  id: string;
  coll: TrashColl;
  title: string;
  subtitle: string;
  deletedAt: string;
  data: Record<string, any>;
  bundle?: CustomerBundle;
  group?: TrashGroup;
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

let writeChain: Promise<unknown> = Promise.resolve();

/** Bin writes run one after another; several deletes at once would otherwise each save over the others. */
function mutateTrash<T>(fn: (list: TrashItem[]) => Promise<T> | T): Promise<T> {
  const run = writeChain.then(async () => fn(await getTrashList()));
  writeChain = run.catch(() => {});
  return run;
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

const ENTRY_KIND: Record<string, { title: string; amount: string }> = {
  work: { title: "काम", amount: "रकम" },
  payment: { title: "भुगतान", amount: "मिले" },
  given: { title: "दिए", amount: "दिए" },
  purchase: { title: "सामान / सेवा", amount: "सामान" },
  aeps: { title: "काउंटर सेवा", amount: "रकम" },
};

/** Labels are rebuilt from the saved record so items binned by older versions read right too. */
export function describeTrash(item: TrashItem): { title: string; subtitle: string } {
  try {
    return describe(item.coll, item.data ?? {}, item.bundle, item.group);
  } catch {
    return { title: item.title, subtitle: item.subtitle };
  }
}

function describe(coll: TrashColl, data: Record<string, any>, bundle?: CustomerBundle, group?: TrashGroup) {
  const d = describeOne(coll, data, bundle);
  const n = group ? group.entries.length + group.jobs.length + (group.aeps?.length ?? 0) : 0;
  return n > 1 ? { ...d, subtitle: `${d.subtitle} · साथ में ${n - 1} और` } : d;
}

function describeOne(coll: TrashColl, data: Record<string, any>, bundle?: CustomerBundle) {
  if (coll === "customers") {
    const parts = [data.phone ? `फ़ोन: ${data.phone}` : "खाता"];
    if (bundle?.entries.length) parts.push(`${bundle.entries.length} एंट्री`);
    if (bundle?.jobs.length) parts.push(`${bundle.jobs.length} काम`);
    return { title: data.name || "खाता", subtitle: parts.join(" · ") };
  }
  if (coll === "entries") {
    const kind = ENTRY_KIND[data.type as string] ?? { title: "काम", amount: "रकम" };
    return {
      title: data.description || kind.title,
      subtitle: `${kind.amount}: ${formatINR(data.amount || 0)} (${data.date || ""})`,
    };
  }
  if (coll === "jobs") {
    if (!data.customerId && data.persona === "personal") {
      return { title: data.title || "काम", subtitle: data.dueDate ? `मेरा काम · ${data.dueDate}` : "मेरा काम" };
    }
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

export function putInTrash(coll: TrashColl, data: Record<string, any>, bundle?: CustomerBundle, group?: TrashGroup): Promise<TrashItem> {
  return mutateTrash(async (list) => {
    const trashItem: TrashItem = {
      id: `trash_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      coll,
      ...describe(coll, data, bundle, group),
      deletedAt: new Date().toISOString(),
      data,
      ...(bundle ? { bundle } : {}),
      ...(group ? { group } : {}),
    };
    await save([trashItem, ...list].slice(0, MAX_TRASH_ITEMS));
    return trashItem;
  });
}

let openGroup: TrashGroup | null = null;

/**
 * Everything `fn` deletes goes to the bin as one item, so "वापस लाएं" brings the whole record back the
 * way it was (payments, vendor cost, job card and the links that were cut), not one loose row.
 */
export function trashGroup(fn: () => void) {
  if (openGroup) return fn();
  const g: TrashGroup = { entries: [], jobs: [], relink: [], aeps: [] };
  openGroup = g;
  try {
    fn();
  } finally {
    openGroup = null;
    const counter = g.aeps ?? [];
    const n = g.entries.length + g.jobs.length;
    if (counter.length) {
      // A counter row with its khata due / jama: one bin item, restored together so the due is never doubled.
      if (n === 0 && counter.length === 1) void putInTrash("aeps", counter[0]);
      else void putInTrash("aeps", counter[0], undefined, g);
    } else if (n === 1 && !g.relink.length) void putInTrash(g.entries.length ? "entries" : "jobs", g.entries[0] ?? g.jobs[0]);
    else if (n > 0) {
      const lead = g.entries.find((e) => e.type === "work") ?? g.jobs[0] ?? g.entries[0];
      void putInTrash(g.entries.includes(lead as Entry) ? "entries" : "jobs", lead, undefined, g);
    }
  }
}

/** Store hook: true when the row was taken into the open group instead of its own bin item. */
export function captureTrash(coll: TrashColl, row: Entry | Job | AepsTxn): boolean {
  if (!openGroup) return false;
  if (coll === "entries") openGroup.entries.push(row as Entry);
  else if (coll === "jobs") openGroup.jobs.push(row as Job);
  else if (coll === "aeps") (openGroup.aeps ??= []).push(row as AepsTxn);
  else return false;
  return true;
}

/** A kept row whose link (and note) the delete changed; restored with the group. */
export function noteRelink(row: Entry) {
  openGroup?.relink.push({ id: row.id, linkId: row.linkId ?? "", notes: row.notes ?? "" });
}

function restoreGroup(g: TrashGroup) {
  const live = new Set(cached<Customer>("customers").map((c) => c.id));
  // Counter rows keep their money even if their customer is gone; they just come back unlinked (and without a khata due).
  for (const t of g.aeps ?? []) store.restoreRaw("aeps", (t.customerId && !live.has(t.customerId) ? { ...t, customerId: "" } : t) as any);
  for (const e of g.entries) if (live.has(e.customerId)) store.restoreRaw("entries", e as any);
  for (const j of g.jobs) if (!j.customerId || live.has(j.customerId)) store.restoreRaw("jobs", j as any);
  const entries = cached<Entry>("entries");
  for (const r of g.relink) {
    const row = entries.find((e) => e.id === r.id);
    // Only if nothing re-linked it meanwhile.
    if (row && !row.linkId) store.updateEntry(r.id, { linkId: r.linkId, notes: r.notes });
  }
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

/** Permanently drop just these items (the bin shows one account at a time). */
export function clearTrashItems(ids: string[]): Promise<void> {
  const drop = new Set(ids);
  return mutateTrash(async (list) => {
    await save(list.filter((t) => !drop.has(t.id)));
  });
}

/** Which account a binned row belongs to; null when it can't be told (shown in both). */
export function trashPersona(item: TrashItem, list: TrashItem[]): Persona | null {
  const d = item.data ?? {};
  const asPersona = (p?: string): Persona => (p === "personal" ? "personal" : "business");
  switch (item.coll) {
    case "customers":
      return asPersona(d.persona);
    case "aeps":
      return "business";
    case "expenses":
      return asPersona(d.persona);
    case "moves": {
      const key = (d.from || d.to || "") as string;
      return key ? asPersona(key.split(":")[0]) : null;
    }
    default: {
      if (!d.customerId) return item.coll === "jobs" ? asPersona(d.persona) : null;
      const owner =
        cached<Customer>("customers").find((c) => c.id === d.customerId) ??
        (list.find((t) => t.coll === "customers" && t.data?.id === d.customerId)?.data as Customer | undefined);
      return owner ? asPersona(owner.persona) : null;
    }
  }
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
  // The counter jama comes back on the khata, so the stand-in "money added" rows go.
  for (const id of b.jamaMoveIds ?? []) store.dropRaw("moves", id);
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
  const taken = await mutateTrash(async (list) => {
    const found = list.find((t) => t.id === trashId);
    if (!found || !found.data) return "missing" as const;
    const ownerId = (found.data as { customerId?: string }).customerId;
    if ((found.coll === "entries" || found.coll === "jobs") && ownerId && !cached<Customer>("customers").some((c) => c.id === ownerId)) {
      return "no-customer" as const;
    }
    await save(list.filter((t) => t.id !== trashId));
    return found;
  });
  if (typeof taken === "string") return taken;
  const item = taken;
  const customerId = (item.data as { customerId?: string }).customerId;
  if (item.coll === "customers") {
    restoreCustomer(item);
  } else if (item.group) {
    restoreGroup(item.group);
  } else {
    let data = item.data;
    if (item.coll === "entries" && data.type === "aeps") {
      // Binned on its own by older versions: the counter row (restored, or still there) already has its due,
      // and with the row gone it would be udhaar with nothing behind it.
      const rowLive = cached<AepsTxn>("aeps").some((t) => t.id === data.linkId);
      const hasDue = cached<Entry>("entries").some((e) => e.type === "aeps" && e.linkId === data.linkId);
      if (!rowLive || hasDue) return "ok";
    }
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
