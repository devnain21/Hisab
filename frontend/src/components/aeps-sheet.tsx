import { useEffect, useState } from "react";
import { View, Text, TextInput, StyleSheet, ScrollView, type KeyboardTypeOptions } from "react-native";
import MaterialIcon from "@react-native-vector-icons/material-design-icons";
import { colors, spacing, radius } from "@/src/theme";
import { store } from "@/src/lib/store";
import type { AepsCash, AepsCommissionMode, AepsStatus, AepsTxn, AepsType, AepsVia } from "@/src/lib/data";
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
  cashLegDate,
  defaultVia,
  fieldLabel,
  fieldsFor,
  isLater,
  moneyLines,
  type AepsField,
  type CashFlow,
} from "@/src/lib/aeps";
import { createAeps, saveAeps } from "@/src/lib/aeps-due";
import { formatINR, nowHM, todayISO } from "@/src/lib/format";
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
  /** Money the customer handed over; null follows the amount (paid in full). */
  collected: string | null;
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
  payMode: "cash",
  dueDate: todayISO(1),
  notes: "",
  more: false,
});

const flowOf = (l: Pick<Line, "type" | "cash">): CashFlow => (l.cash || AEPS_META[l.type].cash) as CashFlow;

const lineFrom = (t: AepsTxn): Line => {
  const legDone = !!cashLegDate(t);
  return {
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
    collected: !legDone ? "0" : t.collected == null ? null : String(t.collected),
    payMode: t.payMode === "online" ? "online" : "cash",
    dueDate: t.dueDate || todayISO(1),
    notes: t.notes,
    more: !!t.reference || !!t.notes,
  };
};

const digits = (v: string, max: number) => v.replace(/\D/g, "").slice(0, max);
const num = (v: string) => Math.max(parseFloat(v) || 0, 0);
const collectedNum = (l: Line) => (l.collected === null ? num(l.amount) : num(l.collected));

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
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setMobile(initial?.mobile ?? "");
    setDate(initial?.date ?? todayISO());
    setTime(initial?.time || nowHM());
    setLines([initial ? lineFrom(initial) : emptyLine()]);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, initial]);

  const picked = choice.recent.find((c) => c.id === choice.customerId);
  const name = picked ? picked.name : choice.query.trim();
  const finalMobile = digits(picked ? picked.phone || mobile : choice.isNew ? choice.newPhone : "", 10);

  const patch = (key: string, partial: Partial<Line>) => setLines((rows) => rows.map((r) => (r.key === key ? { ...r, ...partial } : r)));
  const pickType = (key: string, type: AepsType) =>
    patch(key, { type, via: defaultVia(type), cash: type === "other" ? "in" : "", cashTaken: true, collected: null });

  const lineValid = (l: Line) => {
    const amt = num(l.amount);
    if (l.type !== "balance" && !(flowOf(l) === "none" && l.type === "other") && amt <= 0) return false;
    if (l.status === "later" && l.dueDate <= date) return false;
    if (flowOf(l) === "in" && collectedNum(l) > amt) return false;
    return true;
  };
  const valid = choice.ready && !choice.isSelf && lines.every(lineValid);

  /** Status fields for the server. Editing keeps the days a side already settled on. */
  const statusFields = (line: Line, i: number) => {
    const prev = initial && i === 0 ? initial : null;
    const status: AepsStatus = line.status === "later" ? "pending" : line.status;
    const flow = flowOf(line);
    const got = flow === "in" ? Math.min(collectedNum(line), num(line.amount)) : 0;
    const cashNow = status !== "failed" && (flow === "in" ? got > 0 : flow === "out" ? status === "success" || line.cashTaken : true);
    const prevCash = prev ? cashLegDate(prev) : null;
    return {
      status,
      cashDate: cashNow ? prevCash || date : "",
      doneDate: status === "success" ? prev?.doneDate || date : "",
      dueDate: line.status === "later" ? line.dueDate : "",
      commissionMode: num(line.commission) > 0 ? line.commissionMode : ("" as AepsCommissionMode),
      collected: flow === "in" ? got : null,
      payMode: flow === "in" ? line.payMode : ("" as const),
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
      lines.forEach((line, i) => {
        const keep = new Set<AepsField>(fieldsFor(line.type, line.via));
        const val = (f: AepsField, v: string) => (keep.has(f) ? v.trim() : "");
        const payload = {
          type: line.type,
          via: VIA_FOR[line.type] ? line.via : ("" as AepsVia),
          date,
          time,
          customerId,
          customerName: name,
          mobile: finalMobile,
          aadhaarLast4: val("aadhaarLast4", line.aadhaarLast4),
          bankName: val("bankName", line.bankName),
          amount: num(line.amount),
          commission: num(line.commission),
          ...statusFields(line, i),
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
        if (initial && i === 0) saveAeps(initial.id, payload);
        else createAeps(payload);
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
        />
      ))}

      {!initial ? (
        <Pressable onPress={() => setLines((rows) => [...rows, emptyLine("transfer")])} style={styles.addLine} testID="aeps-add-line">
          <MaterialIcon name="plus" size={18} color={colors.brandPrimary} />
          <Text style={styles.moreText}>और एक सेवा</Text>
        </Pressable>
      ) : null}

      <DateField label="तारीख" value={date} onChange={setDate} money={!initial} testID="aeps-input-date" />
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
}: {
  line: Line;
  index: number;
  count: number;
  date: string;
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
  const preview = {
    type: line.type,
    date,
    cash: line.cash,
    amount: amt,
    commission,
    commissionMode: commission > 0 ? line.commissionMode : ("" as AepsCommissionMode),
    status,
    cashDate: status === "failed" ? "" : flow === "in" ? (got > 0 ? date : "") : flow === "out" ? (status === "success" || line.cashTaken ? date : "") : date,
    doneDate: status === "success" ? date : "",
    collected: flow === "in" ? Math.min(got, amt) : null,
    payMode: line.payMode,
  };
  const bill = aepsBill(preview);

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

      {flow === "in" && amt > 0 && status !== "failed" ? (
        <View style={styles.block}>
          <Text style={styles.blockTitle}>ग्राहक से कितने मिले</Text>
          <View style={[styles.chipRow, { marginBottom: spacing.sm }]}>
            <Chip label={`पूरे ${formatINR(amt)}`} active={got === amt} onPress={() => patch({ collected: null })} tone={colors.success} testID="aeps-got-full" />
            <Chip label="कुछ नहीं" active={got === 0} onPress={() => patch({ collected: "0" })} tone={colors.warning} testID="aeps-got-none" />
          </View>
          <TextInput style={inputStyle} value={line.collected ?? line.amount} onChangeText={(v) => patch({ collected: v })} placeholder="0" placeholderTextColor={colors.muted} keyboardType="numeric" testID="aeps-input-collected" />
          {got > amt ? <Text style={styles.warn}>रकम से ज़्यादा नहीं</Text> : null}
          {got > 0 ? (
            <View style={[styles.segment, { marginTop: spacing.sm, marginBottom: 0 }]}>
              {(["cash", "online"] as const).map((m) => (
                <Pressable key={m} onPress={() => patch({ payMode: m })} style={[styles.segmentBtn, line.payMode === m && { backgroundColor: m === "cash" ? colors.success : colors.info }]} testID={`aeps-paymode-${m}`}>
                  <MaterialIcon name={m === "cash" ? "cash" : "cellphone"} size={16} color={line.payMode === m ? "#fff" : colors.onSurface} />
                  <Text style={[styles.segmentText, line.payMode === m && { color: "#fff" }]}>{m === "cash" ? "नकद (गल्ले में)" : "ऑनलाइन (बैंक में)"}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

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
        {(line.status === "pending" || line.status === "later") && flow === "out" ? (
          <View style={[styles.chipRow, { marginTop: spacing.sm }]}>
            <Chip label="कैश दे दिया" icon="cash-check" active={line.cashTaken} tone={colors.success} onPress={() => patch({ cashTaken: true })} testID="aeps-cash-yes" />
            <Chip label="कैश अभी नहीं दिया" active={!line.cashTaken} onPress={() => patch({ cashTaken: false })} testID="aeps-cash-no" />
          </View>
        ) : null}
        {line.status === "later" ? (
          <View style={{ marginTop: spacing.sm }}>
            <DateField label="कब भेजनी है" value={line.dueDate} onChange={(v) => patch({ dueDate: v })} future testID="aeps-input-due" />
            {line.dueDate <= date ? <Text style={styles.warn}>आगे की तारीख चुनें</Text> : null}
          </View>
        ) : null}
      </View>

      <View style={styles.preview}>
        {moneyLines(preview).map((r) => (
          <View key={r.label} style={styles.previewRow}>
            <Text style={styles.previewLabel}>{r.label}</Text>
            <Text style={[styles.previewValue, { color: TONE[r.tone] }]}>{r.value}</Text>
          </View>
        ))}
        {bill.flow === "in" && bill.total > 0 && status !== "failed" ? (
          <View style={[styles.previewRow, styles.previewTotal]}>
            <Text style={styles.previewLabel}>कुल {formatINR(bill.total)} · जमा {formatINR(bill.settled)}</Text>
            <Text style={[styles.previewValue, { color: bill.due > 0 ? colors.error : colors.success }]}>{bill.due > 0 ? `बाकी ${formatINR(bill.due)}` : "✔ पूरा"}</Text>
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
  addLine: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: spacing.md, marginBottom: spacing.md },
});
