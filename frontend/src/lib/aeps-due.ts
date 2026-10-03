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
  // Once the customer paid something on the khata the entry must keep covering it, or that payment turns into a false advance.
  const due = Math.max(aepsDue(t), paid);
  const body = { type: "aeps" as const, date: t.doneDate || t.date, description: dueTitle(t), amount: due, notes: t.reference ? `Txn ${t.reference}` : "", linkId: id };
  if (existing && paid > 0) {
    store.updateEntry(existing.id, { ...body, amount: due });
    return;
  }
  if (existing && (due <= 0 || existing.customerId !== t.customerId)) store.deleteEntry(existing.id);
  if (due <= 0 || !t.customerId) return;
  if (existing && existing.customerId === t.customerId) store.updateEntry(existing.id, body);
  else store.createEntry({ customerId: t.customerId, paid: 0, ...body });
}

/** Counter cash can't also cover what the customer already paid on the khata, or the galla counts it twice. */
function withKhata(id: string | null, t: AepsBody): AepsBody {
  const paid = id ? khataPaid(id) : 0;
  if (paid <= 0 || cashOf(t) !== "in" || t.collected == null) return t;
  return { ...t, collected: Math.min(t.collected, Math.max(0, t.amount - paid)) };
}

export function createAeps(t: AepsBody): AepsTxn {
  const row = store.createAeps(t);
  syncAepsDue(row.id, t);
  return row;
}

export function saveAeps(id: string, t: AepsBody) {
  const body = withKhata(id, t);
  store.updateAeps(id, body);
  syncAepsDue(id, body);
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
  store.deleteAeps(t.id);
}
