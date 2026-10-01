import { useQuery } from "@tanstack/react-query";
import { api } from "@/src/lib/api";
import { withPending } from "@/src/lib/store";

export type Customer = { id: string; name: string; phone: string; address: string; notes: string; createdAt: string };
// work: service done · payment: money received from them · given: money handed to them (loan).
// paid: cash taken when the work was booked (work rows only, 0..amount).
// linkId: a payment that settles a specific work/given entry points at that entry.
export type EntryType = "work" | "payment" | "given";
export type Entry = { id: string; customerId: string; type: EntryType; date: string; description: string; amount: number; paid?: number; notes: string; linkId?: string; createdAt: string };
// customerId "" = the shopkeeper's own task (no customer, no money).
// entryId: the work entry booked when this job was completed.
export type Job = { id: string; customerId: string; title: string; dueDate: string; status: "pending" | "doing" | "done"; estimatedAmount: number; notes: string; entryId?: string; createdAt: string };

export type AepsType = "withdrawal" | "cash" | "deposit" | "transfer" | "upi" | "balance" | "recharge" | "bill" | "other";
export type AepsCash = "" | "in" | "out" | "none";
export type AepsStatus = "success" | "pending" | "failed";
export type AepsTxn = {
  id: string;
  type: AepsType;
  date: string;
  time: string;
  customerName: string;
  mobile: string;
  aadhaarLast4: string;
  bankName: string;
  amount: number;
  commission: number;
  status: AepsStatus;
  reference: string;
  operator: string;
  rechargeNumber: string;
  billerName: string;
  billAccount: string;
  beneficiaryName: string;
  accountNumber: string;
  ifsc: string;
  upiId?: string;
  /** Set only when type is "other"; otherwise the service decides the drawer. */
  cash?: AepsCash;
  notes: string;
  createdAt: string;
};

export function useCustomers() {
  return useQuery<Customer[]>({ queryKey: ["customers"], queryFn: async () => withPending("customers", await api.listCustomers()) });
}
export function useEntries() {
  return useQuery<Entry[]>({ queryKey: ["entries"], queryFn: async () => withPending("entries", await api.listEntries()) });
}
export function useJobs() {
  return useQuery<Job[]>({ queryKey: ["jobs"], queryFn: async () => withPending("jobs", await api.listJobs()) });
}
export function useAeps() {
  return useQuery<AepsTxn[]>({ queryKey: ["aeps"], queryFn: async () => withPending("aeps", await api.listAeps()) });
}

export function computeBalance(entries: Entry[], customerId?: string): number {
  const list = customerId ? entries.filter((e) => e.customerId === customerId) : entries;
  return list.reduce((s, e) => s + entryDelta(e), 0);
}

/** How much this row moves the customer's balance: udhaar part of work and money given up, payments down. */
export function entryDelta(e: Entry): number {
  if (e.type === "work") return e.amount - (e.paid ?? 0);
  return e.type === "given" ? e.amount : -e.amount;
}

/** Cash that came in with this row (for day totals). */
export function cashIn(e: Entry): number {
  if (e.type === "work") return e.paid ?? 0;
  return e.type === "payment" ? e.amount : 0;
}

/** Rows the customer owes on (payments settle these, oldest first). */
export const isDebt = (e: Entry) => e.type !== "payment";

/** Unlinked money already with us from this customer (negative balance), or 0. */
export function advanceOf(entries: Entry[], customerId: string): number {
  return Math.max(0, -computeBalance(entries, customerId));
}
