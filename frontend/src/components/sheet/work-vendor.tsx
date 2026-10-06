import { useState, useEffect } from "react";
import { View, Text, TextInput } from "react-native";
import MaterialIcon from "@react-native-vector-icons/material-design-icons";
import { store } from "@/src/lib/store";
import { useCustomers, type Entry, type EntryItem } from "@/src/lib/data";
import { ADVANCE, releaseVendorOrder, removeVendorCost, settlementsFor, type VendorRefund } from "@/src/lib/records";
import { confirmAction } from "@/src/lib/confirm";
import { colors, spacing } from "@/src/theme";
import { formatDate, formatINR, parseAmount, roundMoney, todayISO } from "@/src/lib/format";
import { Pressable } from "@/src/components/tap";
import { getPrefs } from "@/src/lib/prefs";
import { Field, inputStyle, Chip, DateField, useCustomerChoice, CustomerPicker, type PayMode, PayModeField, settleDescription, bookAdvance, styles } from "./parts";

// One row per piece of work: `paid` is the money taken now (capped at the amount), the rest is udhaar.
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
  vendor = null,
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
  /** Work done by a vendor: books their cost as a purchase tied to this work row. */
  vendor?: VendorJob | null;
  /** Book the row even when free (a vendor cost is attached to it afterwards). */
  keepRow?: boolean;
}): string {
  // Free work is still booked when the shop paid a fee or a vendor for it, so the cost shows up.
  if (amount <= 0 && !((fee > 0 || (vendor?.cost ?? 0) > 0 || keepRow) && customerId)) return "";
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
  if (vendor && vendor.cost > 0) bookVendorCost(vendor, work.id, title, date);
  return work.id;
}

/** `paidOn` "" means the work day. */
export type VendorJob = { vendorId: string; cost: number; paidNow: boolean; mode: PayMode; paidOn: string };

/** Vendor cost sits on the work day; money paid to them on another day is its own payment row on that day. */
export function bookVendorCost(v: VendorJob, workId: string, title: string, date: string) {
  const paidOn = v.paidOn || date;
  const onWorkDay = v.paidNow && paidOn === date;
  const row = store.createEntry({
    customerId: v.vendorId,
    type: "purchase",
    date,
    description: title,
    amount: v.cost,
    paid: onWorkDay ? v.cost : 0,
    mode: v.mode,
    notes: "",
    refId: workId,
    status: "delivered",
    dueDate: "",
  });
  if (v.paidNow && !onWorkDay) {
    store.createEntry({ customerId: v.vendorId, type: "given", date: paidOn, description: settleDescription(title), amount: v.cost, mode: v.mode, notes: "", linkId: row.id });
  }
}

/** Saves the "वेंडर से कराया" block of an already written work row: adds, changes or drops its vendor cost. */
export async function saveVendorEdit(v: ReturnType<typeof useVendorJob>, row: Entry | undefined, workId: string, title: string, date: string, entries: Entry[]) {
  if (row && v.releasing) {
    // The job's vendor order: taken back (done in-house) or finished by someone else.
    releaseVendorOrder(row, entries, v.refund());
    row = undefined;
  } else if (!v.on && row) removeVendorCost(row, entries);
  if (!v.on) return;
  const job = await v.resolve();
  if (!job) return;
  if (!row) return bookVendorCost(job, workId, title, date);
  const later = settlementsFor(row, entries);
  const rest = roundMoney(job.cost - later.reduce((s, p) => s + p.amount, 0));
  const paidOn = job.paidOn || date;
  const onWorkDay = job.paidNow && paidOn === date;
  // A vendor order of a pending job becomes the cost of the finished work: it moves to the work day and row.
  store.updateEntry(row.id, {
    customerId: job.vendorId,
    date,
    description: title,
    amount: job.cost,
    paid: onWorkDay ? Math.max(0, rest) : 0,
    mode: job.mode,
    refId: workId,
    status: "delivered",
    dueDate: "",
  });
  if (job.vendorId !== row.customerId) later.forEach((p) => store.updateEntry(p.id, { customerId: job.vendorId }));
  if (job.paidNow && !onWorkDay && rest > 0) {
    store.createEntry({ customerId: job.vendorId, type: "given", date: paidOn, description: settleDescription(title), amount: rest, mode: job.mode, notes: "", linkId: row.id });
  }
}

/**
 * Pending job handed to a vendor: an open vendor order tied to the job (counted as cost only once the
 * job is finished). Money given to them now is its own payment row on the day it was given.
 */
export async function saveVendorAssign(v: ReturnType<typeof useVendorJob>, row: Entry | undefined, jobId: string, title: string, dueDate: string, entries: Entry[]) {
  if (row && v.releasing) {
    releaseVendorOrder(row, entries, v.refund());
    row = undefined;
  }
  if (!v.on) return;
  const job = await v.resolve();
  if (!job) return;
  const handedOn = v.assignDay;
  if (v.vendorDue) dueDate = v.vendorDue;
  let rowId = row?.id ?? "";
  if (row) {
    store.updateEntry(row.id, { customerId: job.vendorId, date: handedOn, description: title, amount: job.cost, dueDate, assignedOn: handedOn });
    // Picked the wrong vendor earlier: what was given really went to this one.
    if (job.vendorId !== row.customerId) settlementsFor(row, entries).forEach((p) => store.updateEntry(p.id, { customerId: job.vendorId }));
  } else {
    rowId = store.createEntry({ customerId: job.vendorId, type: "purchase", date: handedOn, description: title, amount: job.cost, paid: 0, mode: job.mode, notes: "", refId: jobId, status: "ordered", dueDate, assignedOn: handedOn }).id;
  }
  if (v.advanceNum > 0) {
    store.createEntry({ customerId: job.vendorId, type: "given", date: job.paidOn || handedOn, description: ADVANCE, amount: v.advanceNum, mode: job.mode, notes: `${title} के लिए`, linkId: rowId });
  }
}

/** "वेंडर से कराया" state for a job: off by default; picks the vendor and what they charged. */
export function useVendorJob(visible: boolean) {
  const choice = useCustomerChoice(visible, undefined, "vendor");
  const [on, setOn] = useState(false);
  const [cost, setCost] = useState("");
  const [paidNow, setPaidNow] = useState(true);
  const [mode, setMode] = useState<PayMode>("cash");
  const [paidOn, setPaidOn] = useState("");
  /** Payments already made against an existing vendor row (from the vendor's page). */
  const [laterPaid, setLaterPaid] = useState<Entry[]>([]);
  const [existing, setExisting] = useState(false);
  /** Pending job: money handed to the vendor now, before the work is done. */
  const [advance, setAdvance] = useState("");
  /** Day the job was handed to the vendor ("" = today). */
  const [assignOn, setAssignOn] = useState("");
  /** Day the vendor promised it back ("" = the customer's deadline). */
  const [vendorDue, setVendorDue] = useState("");
  /** Vendor holding the job's open order when the sheet opened ("" = no order). */
  const [orderVendor, setOrderVendor] = useState("");
  /** Order taken back with money already given: returned, still with them, or it was the new vendor's all along. */
  const [fate, setFate] = useState<"" | "back" | "keep" | "fix">("");
  const [refundAmt, setRefundAmt] = useState("");
  const [refundMode, setRefundMode] = useState<PayMode>("cash");
  const [refundOn, setRefundOn] = useState("");

  const resetOrder = () => {
    setAssignOn("");
    setVendorDue("");
    setOrderVendor("");
    setFate("");
    setRefundAmt("");
    setRefundMode(getPrefs().defaultMode);
    setRefundOn("");
  };

  useEffect(() => {
    if (visible) {
      setOn(false);
      setCost("");
      setPaidNow(true);
      setMode(getPrefs().defaultMode);
      setPaidOn("");
      setLaterPaid([]);
      setExisting(false);
      setAdvance("");
      resetOrder();
    }
  }, [visible]);

  /**
   * Fills the block from a vendor row already booked for the work, or (`order`) the open vendor order
   * of a pending job (`customerDue`: that job's deadline).
   */
  const load = (row: Entry | undefined, entries: Entry[], order = false, customerDue = "") => {
    setExisting(!!row);
    setOn(!!row);
    choice.setCustomerId(row?.customerId ?? "");
    setCost(row ? String(row.amount) : "");
    setPaidNow(row && !order ? (row.paid ?? 0) > 0 : true);
    setMode(row?.mode ?? getPrefs().defaultMode);
    setPaidOn("");
    setLaterPaid(row ? settlementsFor(row, entries) : []);
    setAdvance("");
    resetOrder();
    if (row && order) {
      setOrderVendor(row.customerId);
      setAssignOn(row.assignedOn || row.date);
      setVendorDue(row.dueDate && row.dueDate !== customerDue ? row.dueDate : "");
    }
  };
  /** An old fee that was really the vendor's charge: same money, same day, same pocket. */
  const fromFee = (fee: string, feeMode: PayMode) => {
    setOn(true);
    setCost(fee);
    setPaidNow(true);
    setMode(feeMode);
    setPaidOn("");
  };

  const today = todayISO();
  const order = !!orderVendor;
  const assignDay = assignOn || today;
  const oldPaid = roundMoney(laterPaid.reduce((s, p) => s + p.amount, 0));
  const firstPaid = laterPaid.reduce((d, p) => (p.date < d ? p.date : d), today);
  const changed = order && on && choice.customerId !== orderVendor;
  /** The open order leaves this vendor: taken back, or handed to another one. */
  const releasing = order && (!on || (changed && fate !== "fix"));
  const needFate = releasing && oldPaid > 0;
  const paidBefore = releasing ? 0 : oldPaid;
  const costNum = on ? parseAmount(cost) : 0;
  const advanceNum = on ? parseAmount(advance) : 0;
  const refundNum = needFate && fate === "back" ? parseAmount(refundAmt) : 0;
  const rest = roundMoney(costNum - paidBefore - advanceNum);
  const fateOk = !needFate || fate === "keep" || (fate === "back" && refundNum > 0 && refundNum <= oldPaid);
  const ready = (!on || (choice.ready && costNum > 0 && rest >= 0)) && fateOk;
  /** Dates in order: handed out after the job came in, money moved only after it was handed out. */
  const datesOk = (start: string, assigning: boolean) => {
    if (on && assigning && assignDay < start) return false;
    if (on && assigning && !!vendorDue && vendorDue < assignDay) return false;
    if (on && assigning && advanceNum > 0 && (paidOn || assignDay) < assignDay) return false;
    if (on && !assigning && order && !releasing && paidNow && rest > 0 && !!paidOn && paidOn < assignDay) return false;
    if (refundNum > 0 && (refundOn || today) < firstPaid) return false;
    return true;
  };
  const refund = (): VendorRefund => (refundNum > 0 ? { amount: refundNum, mode: refundMode, date: refundOn || today } : null);
  const resolve = async (): Promise<VendorJob | null> => {
    if (!on || costNum <= 0) return null;
    const vendorId = await choice.resolve();
    return vendorId ? { vendorId, cost: costNum, paidNow, mode, paidOn } : null;
  };
  return {
    choice, on, setOn, cost, setCost, costNum, paidNow, setPaidNow, mode, setMode, paidOn, setPaidOn, laterPaid, paidBefore, rest, existing, ready, resolve, load, fromFee, advance, setAdvance, advanceNum,
    order, orderVendor, assignOn, setAssignOn, assignDay, vendorDue, setVendorDue, changed, releasing, needFate, oldPaid, firstPaid, fate, setFate, refundAmt, setRefundAmt, refundMode, setRefundMode, refundOn, setRefundOn, refund, datesOk,
  };
}

/** Money already given to a vendor whose order is taken back: returned, or still owed by them. */
export function VendorRelease({ v, vendorName }: { v: ReturnType<typeof useVendorJob>; vendorName: string }) {
  const today = todayISO();
  const pick = (f: "back" | "keep" | "fix") => {
    v.setFate(f);
    if (f === "back" && !v.refundAmt) v.setRefundAmt(String(v.oldPaid));
  };
  return (
    <Field label={`${vendorName} को दिए ${formatINR(v.oldPaid)}`}>
      <View style={styles.chipRow}>
        <Chip label="राशि वापस मिली" icon="cash-refund" active={v.fate === "back"} onPress={() => pick("back")} testID="chip-vendor-refund" />
        <Chip label="Vendor पर बकाया" icon="account-clock-outline" active={v.fate === "keep"} onPress={() => pick("keep")} testID="chip-vendor-keep" />
        {v.changed ? <Chip label="गलत Vendor चुना था" icon="swap-horizontal" active={v.fate === "fix"} onPress={() => pick("fix")} testID="chip-vendor-fix" /> : null}
      </View>
      {v.fate === "" ? <Text style={[styles.hint, { color: colors.warning, fontWeight: "700" }]}>चुनें कि यह राशि कहाँ है</Text> : null}
      {v.fate === "keep" ? <Text style={styles.hint}>{vendorName} के खाते में {formatINR(v.oldPaid)} लेना बाकी रहेगा</Text> : null}
      {v.fate === "fix" ? <Text style={styles.hint}>यह राशि नए Vendor के खाते में जाएगी</Text> : null}
      {v.fate === "back" ? (
        <View style={{ marginTop: spacing.sm }}>
          <Field label="कितने वापस मिले (₹)">
            <TextInput style={inputStyle} value={v.refundAmt} onChangeText={v.setRefundAmt} placeholder="0" placeholderTextColor={colors.muted} keyboardType="numeric" testID="input-vendor-refund" />
            {parseAmount(v.refundAmt) > v.oldPaid ? <Text style={[styles.hint, { color: colors.error, fontWeight: "700" }]}>{formatINR(v.oldPaid)} से ज़्यादा नहीं</Text> : null}
            {parseAmount(v.refundAmt) > 0 && parseAmount(v.refundAmt) < v.oldPaid ? (
              <Text style={styles.hint}>बाकी {formatINR(roundMoney(v.oldPaid - parseAmount(v.refundAmt)))} {vendorName} पर बकाया रहेंगे</Text>
            ) : null}
          </Field>
          <PayModeField label="कहाँ आए" value={v.refundMode} onChange={v.setRefundMode} cashLabel="गल्ले में" onlineLabel="बैंक में" />
          <DateField label="कब मिले" value={v.refundOn || today} onChange={(d) => v.setRefundOn(d === today ? "" : d)} min={v.firstPaid} money testID="input-vendor-refund-date" />
        </View>
      ) : null}
    </Field>
  );
}

/**
 * "वेंडर से कराया" block. `assign`: the job is still pending, so it records who has the work, since when,
 * the agreed cost and any advance given; the rest is settled when the job is marked done. `start`: the day
 * the job came in. At completion of a job that was handed out, it asks who finished it.
 */
export function VendorOutsource({
  v,
  amount,
  fee,
  workDate,
  assign,
  start,
  bare,
}: {
  v: ReturnType<typeof useVendorJob>;
  amount: number;
  fee: number;
  workDate: string;
  assign?: boolean;
  start?: string;
  /** The sheet already chose "vendor" (action pills): no on/off toggle, no "who finished it" chips. */
  bare?: boolean;
}) {
  const customers = useCustomers().data ?? [];
  const oldName = customers.find((c) => c.id === v.orderVendor)?.name ?? "Vendor";
  const left = roundMoney(amount - fee - v.costNum);
  const finishing = !assign && v.order;
  const toggle = () => {
    if (v.on && v.existing) confirmAction("Vendor हटाएँ?", assign ? "काम Vendor से वापस लिया जाएगा (सेव करने पर)।" : "इस काम की Vendor लागत हटेगी (सेव करने पर)।", "हटा दें", () => v.setOn(false));
    else v.setOn(!v.on);
  };
  const today = todayISO();
  return (
    <View style={styles.vendorBox}>
      {bare ? (
        v.order && !v.changed ? (
          <View style={styles.vendorToggle}>
            <MaterialIcon name="truck-outline" size={20} color={colors.brandPrimary} />
            <Text style={[styles.vendorToggleText, { color: colors.onSurface }]}>{oldName} को दिया · {formatDate(v.assignDay)}</Text>
          </View>
        ) : null
      ) : finishing ? (
        <>
          <View style={styles.vendorToggle}>
            <MaterialIcon name="truck-outline" size={20} color={colors.brandPrimary} />
            <Text style={[styles.vendorToggleText, { color: colors.onSurface }]}>{oldName} को दिया था · {formatDate(v.assignDay)}</Text>
          </View>
          <View style={[styles.chipRow, { marginTop: spacing.xs }]}>
            <Chip label="Vendor ने पूरा किया" icon="truck-check-outline" active={v.on} onPress={() => v.setOn(true)} testID="chip-done-by-vendor" />
            <Chip label="स्वयं पूरा किया" icon="account-check-outline" active={!v.on} onPress={() => v.setOn(false)} testID="chip-done-by-self" />
          </View>
          {!v.on ? <Text style={styles.hint}>काम Vendor से वापस लिया गया — उनकी लागत नहीं जुड़ेगी</Text> : null}
        </>
      ) : (
        <Pressable hitSlop={{ top: 2, bottom: 2 }} style={styles.vendorToggle} onPress={toggle} testID="toggle-job-vendor">
          <MaterialIcon name="truck-outline" size={20} color={v.on ? colors.brandPrimary : colors.muted} />
          <Text style={[styles.vendorToggleText, v.on && { color: colors.onSurface }]}>{assign ? "वेंडर को दिया" : "वेंडर से कराया"}</Text>
          <MaterialIcon name={v.on ? "toggle-switch" : "toggle-switch-off-outline"} size={34} color={v.on ? colors.brandPrimary : colors.muted} />
        </Pressable>
      )}
      {!v.on && v.needFate ? <View style={{ marginTop: spacing.sm }}><VendorRelease v={v} vendorName={oldName} /></View> : null}
      {v.on ? (
        <View style={{ marginTop: spacing.sm }}>
          <CustomerPicker choice={v.choice} label="Vendor" testPrefix="chip-job-vendor" />
          <Field label="Vendor लागत (₹)">
            <TextInput style={inputStyle} value={v.cost} onChangeText={v.setCost} placeholder="0" placeholderTextColor={colors.muted} keyboardType="numeric" testID="input-job-vendor-cost" />
            {v.costNum > 0 && amount > 0 ? (
              <Text style={[styles.hint, { color: left >= 0 ? colors.brandPrimary : colors.error, fontWeight: "700" }]}>
                {left >= 0 ? "बचत" : "घाटा"} {formatINR(Math.abs(left))}
              </Text>
            ) : null}
          </Field>
          {v.changed && v.oldPaid > 0 ? <VendorRelease v={v} vendorName={oldName} /> : null}
          {v.laterPaid.length > 0 && !v.releasing ? (
            <Field label="दे चुके">
              {v.laterPaid.map((p) => (
                <View key={p.id} style={styles.settleRow}>
                  <MaterialIcon name="check-circle" size={16} color={colors.success} />
                  <Text style={styles.settleText}>{formatINR(p.amount)} · {formatDate(p.date)} · {p.mode === "online" ? "बैंक" : "नकद"}</Text>
                </View>
              ))}
              {v.rest < 0 && !assign ? <Text style={[styles.hint, { color: colors.error, fontWeight: "700" }]}>लागत {formatINR(v.paidBefore)} से कम नहीं</Text> : null}
            </Field>
          ) : null}
          {assign ? (
            <>
              <DateField label="कब सौंपा" value={v.assignDay} onChange={(d) => v.setAssignOn(d === today ? "" : d)} min={start} testID="input-job-vendor-assign-date" />
              <DateField label="Vendor कब तक देगा" value={v.vendorDue || workDate} onChange={(d) => v.setVendorDue(d === workDate ? "" : d)} min={v.assignDay} future testID="input-job-vendor-due" />
              {v.vendorDue && v.vendorDue > workDate ? <Text style={[styles.hint, { color: colors.warning, fontWeight: "700" }]}>ग्राहक की तारीख ({formatDate(workDate)}) के बाद</Text> : null}
              <Field label="Vendor को एडवांस (₹)">
                <TextInput style={inputStyle} value={v.advance} onChangeText={v.setAdvance} placeholder="0" placeholderTextColor={colors.muted} keyboardType="numeric" testID="input-job-vendor-advance" />
                {v.rest < 0 ? <Text style={[styles.hint, { color: colors.error, fontWeight: "700" }]}>लागत से ज़्यादा नहीं</Text> : null}
              </Field>
              {v.advanceNum > 0 ? (
                <>
                  <PayModeField label="कहाँ से दिए" value={v.mode} onChange={v.setMode} cashLabel="गल्ले से" onlineLabel="बैंक से" />
                  <DateField label="कब दिए" value={v.paidOn || v.assignDay} onChange={(d) => v.setPaidOn(d === v.assignDay ? "" : d)} min={v.assignDay} money testID="input-job-vendor-advance-date" />
                </>
              ) : null}
            </>
          ) : v.rest > 0 ? (
            <>
              <View style={[styles.chipRow, { marginBottom: spacing.md }]}>
                <Chip label="तुरंत चुकाए" icon="check" active={v.paidNow} onPress={() => v.setPaidNow(true)} testID="chip-vendor-paid" />
                <Chip label="उधारी" icon="timer-sand" active={!v.paidNow} onPress={() => v.setPaidNow(false)} testID="chip-vendor-later" />
              </View>
              {v.paidNow ? (
                <>
                  <PayModeField label="कहाँ से दिए" value={v.mode} onChange={v.setMode} cashLabel="गल्ले से" onlineLabel="बैंक से" />
                  <DateField label="कब दिए" value={v.paidOn || workDate} onChange={(d) => v.setPaidOn(d === workDate ? "" : d)} min={finishing && !v.releasing ? v.assignDay : undefined} money testID="input-job-vendor-paid-date" />
                </>
              ) : null}
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
