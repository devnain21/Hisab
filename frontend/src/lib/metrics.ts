import { isRepayment, isVendor, type AepsTxn, type Customer, type Entry } from "./data";
import { expensePersona, type Expense } from "./expenses";
import { commissionEarnedOn } from "./aeps";
import { isWorkVendorCost } from "./records";
import { roundMoney } from "./format";
import { personaOfEntry } from "./wallet";
import type { Persona } from "./persona";

type Book = { entries: Entry[]; customers: Customer[]; aeps: AepsTxn[]; expenses: Expense[] };

/**
 * One rule per summary figure, shared by the summaries and their drill-down lists so a list always adds up
 * to the figure that opened it. Rows count by their own date (old-dated rows included), like the khata.
 *
 * work: work booked in any mode · fee: govt / portal fees on that work · vendor: every vendor order
 * (outsourced work and stock) · workVendor: only the vendor cost of finished work · commission: AEPS / service
 * commission (never the counter amount) · expense · collected: money received from customers / people ·
 * given: money lent out · paidOut: money paid for goods / services and repaid · goods: goods / services bought.
 */
export type MetricKind = "work" | "fee" | "vendor" | "workVendor" | "commission" | "expense" | "collected" | "given" | "paidOut" | "goods";

export const METRIC_KINDS: MetricKind[] = ["work", "fee", "vendor", "workVendor", "commission", "expense", "collected", "given", "paidOut", "goods"];

export type MetricRow =
  | { key: string; date: string; amount: number; source: "entry"; entry: Entry }
  | { key: string; date: string; amount: number; source: "expense"; expense: Expense }
  | { key: string; date: string; amount: number; source: "aeps"; txn: AepsTxn };

export function metricRows(book: Book, persona: Persona, kind: MetricKind, from: string, to: string): MetricRow[] {
  const inRange = (d: string | null | undefined) => !!d && d >= from && d <= to;
  const rows: MetricRow[] = [];
  if (kind === "expense") {
    for (const x of book.expenses) {
      if (inRange(x.date) && expensePersona(x) === persona) rows.push({ key: x.id, date: x.date, amount: x.amount, source: "expense", expense: x });
    }
  } else if (kind === "commission") {
    if (persona !== "business") return rows;
    for (const t of book.aeps) {
      const day = commissionEarnedOn(t);
      if (day && inRange(day)) rows.push({ key: t.id, date: day, amount: t.commission, source: "aeps", txn: t });
    }
  } else {
    const byId = new Map(book.customers.map((c) => [c.id, c]));
    const workIds = new Set(book.entries.filter((e) => e.type === "work").map((e) => e.id));
    for (const e of book.entries) {
      if (!inRange(e.date) || personaOfEntry(e, byId) !== persona) continue;
      const amount = entryAmount(e, kind, persona, byId, workIds);
      if (amount > 0) rows.push({ key: e.id, date: e.date, amount, source: "entry", entry: e });
    }
  }
  return rows.sort((a, b) => b.date.localeCompare(a.date) || createdOf(b).localeCompare(createdOf(a)));
}

function entryAmount(e: Entry, kind: MetricKind, persona: Persona, byId: Map<string, Customer>, workIds: Set<string>): number {
  switch (kind) {
    case "work":
      return e.type === "work" ? e.amount : 0;
    case "fee":
      return e.type === "work" ? e.fee ?? 0 : 0;
    case "vendor":
      // A vendor order of a job still pending is not a cost yet; it counts on the day the job is finished.
      return persona === "business" && e.type === "purchase" && isVendor(byId.get(e.customerId)) && (!e.refId || workIds.has(e.refId)) ? e.amount : 0;
    case "workVendor":
      return isWorkVendorCost(e, workIds) ? e.amount : 0;
    case "collected":
      return e.type === "payment" ? e.amount : e.type === "work" ? e.paid ?? 0 : 0;
    case "given":
      return e.type === "given" && !isRepayment(e) ? e.amount : 0;
    case "goods":
      return e.type === "purchase" ? e.amount : 0;
    case "paidOut":
      return e.type === "purchase" ? e.paid ?? 0 : e.type === "given" && isRepayment(e) ? e.amount : 0;
    default:
      return 0;
  }
}

function createdOf(r: MetricRow): string {
  return r.source === "entry" ? r.entry.createdAt : r.source === "expense" ? r.expense.createdAt : r.txn.createdAt;
}

export function metricSum(book: Book, persona: Persona, kind: MetricKind, from: string, to: string): number {
  return roundMoney(metricRows(book, persona, kind, from, to).reduce((s, r) => s + r.amount, 0));
}

/**
 * कमाई of the shop, the one rule every screen shows: work + commission − expenses − portal fees − vendor cost.
 * बचत is only ever the galla / bank change; the work margin (work − fees − vendor cost of that work) is "मार्जिन".
 */
export function shopProfit(book: Book, from: string, to: string) {
  const sum = (k: MetricKind) => metricSum(book, "business", k, from, to);
  const work = sum("work");
  const commission = sum("commission");
  const expense = sum("expense");
  const fee = sum("fee");
  const vendor = sum("vendor");
  return { work, commission, expense, fee, vendor, profit: roundMoney(work + commission - expense - fee - vendor) };
}
