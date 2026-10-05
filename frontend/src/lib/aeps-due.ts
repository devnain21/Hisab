// The unpaid part of a counter service lives on the customer's khata as an "aeps" entry linked
// to the AEPS row, so balances, reminders and "पैसे मिले" work the same as for any other udhaar.
// The AEPS row itself carries the galla / bank movement; the khata entry never moves money.
import { queryClient } from "@/src/query-client";
import { store } from "@/src/lib/store";
import type { AepsTxn, Entry } from "@/src/lib/data";
import { AEPS_META, aepsDue, cashLegDate, cashOf, viaBill } from "@/src/lib/aeps";
import { todayISO } from "@/src/lib/format";
import { settlementsFor } from "@/src/lib/records";

type AepsBody = Omit<AepsTxn, "id" | "createdAt">;

const entriesNow = () => queryClient.getQueryData<Entry[]>(["entries"]) ?? [];

export function aepsDueEntry(aepsId: string, entries: Entry[] = entriesNow()): Entry | undefined {
  return entries.find((e) => e.type === "aeps" && e.linkId === aepsId);
}

function dueTitle(t: AepsBody): string {
  const via = viaBill(t.via);
  return `${AEPS_META[t.type]?.label ?? "काउंटर सेवा"}${via ? ` · ${via}` : ""}`;
}

/** Money the customer already paid on the khata against this row's due. */
export function khataPaid(aepsId: string, entries: Entry[] = entriesNow()): number {
  const due = aepsDueEntry(aepsId, entries);
  return due ? settlementsFor(due, entries).reduce((s, p) => s + p.amount, 0) : 0;
}

/** Brings the khata entry in line with the row: created, resized, moved or removed. */
export function syncAepsDue(id: string, t: AepsBody) {
  const existing = aepsDueEntry(id);
  const paid = existing ? khataPaid(id) : 0;
  // A failed row or one moved to someone else owes nothing here; what was paid stays with that customer as advance.
  const stillTheirs = !!existing && existing.customerId === t.customerId && t.status !== "failed";
  // Once the customer paid something on the khata the entry must keep covering it, or that payment turns into a false advance.
  const due = stillTheirs ? Math.max(aepsDue(t), paid) : aepsDue(t);
  const body = { type: "aeps" as const, date: t.doneDate || t.date, description: dueTitle(t), amount: due, notes: t.reference ? `Txn ${t.reference}` : "", linkId: id };
  if (existing && paid > 0 && stillTheirs) {
    store.updateEntry(existing.id, { ...body, amount: due });
    return;
  }
  if (existing && (due <= 0 || !stillTheirs)) store.deleteEntry(existing.id);
  if (due <= 0 || !t.customerId || t.status === "failed") return;
  if (existing && existing.customerId === t.customerId) store.updateEntry(existing.id, body);
  else store.createEntry({ customerId: t.customerId, paid: 0, ...body });
}

/** Counter cash can't also cover what the customer already paid on the khata, or the galla counts it twice. */
function withKhata(id: string | null, t: AepsBody): AepsBody {
  const paid = id ? khataPaid(id) : 0;
  if (paid <= 0 || cashOf(t) !== "in" || t.collected == null) return t;
  return { ...t, collected: Math.min(t.collected, Math.max(0, t.amount - paid)) };
}

/**
 * Money the customer left with the shop on a counter row: cash kept back from a withdrawal
 * (towards old udhaar, or to be handed over later) or paid over the amount. It is a normal
 * "जमा" payment on the khata linked to the row, so the ledger settles the oldest udhaar with it.
 */
export type JamaKind = "old" | "later" | "advance";
export type Jama = { amount: number; mode: "cash" | "online"; kind: JamaKind };

const JAMA_TEXT: Record<JamaKind, string> = {
  old: "पुरानी उधारी में काटे",
  later: "जमा — बाकी पैसे बाद में देने हैं",
  advance: "एडवांस जमा",
};

export function aepsJamaEntry(aepsId: string, entries: Entry[] = entriesNow()): Entry | undefined {
  return entries.find((e) => e.type === "payment" && e.linkId === aepsId);
}

export function jamaKindOf(e: Entry): JamaKind {
  return e.description.endsWith(JAMA_TEXT.old) ? "old" : e.description.endsWith(JAMA_TEXT.later) ? "later" : "advance";
}

/** `undefined` leaves the jama as it is (status changes from the list); a failed or unlinked row drops it. */
function syncAepsJama(id: string, t: AepsBody, jama: Jama | null | undefined, createdAt?: string) {
  const existing = aepsJamaEntry(id);
  const drop = t.status === "failed" || !t.customerId || jama === null || (jama !== undefined && jama.amount <= 0);
  if (drop) {
    if (existing) store.deleteEntry(existing.id);
    return;
  }
  const day = cashLegDate(t) || t.date;
  if (!jama) {
    if (existing && existing.date !== day && existing.customerId === t.customerId) store.updateEntry(existing.id, { date: day });
    return;
  }
  const body = {
    type: "payment" as const,
    date: day,
    description: `${AEPS_META[t.type]?.short ?? "काउंटर"} · ${JAMA_TEXT[jama.kind]}`,
    amount: jama.amount,
    mode: jama.mode,
    notes: t.reference ? `Txn ${t.reference}` : "",
    linkId: id,
  };
  if (existing && existing.customerId === t.customerId) store.updateEntry(existing.id, body);
  else {
    if (existing) store.deleteEntry(existing.id);
    // Same typed-on time as the counter row, so galla counts (or skips as backdated) both together.
    const rowCreatedAt = createdAt ?? queryClient.getQueryData<AepsTxn[]>(["aeps"])?.find((x) => x.id === id)?.createdAt;
    store.createEntry({ customerId: t.customerId!, paid: 0, ...body, ...(rowCreatedAt ? { createdAt: rowCreatedAt } : {}) });
  }
}

/** `createdAt` ties a row added while editing an older one to that visit, so galla treats them alike. */
export function createAeps(t: AepsBody, jama?: Jama | null, createdAt?: string): AepsTxn {
  const row = store.createAeps(t, createdAt);
  syncAepsDue(row.id, t);
  syncAepsJama(row.id, t, jama, row.createdAt);
  return row;
}

export function saveAeps(id: string, t: AepsBody, jama?: Jama | null) {
  const body = withKhata(id, t);
  store.updateAeps(id, body);
  syncAepsDue(id, body);
  syncAepsJama(id, body, jama);
}

const bodyOf = ({ id: _id, createdAt: _c, ...body }: AepsTxn): AepsBody => body;

/**
 * The bank side went through today. Money still owed by a linked customer goes on their khata;
 * a walk-in without a customer is taken as paid in full.
 */
export function completeAeps(t: AepsTxn) {
  const d = todayISO();
  const leg = cashLegDate(t);
  const owes = !leg && cashOf(t) === "in" && !!t.customerId;
  saveAeps(t.id, {
    ...bodyOf(t),
    status: "success",
    doneDate: d,
    cashDate: leg || (owes ? "" : d),
    collected: !leg && cashOf(t) === "in" ? (owes ? 0 : t.amount) : t.collected,
    dueDate: "",
  });
}

/** The counter cash changed hands today (whole amount). */
export function cashSettledAeps(t: AepsTxn) {
  saveAeps(t.id, { ...bodyOf(t), cashDate: todayISO(), collected: cashOf(t) === "in" ? t.amount : t.collected });
}

export function failAeps(t: AepsTxn) {
  saveAeps(t.id, { ...bodyOf(t), status: "failed", cashDate: "", doneDate: "", dueDate: "" });
}

export function removeAeps(t: AepsTxn) {
  const due = aepsDueEntry(t.id);
  if (due) store.deleteEntry(due.id);
  const jama = aepsJamaEntry(t.id);
  if (jama) store.deleteEntry(jama.id);
  store.deleteAeps(t.id);
}
