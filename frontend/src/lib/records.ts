// A "work record" is up to three rows booked together: the work entry, the payment taken
// at the same time, and the finished job card. Older rows predate the explicit links, so
// fall back to matching the way recordWork used to name them.
import { store } from "@/src/lib/store";
import type { Entry, Job } from "@/src/lib/data";

export function linkedPayment(work: Entry, entries: Entry[]): Entry | undefined {
  return (
    entries.find((e) => e.type === "payment" && e.linkId === work.id) ??
    entries.find(
      (e) =>
        e.type === "payment" &&
        !e.linkId &&
        e.customerId === work.customerId &&
        e.date === work.date &&
        e.description.startsWith(`${work.description} — `),
    )
  );
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
  if (!work) {
    store.deleteEntry(entry.id);
    return;
  }
  const pay = linkedPayment(work, entries);
  const job = jobForWork(work, jobs);
  store.deleteEntry(work.id);
  if (pay) store.deleteEntry(pay.id);
  if (job) store.deleteJob(job.id);
}

export function linkedCount(entry: Entry, entries: Entry[], jobs: Job[]): number {
  const work = entry.type === "work" ? entry : workForPayment(entry, entries);
  if (!work) return 0;
  return (linkedPayment(work, entries) ? 1 : 0) + (jobForWork(work, jobs) ? 1 : 0) + (work.id !== entry.id ? 1 : 0);
}
