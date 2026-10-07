import { store } from "@/src/lib/store";
import type { Entry, EntryItem } from "@/src/lib/data";
import { settleDescription, bookAdvance } from "./parts";

// One row per piece of work: `paid` is the money taken now (capped at the amount), the rest is udhaar.
// Vendor cost never rides on the customer's work: it is booked once, on the vendor's own order.
export function recordWork({
  customerId,
  title,
  amount,
  received,
  date,
  notes,
  mode = "cash",
  fee = 0,
  feeMode = "online",
  items = [],
  split = null,
  keepRow = false,
}: {
  customerId: string;
  title: string;
  amount: number;
  received: number;
  date: string;
  notes: string;
  mode?: "cash" | "online";
  fee?: number;
  feeMode?: "cash" | "online";
  items?: EntryItem[];
  /** Paid partly cash, partly online (adds up to `received`). */
  split?: { cash: number; online: number } | null;
  /** Book the row even when free (an older vendor order is attached to it). */
  keepRow?: boolean;
}): string {
  // Free work is still booked when the shop paid a fee for it, so the cost shows up.
  if (amount <= 0 && !((fee > 0 || keepRow) && customerId)) return "";
  // Split: the cash part sits on the work row, the online part is a linked payment the same day.
  const cashPart = split ? split.cash : received;
  const rowMode = split ? "cash" : mode;
  const paid = Math.min(cashPart, amount);
  const work = store.createEntry({
    customerId,
    type: "work",
    date,
    description: title,
    amount,
    paid,
    mode: rowMode,
    fee: Math.max(0, fee),
    feeMode,
    notes,
    items,
  });
  bookAdvance(customerId, cashPart - paid, date, title, work.id, rowMode);
  if (split) {
    const onlinePaid = Math.min(split.online, amount - paid);
    if (onlinePaid > 0) store.createEntry({ customerId, type: "payment", date, description: settleDescription(title), amount: onlinePaid, mode: "online", notes: "", linkId: work.id });
    bookAdvance(customerId, split.online - onlinePaid, date, title, work.id, "online");
  }
  return work.id;
}

/**
 * A vendor order made for a pending job before vendors moved to their own tab: when the job is finished
 * it becomes that work's cost (counted once, from the vendor row), or a plain vendor order when no work
 * row was booked. Amount and payments stay as they are.
 */
export function closeJobVendorOrder(row: Entry, workId: string, doneOn: string) {
  store.updateEntry(row.id, { refId: workId, status: "delivered", doneOn });
}
