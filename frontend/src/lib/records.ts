// A "work record" is the work entry, any payments that settle it (linkId) and the finished
// job card (entryId). Older rows predate the explicit links, so fall back to matching the way
// recordWork used to name them.
import { useEffect, useRef } from "react";
import { store } from "@/src/lib/store";
import { isDebt, isRepayment, useEntries, useJobs, type Entry, type Job } from "@/src/lib/data";
import { roundMoney, todayISO } from "@/src/lib/format";

const isLegacyPairFor = (work: Entry, e: Entry) =>
  work.type === "work" &&
  e.type === "payment" &&
  !e.linkId &&
  e.customerId === work.customerId &&
  e.date === work.date &&
  e.description.startsWith(`${work.description} — `);

/** Rows booked specifically against this entry: payments for work / given, repayments for a purchase. */
export function settlementsFor(work: Entry, entries: Entry[]): Entry[] {
  if (work.type === "purchase") return entries.filter((e) => isRepayment(e) && e.linkId === work.id).sort(byTime);
  return entries
    .filter((e) => e.type === "payment" && (e.linkId === work.id || isLegacyPairFor(work, e)))
    .sort((a, b) => (a.date !== b.date ? a.date.localeCompare(b.date) : a.createdAt.localeCompare(b.createdAt)));
}

/** Old two-row cash records: the payment written on the same day as the work. */
export function linkedPayment(work: Entry, entries: Entry[]): Entry | undefined {
  return settlementsFor(work, entries).find((p) => p.date === work.date);
}

export function workForPayment(payment: Entry, entries: Entry[]): Entry | undefined {
  if (payment.linkId) return entries.find((e) => e.id === payment.linkId);
  const sep = payment.description.lastIndexOf(" — ");
  if (sep < 0) return undefined;
  const title = payment.description.slice(0, sep);
  return entries.find(
    (e) => e.type === "work" && e.customerId === payment.customerId && e.date === payment.date && e.description === title,
  );
}

export function jobForWork(work: Entry, jobs: Job[]): Job | undefined {
  return (
    jobs.find((j) => j.entryId === work.id) ??
    jobs.find(
      (j) => !j.entryId && j.status === "done" && j.customerId === work.customerId && j.title === work.description && j.dueDate === work.date,
    )
  );
}

export function workForJob(job: Job, entries: Entry[]): Entry | undefined {
  if (job.entryId) return entries.find((e) => e.id === job.entryId);
  if (job.status !== "done") return undefined;
  return entries.find((e) => e.type === "work" && e.customerId === job.customerId && e.description === job.title && e.date === job.dueDate);
}

/** `workForJob` for many jobs at once: one pass over entries instead of one per job. Same first-match result. */
export function workForJobs(jobs: Job[], entries: Entry[]): Map<string, Entry> {
  const byId = new Map<string, Entry>();
  const byKey = new Map<string, Entry>();
  for (const e of entries) {
    if (!byId.has(e.id)) byId.set(e.id, e);
    if (e.type !== "work") continue;
    const k = `${e.customerId}\u0000${e.description}\u0000${e.date}`;
    if (!byKey.has(k)) byKey.set(k, e);
  }
  const out = new Map<string, Entry>();
  for (const j of jobs) {
    const w = j.entryId ? byId.get(j.entryId) : j.status === "done" ? byKey.get(`${j.customerId}\u0000${j.title}\u0000${j.dueDate}`) : undefined;
    if (w) out.set(j.id, w);
  }
  return out;
}

export const ADVANCE = "एडवांस";

/** Advance taken while booking a future job. Older rows carry no link, only the note. */
export function advancesForJob(job: Job, entries: Entry[]): Entry[] {
  if (!job.customerId) return [];
  return entries.filter(
    (e) =>
      e.type === "payment" &&
      e.customerId === job.customerId &&
      (e.linkId === job.id || (!e.linkId && e.description === ADVANCE && e.notes === `${job.title} के लिए`)),
  );
}

/** Unlinked advance rows written with a work entry by older versions. */
function legacyAdvancesForWork(work: Entry, entries: Entry[]): Entry[] {
  const notes = [`${work.description} के लिए`, `${work.description} के साथ`];
  return entries.filter(
    (e) => e.type === "payment" && !e.linkId && e.customerId === work.customerId && e.description === ADVANCE && notes.includes(e.notes),
  );
}

/**
 * Money that changed hands on another day is a past galla / bank event: it stays on the khata
 * (unlinked) instead of disappearing with the entry it was booked against.
 */
function dropOrKeep(rows: Entry[], day: string) {
  rows.forEach((p) => {
    // An old advance found only by its note may belong to another job of the same name; it stays on the khata.
    if (!p.linkId && p.description === ADVANCE) return;
    if (p.date === day) store.deleteEntry(p.id);
    else if (p.linkId) store.updateEntry(p.id, { linkId: "" });
  });
}

/** Vendor purchase rows booked for this piece of work ("वेंडर से कराया"). */
export function vendorCostsFor(work: Entry, entries: Entry[]): Entry[] {
  return entries.filter((e) => e.type === "purchase" && e.refId === work.id);
}

/** Drops a vendor cost row; a payment made to them on another day stays as their advance. */
export function removeVendorCost(row: Entry, entries: Entry[]) {
  store.deleteEntry(row.id);
  dropOrKeep(settlementsFor(row, entries), row.date);
}

/** Removes a khata entry together with the rows that were booked with it. */
export function removeEntryWithLinks(entry: Entry, entries: Entry[], jobs: Job[]) {
  if (entry.type === "given" || entry.type === "purchase") {
    store.deleteEntry(entry.id);
    dropOrKeep(settlementsFor(entry, entries), entry.date);
    return;
  }
  const work = entry.type === "work" ? entry : workForPayment(entry, entries);
  if (!work || work.type !== "work" || (entry.type === "payment" && entry.date !== work.date)) {
    // A later settlement is its own event; removing it just re-opens the udhaar.
    store.deleteEntry(entry.id);
    return;
  }
  const job = jobForWork(work, jobs);
  const linked = new Map<string, Entry>();
  [...settlementsFor(work, entries), ...legacyAdvancesForWork(work, entries), ...(job ? advancesForJob(job, entries) : [])].forEach((p) => linked.set(p.id, p));
  store.deleteEntry(work.id);
  dropOrKeep([...linked.values()], work.date);
  vendorCostsFor(work, entries).forEach((v) => removeVendorCost(v, entries));
  if (job) store.deleteJob(job.id);
  remindersFor(work, jobs).forEach((j) => store.deleteJob(j.id));
}

/**
 * Removes an open job card. An advance taken today goes with it; one taken on an earlier day
 * already sits in that day's galla / bank, so it stays on the khata as the customer's advance.
 */
export function removeJobWithAdvances(job: Job, entries: Entry[]) {
  dropOrKeep(advancesForJob(job, entries), todayISO());
  store.deleteJob(job.id);
}

/** Advance rows of this job that were taken before today (they stay when the job is removed). */
export function olderAdvances(job: Job, entries: Entry[]): Entry[] {
  const today = todayISO();
  return advancesForJob(job, entries).filter((p) => p.date !== today);
}

/** Follow-up reminders saved together with this work ("पिछला काम: …", same customer, same save). */
function remindersFor(work: Entry, jobs: Job[]): Job[] {
  const at = Date.parse(work.createdAt);
  return jobs.filter(
    (j) =>
      j.status !== "done" &&
      j.customerId === work.customerId &&
      j.notes === `पिछला काम: ${work.description}` &&
      Number.isFinite(at) &&
      Math.abs(Date.parse(j.createdAt) - at) < 2 * 60_000,
  );
}

export function linkedCount(entry: Entry, entries: Entry[], jobs: Job[]): number {
  const work = entry.type === "work" ? entry : workForPayment(entry, entries);
  if (!work) return 0;
  return settlementsFor(work, entries).length + (jobForWork(work, jobs) ? 1 : 0) + (work.id !== entry.id ? 1 : 0);
}

/**
 * Older versions booked cash work as two rows (work + same-day jama). Fold those into the
 * work row's `paid` so cash work is one row. The balance is unchanged either way.
 */
export function foldLegacyCashRows(entries: Entry[]): number {
  let folded = 0;
  // Old pairs are unlinked payments of the same customer on the same day; index them once.
  const pairs = new Map<string, Entry[]>();
  for (const e of entries) {
    if (e.type !== "payment" || e.linkId) continue;
    const k = `${e.customerId}|${e.date}`;
    const list = pairs.get(k);
    if (list) list.push(e);
    else pairs.set(k, [e]);
  }
  if (pairs.size === 0) return 0;
  for (const w of entries) {
    if (w.type !== "work" || (w.paid ?? 0) > 0) continue;
    const candidates = pairs.get(`${w.customerId}|${w.date}`);
    if (!candidates) continue;
    const sameDay = candidates.filter((p) => isLegacyPairFor(w, p));
    const total = sameDay.reduce((s, p) => s + p.amount, 0);
    if (!sameDay.length || total > w.amount) continue;
    // A row has one mode; mixed cash + online same-day payments stay as separate rows.
    const mode = sameDay[0].mode ?? "cash";
    if (sameDay.some((p) => (p.mode ?? "cash") !== mode)) continue;
    store.updateEntry(w.id, { type: "work", date: w.date, description: w.description, amount: w.amount, notes: w.notes, paid: total, mode });
    sameDay.forEach((p) => store.deleteEntry(p.id));
    folded += 1;
  }
  return folded;
}

const FOR_JOB = " के लिए";
const WITH_WORK = " के साथ";

/**
 * Older versions tied an advance to its job / work only by the note ("<title> के लिए / के साथ").
 * Link each one by id where exactly one job or work fits, the way current versions save them,
 * so two jobs with the same name can never share (or delete) each other's advance.
 */
export function linkLegacyAdvances(entries: Entry[], jobs: Job[]): number {
  let linked = 0;
  for (const e of entries) {
    if (e.type !== "payment" || e.linkId || e.description !== ADVANCE) continue;
    const forJob = e.notes.endsWith(FOR_JOB) ? e.notes.slice(0, -FOR_JOB.length) : null;
    const withWork = e.notes.endsWith(WITH_WORK) ? e.notes.slice(0, -WITH_WORK.length) : null;
    const title = forJob ?? withWork;
    if (!title) continue;
    const works = entries.filter((w) => w.type === "work" && w.customerId === e.customerId && w.description === title);
    let target = "";
    if (forJob !== null) {
      const hits = jobs.filter((j) => j.customerId === e.customerId && j.title === title);
      if (hits.length === 1) {
        const job = hits[0];
        // A finished job's advance belongs to its work row, as "काम पूरा करें" links it today.
        if (job.status !== "done") target = job.id;
        else if (job.entryId && works.some((w) => w.id === job.entryId)) target = job.entryId;
      } else if (hits.length === 0 && works.length === 1) target = works[0].id;
    } else {
      const sameDay = works.filter((w) => w.date === e.date);
      if (sameDay.length === 1) target = sameDay[0].id;
    }
    if (!target) continue;
    store.updateEntry(e.id, { linkId: target });
    linked += 1;
  }
  return linked;
}

/**
 * Runs the fold once per app session after entries load. Every row from a server that
 * understands `paid` carries the field, so if any row lacks it the backend is still the old
 * one (it would drop `paid` and the fold would lose money) and we wait.
 */
export function useFoldLegacyCashRows() {
  const q = useEntries();
  const jq = useJobs();
  const done = useRef(false);
  useEffect(() => {
    if (done.current || !q.data || q.isFetching || !q.isFetchedAfterMount) return;
    if (!jq.data || jq.isFetching) return;
    if (q.data.length === 0 || q.data.some((e) => e.paid === undefined)) return;
    const rows = q.data;
    const jobs = jq.data;
    // After the first screen has drawn, so opening the app never waits on this check.
    const t = setTimeout(() => {
      if (done.current) return;
      done.current = true;
      foldLegacyCashRows(rows);
      linkLegacyAdvances(rows, jobs);
    }, 1500);
    return () => clearTimeout(t);
  }, [q.data, q.isFetching, q.isFetchedAfterMount, jq.data, jq.isFetching]);
}

// --- Ledger status ---------------------------------------------------------

/**
 * cash: fully paid when booked · pending: nothing received · partial: some received ·
 * settled: was udhaar, now fully received.
 */
export type WorkState = "cash" | "pending" | "partial" | "settled";

export type WorkStatus = {
  state: WorkState;
  paidAtBooking: number;
  /** Payments linked to this work (including old same-day cash rows). */
  settlements: Entry[];
  /** Share of general (unlinked) jama applied to this work, oldest udhaar first. */
  fromJama: number;
  received: number;
  remaining: number;
  /** Date the last rupee came in, when state is settled. */
  settledOn: string;
};

export type Ledger = {
  /** Status of every work, given and purchase row. For a purchase "received" is what we have paid them. */
  work: Map<string, WorkStatus>;
  /** Payment / repayment ids shown inside their card instead of as separate rows. */
  nested: Set<string>;
};

/** Work status for every customer at once (keyed by work entry id). */
export function buildAllLedgers(entries: Entry[]): Map<string, WorkStatus> {
  const hit = allLedgersCache.get(entries);
  if (hit) return hit;
  const byCustomer = new Map<string, Entry[]>();
  for (const e of entries) {
    const list = byCustomer.get(e.customerId);
    if (list) list.push(e);
    else byCustomer.set(e.customerId, [e]);
  }
  const all = new Map<string, WorkStatus>();
  byCustomer.forEach((list) => buildLedger(list).work.forEach((st, id) => all.set(id, st)));
  allLedgersCache.set(entries, all);
  return all;
}

// Work tab (two lists) and the customer list ask for the same entries array; build it once.
const allLedgersCache = new WeakMap<Entry[], Map<string, WorkStatus>>();

function byTime(a: Entry, b: Entry) {
  return a.date !== b.date ? a.date.localeCompare(b.date) : a.createdAt.localeCompare(b.createdAt);
}

/**
 * Derives per-row status for one person's entries. The balance is always
 * sum(work.amount - work.paid) + sum(given) - sum(payments) - sum(purchase.amount - purchase.paid);
 * this only explains which row that money covers, so the status can never disagree with the balance.
 * Credits (unlinked jama, unpaid purchases, overpaid work) settle the oldest open debt first.
 */
/**
 * settlementsFor for every row of one list, indexed once: same rows, same order, but without
 * scanning the whole list again for each work (a busy "नकद ग्राहक" has thousands of rows).
 */
function settlementIndex(entries: Entry[]): (w: Entry) => Entry[] {
  const order = new Map<Entry, number>();
  const linked = new Map<string, Entry[]>();
  const repaid = new Map<string, Entry[]>();
  const unlinked = new Map<string, Entry[]>();
  const add = (m: Map<string, Entry[]>, k: string, e: Entry) => {
    const list = m.get(k);
    if (list) list.push(e);
    else m.set(k, [e]);
  };
  entries.forEach((e, i) => {
    order.set(e, i);
    if (isRepayment(e)) add(repaid, e.linkId!, e);
    if (e.type !== "payment") return;
    if (e.linkId) add(linked, e.linkId, e);
    else add(unlinked, `${e.customerId}|${e.date}`, e);
  });
  return (w) => {
    if (w.type === "purchase") return [...(repaid.get(w.id) ?? [])].sort(byTime);
    const legacy = w.type === "work" ? (unlinked.get(`${w.customerId}|${w.date}`) ?? []).filter((e) => isLegacyPairFor(w, e)) : [];
    return [...(linked.get(w.id) ?? []), ...legacy].sort((a, b) => order.get(a)! - order.get(b)!).sort(byTime);
  };
}

export function buildLedger(entries: Entry[]): Ledger {
  const purchases = entries.filter((e) => e.type === "purchase").sort(byTime);
  const purchaseIds = new Set(purchases.map((p) => p.id));
  // A repayment whose purchase is gone is just money given.
  const debts = entries.filter((e) => isDebt(e) || (isRepayment(e) && !purchaseIds.has(e.linkId!))).sort(byTime);
  const work = new Map<string, WorkStatus>();
  const nested = new Set<string>();
  const settlementsOf = settlementIndex(entries);

  // Below half a paisa is float noise, not money still owed.
  const EPS = 0.005;
  for (const w of [...debts, ...purchases]) {
    const settlements = settlementsOf(w).filter((p) => !nested.has(p.id));
    settlements.forEach((p) => nested.add(p.id));
    const paidAtBooking = Math.min(w.paid ?? 0, w.amount);
    const linked = settlements.reduce((s, p) => s + p.amount, 0);
    work.set(w.id, { state: "pending", paidAtBooking, settlements, fromJama: 0, received: paidAtBooking + linked, remaining: 0, settledOn: "" });
  }

  type Ev = { e: Entry; kind: "debt" | "jama" | "purchase" };
  const events: Ev[] = [
    ...debts.map((e) => ({ e, kind: "debt" as const })),
    ...entries.filter((p) => p.type === "payment" && !nested.has(p.id)).map((e) => ({ e, kind: "jama" as const })),
    ...purchases.map((e) => ({ e, kind: "purchase" as const })),
  ].sort((a, b) => byTime(a.e, b.e));

  const credits: { left: number; purchase?: Entry }[] = [];
  const open: Entry[] = [];
  for (const ev of events) {
    const st = work.get(ev.e.id);
    if (ev.kind === "debt") {
      const over = st!.received - ev.e.amount;
      if (over > EPS) credits.push({ left: over });
      if (over > 0) st!.received = ev.e.amount;
      if (st!.received < ev.e.amount - EPS) open.push(ev.e);
    } else if (ev.kind === "jama") {
      credits.push({ left: ev.e.amount });
    } else {
      const unpaid = ev.e.amount - st!.received;
      if (unpaid > EPS) credits.push({ left: unpaid, purchase: ev.e });
    }
    while (credits.length && open.length) {
      const credit = credits[0];
      const debt = open[0];
      const dst = work.get(debt.id)!;
      const take = Math.min(credit.left, debt.amount - dst.received);
      dst.received += take;
      dst.fromJama += take;
      credit.left -= take;
      if (credit.purchase) {
        const pst = work.get(credit.purchase.id)!;
        pst.received += take;
        pst.fromJama += take;
        if (pst.received >= credit.purchase.amount - EPS) pst.settledOn = ev.e.date;
      }
      if (dst.received >= debt.amount - EPS) {
        open.shift();
        dst.settledOn = ev.e.date;
      }
      if (credit.left <= EPS) credits.shift();
    }
  }

  for (const w of [...debts, ...purchases]) {
    const st = work.get(w.id)!;
    const left = w.amount - st.received;
    st.remaining = left > EPS ? roundMoney(left) : 0;
    st.received = roundMoney(st.received);
    st.fromJama = roundMoney(st.fromJama);
    if (st.paidAtBooking >= w.amount && st.settlements.length === 0) st.state = "cash";
    else if (st.settlements.length > 0 && st.settlements.every((p) => p.date === w.date) && st.remaining <= 0 && st.fromJama === 0) st.state = "cash";
    else if (st.remaining <= 0) {
      st.state = "settled";
      if (!st.settledOn) st.settledOn = st.settlements.length ? st.settlements[st.settlements.length - 1].date : w.date;
    } else st.state = st.received > 0 ? "partial" : "pending";
  }

  return { work, nested };
}