// A "work record" is the work entry, any payments that settle it (linkId) and the finished
// job card (entryId). Older rows predate the explicit links, so fall back to matching the way
// recordWork used to name them.
import { useEffect, useRef } from "react";
import { store } from "@/src/lib/store";
import { isDebt, isRepayment, useEntries, type Entry, type Job } from "@/src/lib/data";

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

/** Removes a khata entry together with the rows that were booked with it. */
export function removeEntryWithLinks(entry: Entry, entries: Entry[], jobs: Job[]) {
  if (entry.type === "given" || entry.type === "purchase") {
    store.deleteEntry(entry.id);
    settlementsFor(entry, entries).forEach((p) => store.deleteEntry(p.id));
    return;
  }
  const work = entry.type === "work" ? entry : workForPayment(entry, entries);
  if (!work || work.type !== "work" || (entry.type === "payment" && entry.date !== work.date)) {
    // A later settlement is its own event; removing it just re-opens the udhaar.
    store.deleteEntry(entry.id);
    return;
  }
  const job = jobForWork(work, jobs);
  const linked = new Set<string>([
    ...settlementsFor(work, entries).map((p) => p.id),
    ...legacyAdvancesForWork(work, entries).map((p) => p.id),
    ...(job ? advancesForJob(job, entries).map((p) => p.id) : []),
  ]);
  store.deleteEntry(work.id);
  linked.forEach((id) => store.deleteEntry(id));
  if (job) store.deleteJob(job.id);
}

/** Removes an open job card and the advance taken for it. */
export function removeJobWithAdvances(job: Job, entries: Entry[]) {
  advancesForJob(job, entries).forEach((p) => store.deleteEntry(p.id));
  store.deleteJob(job.id);
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
  for (const w of entries) {
    if (w.type !== "work" || (w.paid ?? 0) > 0) continue;
    const sameDay = settlementsFor(w, entries).filter((p) => p.date === w.date);
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

/**
 * Runs the fold once per app session after entries load. Every row from a server that
 * understands `paid` carries the field, so if any row lacks it the backend is still the old
 * one (it would drop `paid` and the fold would lose money) and we wait.
 */
export function useFoldLegacyCashRows() {
  const q = useEntries();
  const done = useRef(false);
  useEffect(() => {
    if (done.current || !q.data || q.isFetching || !q.isFetchedAfterMount) return;
    if (q.data.length === 0 || q.data.some((e) => e.paid === undefined)) return;
    done.current = true;
    foldLegacyCashRows(q.data);
  }, [q.data, q.isFetching, q.isFetchedAfterMount]);
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
  const byCustomer = new Map<string, Entry[]>();
  for (const e of entries) {
    const list = byCustomer.get(e.customerId);
    if (list) list.push(e);
    else byCustomer.set(e.customerId, [e]);
  }
  const all = new Map<string, WorkStatus>();
  byCustomer.forEach((list) => buildLedger(list).work.forEach((st, id) => all.set(id, st)));
  return all;
}

function byTime(a: Entry, b: Entry) {
  return a.date !== b.date ? a.date.localeCompare(b.date) : a.createdAt.localeCompare(b.createdAt);
}

/**
 * Derives per-row status for one person's entries. The balance is always
 * sum(work.amount - work.paid) + sum(given) - sum(payments) - sum(purchase.amount - purchase.paid);
 * this only explains which row that money covers, so the status can never disagree with the balance.
 * Credits (unlinked jama, unpaid purchases, overpaid work) settle the oldest open debt first.
 */
export function buildLedger(entries: Entry[]): Ledger {
  const purchases = entries.filter((e) => e.type === "purchase").sort(byTime);
  const purchaseIds = new Set(purchases.map((p) => p.id));
  // A repayment whose purchase is gone is just money given.
  const debts = entries.filter((e) => isDebt(e) || (isRepayment(e) && !purchaseIds.has(e.linkId!))).sort(byTime);
  const work = new Map<string, WorkStatus>();
  const nested = new Set<string>();

  for (const w of [...debts, ...purchases]) {
    const settlements = settlementsFor(w, entries).filter((p) => !nested.has(p.id));
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
      if (over > 0) {
        credits.push({ left: over });
        st!.received = ev.e.amount;
      }
      if (st!.received < ev.e.amount) open.push(ev.e);
    } else if (ev.kind === "jama") {
      credits.push({ left: ev.e.amount });
    } else {
      const unpaid = ev.e.amount - st!.received;
      if (unpaid > 0) credits.push({ left: unpaid, purchase: ev.e });
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
        if (pst.received >= credit.purchase.amount) pst.settledOn = ev.e.date;
      }
      if (dst.received >= debt.amount) {
        open.shift();
        dst.settledOn = ev.e.date;
      }
      if (credit.left <= 0) credits.shift();
    }
  }

  for (const w of [...debts, ...purchases]) {
    const st = work.get(w.id)!;
    st.remaining = Math.max(0, w.amount - st.received);
    if (st.paidAtBooking >= w.amount && st.settlements.length === 0) st.state = "cash";
    else if (st.settlements.length > 0 && st.settlements.every((p) => p.date === w.date) && st.received >= w.amount && st.fromJama === 0) st.state = "cash";
    else if (st.remaining <= 0) {
      st.state = "settled";
      if (!st.settledOn) st.settledOn = st.settlements.length ? st.settlements[st.settlements.length - 1].date : w.date;
    } else st.state = st.received > 0 ? "partial" : "pending";
  }

  return { work, nested };
}