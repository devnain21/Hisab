// A "work record" is the work entry, any payments that settle it (linkId) and the finished
// job card (entryId). Older rows predate the explicit links, so fall back to matching the way
// recordWork used to name them.
import { useEffect, useRef } from "react";
import { store } from "@/src/lib/store";
import { useEntries, type Entry, type Job } from "@/src/lib/data";

const isLegacyPairFor = (work: Entry, e: Entry) =>
  e.type === "payment" &&
  !e.linkId &&
  e.customerId === work.customerId &&
  e.date === work.date &&
  e.description.startsWith(`${work.description} — `);

/** Payments booked specifically against this work entry (settlements). */
export function settlementsFor(work: Entry, entries: Entry[]): Entry[] {
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

/** Removes a khata entry together with the rows that were booked with it. */
export function removeEntryWithLinks(entry: Entry, entries: Entry[], jobs: Job[]) {
  const work = entry.type === "work" ? entry : workForPayment(entry, entries);
  if (!work || (entry.type === "payment" && entry.date !== work.date)) {
    // A later settlement is its own event; removing it just re-opens the udhaar.
    store.deleteEntry(entry.id);
    return;
  }
  const job = jobForWork(work, jobs);
  store.deleteEntry(work.id);
  settlementsFor(work, entries).forEach((p) => store.deleteEntry(p.id));
  if (job) store.deleteJob(job.id);
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
    store.updateEntry(w.id, { type: "work", date: w.date, description: w.description, amount: w.amount, notes: w.notes, paid: total });
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
  work: Map<string, WorkStatus>;
  /** Payment ids shown inside their work card instead of as separate rows. */
  nested: Set<string>;
  /** Unlinked jama → how much of it went against old udhaar vs. left as advance. */
  jama: Map<string, { applied: number; advance: number }>;
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

const byTime = (a: Entry, b: Entry) => (a.date !== b.date ? a.date.localeCompare(b.date) : a.createdAt.localeCompare(b.createdAt));

/**
 * Derives per-row status for one customer's entries. The customer balance is always
 * sum(work.amount - work.paid) - sum(payments); this only explains which work that money covers,
 * so the status can never disagree with the balance.
 */
export function buildLedger(entries: Entry[]): Ledger {
  const works = entries.filter((e) => e.type === "work").sort(byTime);
  const work = new Map<string, WorkStatus>();
  const nested = new Set<string>();

  for (const w of works) {
    const settlements = settlementsFor(w, entries).filter((p) => !nested.has(p.id));
    settlements.forEach((p) => nested.add(p.id));
    const paidAtBooking = Math.min(w.paid ?? 0, w.amount);
    const linked = settlements.reduce((s, p) => s + p.amount, 0);
    work.set(w.id, { state: "pending", paidAtBooking, settlements, fromJama: 0, received: paidAtBooking + linked, remaining: 0, settledOn: "" });
  }

  // Linked payments larger than their work spill over like general jama.
  let pool = 0;
  const jama = new Map<string, { applied: number; advance: number }>();
  const events: { date: string; createdAt: string; kind: "work" | "jama"; e: Entry }[] = [];
  for (const w of works) events.push({ date: w.date, createdAt: w.createdAt, kind: "work", e: w });
  for (const p of entries) if (p.type === "payment" && !nested.has(p.id)) events.push({ date: p.date, createdAt: p.createdAt, kind: "jama", e: p });
  events.sort((a, b) => (a.date !== b.date ? a.date.localeCompare(b.date) : a.createdAt.localeCompare(b.createdAt)));

  const open: string[] = [];
  for (const ev of events) {
    if (ev.kind === "work") {
      const st = work.get(ev.e.id)!;
      const over = st.received - ev.e.amount;
      if (over > 0) {
        pool += over;
        st.received = ev.e.amount;
      }
      if (st.received < ev.e.amount) open.push(ev.e.id);
    } else {
      pool += ev.e.amount;
      jama.set(ev.e.id, { applied: 0, advance: 0 });
    }
    // Apply whatever jama is available to the oldest open udhaar.
    while (pool > 0 && open.length) {
      const id = open[0];
      const w = works.find((x) => x.id === id)!;
      const st = work.get(id)!;
      const take = Math.min(pool, w.amount - st.received);
      st.received += take;
      st.fromJama += take;
      pool -= take;
      if (ev.kind === "jama") jama.get(ev.e.id)!.applied += take;
      if (st.received >= w.amount) {
        open.shift();
        st.settledOn = ev.date;
      }
    }
    if (ev.kind === "jama") {
      const j = jama.get(ev.e.id)!;
      j.advance = Math.max(0, ev.e.amount - j.applied);
    }
  }

  for (const w of works) {
    const st = work.get(w.id)!;
    st.remaining = Math.max(0, w.amount - st.received);
    if (st.paidAtBooking >= w.amount && st.settlements.length === 0) st.state = "cash";
    else if (st.settlements.length > 0 && st.settlements.every((p) => p.date === w.date) && st.received >= w.amount && st.fromJama === 0) st.state = "cash";
    else if (st.remaining <= 0) {
      st.state = "settled";
      if (!st.settledOn) st.settledOn = st.settlements.length ? st.settlements[st.settlements.length - 1].date : w.date;
    } else st.state = st.received > 0 ? "partial" : "pending";
  }

  return { work, nested, jama };
}
