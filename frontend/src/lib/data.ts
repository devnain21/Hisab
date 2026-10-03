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
// work: service done · payment: money received from them · given: money handed to them (loan, or
// paying back a purchase when linkId points at it) · purchase: goods / service taken from them on credit.
// paid: money settled on the spot (work: taken from them, purchase: paid to them; 0..amount).
// items: line items of a work / purchase; amount is their sum.
// aeps: what a customer still owes for a counter service (linkId = AEPS row; its money moves on that row).
// mode: payment mode ("cash" = cash drawer, "online" = UPI/Bank account).
// fee: government/portal fee or direct cost incurred by shopkeeper.
// feeMode: where government fee was paid from ("online" = Bank/UPI, "cash" = Drawer).
// linkId: a payment that settles a specific work/given entry points at that entry.
export type EntryType = "work" | "payment" | "given" | "purchase" | "aeps";
export type PaymentMode = "cash" | "online";
export type EntryItem = { title: string; amount: number };

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
  items?: EntryItem[];
  createdAt: string;
};
// customerId "" = the shopkeeper's own task (no customer, no money).
// entryId: the work entry booked when this job was completed.
export type Job = { id: string; customerId: string; title: string; dueDate: string; status: "pending" | "doing" | "done"; estimatedAmount: number; notes: string; entryId?: string; createdAt: string };

export type AepsType = "withdrawal" | "cash" | "deposit" | "transfer" | "upi" | "balance" | "recharge" | "bill" | "other";
export type AepsCash = "" | "in" | "out" | "none";
export type AepsStatus = "success" | "pending" | "failed";
export type AepsCommissionMode = "" | "cash" | "online" | "app";
export type AepsVia = "" | "aeps" | "upi" | "bank" | "emi";
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
  /** Shop customer the service was done for ("" on older rows). */
  customerId?: string;
  via?: AepsVia;
  /** Money the customer handed over toward the amount; null/undefined on older rows = all of it. */
  collected?: number | null;
  /** How the customer paid: cash lands in the galla, online in the bank. */
  payMode?: "" | "cash" | "online";
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
  if (e.type === "purchase") return -(e.amount - (e.paid ?? 0));
  if (e.type === "aeps") return e.amount;
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
export const isDebt = (e: Entry) => e.type === "work" || e.type === "aeps" || (e.type === "given" && !e.linkId);

/** Money paid back against a purchase (shown inside that purchase). */
export const isRepayment = (e: Entry) => e.type === "given" && !!e.linkId;

/** Line items of a row; older rows are one item made from the description. */
export function itemsOf(e: Pick<Entry, "items" | "description" | "amount">, fallback = ""): EntryItem[] {
  if (e.items && e.items.length) return e.items;
  return [{ title: e.description || fallback, amount: e.amount }];
}

/** Unlinked money already with us from this customer (negative balance), or 0. */
export function advanceOf(entries: Entry[], customerId: string): number {
  return Math.max(0, -computeBalance(entries, customerId));
}

/** One-line description with each item's amount, for exports. */
export function itemsText(e: Pick<Entry, "items" | "description">): string {
  if (!e.items || e.items.length < 2) return e.description;
  return e.items.map((i) => `${i.title} ₹${i.amount}`).join(", ");
}
