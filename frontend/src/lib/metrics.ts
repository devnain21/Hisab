import { isRepayment, isVendor, type AepsTxn, type Customer, type Entry, type Job } from "./data";
import { expensePersona, type Expense } from "./expenses";
import { commissionEarnedOn } from "./aeps";
import { buildAllLedgers, isWorkVendorCost } from "./records";
import { formatINR, localDay, roundMoney } from "./format";
import { personaOfEntry } from "./wallet";
import type { Persona } from "./persona";

type Book = { entries: Entry[]; customers: Customer[]; aeps: AepsTxn[]; expenses: Expense[]; jobs?: Job[] };

/**
 * One rule per summary figure, shared by the summaries and their drill-down lists so a list always adds up
 * to the figure that opened it. Rows count by their own date (old-dated rows included), like the khata.
 *
 * work: work that came in that day, in any mode and whether finished or still pending (a job finished later
 * counts on the day it came in) · fee: govt / portal fees on that work · vendor: every vendor order
 * (outsourced work and stock) · workVendor: only the vendor cost of finished work · commission: AEPS / service
 * commission (never the counter amount) · expense · collected: money received from customers / people ·
 * given: money lent out · paidOut: money paid for goods / services and repaid · goods: goods / services bought.
 * Fees and vendor cost of a piece of work sit on the day that work came in, so the day's margin adds up.
 */
export type MetricKind = "work" | "fee" | "vendor" | "workVendor" | "commission" | "expense" | "collected" | "given" | "paidOut" | "goods";

export const METRIC_KINDS: MetricKind[] = ["work", "fee", "vendor", "workVendor", "commission", "expense", "collected", "given", "paidOut", "goods"];

export type MetricRow =
  | { key: string; date: string; amount: number; source: "entry"; entry: Entry }
  | { key: string; date: string; amount: number; source: "job"; job: Job }
  | { key: string; date: string; amount: number; source: "expense"; expense: Expense }
  | { key: string; date: string; amount: number; source: "aeps"; txn: AepsTxn };

type Arrivals = { work: Map<string, string>; open: { job: Job; date: string }[] };
const arrivalCache = new WeakMap<Entry[], WeakMap<Job[], Arrivals>>();

/**
 * Day each piece of work came in. A finished job's work row is dated the day it was finished; it came in on
 * its job card's day (or the day of an advance taken before that). `work` holds only rows that came in
 * earlier than their own date; `open` is every job still pending, with the day it came in.
 */
export function workArrivals(entries: Entry[], jobs: Job[]): Arrivals {
  const hit = arrivalCache.get(entries)?.get(jobs);
  if (hit) return hit;
  const firstPaid = new Map<string, string>();
  const workDay = new Map<string, string>();
  for (const e of entries) {
    if (e.type === "work") workDay.set(e.id, e.date);
    else if (e.type === "payment" && e.linkId) {
      const d = firstPaid.get(e.linkId);
      if (!d || e.date < d) firstPaid.set(e.linkId, e.date);
    }
  }
  const earliest = (...days: (string | null | undefined)[]) => days.filter((d): d is string => !!d).sort()[0] ?? "";
  const out: Arrivals = { work: new Map(), open: [] };
  for (const j of jobs) {
    if (!j.customerId) continue;
    if (j.status === "done") {
      const done = j.entryId ? workDay.get(j.entryId) : undefined;
      if (!done) continue;
      const came = earliest(done, localDay(j.createdAt), firstPaid.get(j.entryId!), firstPaid.get(j.id));
      if (came < done) out.work.set(j.entryId!, came);
    } else {
      const came = earliest(localDay(j.createdAt), firstPaid.get(j.id));
      if (came) out.open.push({ job: j, date: came });
    }
  }
  let inner = arrivalCache.get(entries);
  if (!inner) arrivalCache.set(entries, (inner = new WeakMap()));
  inner.set(jobs, out);
  return out;
}

const NO_JOBS: Job[] = [];

export type WorkMoney = { cash: number; online: number; jama: number; left: number; pending: boolean };

/**
 * How a piece of work has been paid for: cash / online taken on the row or against it, old jama applied to it,
 * and what is still to come. `upTo`: count only money that came in up to that day. A pending job counts its advances.
 */
export function workMoney(r: MetricRow, entries: Entry[], upTo?: string): WorkMoney {
  // Work finished after `upTo` was still a pending job on that day.
  const pending = r.source === "job" || (!!upTo && r.source === "entry" && r.entry.date > upTo);
  const m: WorkMoney = { cash: 0, online: 0, jama: 0, left: 0, pending };
  const add = (mode: string | undefined, amt: number) => {
    if (mode === "online") m.online += amt;
    else m.cash += amt;
  };
  const ok = (d: string) => !upTo || d <= upTo;
  if (r.source === "job") {
    for (const e of entries) if (e.type === "payment" && e.linkId === r.job.id && ok(e.date)) add(e.mode, e.amount);
  } else if (r.source === "entry" && r.entry.type === "work") {
    const w = r.entry;
    if (ok(w.date)) add(w.mode, Math.min(w.paid ?? 0, w.amount));
    for (const e of entries) if (e.type === "payment" && e.linkId === w.id && ok(e.date)) add(e.mode, e.amount);
    if (!upTo) m.jama = buildAllLedgers(entries).get(w.id)?.fromJama ?? 0;
  }
  const got = Math.min(m.cash + m.online + m.jama, r.amount);
  m.cash = roundMoney(m.cash);
  m.online = roundMoney(m.online);
  m.jama = roundMoney(m.jama);
  m.left = roundMoney(Math.max(0, r.amount - got));
  return m;
}

/** "नकद ₹200 · UPI ₹100 · उधार ₹150", or for a pending job "पेंडिंग · एडवांस ₹100". */
export function workMoneyText(m: WorkMoney): string {
  const parts: string[] = [];
  if (m.pending) parts.push("पेंडिंग");
  const adv = m.pending ? "एडवांस " : "";
  if (m.cash > 0) parts.push(`${adv}नकद ${formatINR(m.cash)}`);
  if (m.online > 0) parts.push(`${adv}UPI ${formatINR(m.online)}`);
  if (m.jama > 0) parts.push(`जमा से ${formatINR(m.jama)}`);
  if (!m.pending && m.left > 0) parts.push(m.cash + m.online + m.jama > 0 ? `उधार ${formatINR(m.left)}` : "पूरा उधार");
  if (!m.pending && m.left <= 0 && parts.length) parts.unshift("पूरे मिले");
  return parts.join(" · ");
}

export function metricRows(book: Book, persona: Persona, kind: MetricKind, from: string, to: string): MetricRow[] {
  const inRange = (d: string | null | undefined) => !!d && d >= from && d <= to;
  const rows: MetricRow[] = [];
  if (kind === "work" || kind === "fee" || kind === "workVendor" || kind === "vendor") {
    const byId = new Map(book.customers.map((c) => [c.id, c]));
    const workIds = new Set(book.entries.filter((e) => e.type === "work").map((e) => e.id));
    const arrivals = workArrivals(book.entries, book.jobs ?? NO_JOBS);
    for (const e of book.entries) {
      const workId = e.type === "work" ? e.id : e.type === "purchase" && e.refId && workIds.has(e.refId) ? e.refId : "";
      const day = (workId && arrivals.work.get(workId)) || e.date;
      if (!inRange(day) || personaOfEntry(e, byId) !== persona) continue;
      const amount = entryAmount(e, kind, persona, byId, workIds);
      if (amount > 0) rows.push({ key: e.id, date: day, amount, source: "entry", entry: e });
    }
    if (kind === "work") {
      for (const { job, date } of arrivals.open) {
        if (!inRange(date) || job.estimatedAmount <= 0) continue;
        if ((byId.get(job.customerId)?.persona === "personal" ? "personal" : "business") !== persona) continue;
        rows.push({ key: job.id, date, amount: job.estimatedAmount, source: "job", job });
      }
    }
  } else if (kind === "expense") {
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
  return r.source === "entry" ? r.entry.createdAt : r.source === "job" ? r.job.createdAt : r.source === "expense" ? r.expense.createdAt : r.txn.createdAt;
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
