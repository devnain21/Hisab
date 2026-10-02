// Offline-first writes: every change is applied to the query cache immediately and
// queued in an AsyncStorage outbox that is replayed against the API in order.
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { api } from "@/src/lib/api";
import { queryClient } from "@/src/query-client";
import type { AepsTxn, Customer, Entry, Job } from "@/src/lib/data";
import { putInTrash } from "@/src/lib/trash";

type Coll = "customers" | "entries" | "jobs" | "aeps";
type Op =
  | { kind: "create"; coll: Coll; item: { id: string } & Record<string, unknown> }
  | { kind: "update"; coll: Coll; itemId: string; patch: Record<string, unknown> }
  | { kind: "delete"; coll: Coll; itemId: string };

const KEY = "hisab_outbox_v1";
const COLLS: Coll[] = ["customers", "entries", "jobs", "aeps"];
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
    queryClient.setQueryData<any[]>([coll], (old) => applyOp(coll, old ?? [], op));
  }
  notify();
  void flush();
}

function send(op: Op): Promise<unknown> {
  if (op.kind === "create") {
    if (op.coll === "customers") return api.createCustomer(op.item);
    if (op.coll === "entries") return api.createEntry(op.item);
    if (op.coll === "aeps") return api.createAeps(op.item);
    return api.createJob(op.item);
  }
  if (op.kind === "update") {
    if (op.coll === "customers") return api.updateCustomer(op.itemId, op.patch);
    if (op.coll === "entries") return api.updateEntry(op.itemId, op.patch);
    if (op.coll === "aeps") return api.updateAeps(op.itemId, op.patch);
    return api.updateJob(op.itemId, op.patch);
  }
  if (op.coll === "customers") return api.deleteCustomer(op.itemId);
  if (op.coll === "entries") return api.deleteEntry(op.itemId);
  if (op.coll === "aeps") return api.deleteAeps(op.itemId);
  return api.deleteJob(op.itemId);
}

function isRetryable(e: unknown) {
  const status = (e as { status?: number })?.status;
  return status === undefined || status === 401 || status === 408 || status === 429 || status >= 500;
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
  try {
    while (ops.length > 0) {
      const op = ops[0];
      try {
        await send(op);
      } catch (e) {
        if (isRetryable(e)) {
          retryTimer = setTimeout(() => void flush(), RETRY_MS);
          return;
        }
        // The server rejected this change outright (e.g. the job was deleted elsewhere); drop it.
      }
      ops.shift();
      persist();
      notify();
    }
    drained = true;
  } finally {
    flushing = false;
    if (drained) {
      for (const coll of COLLS) queryClient.invalidateQueries({ queryKey: [coll] });
    }
  }
}

export async function clearOutbox() {
  ops = [];
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  await AsyncStorage.removeItem(KEY).catch(() => {});
  notify();
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
    if (target) void putInTrash("customers", target);
    enqueue({ kind: "delete", coll: "customers", itemId: id });
  },
  createEntry(b: Omit<Entry, "id" | "createdAt">): Entry {
    const item: Entry = { id: Crypto.randomUUID(), createdAt: now(), paid: 0, ...b };
    enqueue({ kind: "create", coll: "entries", item });
    return item;
  },
  updateEntry(id: string, patch: Partial<Omit<Entry, "id" | "createdAt">>) {
    enqueue({ kind: "update", coll: "entries", itemId: id, patch });
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
  restoreRaw(coll: Coll, item: Record<string, unknown> & { id: string }) {
    enqueue({ kind: "create", coll, item });
  },
};
