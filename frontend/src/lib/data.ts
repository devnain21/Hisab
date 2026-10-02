import { useQuery } from "@tanstack/react-query";
import { api } from "@/src/lib/api";
import { withPending } from "@/src/lib/store";

export type Customer = {
  id: string;
  name: string;
  phone: string;
  address: string;
  notes: string;
  persona?: "business" | "personal";
  createdAt: string;
};
// work: service done · payment: money received from them · given: money handed to them (loan).
// paid: money taken when the work was booked (work rows only, 0..amount).
// mode: payment mode ("cash" = cash drawer, "online" = UPI/Bank account).
// fee: government/portal fee or direct cost incurred by shopkeeper.
// feeMode: where government fee was paid from ("online" = Bank/UPI, "cash" = Drawer).
// linkId: a payment that settles a specific work/given entry points at that entry.
export type EntryType = "work" | "payment" | "given";
export type PaymentMode = "cash" | "online";

export type Entry = {
  id: string;
  customerId: string;
  type: EntryType;
  date: string;
  description: string;
  amount: number;
  paid?: number;
  mode?: PaymentMode;
  fee?: number;
  feeMode?: PaymentMode;
  notes: string;
  linkId?: string;
  createdAt: string;
};
// customerId "" = the shopkeeper's own task (no customer, no money).
// entryId: the work entry booked when this job was completed.
export type Job = { id: string; customerId: string; title: string; dueDate: string; status: "pending" | "doing" | "done"; estimatedAmount: number; notes: string; entryId?: string; createdAt: string };

export type AepsType = "withdrawal" | "cash" | "deposit" | "transfer" | "upi" | "balance" | "recharge" | "bill" | "other";
export type AepsCash = "" | "in" | "out" | "none";
export type AepsStatus = "success" | "pending" | "failed";
export type AepsCommissionMode = "" | "cash" | "online" | "app";
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
  commissionMode?: AepsCommissionMode;
  /** Day the counter cash changed hands; "" = not yet, null/undefined = older row (follows status). */
  cashDate?: string | null;
  /** Day the bank side went through; "" while pending. */
  doneDate?: string;
  /** Pending row to be sent on this day. */
  dueDate?: string;
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

/** Cash that came into Cash Drawer (गल्ला) with this row. */
export function cashIn(e: Entry): number {
  if (e.mode === "online") return 0;
  if (e.type === "work") return e.paid ?? 0;
  return e.type === "payment" ? e.amount : 0;
}

/** Online money received into Bank/UPI with this row. */
export function onlineIn(e: Entry): number {
  if (e.mode !== "online") return 0;
  if (e.type === "work") return e.paid ?? 0;
  return e.type === "payment" ? e.amount : 0;
}

/** Portal fees/charges or direct cost for this work entry. */
export function entryFee(e: Entry): number {
  return Math.max(0, e.fee ?? 0);
}

/** Net earning / profit margin for this work entry (turnover minus portal fees/cost). */
export function entryProfit(e: Entry): number {
  if (e.type === "work") {
    return Math.max(0, e.amount - entryFee(e));
  }
  return 0;
}

/** Rows the customer owes on (payments settle these, oldest first). */
export const isDebt = (e: Entry) => e.type !== "payment";

/** Unlinked money already with us from this customer (negative balance), or 0. */
export function advanceOf(entries: Entry[], customerId: string): number {
  return Math.max(0, -computeBalance(entries, customerId));
}
