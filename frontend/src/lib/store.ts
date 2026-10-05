// Offline-first writes: every change is applied to the query cache immediately and
// queued in an AsyncStorage outbox that is replayed against the API in order.
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { api, serverIsUp } from "@/src/lib/api";
import { queryClient } from "@/src/query-client";
import type { AepsTxn, Customer, Entry, Job } from "@/src/lib/data";
import type { Expense } from "@/src/lib/expenses";
import type { Move } from "@/src/lib/wallet";
import { bundleFor, putInTrash } from "@/src/lib/trash";
import { fileStore } from "@/src/lib/file-store";

export type Coll = "customers" | "entries" | "jobs" | "aeps" | "expenses" | "moves";
type Op =
  | { kind: "create"; coll: Coll; item: { id: string } & Record<string, unknown> }
  // `base`: the server copy (updatedAt) this edit was made from; a newer copy saved elsewhere is not overwritten.
  | { kind: "update"; coll: Coll; itemId: string; patch: Record<string, unknown>; base?: string }
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

// A file, not AsyncStorage: Android caps one AsyncStorage value at ~2 MB, which a long offline spell can cross.
function ensureLoaded() {
  if (!loadPromise) {
    loadPromise = fileStore
      .getItem(KEY)
      .then((raw) => {
        const saved: Op[] = raw ? JSON.parse(raw) : [];
        ops = [...saved, ...ops];
      })
      .catch(() => {})
      .finally(notify);
  }
  return loadPromise;
}

// Never written before the saved queue is read, or a change made at startup would overwrite it.
function persist() {
  void ensureLoaded().then(() => fileStore.setItem(KEY, JSON.stringify(ops)).catch(() => {}));
}

void ensureLoaded();

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

const savedVersion = (coll: Coll, id: string): string | undefined =>
  (queryClient.getQueryData<{ id: string; updatedAt?: string }[]>([coll]) ?? []).find((x) => x.id === id)?.updatedAt;

function enqueue(op: Op) {
  if (op.kind === "update") {
    // Rows copied from the cache carry an old updatedAt; it must never overwrite the server's.
    const { updatedAt: _stale, ...patch } = op.patch;
    op = { ...op, patch, base: op.base ?? savedVersion(op.coll, op.itemId) };
  }
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
    if (op.coll === "customers") return api.updateCustomer(op.itemId, op.patch, op.base);
    if (op.coll === "entries") return api.updateEntry(op.itemId, op.patch, op.base);
    if (op.coll === "aeps") return api.updateAeps(op.itemId, op.patch, op.base);
    if (op.coll === "expenses") return api.updateExpense(op.itemId, op.patch, op.base);
    if (op.coll === "moves") return api.updateMove(op.itemId, op.patch as Record<string, unknown> & { from: string; to: string }, op.base);
    return api.updateJob(op.itemId, op.patch, op.base);
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
export type RejectedChange = { coll: Coll; kind: Op["kind"]; status: number | undefined; at: string; label: string; op?: Op };
const REJECTED_KEY = "hisab_rejected_v1";
const MAX_SERVER_FAILS = 5;
const MAX_REJECTED = 100;
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

const COLL_LABEL: Record<Coll, string> = { customers: "खाता", entries: "एंट्री", jobs: "काम", aeps: "काउंटर एंट्री", expenses: "खर्च", moves: "पैसे जोड़े / निकाले" };
const KIND_LABEL: Record<Op["kind"], string> = { create: "नई", update: "बदली गई", delete: "हटाई गई" };

function describe(op: Op): string {
  const row = (op.kind === "create" ? op.item : op.kind === "update" ? op.patch : {}) as Record<string, unknown>;
  const name = String(row.name ?? row.description ?? row.title ?? row.customerName ?? "");
  const amount = typeof row.amount === "number" ? ` ₹${row.amount}` : "";
  return `${KIND_LABEL[op.kind]} ${COLL_LABEL[op.coll]}${name ? ` · ${name}` : ""}${amount}`;
}

function reject(op: Op, status: number | undefined) {
  const label = describe(op) + (status === 409 ? " (दूसरे फ़ोन / वेबसाइट पर बदल चुका)" : "");
  rejected = [{ coll: op.coll, kind: op.kind, status, at: new Date().toISOString(), label, op }, ...rejected].slice(0, MAX_REJECTED);
  if (rejectedLoaded) AsyncStorage.setItem(REJECTED_KEY, JSON.stringify(rejected)).catch(() => {});
}

export function rejectedChanges() {
  return rejected;
}

/** Changes set aside whose full data was kept and can be sent again. */
export function retryableRejectedCount() {
  return rejected.filter((r) => r.op).length;
}

/** Queue the set-aside changes again, oldest first; ones saved without their data stay listed. */
export async function retryRejected() {
  await ensureLoaded();
  // Sent again on purpose: an edit refused as out of date now replaces the newer copy.
  const again = rejected
    .filter((r) => r.op)
    .reverse()
    .map((r) => {
      const op = r.op as Op;
      return op.kind === "update" ? { ...op, base: undefined } : op;
    });
  if (again.length === 0) return;
  rejected = rejected.filter((r) => !r.op);
  await AsyncStorage.setItem(REJECTED_KEY, JSON.stringify(rejected)).catch(() => {});
  for (const op of again) {
    ops.push(op);
    for (const coll of COLLS) queryClient.setQueryData<any[]>([coll], (old) => (old === undefined ? old : applyOp(coll, old, op)));
  }
  persist();
  notify();
  void flush();
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

// Off until sign-in has confirmed whose changes are queued, so they never go out under another account's token.
let syncEnabled = false;

export function setSyncEnabled(on: boolean) {
  syncEnabled = on;
  if (on) void flush();
}

/** Our own save is the newest copy now: later queued edits of the row, and the next ones, build on it. */
function adoptVersion(op: Op, version: string) {
  const id = op.kind === "create" ? op.item.id : op.kind === "update" ? op.itemId : "";
  for (const o of ops) if (o !== op && o.kind === "update" && o.coll === op.coll && o.itemId === id) o.base = version;
  queryClient.setQueryData<{ id: string; updatedAt?: string }[]>([op.coll], (old) => old?.map((x) => (x.id === id ? { ...x, updatedAt: version } : x)));
}

export async function flush() {
  await ensureLoaded();
  if (!syncEnabled || flushing || ops.length === 0) return;
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
      if (!syncEnabled) return;
      const op = ops[0];
      try {
        const saved = (await send(op)) as { updatedAt?: string } | null;
        serverFails = 0;
        if (op.kind !== "delete" && saved?.updatedAt) adoptVersion(op, saved.updatedAt);
      } catch (e) {
        const status = statusOf(e);
        // One change the server keeps crashing on must not hold back everything queued after it,
        // but while the whole server is down nothing is set aside.
        const stuck = status !== undefined && status >= 500 && ++serverFails >= MAX_SERVER_FAILS && (await serverIsUp());
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
  // A load still in flight would otherwise bring the cleared changes back.
  await ensureLoaded();
  ops = [];
  rejected = [];
  serverFails = 0;
  await AsyncStorage.removeItem(REJECTED_KEY).catch(() => {});
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  await fileStore.removeItem(KEY).catch(() => {});
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
    await fileStore.setItem(KEY, JSON.stringify(ops));
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
    // Counter rows stay (unlinked) with their galla / bank movement, so the cash a customer left on
    // them must stay too: it is carried over as money added, same day and typed-on time.
    const aepsIds = new Set((queryClient.getQueryData<AepsTxn[]>(["aeps"]) ?? []).map((t) => t.id));
    const jama = (queryClient.getQueryData<Entry[]>(["entries"]) ?? []).filter(
      (e) => e.customerId === id && e.type === "payment" && !!e.linkId && aepsIds.has(e.linkId),
    );
    const moves: Move[] = jama.map((e) => ({
      id: Crypto.randomUUID(),
      date: e.date,
      from: "",
      to: e.mode === "online" ? "business:bank" : "business:cash",
      amount: e.amount,
      note: `${target?.name ?? "ग्राहक"} · काउंटर जमा (खाता हटाया)`,
      createdAt: e.createdAt,
    }));
    if (target) void putInTrash("customers", target, { ...bundleFor(id), jamaMoveIds: moves.map((m) => m.id) });
    enqueue({ kind: "delete", coll: "customers", itemId: id });
    moves.forEach((m) => enqueue({ kind: "create", coll: "moves", item: m }));
  },
  /** Removes a row without putting it in the recycle bin (undoing a row the app itself added). */
  dropRaw(coll: Coll, itemId: string) {
    enqueue({ kind: "delete", coll, itemId });
  },
  /** `createdAt` only for rows that must share another row's typed-on time (galla skips late-typed rows by it). */
  createEntry(b: Omit<Entry, "id" | "createdAt"> & { createdAt?: string }): Entry {
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
  createAeps(b: Omit<AepsTxn, "id" | "createdAt">, createdAt?: string): AepsTxn {
    const item: AepsTxn = { id: Crypto.randomUUID(), createdAt: createdAt ?? now(), ...b };
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
