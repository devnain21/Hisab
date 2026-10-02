import { useEffect, useState } from "react";
import { View, Text, TextInput, StyleSheet, ScrollView } from "react-native";
import MaterialIcon from "@react-native-vector-icons/material-design-icons";
import { colors, spacing, radius } from "@/src/theme";
import { store } from "@/src/lib/store";
import { useAeps, type AepsCash, type AepsCommissionMode, type AepsStatus, type AepsTxn, type AepsType } from "@/src/lib/data";
import { AEPS_META, AEPS_TYPES, BANKS, BILLERS, COMMISSION_MODES, FIELD_LABEL, OPERATORS, STATUS_META, cashLegDate, isLater, moneyLines, type AepsField, type CashFlow } from "@/src/lib/aeps";
import { nowHM, todayISO } from "@/src/lib/format";
import { Pressable } from "@/src/components/tap";
import { Chip, DateField, Field, PrimaryButton, SheetShell, inputStyle } from "@/src/components/sheets";

const SERVICES = AEPS_TYPES.filter((t) => t !== "other");

type Line = {
  key: string;
  type: AepsType;
  amount: string;
  /** "" uses the service default. UPI can be "in" (cash taken) or "none" (drawer untouched). */
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
  /** For pending rows: the counter cash already changed hands. */
  cashTaken: boolean;
  dueDate: string;
  notes: string;
  more: boolean;
};

type LineStatus = AepsStatus | "later";
const LINE_STATUS: { id: LineStatus; label: string; icon: string; color: string }[] = [
  { id: "success", label: "हो गया", icon: "check-circle", color: STATUS_META.success.color },
  { id: "pending", label: "पेंडिंग", icon: "clock-outline", color: STATUS_META.pending.color },
  { id: "later", label: "बाद में भेजनी है", icon: "calendar-clock", color: colors.info },
  { id: "failed", label: "फेल", icon: "close-circle", color: STATUS_META.failed.color },
];

const TONE = { in: colors.success, out: colors.error, wait: colors.warning, muted: colors.muted } as const;

const lineKey = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

const emptyLine = (type: AepsType = "withdrawal"): Line => ({
  key: lineKey(),
  type,
  amount: "",
  cash: "",
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
  cashTaken: AEPS_META[type].cash === "in",
  dueDate: todayISO(1),
  notes: "",
  more: false,
});

const lineFrom = (t: AepsTxn): Line => ({
  ...emptyLine(t.type),
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
  cashTaken: !!cashLegDate(t),
  dueDate: t.dueDate || todayISO(1),
  notes: t.notes,
  more: !!t.reference || !!t.notes,
});

const digits = (v: string, max: number) => v.replace(/\D/g, "").slice(0, max);

export function AepsSheet({ visible, initial, onClose }: { visible: boolean; initial?: AepsTxn | null; onClose: () => void }) {
  const history = useAeps().data ?? [];
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [date, setDate] = useState(todayISO());
  const [time, setTime] = useState(nowHM());
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    if (initial) {
      setName(initial.customerName);
      setMobile(initial.mobile);
      setDate(initial.date);
      setTime(initial.time || nowHM());
      setLines([lineFrom(initial)]);
    } else {
      setName("");
      setMobile("");
      setDate(todayISO());
      setTime(nowHM());
      setLines([emptyLine()]);
    }
  }, [visible, initial]);

  const onMobile = (v: string) => {
    const m = digits(v, 10);
    setMobile(m);
    if (m.length === 10 && !initial && !name) {
      const prev = [...history].reverse().find((t) => t.mobile === m);
      if (prev) setName(prev.customerName);
    }
  };

  const patch = (key: string, partial: Partial<Line>) => setLines((rows) => rows.map((r) => (r.key === key ? { ...r, ...partial } : r)));

  const needsAmount = (t: AepsType) => t !== "balance";
  const valid = !!name.trim() && lines.every((l) => (!needsAmount(l.type) || (parseFloat(l.amount) || 0) > 0) && (l.status !== "later" || l.dueDate > date));

  /** Status fields for the server. Editing keeps the original days a side already settled on. */
  const statusFields = (line: Line, i: number) => {
    const prev = initial && i === 0 ? initial : null;
    const status: AepsStatus = line.status === "later" ? "pending" : line.status;
    const prevCash = prev ? cashLegDate(prev) : null;
    const flow = (line.cash || AEPS_META[line.type].cash) as CashFlow;
    const cashNow = status === "success" || (status === "pending" && (line.cashTaken || flow === "none"));
    return {
      status,
      cashDate: status === "failed" || !cashNow ? "" : prevCash || date,
      doneDate: status === "success" ? prev?.doneDate || date : "",
      dueDate: line.status === "later" ? line.dueDate : "",
      commissionMode: (parseFloat(line.commission) || 0) > 0 ? line.commissionMode : ("" as AepsCommissionMode),
    };
  };

  const save = () => {
    if (!valid) return;
    setSaving(true);
    try {
      lines.forEach((line, i) => {
        const flow = (line.cash || AEPS_META[line.type].cash) as CashFlow;
        const payload = {
          type: line.type,
          date,
          time,
          customerName: name.trim(),
          mobile,
          aadhaarLast4: line.aadhaarLast4,
          bankName: line.bankName.trim(),
          amount: parseFloat(line.amount) || 0,
          commission: parseFloat(line.commission) || 0,
          ...statusFields(line, i),
          reference: line.reference.trim(),
          operator: line.operator.trim(),
          rechargeNumber: line.rechargeNumber.trim(),
          billerName: line.billerName.trim(),
          billAccount: line.billAccount.trim(),
          beneficiaryName: line.beneficiaryName.trim(),
          accountNumber: line.accountNumber.trim(),
          ifsc: line.ifsc.trim().toUpperCase(),
          upiId: line.upiId.trim(),
          cash: line.cash,
          notes: line.notes.trim(),
        };
        const keep = new Set(AEPS_META[line.type].fields);
        if (!keep.has("aadhaarLast4")) payload.aadhaarLast4 = "";
        if (!keep.has("bankName")) payload.bankName = "";
        if (!keep.has("beneficiaryName")) payload.beneficiaryName = "";
        if (!keep.has("accountNumber")) payload.accountNumber = "";
        if (!keep.has("ifsc")) payload.ifsc = "";
        if (!keep.has("upiId")) payload.upiId = "";
        if (!keep.has("operator")) payload.operator = "";
        if (!keep.has("rechargeNumber")) payload.rechargeNumber = "";
        if (!keep.has("billerName")) payload.billerName = "";
        if (!keep.has("billAccount")) payload.billAccount = "";
        if (!keep.has("commission")) { payload.commission = 0; payload.commissionMode = ""; }
        if (!keep.has("reference")) payload.reference = "";
        if (line.type !== "upi" && line.type !== "other") payload.cash = "";
        if (line.type === "upi" && flow === "in") payload.cash = "";
        if (initial && i === 0) store.updateAeps(initial.id, payload);
        else store.createAeps(payload);
      });
      onClose();
    } finally { setSaving(false); }
  };

  return (
    <SheetShell visible={visible} onClose={onClose} title={initial ? "एंट्री बदलें" : "काउंटर एंट्री"} testID="sheet-aeps">
      <Field label="नाम">
        <TextInput style={inputStyle} value={name} onChangeText={setName} placeholder="जैसे सुनीता देवी" placeholderTextColor={colors.muted} autoCapitalize="words" testID="aeps-input-name" />
      </Field>
      <Field label={FIELD_LABEL.mobile}>
        <TextInput style={inputStyle} value={mobile} onChangeText={onMobile} placeholder="10 अंक" placeholderTextColor={colors.muted} keyboardType="phone-pad" maxLength={10} testID="aeps-input-mobile" />
      </Field>

      {lines.map((line, index) => {
        const meta = AEPS_META[line.type];
        const has = (f: AepsField) => meta.fields.includes(f);
        const amt = parseFloat(line.amount) || 0;
        const flow = (line.cash || meta.cash) as CashFlow;
        return (
          <View key={line.key} style={styles.line}>
            <View style={styles.lineHead}>
              <Text style={styles.lineTitle}>सेवा {lines.length > 1 ? index + 1 : ""}</Text>
              {lines.length > 1 ? (
                <Pressable onPress={() => setLines((rows) => rows.filter((r) => r.key !== line.key))} hitSlop={8} testID={`aeps-remove-${index}`}>
                  <MaterialIcon name="close" size={18} color={colors.muted} />
                </Pressable>
              ) : null}
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: spacing.sm }}>
              {SERVICES.map((t) => {
                const m = AEPS_META[t];
                const active = line.type === t;
                return (
                  <Pressable key={t} onPress={() => patch(line.key, { type: t, cash: "", cashTaken: AEPS_META[t].cash === "in" })} style={[styles.serviceChip, active && { backgroundColor: m.color, borderColor: m.color }]} testID={`aeps-type-${t}`}>
                    <MaterialIcon name={m.icon as any} size={16} color={active ? "#fff" : m.color} />
                    <Text style={[styles.typeText, active && { color: "#fff" }]}>{m.short}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {line.type === "upi" ? (
              <View style={[styles.chipRow, { marginTop: spacing.sm }]}>
                <Chip label="नकद लेकर भेजा" active={flow === "in"} onPress={() => patch(line.key, { cash: "" })} tone={colors.success} testID="aeps-upi-in" />
                <Chip label="सिर्फ़ UPI" active={flow === "none"} onPress={() => patch(line.key, { cash: "none" })} testID="aeps-upi-none" />
              </View>
            ) : null}

            {has("amount") ? (
              <Field label={meta.amountLabel}>
                <TextInput style={[inputStyle, styles.amountInput]} value={line.amount} onChangeText={(v) => patch(line.key, { amount: v })} placeholder="0" placeholderTextColor={colors.muted} keyboardType="numeric" testID="aeps-input-amount" />
              </Field>
            ) : null}
            {has("aadhaarLast4") ? (
              <>
                <Field label={FIELD_LABEL.aadhaarLast4}>
                  <TextInput style={inputStyle} value={line.aadhaarLast4} onChangeText={(v) => patch(line.key, { aadhaarLast4: digits(v, 4) })} placeholder="जैसे 4821" placeholderTextColor={colors.muted} keyboardType="number-pad" maxLength={4} testID="aeps-input-aadhaarLast4" />
                </Field>
                <Text style={styles.privacy}>सुरक्षा के लिए पूरा आधार नंबर सेव नहीं होता।</Text>
              </>
            ) : null}
            {has("bankName") ? (
              <Field label={FIELD_LABEL.bankName}>
                <TextInput style={inputStyle} value={line.bankName} onChangeText={(v) => patch(line.key, { bankName: v })} placeholder="बैंक का नाम" placeholderTextColor={colors.muted} testID="aeps-input-bankName" />
                <Presets items={BANKS} value={line.bankName} onPick={(v) => patch(line.key, { bankName: v })} />
              </Field>
            ) : null}
            {has("beneficiaryName") ? (
              <Field label={FIELD_LABEL.beneficiaryName}>
                <TextInput style={inputStyle} value={line.beneficiaryName} onChangeText={(v) => patch(line.key, { beneficiaryName: v })} placeholder="जिसे पैसे भेजे" placeholderTextColor={colors.muted} autoCapitalize="words" testID="aeps-input-beneficiaryName" />
              </Field>
            ) : null}
            {has("upiId") ? (
              <Field label={FIELD_LABEL.upiId}>
                <TextInput style={inputStyle} value={line.upiId} onChangeText={(v) => patch(line.key, { upiId: v })} placeholder="जैसे sunita@upi" placeholderTextColor={colors.muted} autoCapitalize="none" maxLength={50} testID="aeps-input-upiId" />
              </Field>
            ) : null}
            {has("accountNumber") ? (
              <Field label={FIELD_LABEL.accountNumber}>
                <TextInput style={inputStyle} value={line.accountNumber} onChangeText={(v) => patch(line.key, { accountNumber: v })} placeholder="खाता नंबर" placeholderTextColor={colors.muted} keyboardType="number-pad" maxLength={20} testID="aeps-input-accountNumber" />
              </Field>
            ) : null}
            {has("ifsc") ? (
              <Field label={FIELD_LABEL.ifsc}>
                <TextInput style={inputStyle} value={line.ifsc} onChangeText={(v) => patch(line.key, { ifsc: v })} placeholder="जैसे SBIN0001234" placeholderTextColor={colors.muted} autoCapitalize="characters" maxLength={11} testID="aeps-input-ifsc" />
              </Field>
            ) : null}
            {has("operator") ? (
              <Field label={FIELD_LABEL.operator}>
                <TextInput style={inputStyle} value={line.operator} onChangeText={(v) => patch(line.key, { operator: v })} placeholder="ऑपरेटर" placeholderTextColor={colors.muted} testID="aeps-input-operator" />
                <Presets items={OPERATORS} value={line.operator} onPick={(v) => patch(line.key, { operator: v })} />
              </Field>
            ) : null}
            {has("rechargeNumber") ? (
              <Field label={FIELD_LABEL.rechargeNumber}>
                <TextInput style={inputStyle} value={line.rechargeNumber} onChangeText={(v) => patch(line.key, { rechargeNumber: v })} placeholder="मोबाइल या DTH ID" placeholderTextColor={colors.muted} keyboardType="number-pad" maxLength={15} testID="aeps-input-rechargeNumber" />
              </Field>
            ) : null}
            {has("billerName") ? (
              <Field label={FIELD_LABEL.billerName}>
                <TextInput style={inputStyle} value={line.billerName} onChangeText={(v) => patch(line.key, { billerName: v })} placeholder="जैसे बिजली" placeholderTextColor={colors.muted} testID="aeps-input-billerName" />
                <Presets items={BILLERS} value={line.billerName} onPick={(v) => patch(line.key, { billerName: v })} />
              </Field>
            ) : null}
            {has("billAccount") ? (
              <Field label={FIELD_LABEL.billAccount}>
                <TextInput style={inputStyle} value={line.billAccount} onChangeText={(v) => patch(line.key, { billAccount: v })} placeholder="बिल पर लिखा नंबर" placeholderTextColor={colors.muted} testID="aeps-input-billAccount" />
              </Field>
            ) : null}

            {has("commission") ? (
              <View style={styles.block}>
                <Text style={styles.blockTitle}>कमीशन</Text>
                <TextInput style={inputStyle} value={line.commission} onChangeText={(v) => patch(line.key, { commission: v })} placeholder="₹ 0 (नहीं मिला तो खाली)" placeholderTextColor={colors.muted} keyboardType="numeric" testID="aeps-input-commission" />
                {(parseFloat(line.commission) || 0) > 0 ? (
                  <View style={[styles.chipRow, { marginTop: spacing.sm }]}>
                    {COMMISSION_MODES.map((m) => (
                      <Chip key={m.id} label={m.label} active={line.commissionMode === m.id} onPress={() => patch(line.key, { commissionMode: m.id })} testID={`aeps-comm-${m.id}`} />
                    ))}
                  </View>
                ) : null}
              </View>
            ) : null}

            <View style={styles.block}>
              <Text style={styles.blockTitle}>स्थिति</Text>
              <View style={styles.chipRow}>
                {LINE_STATUS.map((s) => (
                  <Chip key={s.id} label={s.label} icon={s.icon} active={line.status === s.id} tone={s.color} onPress={() => patch(line.key, { status: s.id })} testID={`aeps-status-${s.id}`} />
                ))}
              </View>
              {(line.status === "pending" || line.status === "later") && flow !== "none" ? (
                <View style={[styles.chipRow, { marginTop: spacing.sm }]}>
                  <Chip label={flow === "in" ? "कैश ले लिया" : "कैश दे दिया"} icon="cash-check" active={line.cashTaken} tone={colors.success} onPress={() => patch(line.key, { cashTaken: true })} testID="aeps-cash-yes" />
                  <Chip label={flow === "in" ? "कैश अभी नहीं लिया" : "कैश अभी नहीं दिया"} active={!line.cashTaken} onPress={() => patch(line.key, { cashTaken: false })} testID="aeps-cash-no" />
                </View>
              ) : null}
              {line.status === "later" ? (
                <View style={{ marginTop: spacing.sm }}>
                  <DateField label="कब भेजनी है" value={line.dueDate} onChange={(v) => patch(line.key, { dueDate: v })} testID="aeps-input-due" />
                  {line.dueDate <= date ? <Text style={styles.warn}>आगे की तारीख चुनें</Text> : null}
                </View>
              ) : null}
            </View>

            <View style={styles.preview}>
              {moneyLines({
                type: line.type,
                date,
                cash: line.cash,
                amount: amt,
                commission: parseFloat(line.commission) || 0,
                commissionMode: line.commissionMode,
                status: line.status === "later" ? "pending" : line.status,
                cashDate: line.status === "success" || ((line.status === "pending" || line.status === "later") && line.cashTaken) ? date : "",
                doneDate: line.status === "success" ? date : "",
              }).map((r) => (
                <View key={r.label} style={styles.previewRow}>
                  <Text style={styles.previewLabel}>{r.label}</Text>
                  <Text style={[styles.previewValue, { color: TONE[r.tone] }]}>{r.value}</Text>
                </View>
              ))}
            </View>

            <Pressable onPress={() => patch(line.key, { more: !line.more })} style={styles.moreBtn} testID="aeps-more">
              <Text style={styles.moreText}>{line.more ? "कम दिखाएँ" : "Txn ID, नोट"}</Text>
              <MaterialIcon name={line.more ? "chevron-up" : "chevron-down"} size={18} color={colors.brandPrimary} />
            </Pressable>
            {line.more ? (
              <>
                {has("reference") ? (
                  <Field label={FIELD_LABEL.reference}>
                    <TextInput style={inputStyle} value={line.reference} onChangeText={(v) => patch(line.key, { reference: v })} placeholder="रसीद / SMS में लिखा नंबर" placeholderTextColor={colors.muted} autoCapitalize="characters" testID="aeps-input-reference" />
                  </Field>
                ) : null}
                <Field label="नोट (वैकल्पिक)">
                  <TextInput style={[inputStyle, { minHeight: 56 }]} value={line.notes} onChangeText={(v) => patch(line.key, { notes: v })} multiline placeholderTextColor={colors.muted} testID="aeps-input-notes" />
                </Field>
              </>
            ) : null}
          </View>
        );
      })}

      {!initial ? (
        <Pressable onPress={() => setLines((rows) => [...rows, emptyLine("upi")])} style={styles.addLine} testID="aeps-add-line">
          <MaterialIcon name="plus" size={18} color={colors.brandPrimary} />
          <Text style={styles.moreText}>और एक सेवा</Text>
        </Pressable>
      ) : null}

      <DateField label="तारीख" value={date} onChange={setDate} testID="aeps-input-date" />
      <Field label="समय">
        <TextInput style={inputStyle} value={time} onChangeText={setTime} placeholder="HH:MM" placeholderTextColor={colors.muted} maxLength={5} testID="aeps-input-time" />
      </Field>

      <PrimaryButton label={initial ? "बदलाव सेव करें" : lines.length > 1 ? `${lines.length} सेवाएँ सेव करें` : "एंट्री सेव करें"} onPress={save} disabled={!valid} saving={saving} testID="aeps-save-btn" />
    </SheetShell>
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
  serviceChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  typeText: { fontSize: 13, fontWeight: "700", color: colors.onSurface },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  block: { marginBottom: spacing.md },
  blockTitle: { fontSize: 13, fontWeight: "700", color: colors.onSurfaceSecondary, marginBottom: spacing.sm },
  warn: { fontSize: 12, color: colors.error, marginTop: -spacing.sm },
  preview: { marginBottom: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderStyle: "dashed", borderColor: colors.border, backgroundColor: colors.surface },
  previewRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  previewLabel: { fontSize: 13, color: colors.onSurfaceSecondary },
  previewValue: { fontSize: 14, fontWeight: "800" },
  amountInput: { fontSize: 22, fontWeight: "700" },
  privacy: { fontSize: 11, color: colors.muted, marginTop: -spacing.sm, marginBottom: spacing.md },
  moreBtn: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: spacing.sm },
  moreText: { fontSize: 13, fontWeight: "700", color: colors.brandPrimary },
  addLine: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: spacing.md, marginBottom: spacing.md },
});
