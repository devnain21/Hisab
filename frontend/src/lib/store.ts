// Offline-first writes: every change is applied to the query cache immediately and
// queued in an AsyncStorage outbox that is replayed against the API in order.
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { api } from "@/src/lib/api";
import { queryClient } from "@/src/query-client";
import type { AepsTxn, Customer, Entry, Job } from "@/src/lib/data";
import type { Expense } from "@/src/lib/expenses";
import type { Move } from "@/src/lib/wallet";
import { bundleFor, putInTrash } from "@/src/lib/trash";

export type Coll = "customers" | "entries" | "jobs" | "aeps" | "expenses" | "moves";
type Op =
  | { kind: "create"; coll: Coll; item: { id: string } & Record<string, unknown> }
  | { kind: "update"; coll: Coll; itemId: string; patch: Record<string, unknown> }
  | { kind: "delete"; coll: Coll; itemId: string };

const KEY = "hisab_outbox_v1";
const COLLS: Coll[] = ["customers", "entries", "jobs", "aeps", "expenses", "moves"];
const RETRY_MS = 15_000;

let ops: Op[] = [];
let loadPromise: Promise<void> | null = null;
let flushing = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

function ensureLoaded() {
  if (!loadPromise) {
    loadPromise = AsyncStorage.getItem(KEY)
      .then((raw) => {
        const saved: Op[] = raw ? JSON.parse(raw) : [];
        ops = [...saved, ...ops];
      })
      .catch(() => {})
      .finally(notify);
  }
  return loadPromise;
}

function persist() {
  AsyncStorage.setItem(KEY, JSON.stringify(ops)).catch(() => {});
}

function applyOp<T extends { id: string; customerId?: string }>(coll: Coll, list: T[], op: Op): T[] {
  if (op.kind === "delete" && op.coll === "customers" && coll !== "customers") {
    // Counter rows keep their galla / bank movement; the server only unlinks them.
    if (coll === "aeps") return list.map((x) => (x.customerId === op.itemId ? { ...x, customerId: "" } : x));
    return list.filter((x) => x.customerId !== op.itemId);
  }
  if (op.coll !== coll) return list;
  switch (op.kind) {
    case "create":
      return list.some((x) => x.id === op.item.id) ? list : [...list, op.item as unknown as T];
    case "update":
      return list.map((x) => (x.id === op.itemId ? { ...x, ...op.patch } : x));
    case "delete":
      return list.filter((x) => x.id !== op.itemId);
  }
}

// Server rows don't include queued changes yet, so re-apply them on every fetch.
export async function withPending<T extends { id: string; customerId?: string }>(coll: Coll, rows: T[]): Promise<T[]> {
  await ensureLoaded();
  return ops.reduce((acc, op) => applyOp(coll, acc, op), rows);
}

function enqueue(op: Op) {
  ops.push(op);
  persist();
  for (const coll of COLLS) {
    // A list that has not loaded yet gets the change applied when it is fetched (withPending).
    queryClient.setQueryData<any[]>([coll], (old) => (old === undefined ? old : applyOp(coll, old, op)));
  }
  notify();
  void flush();
}

function send(op: Op): Promise<unknown> {
  if (op.kind === "create") {
    if (op.coll === "customers") return api.createCustomer(op.item);
    if (op.coll === "entries") return api.createEntry(op.item);
    if (op.coll === "aeps") return api.createAeps(op.item);
    if (op.coll === "expenses") return api.createExpense(op.item);
    if (op.coll === "moves") return api.createMove(op.item as unknown as Move);
    return api.createJob(op.item);
  }
  if (op.kind === "update") {
    if (op.coll === "customers") return api.updateCustomer(op.itemId, op.patch);
    if (op.coll === "entries") return api.updateEntry(op.itemId, op.patch);
    if (op.coll === "aeps") return api.updateAeps(op.itemId, op.patch);
    if (op.coll === "expenses") return api.updateExpense(op.itemId, op.patch);
    if (op.coll === "moves") return api.updateMove(op.itemId, op.patch as Record<string, unknown> & { from: string; to: string });
    return api.updateJob(op.itemId, op.patch);
  }
  if (op.coll === "customers") return api.deleteCustomer(op.itemId);
  if (op.coll === "entries") return api.deleteEntry(op.itemId);
  if (op.coll === "aeps") return api.deleteAeps(op.itemId);
  if (op.coll === "expenses") return api.deleteExpense(op.itemId);
  if (op.coll === "moves") return api.deleteMove(op.itemId);
  return api.deleteJob(op.itemId);
}

const statusOf = (e: unknown) => (e as { status?: number })?.status;

function isRetryable(e: unknown, op: Op) {
  const status = statusOf(e);
  // A server that predates these collections answers 404/405; keep the row until it is updated.
  if ((op.coll === "expenses" || op.coll === "moves") && op.kind !== "update" && (status === 404 || status === 405)) return true;
  return status === undefined || status === 401 || status === 408 || status === 429 || status >= 500;
}

/** Changes the server refused, kept so the user is told instead of losing them silently. */
export type RejectedChange = { coll: Coll; kind: Op["kind"]; status: number | undefined; at: string; label: string };
const REJECTED_KEY = "hisab_rejected_v1";
const MAX_SERVER_FAILS = 5;
let rejected: RejectedChange[] = [];
let rejectedLoaded = false;
let serverFails = 0;

AsyncStorage.getItem(REJECTED_KEY)
  .then((raw) => {
    rejected = [...(raw ? JSON.parse(raw) : []), ...rejected];
  })
  .catch(() => {})
  .finally(() => {
    rejectedLoaded = true;
    notify();
  });

const COLL_LABEL: Record<Coll, string> = { customers: "खाता", entries: "एंट्री", jobs: "काम", aeps: "काउंटर एंट्री", expenses: "खर्च", moves: "गल्ला / बैंक बदलाव" };
const KIND_LABEL: Record<Op["kind"], string> = { create: "नई", update: "बदली गई", delete: "हटाई गई" };

function describe(op: Op): string {
  const row = (op.kind === "create" ? op.item : op.kind === "update" ? op.patch : {}) as Record<string, unknown>;
  const name = String(row.name ?? row.description ?? row.title ?? row.customerName ?? "");
  const amount = typeof row.amount === "number" ? ` ₹${row.amount}` : "";
  return `${KIND_LABEL[op.kind]} ${COLL_LABEL[op.coll]}${name ? ` · ${name}` : ""}${amount}`;
}

function reject(op: Op, status: number | undefined) {
  rejected = [{ coll: op.coll, kind: op.kind, status, at: new Date().toISOString(), label: describe(op) }, ...rejected].slice(0, 30);
  if (rejectedLoaded) AsyncStorage.setItem(REJECTED_KEY, JSON.stringify(rejected)).catch(() => {});
}

export function rejectedChanges() {
  return rejected;
}

export async function clearRejected() {
  rejected = [];
  await AsyncStorage.removeItem(REJECTED_KEY).catch(() => {});
  notify();
}

export function useRejectedCount() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => rejected.length,
  );
}

/** Lists whose server copy this change can alter (a customer delete also removes / unlinks its rows). */
function touchedBy(op: Op): Coll[] {
  if (op.coll === "customers" && op.kind === "delete") return ["customers", "entries", "jobs", "aeps"];
  return [op.coll];
}

export async function flush() {
  await ensureLoaded();
  if (flushing || ops.length === 0) return;
  flushing = true;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  let drained = false;
  // Only lists that were written are fetched again, not all six.
  const touched = new Set<Coll>();
  try {
    while (ops.length > 0) {
      const op = ops[0];
      try {
        await send(op);
        serverFails = 0;
      } catch (e) {
        const status = statusOf(e);
        // One change the server keeps crashing on must not hold back everything queued after it.
        const stuck = status !== undefined && status >= 500 && ++serverFails >= MAX_SERVER_FAILS;
        if (isRetryable(e, op) && !stuck) {
          retryTimer = setTimeout(() => void flush(), RETRY_MS);
          return;
        }
        serverFails = 0;
        // Deleting something already gone elsewhere is not worth reporting.
        if (!(op.kind === "delete" && status === 404)) reject(op, status);
      }
      touchedBy(op).forEach((c) => touched.add(c));
      ops.shift();
      persist();
      notify();
    }
    drained = true;
  } finally {
    flushing = false;
    // Also after a pause for retry: what was already sent should show the server's copy.
    if (drained || touched.size) {
      for (const coll of touched) queryClient.invalidateQueries({ queryKey: [coll] });
    }
  }
}

export async function clearOutbox() {
  ops = [];
  rejected = [];
  serverFails = 0;
  await AsyncStorage.removeItem(REJECTED_KEY).catch(() => {});
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  await AsyncStorage.removeItem(KEY).catch(() => {});
  notify();
}

// Outside the "hisab_" prefix so the sign-out wipe keeps it; only the same account gets it back.
const PARKED_PREFIX = "parked_outbox_";

/** Sign-out with unsynced changes: keep them aside for this account instead of throwing them away. */
export async function parkOutbox(uid: string) {
  await ensureLoaded();
  if (!uid || ops.length === 0) return;
  try {
    const raw = await AsyncStorage.getItem(PARKED_PREFIX + uid);
    const earlier: Op[] = raw ? JSON.parse(raw) : [];
    await AsyncStorage.setItem(PARKED_PREFIX + uid, JSON.stringify([...earlier, ...ops]));
  } catch {}
}

/** Same account signed in again: queue its parked changes ahead of anything new. */
export async function unparkOutbox(uid: string) {
  if (!uid) return;
  try {
    const raw = await AsyncStorage.getItem(PARKED_PREFIX + uid);
    if (!raw) return;
    await ensureLoaded();
    const parked: Op[] = JSON.parse(raw);
    ops = [...parked, ...ops];
    await AsyncStorage.setItem(KEY, JSON.stringify(ops));
    await AsyncStorage.removeItem(PARKED_PREFIX + uid);
    for (const coll of COLLS) queryClient.invalidateQueries({ queryKey: [coll] });
    notify();
  } catch {}
}

export function pendingCount() {
  return ops.length;
}

export function usePendingCount() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => ops.length,
  );
}

AppState.addEventListener("change", (s) => {
  if (s === "active") void flush();
});

const now = () => new Date().toISOString();

export const store = {
  createCustomer(b: Omit<Customer, "id" | "createdAt">): Customer {
    const item: Customer = { id: Crypto.randomUUID(), createdAt: now(), ...b };
    enqueue({ kind: "create", coll: "customers", item });
    return item;
  },
  updateCustomer(id: string, b: Omit<Customer, "id" | "createdAt">) {
    enqueue({ kind: "update", coll: "customers", itemId: id, patch: b });
  },
  deleteCustomer(id: string) {
    const list = queryClient.getQueryData<Customer[]>(["customers"]);
    const target = list?.find((x) => x.id === id);
    if (target) void putInTrash("customers", target, bundleFor(id));
    enqueue({ kind: "delete", coll: "customers", itemId: id });
  },
  createEntry(b: Omit<Entry, "id" | "createdAt">): Entry {
    const item: Entry = { id: Crypto.randomUUID(), createdAt: now(), paid: 0, ...b };
    enqueue({ kind: "create", coll: "entries", item });
    return item;
  },
  updateEntry(id: string, patch: Partial<Omit<Entry, "id" | "createdAt">>) {
    // The API replaces type/date/description/amount/notes on every update, so send the whole row.
    const current = queryClient.getQueryData<Entry[]>(["entries"])?.find((x) => x.id === id);
    // Without the row a partial update would be refused by the server; it was deleted meanwhile.
    if (!current && !(patch.type && patch.date && patch.amount)) return;
    const base: Partial<Entry> = current ? { ...current } : {};
    delete base.id;
    delete base.createdAt;
    enqueue({ kind: "update", coll: "entries", itemId: id, patch: { ...base, ...patch } });
  },
  deleteEntry(id: string) {
    const list = queryClient.getQueryData<Entry[]>(["entries"]);
    const target = list?.find((x) => x.id === id);
    if (target) void putInTrash("entries", target);
    enqueue({ kind: "delete", coll: "entries", itemId: id });
  },
  createJob(b: Omit<Job, "id" | "createdAt" | "status"> & { status?: Job["status"] }): Job {
    const item: Job = { id: Crypto.randomUUID(), createdAt: now(), status: "pending", ...b };
    enqueue({ kind: "create", coll: "jobs", item });
    return item;
  },
  updateJob(id: string, patch: Partial<Omit<Job, "id" | "createdAt">>) {
    enqueue({ kind: "update", coll: "jobs", itemId: id, patch });
  },
  deleteJob(id: string) {
    const list = queryClient.getQueryData<Job[]>(["jobs"]);
    const target = list?.find((x) => x.id === id);
    if (target) void putInTrash("jobs", target);
    enqueue({ kind: "delete", coll: "jobs", itemId: id });
  },
  createAeps(b: Omit<AepsTxn, "id" | "createdAt">): AepsTxn {
    const item: AepsTxn = { id: Crypto.randomUUID(), createdAt: now(), ...b };
    enqueue({ kind: "create", coll: "aeps", item });
    return item;
  },
  updateAeps(id: string, b: Omit<AepsTxn, "id" | "createdAt">) {
    enqueue({ kind: "update", coll: "aeps", itemId: id, patch: b });
  },
  deleteAeps(id: string) {
    const list = queryClient.getQueryData<AepsTxn[]>(["aeps"]);
    const target = list?.find((x) => x.id === id);
    if (target) void putInTrash("aeps", target);
    enqueue({ kind: "delete", coll: "aeps", itemId: id });
  },
  createExpense(item: Expense) {
    enqueue({ kind: "create", coll: "expenses", item });
  },
  updateExpense(id: string, b: Omit<Expense, "id" | "createdAt">) {
    enqueue({ kind: "update", coll: "expenses", itemId: id, patch: b });
  },
  deleteExpense(id: string) {
    const target = queryClient.getQueryData<Expense[]>(["expenses"])?.find((x) => x.id === id);
    if (target) void putInTrash("expenses", target);
    enqueue({ kind: "delete", coll: "expenses", itemId: id });
  },
  createMove(item: Move) {
    enqueue({ kind: "create", coll: "moves", item });
  },
  updateMove(id: string, b: Omit<Move, "id" | "createdAt">) {
    enqueue({ kind: "update", coll: "moves", itemId: id, patch: b });
  },
  deleteMove(id: string) {
    const target = queryClient.getQueryData<Move[]>(["moves"])?.find((x) => x.id === id);
    if (target) void putInTrash("moves", target);
    enqueue({ kind: "delete", coll: "moves", itemId: id });
  },
  restoreRaw(coll: Coll, item: Record<string, unknown> & { id: string }) {
    enqueue({ kind: "create", coll, item });
  },
  /** Many creates at once (backup restore): one save and one cache update instead of one per row. */
  async restoreMany(rows: { coll: Coll; item: Record<string, unknown> & { id: string } }[]) {
    if (rows.length === 0) return;
    await ensureLoaded();
    const added: Op[] = rows.map(({ coll, item }) => ({ kind: "create", coll, item }));
    ops.push(...added);
    persist();
    for (const coll of COLLS) {
      queryClient.setQueryData<any[]>([coll], (old) => (old === undefined ? old : added.reduce((acc, op) => applyOp(coll, acc, op), old)));
    }
    notify();
    void flush();
  },
};
