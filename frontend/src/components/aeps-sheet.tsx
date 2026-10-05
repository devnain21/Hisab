import { useEffect, useMemo, useState } from "react";
import { View, Text, TextInput, StyleSheet, ScrollView, type KeyboardTypeOptions } from "react-native";
import MaterialIcon from "@react-native-vector-icons/material-design-icons";
import { colors, spacing, radius } from "@/src/theme";
import { store } from "@/src/lib/store";
import { computeBalance, useEntries, type AepsCash, type AepsCommissionMode, type AepsStatus, type AepsTxn, type AepsType, type AepsVia, type Entry } from "@/src/lib/data";
import {
  AEPS_META,
  AEPS_SERVICES,
  BANKS,
  BILLERS,
  COMMISSION_MODES,
  FIELD_LABEL,
  OPERATORS,
  STATUS_META,
  VIA_FOR,
  aepsBill,
  aepsDue,
  aepsLegs,
  bankOf,
  cashLegDate,
  commissionDate,
  defaultVia,
  fieldLabel,
  fieldsFor,
  isLater,
  moneyLines,
  type AepsField,
  type CashFlow,
} from "@/src/lib/aeps";
import { aepsDueEntry, aepsJamaEntry, createAeps, jamaKindOf, saveAeps, type Jama } from "@/src/lib/aeps-due";
import { dateOnSave, formatINR, nowHM, parseAmount, todayISO } from "@/src/lib/format";
import { Pressable } from "@/src/components/tap";
import { Chip, CustomerPicker, DateField, Field, PrimaryButton, SheetShell, inputStyle, useCustomerChoice } from "@/src/components/sheets";

type LineStatus = AepsStatus | "later";
const LINE_STATUS: { id: LineStatus; label: string; icon: string; color: string }[] = [
  { id: "success", label: "हो गया", icon: "check-circle", color: STATUS_META.success.color },
  { id: "pending", label: "पेंडिंग", icon: "clock-outline", color: STATUS_META.pending.color },
  { id: "later", label: "बाद में भेजनी है", icon: "calendar-clock", color: colors.info },
  { id: "failed", label: "फेल", icon: "close-circle", color: STATUS_META.failed.color },
];

const OTHER_FLOW: { id: CashFlow; label: string }[] = [
  { id: "in", label: "ग्राहक से पैसे लिए" },
  { id: "out", label: "ग्राहक को पैसे दिए" },
  { id: "none", label: "सिर्फ़ सेवा शुल्क" },
];

const TONE = { in: colors.success, out: colors.error, wait: colors.warning, muted: colors.muted } as const;

type Line = {
  key: string;
  type: AepsType;
  via: AepsVia;
  amount: string;
  /** Drawer direction for "other" (and older UPI rows). */
  cash: AepsCash;
  aadhaarLast4: string;
  bankName: string;
  beneficiaryName: string;
  accountNumber: string;
  ifsc: string;
  upiId: string;
  operator: string;
  rechargeNumber: string;
  billerName: string;
  billAccount: string;
  reference: string;
  commission: string;
  commissionMode: Exclude<AepsCommissionMode, "">;
  status: LineStatus;
  /** Cash handed to the customer already (money going out on a pending row). */
  cashTaken: boolean;
  /** Money the customer handed over; null follows the amount (paid in full). More than the amount is an advance. */
  collected: string | null;
  /** Cash handed to the customer on a withdrawal; null follows what they are owed (all of it). */
  handed: string | null;
  /** What the cash kept back from a withdrawal is for. */
  rest: "old" | "later";
  /** What the money paid over the amount is for: kept as advance, or the rest is sent on `dueDate`. */
  extra: "advance" | "send";
  /** Customer paid the amount but owes the commission (it goes on the khata). */
  commDue: boolean;
  payMode: "cash" | "online";
  dueDate: string;
  notes: string;
  more: boolean;
};

const lineKey = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

const emptyLine = (type: AepsType = "withdrawal"): Line => ({
  key: lineKey(),
  type,
  via: defaultVia(type),
  amount: "",
  cash: type === "other" ? "in" : "",
  aadhaarLast4: "",
  bankName: "",
  beneficiaryName: "",
  accountNumber: "",
  ifsc: "",
  upiId: "",
  operator: "",
  rechargeNumber: "",
  billerName: "",
  billAccount: "",
  reference: "",
  commission: "",
  commissionMode: "cash",
  status: "success",
  cashTaken: true,
  collected: null,
  handed: null,
  rest: "later",
  extra: "advance",
  commDue: false,
  payMode: "cash",
  dueDate: todayISO(1),
  notes: "",
  more: false,
});

const flowOf = (l: Pick<Line, "type" | "cash">): CashFlow => (l.cash || AEPS_META[l.type].cash) as CashFlow;

const lineFrom = (t: AepsTxn, jama?: Entry): Line => {
  const legDone = !!cashLegDate(t);
  const kept = jama?.amount ?? 0;
  const flow = flowOf({ type: t.type, cash: t.cash ?? "" });
  const owed = Math.max(0, t.amount - (t.commission > 0 && t.commissionMode === "cash" ? t.commission : 0));
  // The row keeps money toward the amount only; the input shows all that was handed over, charge included.
  const chargeTaken = t.collected != null && t.commission > 0 && t.commissionMode === (t.payMode || "cash") && !!commissionDate(t) ? t.commission : 0;
  const base: Line = {
    ...emptyLine(t.type),
    via: t.via || defaultVia(t.type),
    amount: t.amount > 0 ? String(t.amount) : "",
    cash: t.cash ?? "",
    aadhaarLast4: t.aadhaarLast4,
    bankName: t.bankName,
    beneficiaryName: t.beneficiaryName,
    accountNumber: t.accountNumber,
    ifsc: t.ifsc,
    upiId: t.upiId ?? "",
    operator: t.operator,
    rechargeNumber: t.rechargeNumber,
    billerName: t.billerName,
    billAccount: t.billAccount,
    reference: t.reference,
    commission: t.commission > 0 ? String(t.commission) : "",
    commissionMode: t.commissionMode || "app",
    status: isLater(t) ? "later" : t.status,
    cashTaken: legDone,
    collected: !legDone ? "0" : t.collected == null ? null : String(t.collected + chargeTaken),
    commDue: !!t.commissionDue,
    payMode: t.payMode === "online" ? "online" : "cash",
    dueDate: t.dueDate || todayISO(1),
    notes: t.notes,
    more: !!t.reference || !!t.notes,
  };
  if (!jama || kept <= 0) return base;
  if (flow === "out") return { ...base, handed: String(Math.max(0, owed - kept)), rest: jamaKindOf(jama) === "old" ? "old" : "later" };
  if (flow === "in") return { ...base, collected: String(collectedNum(base) + kept), extra: "advance" };
  return base;
};

const digits = (v: string, max: number) => v.replace(/\D/g, "").slice(0, max);
const num = (v: string) => parseAmount(v);
/** Service charge the customer pays (app commission never reaches them). */
const lineCharge = (l: Line) => (num(l.commission) > 0 && (l.commissionMode === "cash" || l.commissionMode === "online") ? num(l.commission) : 0);
/** Charge paid the same way as the amount comes out of the same money, after the amount itself is covered. */
const sameWayCharge = (l: Line) => (num(l.commission) > 0 && l.commissionMode === l.payMode ? num(l.commission) : 0);
/** Paid in full: the amount, plus the charge unless it was left on the khata. */
const fullNum = (l: Line) => num(l.amount) + (l.commDue ? 0 : sameWayCharge(l));
const collectedNum = (l: Line) => (l.collected === null ? fullNum(l) : num(l.collected));
/** Commission still owed: left on the khata on purpose, or not covered by what was handed over. */
const commOwed = (l: Line) => lineCharge(l) > 0 && (l.commDue || collectedNum(l) < num(l.amount) + sameWayCharge(l));
/** Money handed over beyond the amount and its charge. */
const overNum = (l: Line) => Math.max(0, collectedNum(l) - num(l.amount) - (commOwed(l) ? 0 : sameWayCharge(l)));
/** Cash a withdrawal customer is owed: the amount less a charge kept from it. */
const owedNum = (l: Line) => Math.max(0, num(l.amount) - (num(l.commission) > 0 && l.commissionMode === "cash" ? num(l.commission) : 0));
const handedNum = (l: Line) => (l.handed === null ? owedNum(l) : Math.min(num(l.handed), owedNum(l)));
/** Cash given now on an outgoing service (pending rows can still wait for it). */
const outGiven = (l: Line) => l.status !== "failed" && (l.status === "success" || l.cashTaken);

/** What this line leaves on the khata beyond the service itself. */
function lineJama(l: Line): Jama | null {
  const flow = flowOf(l);
  const amt = num(l.amount);
  if (l.status === "failed" || amt <= 0) return null;
  if (flow === "out" && outGiven(l)) {
    const kept = owedNum(l) - handedNum(l);
    return kept > 0 ? { amount: kept, mode: "cash", kind: l.rest } : null;
  }
  if (flow === "in" && l.extra === "advance") {
    const over = overNum(l);
    return over > 0 ? { amount: over, mode: l.payMode, kind: "advance" } : null;
  }
  return null;
}
/** The row this line will save, as far as the money is concerned. */
function previewOf(l: Line, date: string, createdAt = new Date().toISOString()): AepsTxn {
  const amt = num(l.amount);
  const flow = flowOf(l);
  const got = collectedNum(l);
  const status: AepsStatus = l.status === "later" ? "pending" : l.status;
  const commission = num(l.commission);
  return {
    id: "",
    createdAt,
    type: l.type,
    date,
    time: "",
    customerName: "",
    mobile: "",
    aadhaarLast4: "",
    bankName: "",
    reference: "",
    operator: "",
    rechargeNumber: "",
    billerName: "",
    billAccount: "",
    beneficiaryName: "",
    accountNumber: "",
    ifsc: "",
    notes: "",
    cash: l.cash,
    amount: amt,
    commission,
    commissionMode: commission > 0 ? l.commissionMode : "",
    status,
    cashDate: status === "failed" ? "" : flow === "in" ? (got > 0 ? date : "") : flow === "out" ? (outGiven(l) ? date : "") : date,
    doneDate: status === "success" ? date : "",
    collected: flow === "in" ? Math.min(got, amt) : null,
    payMode: l.payMode,
    commissionDue: flow === "in" && commOwed(l),
  };
}

/** Money paid over the amount that is to be sent later as its own pending row. */
const sendLater = (l: Line) => (flowOf(l) === "in" && l.status !== "failed" && l.extra === "send" ? overNum(l) : 0);

type InputSpec = { placeholder: string; keyboard?: KeyboardTypeOptions; caps?: "none" | "words" | "characters"; max?: number; clean?: (v: string) => string; presets?: string[] };
const INPUT: Partial<Record<AepsField, InputSpec>> = {
  aadhaarLast4: { placeholder: "जैसे 4821", keyboard: "number-pad", max: 4, clean: (v) => digits(v, 4) },
  bankName: { placeholder: "बैंक का नाम", presets: BANKS },
  ifsc: { placeholder: "जैसे SBIN0001234", caps: "characters", max: 11 },
  accountNumber: { placeholder: "खाता नंबर", keyboard: "number-pad", max: 20 },
  beneficiaryName: { placeholder: "नाम", caps: "words" },
  upiId: { placeholder: "जैसे 98XXXXXX10@ybl", caps: "none", max: 50 },
  operator: { placeholder: "ऑपरेटर", presets: OPERATORS },
  rechargeNumber: { placeholder: "मोबाइल या DTH ID", keyboard: "number-pad", max: 15 },
  billerName: { placeholder: "जैसे बिजली", presets: BILLERS },
  billAccount: { placeholder: "बिल / खाते पर लिखा नंबर" },
};
const CORE: AepsField[] = ["mobile", "amount", "reference", "commission"];

export function AepsSheet({ visible, initial, onClose }: { visible: boolean; initial?: AepsTxn | null; onClose: () => void }) {
  const choice = useCustomerChoice(visible, initial?.customerId || undefined);
  const [mobile, setMobile] = useState("");
  const [date, setDate] = useState(todayISO());
  const [time, setTime] = useState(nowHM());
  const [openedOn, setOpenedOn] = useState(todayISO());
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [saving, setSaving] = useState(false);
  const entries = useEntries().data;

  useEffect(() => {
    if (!visible) return;
    setMobile(initial?.mobile ?? "");
    setDate(initial?.date ?? todayISO());
    setTime(initial?.time || nowHM());
    setOpenedOn(todayISO());
    setLines([initial ? lineFrom(initial, aepsJamaEntry(initial.id, entries ?? [])) : emptyLine()]);
    // Older rows only carry a name and mobile: find that customer, or offer them as new.
    if (initial && !initial.customerId) {
      const m = initial.mobile.replace(/\D/g, "").slice(-10);
      const known =
        (m.length === 10 && choice.recent.find((c) => c.phone.replace(/\D/g, "").slice(-10) === m)) ||
        choice.recent.find((c) => c.name.trim().toLowerCase() === initial.customerName.trim().toLowerCase());
      if (known) choice.setCustomerId(known.id);
      else {
        choice.setQuery(initial.customerName);
        choice.setNewPhone(initial.mobile);
        choice.setCustomerId("__new__");
      }
    }
    // Only when the sheet opens for a record, not when a sync hands over a fresh copy of it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, initial?.id]);

  const picked = choice.recent.find((c) => c.id === choice.customerId);
  const name = picked ? picked.name : choice.query.trim();
  // The customer's khata before this entry (its own due / jama left out when editing).
  const oldDue = useMemo(() => {
    if (!picked) return 0;
    const own = new Set(initial ? [aepsDueEntry(initial.id, entries ?? [])?.id, aepsJamaEntry(initial.id, entries ?? [])?.id] : []);
    return computeBalance((entries ?? []).filter((e) => !own.has(e.id)), picked.id);
  }, [picked, entries, initial]);
  const finalMobile = (picked ? picked.phone || mobile : choice.isNew ? choice.newPhone : "").replace(/\D/g, "").slice(-10);

  const patch = (key: string, partial: Partial<Line>) => setLines((rows) => rows.map((r) => (r.key === key ? { ...r, ...partial } : r)));
  const pickType = (key: string, type: AepsType) =>
    patch(key, { type, via: defaultVia(type), cash: type === "other" ? "in" : "", cashTaken: true, collected: null, handed: null, extra: "advance" });

  const lineValid = (l: Line) => {
    const amt = num(l.amount);
    if (l.type !== "balance" && !(flowOf(l) === "none" && l.type === "other") && amt <= 0) return false;
    if ((l.status === "later" || sendLater(l) > 0) && l.dueDate <= date) return false;
    if (flowOf(l) === "out" && l.handed !== null && num(l.handed) > owedNum(l)) return false;
    return true;
  };
  const valid = choice.ready && !choice.isSelf && lines.every(lineValid);

  /** Status fields for the server. Editing keeps the days a side already settled on. */
  const statusFields = (line: Line, i: number, date: string) => {
    const prev = initial && i === 0 ? initial : null;
    const status: AepsStatus = line.status === "later" ? "pending" : line.status;
    const flow = flowOf(line);
    const got = flow === "in" ? Math.min(collectedNum(line), num(line.amount)) : 0;
    const cashNow = status !== "failed" && (flow === "in" ? got > 0 : flow === "out" ? status === "success" || line.cashTaken : true);
    // A side settled on the entry's own day moves with it when the date is changed; a later settlement keeps its day.
    const follow = (d: string | null | undefined) => (d && prev && d !== prev.date ? d : date);
    const prevCash = prev ? cashLegDate(prev) : null;
    return {
      status,
      cashDate: cashNow ? follow(prevCash) : "",
      doneDate: status === "success" ? follow(prev?.doneDate) : "",
      dueDate: line.status === "later" ? line.dueDate : "",
      commissionMode: num(line.commission) > 0 ? line.commissionMode : ("" as AepsCommissionMode),
      collected: flow === "in" ? got : null,
      payMode: flow === "in" ? line.payMode : ("" as const),
      commissionDue: flow === "in" && status !== "failed" && commOwed(line),
    };
  };

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      const customerId = await choice.resolve();
      if (picked && !picked.phone && finalMobile) {
        store.updateCustomer(picked.id, { name: picked.name, phone: finalMobile, address: picked.address, notes: picked.notes, persona: picked.persona ?? "business" });
      }
      const day = initial ? date : dateOnSave(date, openedOn);
      const at = day !== date ? nowHM() : time;
      lines.forEach((line, i) => {
        const keep = new Set<AepsField>(fieldsFor(line.type, line.via));
        const val = (f: AepsField, v: string) => (keep.has(f) ? v.trim() : "");
        const payload = {
          type: line.type,
          via: VIA_FOR[line.type] ? line.via : ("" as AepsVia),
          date: day,
          time: at,
          customerId,
          customerName: name,
          mobile: finalMobile,
          aadhaarLast4: val("aadhaarLast4", line.aadhaarLast4),
          bankName: val("bankName", line.bankName),
          amount: num(line.amount),
          commission: num(line.commission),
          ...statusFields(line, i, day),
          reference: line.reference.trim(),
          operator: val("operator", line.operator),
          rechargeNumber: val("rechargeNumber", line.rechargeNumber),
          billerName: val("billerName", line.billerName),
          billAccount: val("billAccount", line.billAccount),
          beneficiaryName: val("beneficiaryName", line.beneficiaryName),
          accountNumber: val("accountNumber", line.accountNumber),
          ifsc: val("ifsc", line.ifsc).toUpperCase(),
          upiId: val("upiId", line.upiId),
          cash: line.type === "other" || (line.type === "upi" && line.cash === "none") ? line.cash : ("" as AepsCash),
          notes: line.notes.trim(),
        };
        const jama = lineJama(line);
        if (initial && i === 0) saveAeps(initial.id, payload, jama);
        else createAeps(payload, jama, initial?.createdAt);
        // Paid in full for more than was sent now: the rest goes out later as its own pending row, already paid for.
        const rest = sendLater(line);
        if (rest > 0) {
          createAeps({ ...payload, amount: rest, commission: 0, commissionMode: "", commissionDue: false, status: "pending", doneDate: "", dueDate: line.dueDate, collected: rest, payMode: line.payMode, cashDate: day, reference: "" }, null, initial?.createdAt);
        }
      });
      onClose();
    } finally { setSaving(false); }
  };

  return (
    <SheetShell visible={visible} onClose={onClose} title={initial ? "एंट्री बदलें" : "काउंटर एंट्री"} testID="sheet-aeps">
      <CustomerPicker choice={choice} label="ग्राहक" testPrefix="aeps-cust" />
      {picked && !picked.phone ? (
        <Field label={FIELD_LABEL.mobile}>
          <TextInput style={inputStyle} value={mobile} onChangeText={(v) => setMobile(digits(v, 10))} placeholder="10 अंक (वैकल्पिक)" placeholderTextColor={colors.muted} keyboardType="phone-pad" maxLength={10} testID="aeps-input-mobile" />
        </Field>
      ) : null}

      {lines.map((line, index) => (
        <ServiceLine
          key={line.key}
          line={line}
          index={index}
          count={lines.length}
          date={date}
          patch={(p) => patch(line.key, p)}
          pickType={(t) => pickType(line.key, t)}
          onRemove={() => setLines((rows) => rows.filter((r) => r.key !== line.key))}
          oldDue={index === 0 ? oldDue : 0}
          hasCustomer={!!choice.customerId}
        />
      ))}

      {lines.length > 1 ? <TotalCard lines={lines} date={date} /> : null}

      {!initial ? (
        <Pressable onPress={() => setLines((rows) => [...rows, emptyLine("transfer")])} style={styles.addLine} testID="aeps-add-line">
          <MaterialIcon name="plus" size={18} color={colors.brandPrimary} />
          <Text style={styles.moreText}>और एक सेवा</Text>
        </Pressable>
      ) : null}

      <DateField label="तारीख" value={date} onChange={setDate} money createdAt={initial?.createdAt} testID="aeps-input-date" />
      <Field label="समय">
        <TextInput style={inputStyle} value={time} onChangeText={setTime} placeholder="HH:MM" placeholderTextColor={colors.muted} maxLength={5} testID="aeps-input-time" />
      </Field>

      <PrimaryButton label={initial ? "बदलाव सेव करें" : lines.length > 1 ? `${lines.length} सेवाएँ सेव करें` : "एंट्री सेव करें"} onPress={save} disabled={!valid} saving={saving} testID="aeps-save-btn" />
    </SheetShell>
  );
}

function ServiceLine({
  line,
  index,
  count,
  date,
  patch,
  pickType,
  onRemove,
  oldDue,
  hasCustomer,
}: {
  line: Line;
  index: number;
  count: number;
  date: string;
  oldDue: number;
  hasCustomer: boolean;
  patch: (p: Partial<Line>) => void;
  pickType: (t: AepsType) => void;
  onRemove: () => void;
}) {
  const meta = AEPS_META[line.type];
  const vias = VIA_FOR[line.type];
  const fields = fieldsFor(line.type, line.via).filter((f) => !CORE.includes(f));
  const amt = num(line.amount);
  const flow = flowOf(line);
  const got = collectedNum(line);
  const status: AepsStatus = line.status === "later" ? "pending" : line.status;
  const commission = num(line.commission);
  const preview = previewOf(line, date);
  const bill = aepsBill(preview);
  const jama = lineJama(line);
  const over = flow === "in" ? overNum(line) : 0;
  const owed = owedNum(line);
  const handed = handedNum(line);
  const kept = flow === "out" ? Math.max(0, owed - handed) : 0;
  const canSend = line.type === "deposit" || line.type === "transfer";
  const charge = lineCharge(line);
  const full = fullNum(line);
  const owedCharge = flow === "in" && commOwed(line);
  // What stays unpaid on this service: the rest of the amount, plus the commission when it is still owed.
  const short = flow === "in" ? Math.max(0, amt - Math.min(got, amt)) + (owedCharge ? charge : 0) : 0;
  const cutOld = Math.min(Math.max(oldDue, 0), owed);

  return (
    <View style={styles.line}>
      <View style={styles.lineHead}>
        <Text style={styles.lineTitle}>सेवा{count > 1 ? ` ${index + 1}` : ""}</Text>
        {count > 1 ? (
          <Pressable onPress={onRemove} hitSlop={8} testID={`aeps-remove-${index}`}>
            <MaterialIcon name="close" size={18} color={colors.muted} />
          </Pressable>
        ) : null}
      </View>

      <View style={styles.serviceGrid}>
        {AEPS_SERVICES.map((t) => {
          const m = AEPS_META[t];
          const active = line.type === t;
          return (
            <Pressable key={t} onPress={() => pickType(t)} style={[styles.serviceTile, active && { backgroundColor: m.color, borderColor: m.color }]} testID={`aeps-type-${t}`}>
              <MaterialIcon name={m.icon as any} size={20} color={active ? "#fff" : m.color} />
              <Text style={[styles.serviceText, active && { color: "#fff" }]} numberOfLines={1}>{m.short}</Text>
            </Pressable>
          );
        })}
      </View>

      {vias ? (
        <View style={styles.segment}>
          {vias.map((v) => (
            <Pressable key={v.id} onPress={() => patch({ via: v.id })} style={[styles.segmentBtn, line.via === v.id && { backgroundColor: meta.color }]} testID={`aeps-via-${v.id}`}>
              <Text style={[styles.segmentText, line.via === v.id && { color: "#fff" }]} numberOfLines={1}>{v.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {line.type === "other" ? (
        <View style={[styles.chipRow, { marginBottom: spacing.md }]}>
          {OTHER_FLOW.map((o) => (
            <Chip key={o.id} label={o.label} active={flow === o.id} onPress={() => patch({ cash: o.id, collected: null })} testID={`aeps-other-${o.id}`} />
          ))}
        </View>
      ) : null}

      {line.type === "other" && flow === "none" ? null : (
        <Field label={meta.amountLabel}>
          <TextInput style={[inputStyle, styles.amountInput]} value={line.amount} onChangeText={(v) => patch({ amount: v })} placeholder="0" placeholderTextColor={colors.muted} keyboardType="numeric" testID="aeps-input-amount" />
        </Field>
      )}

      {fields.map((f) => {
        const spec = INPUT[f] ?? { placeholder: "" };
        const value = String(line[f as keyof Line] ?? "");
        return (
          <Field key={f} label={fieldLabel(line.type, line.via, f)}>
            <TextInput
              style={inputStyle}
              value={value}
              onChangeText={(v) => patch({ [f]: spec.clean ? spec.clean(v) : v } as Partial<Line>)}
              placeholder={spec.placeholder}
              placeholderTextColor={colors.muted}
              keyboardType={spec.keyboard}
              autoCapitalize={spec.caps}
              maxLength={spec.max}
              testID={`aeps-input-${f}`}
            />
            {spec.presets && !(f === "billerName" && (line.type === "other" || line.via === "emi")) ? (
              <Presets items={spec.presets} value={value} onPick={(v) => patch({ [f]: v } as Partial<Line>)} />
            ) : null}
          </Field>
        );
      })}

      {meta.fields.includes("commission") ? (
        <View style={styles.block}>
          <Text style={styles.blockTitle}>{line.type === "other" && flow === "none" ? "सेवा शुल्क (₹)" : "कमीशन / सेवा शुल्क (₹)"}</Text>
          <TextInput style={inputStyle} value={line.commission} onChangeText={(v) => patch({ commission: v })} placeholder="0" placeholderTextColor={colors.muted} keyboardType="numeric" testID="aeps-input-commission" />
          {commission > 0 ? (
            <View style={[styles.chipRow, { marginTop: spacing.sm }]}>
              {COMMISSION_MODES.map((m) => (
                <Chip key={m.id} label={m.label} active={line.commissionMode === m.id} onPress={() => patch({ commissionMode: m.id })} testID={`aeps-comm-${m.id}`} />
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      <View style={styles.block}>
        <Text style={styles.blockTitle}>स्थिति</Text>
        <View style={styles.chipRow}>
          {LINE_STATUS.map((s) => (
            <Chip key={s.id} label={s.label} icon={s.icon} active={line.status === s.id} tone={s.color} onPress={() => patch({ status: s.id })} testID={`aeps-status-${s.id}`} />
          ))}
        </View>
        {line.status === "later" ? (
          <View style={{ marginTop: spacing.sm }}>
            <DateField label="कब भेजनी है" value={line.dueDate} onChange={(v) => patch({ dueDate: v })} future testID="aeps-input-due" />
            {line.dueDate <= date ? <Text style={styles.warn}>आगे की तारीख चुनें</Text> : null}
          </View>
        ) : null}
      </View>

      {flow === "out" && amt > 0 && status !== "failed" ? (
        <View style={styles.money}>
          <Text style={styles.moneyTitle}>💵 ग्राहक को कैश</Text>
          {status === "pending" ? (
            <View style={[styles.chipRow, { marginBottom: spacing.sm }]}>
              <Chip label="कैश दे दिया" icon="cash-check" active={line.cashTaken} tone={colors.success} onPress={() => patch({ cashTaken: true })} testID="aeps-cash-yes" />
              <Chip label="पैसा आने पर दूँगा" active={!line.cashTaken} onPress={() => patch({ cashTaken: false })} testID="aeps-cash-no" />
            </View>
          ) : null}
          {outGiven(line) ? (
            <>
              <Text style={styles.moneyHint}>ग्राहक का हक़ {formatINR(owed)}{owed !== amt ? ` (${formatINR(amt)} − चार्ज ${formatINR(amt - owed)})` : ""}। अभी हाथ में कितने दिए?</Text>
              <View style={[styles.chipRow, { marginBottom: spacing.sm }]}>
                <Chip label={`पूरे ${formatINR(owed)}`} active={handed === owed} onPress={() => patch({ handed: null })} tone={colors.success} testID="aeps-hand-full" />
                {cutOld > 0 && cutOld < owed ? (
                  <Chip label={`उधारी ${formatINR(cutOld)} काट कर ${formatINR(owed - cutOld)}`} active={handed === owed - cutOld && line.rest === "old"} onPress={() => patch({ handed: String(owed - cutOld), rest: "old" })} tone={colors.info} testID="aeps-hand-cut" />
                ) : null}
                <Chip label="अभी कुछ नहीं" active={handed === 0} onPress={() => patch({ handed: "0", rest: cutOld > 0 ? "old" : "later" })} tone={colors.warning} testID="aeps-hand-none" />
              </View>
              <TextInput style={[inputStyle, styles.amountInput]} value={line.handed ?? String(owed)} onChangeText={(v) => patch({ handed: v })} placeholder="0" placeholderTextColor={colors.muted} keyboardType="numeric" testID="aeps-input-handed" />
              {line.handed !== null && num(line.handed) > owed ? <Text style={styles.warn}>{formatINR(owed)} से ज़्यादा नहीं दे सकते</Text> : null}
              {kept > 0 ? (
                <View style={styles.restBox}>
                  <Text style={styles.restTitle}>बचे {formatINR(kept)} का क्या हुआ?</Text>
                  <View style={[styles.segment, { marginBottom: spacing.sm }]}>
                    {(["old", "later"] as const).map((r) => (
                      <Pressable key={r} onPress={() => patch({ rest: r })} style={[styles.segmentBtn, line.rest === r && { backgroundColor: colors.brandPrimary }]} testID={`aeps-rest-${r}`}>
                        <Text style={[styles.segmentText, line.rest === r && { color: "#fff" }]} numberOfLines={1}>{r === "old" ? "पुरानी उधारी में काटे" : "बाद में दूँगा"}</Text>
                      </Pressable>
                    ))}
                  </View>
                  <Text style={styles.moneyHint}>
                    {line.rest === "old"
                      ? oldDue > 0
                        ? `ग्राहक की उधारी ${formatINR(oldDue)} → ${formatINR(Math.max(0, oldDue - kept))}${kept > oldDue ? ` · ${formatINR(kept - oldDue)} जमा रहेंगे` : ""}`
                        : `इस ग्राहक पर कोई पुरानी उधारी नहीं — ${formatINR(kept)} खाते में जमा रहेंगे`
                      : `${formatINR(kept)} ग्राहक के खाते में जमा रहेंगे। देते समय खाते में “पैसे दिए” लिखें।`}
                  </Text>
                  <Text style={styles.moneyHint}>दूसरी सेवा (रिचार्ज / बिल) इसी पैसे से की? नीचे “और एक सेवा” जोड़ें — पूरा हिसाब अपने आप बराबर होगा।</Text>
                </View>
              ) : null}
            </>
          ) : (
            <Text style={styles.moneyHint}>बैंक में पैसा आने पर सूची में “कैश दिया” दबाएँ।</Text>
          )}
        </View>
      ) : null}

      {flow === "in" && amt > 0 && status !== "failed" ? (
        <View style={styles.money}>
          <Text style={styles.moneyTitle}>💵 ग्राहक से पैसे</Text>
          {charge > 0 && hasCustomer ? (
            <View style={[styles.chipRow, { marginBottom: spacing.sm }]}>
              <Chip label={`कमीशन ${formatINR(charge)} मिला`} active={!line.commDue} onPress={() => patch({ commDue: false, collected: null })} tone={colors.success} testID="aeps-comm-paid" />
              <Chip label="कमीशन उधार" active={line.commDue} onPress={() => patch({ commDue: true, collected: null })} tone={colors.warning} testID="aeps-comm-due" />
            </View>
          ) : null}
          <View style={[styles.chipRow, { marginBottom: spacing.sm }]}>
            <Chip label={`पूरे ${formatINR(full)}`} active={got === full} onPress={() => patch({ collected: null })} tone={colors.success} testID="aeps-got-full" />
            {oldDue > 0 ? (
              <Chip label={`+ पुरानी उधारी ${formatINR(oldDue)}`} active={got === full + oldDue && line.extra === "advance"} onPress={() => patch({ collected: String(full + oldDue), extra: "advance" })} tone={colors.info} testID="aeps-got-old" />
            ) : null}
            <Chip label="अभी कुछ नहीं" active={got === 0} onPress={() => patch({ collected: "0" })} tone={colors.warning} testID="aeps-got-none" />
          </View>
          <TextInput style={[inputStyle, styles.amountInput]} value={line.collected ?? String(full)} onChangeText={(v) => patch({ collected: v })} placeholder="0" placeholderTextColor={colors.muted} keyboardType="numeric" testID="aeps-input-collected" />
          {got > 0 ? (
            <View style={[styles.segment, { marginTop: spacing.sm, marginBottom: 0 }]}>
              {(["cash", "online"] as const).map((m) => (
                <Pressable key={m} onPress={() => patch({ payMode: m })} style={[styles.segmentBtn, line.payMode === m && { backgroundColor: m === "cash" ? colors.success : colors.info }]} testID={`aeps-paymode-${m}`}>
                  <MaterialIcon name={m === "cash" ? "cash" : "cellphone"} size={16} color={line.payMode === m ? "#fff" : colors.onSurface} />
                  <Text style={[styles.segmentText, line.payMode === m && { color: "#fff" }]}>{m === "cash" ? "नकद (गल्ले में)" : "UPI (बैंक में)"}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          {short > 0 && status === "success" ? (
            <Text style={[styles.moneyHint, { marginTop: spacing.sm }]}>
              बाकी {formatINR(short)}{owedCharge ? ` (कमीशन ${formatINR(charge)} समेत)` : ""} ग्राहक की उधारी में जुड़ेंगे{oldDue > 0 ? ` (पहले से ${formatINR(oldDue)} बाकी है)` : ""}।
            </Text>
          ) : null}
          {short > 0 && status === "pending" ? <Text style={[styles.moneyHint, { marginTop: spacing.sm }]}>काम होने पर बाकी {formatINR(short)} उधारी में जुड़ेंगे।</Text> : null}
          {over > 0 ? (
            <View style={styles.restBox}>
              <Text style={styles.restTitle}>{formatINR(over)} ज़्यादा मिले — इनका क्या करें?</Text>
              <View style={[styles.segment, { marginBottom: spacing.sm }]}>
                <Pressable onPress={() => patch({ extra: "advance" })} style={[styles.segmentBtn, line.extra === "advance" && { backgroundColor: colors.brandPrimary }]} testID="aeps-extra-advance">
                  <Text style={[styles.segmentText, line.extra === "advance" && { color: "#fff" }]} numberOfLines={1}>{oldDue > 0 ? "उधारी / जमा में" : "खाते में जमा"}</Text>
                </Pressable>
                {canSend ? (
                  <Pressable onPress={() => patch({ extra: "send" })} style={[styles.segmentBtn, line.extra === "send" && { backgroundColor: colors.brandPrimary }]} testID="aeps-extra-send">
                    <Text style={[styles.segmentText, line.extra === "send" && { color: "#fff" }]} numberOfLines={1}>बाकी बाद में भेजने हैं</Text>
                  </Pressable>
                ) : null}
              </View>
              {line.extra === "send" && canSend ? (
                <>
                  <Text style={styles.moneyHint}>{formatINR(over)} की अलग पेंडिंग एंट्री बनेगी (पैसे मिल चुके)। भेजने पर सूची में “हो गया” दबाएँ।</Text>
                  <View style={{ marginTop: spacing.sm }}>
                    <DateField label="कब भेजने हैं" value={line.dueDate} onChange={(v) => patch({ dueDate: v })} future testID="aeps-input-send-due" />
                    {line.dueDate <= date ? <Text style={styles.warn}>आगे की तारीख चुनें</Text> : null}
                  </View>
                </>
              ) : (
                <Text style={styles.moneyHint}>
                  {oldDue > 0
                    ? `ग्राहक की उधारी ${formatINR(oldDue)} → ${formatINR(Math.max(0, oldDue - over))}${over > oldDue ? ` · ${formatINR(over - oldDue)} जमा रहेंगे` : ""}`
                    : `${formatINR(over)} ग्राहक के खाते में जमा (एडवांस) रहेंगे — अगली सेवा में कटेंगे।`}
                </Text>
              )}
            </View>
          ) : null}
        </View>
      ) : null}

      <View style={styles.preview}>
        {moneyLines(preview).map((r) => (
          <View key={r.label} style={styles.previewRow}>
            <Text style={styles.previewLabel}>{r.label}</Text>
            <Text style={[styles.previewValue, { color: TONE[r.tone] }]}>{r.value}</Text>
          </View>
        ))}
        {jama ? (
          <View style={styles.previewRow}>
            <Text style={styles.previewLabel}>{flow === "out" ? "गल्ले में रखे (ग्राहक के)" : `${jama.mode === "online" ? "बैंक" : "गल्ला"} (ज़्यादा मिले)`}</Text>
            <Text style={[styles.previewValue, { color: TONE.in }]}>+{formatINR(jama.amount)}</Text>
          </View>
        ) : null}
        {over > 0 && line.extra === "send" && canSend ? (
          <>
            <View style={styles.previewRow}>
              <Text style={styles.previewLabel}>{line.payMode === "online" ? "बैंक" : "गल्ला"} (बाद में भेजने के)</Text>
              <Text style={[styles.previewValue, { color: TONE.in }]}>+{formatINR(over)}</Text>
            </View>
            <View style={styles.previewRow}>
              <Text style={styles.previewLabel}>बैंक (भेजने पर)</Text>
              <Text style={[styles.previewValue, { color: TONE.wait }]}>−{formatINR(over)} बाद में</Text>
            </View>
          </>
        ) : null}
        {bill.flow === "in" && bill.total > 0 && status !== "failed" ? (
          <View style={[styles.previewRow, styles.previewTotal]}>
            <Text style={styles.previewLabel}>कुल {formatINR(bill.total)} · मिले {formatINR(bill.settled + over)}</Text>
            <Text style={[styles.previewValue, { color: bill.due > 0 ? colors.error : colors.success }]}>
              {bill.due > 0 ? `उधारी ${formatINR(bill.due)}` : jama ? `✔ पूरा · जमा ${formatINR(jama.amount)}` : "✔ पूरा"}
            </Text>
          </View>
        ) : null}
        {flow === "out" && amt > 0 && outGiven(line) ? (
          <View style={[styles.previewRow, styles.previewTotal]}>
            <Text style={styles.previewLabel}>ग्राहक के हाथ में {formatINR(handed)}</Text>
            <Text style={[styles.previewValue, { color: kept > 0 ? colors.info : colors.success }]}>
              {kept > 0 ? (line.rest === "old" && oldDue > 0 ? `उधारी में कटे ${formatINR(Math.min(kept, oldDue))}` : `जमा ${formatINR(kept)}`) : "✔ पूरा"}
            </Text>
          </View>
        ) : null}
      </View>

      <Pressable onPress={() => patch({ more: !line.more })} style={styles.moreBtn} testID="aeps-more">
        <Text style={styles.moreText}>{line.more ? "कम दिखाएँ" : "Txn ID / RRN, नोट"}</Text>
        <MaterialIcon name={line.more ? "chevron-up" : "chevron-down"} size={18} color={colors.brandPrimary} />
      </Pressable>
      {line.more ? (
        <>
          <Field label={FIELD_LABEL.reference}>
            <TextInput style={inputStyle} value={line.reference} onChangeText={(v) => patch({ reference: v })} placeholder="रसीद / SMS में लिखा नंबर" placeholderTextColor={colors.muted} autoCapitalize="characters" testID="aeps-input-reference" />
          </Field>
          <Field label="नोट (वैकल्पिक)">
            <TextInput style={[inputStyle, { minHeight: 56 }]} value={line.notes} onChangeText={(v) => patch({ notes: v })} multiline placeholderTextColor={colors.muted} testID="aeps-input-notes" />
          </Field>
        </>
      ) : null}
    </View>
  );
}

/** All services of one visit together: what the galla, bank and the customer's khata end up with. */
function TotalCard({ lines, date }: { lines: Line[]; date: string }) {
  let cash = 0;
  let bank = 0;
  let bankLater = 0;
  let khata = 0;
  for (const l of lines) {
    const p = previewOf(l, date);
    for (const leg of aepsLegs(p)) {
      const v = leg.dir === "in" ? leg.amount : -leg.amount;
      if (leg.pocket === "cash") cash += v;
      else bank += v;
    }
    if (p.status === "pending" && p.amount > 0) {
      const b = bankOf(p);
      if (b !== "none") bankLater += b === "in" ? p.amount : -p.amount;
    }
    khata += aepsDue({ ...p, customerId: "x", status: p.status === "pending" ? "success" : p.status });
    const j = lineJama(l);
    if (j) {
      if (j.mode === "online") bank += j.amount;
      else cash += j.amount;
      khata -= j.amount;
    }
    const s = sendLater(l);
    if (s > 0) {
      if (l.payMode === "online") bank += s;
      else cash += s;
      bankLater -= s;
    }
  }
  const sign = (v: number) => `${v < 0 ? "−" : "+"}${formatINR(Math.abs(v))}`;
  const rows: { label: string; value: string; color: string }[] = [
    { label: "गल्ला", value: cash ? sign(cash) : "कोई बदलाव नहीं", color: cash < 0 ? colors.error : cash > 0 ? colors.success : colors.muted },
    { label: "बैंक (अभी)", value: bank ? sign(bank) : "कोई बदलाव नहीं", color: bank < 0 ? colors.error : bank > 0 ? colors.success : colors.muted },
  ];
  if (bankLater) rows.push({ label: "बैंक (बाद में)", value: sign(bankLater), color: colors.warning });
  rows.push({
    label: "ग्राहक का खाता",
    value: khata > 0 ? `उधारी +${formatINR(khata)}` : khata < 0 ? `जमा ${formatINR(-khata)}` : "बराबर",
    color: khata > 0 ? colors.error : khata < 0 ? colors.info : colors.success,
  });
  return (
    <View style={styles.total} testID="aeps-total">
      <Text style={styles.moneyTitle}>🧾 पूरा हिसाब · {lines.length} सेवाएँ</Text>
      {rows.map((r) => (
        <View key={r.label} style={styles.previewRow}>
          <Text style={styles.previewLabel}>{r.label}</Text>
          <Text style={[styles.previewValue, { color: r.color }]}>{r.value}</Text>
        </View>
      ))}
      <Text style={[styles.moneyHint, { marginTop: spacing.xs }]}>
        {cash < 0 ? `ग्राहक को कुल ${formatINR(-cash)} कैश दिए` : cash > 0 ? `ग्राहक से कुल ${formatINR(cash)} कैश लिए` : "कैश बराबर"} (कमीशन मिला कर)
      </Text>
    </View>
  );
}

function Presets({ items, value, onPick }: { items: string[]; value: string; onPick: (v: string) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: spacing.sm, paddingTop: spacing.sm }}>
      {items.map((b) => (
        <Chip key={b} label={b} active={value === b} onPress={() => onPick(b)} />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  line: { padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary, marginBottom: spacing.md },
  lineHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.sm },
  lineTitle: { fontSize: 13, fontWeight: "800", color: colors.onSurface },
  serviceGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.md },
  serviceTile: { width: "31.5%", alignItems: "center", gap: 4, paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  serviceText: { fontSize: 13, fontWeight: "700", color: colors.onSurface },
  segment: { flexDirection: "row", backgroundColor: colors.surface, borderRadius: radius.md, padding: 4, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border },
  segmentBtn: { flex: 1, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", paddingVertical: 10, borderRadius: radius.sm },
  segmentText: { fontSize: 13, fontWeight: "700", color: colors.onSurface },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  block: { marginBottom: spacing.md },
  blockTitle: { fontSize: 13, fontWeight: "700", color: colors.onSurfaceSecondary, marginBottom: spacing.sm },
  warn: { fontSize: 12, color: colors.error, marginTop: spacing.xs },
  preview: { marginBottom: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderStyle: "dashed", borderColor: colors.border, backgroundColor: colors.surface },
  previewRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3, gap: spacing.md },
  previewTotal: { borderTopWidth: 1, borderTopColor: colors.border, marginTop: 4, paddingTop: 6 },
  previewLabel: { fontSize: 13, color: colors.onSurfaceSecondary, flexShrink: 1 },
  previewValue: { fontSize: 14, fontWeight: "800" },
  amountInput: { fontSize: 22, fontWeight: "700" },
  moreBtn: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: spacing.sm },
  moreText: { fontSize: 13, fontWeight: "700", color: colors.brandPrimary },
  money: { marginBottom: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  moneyTitle: { fontSize: 14, fontWeight: "800", color: colors.onSurface, marginBottom: spacing.sm },
  moneyHint: { fontSize: 12, color: colors.onSurfaceSecondary, lineHeight: 17 },
  restBox: { marginTop: spacing.md, padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  restTitle: { fontSize: 13, fontWeight: "800", color: colors.onSurface, marginBottom: spacing.sm },
  total: { marginBottom: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.brandPrimary, backgroundColor: colors.surface },
  addLine: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: spacing.md, marginBottom: spacing.md },
});
