import { useEffect, useState } from "react";
import { View, Text, TextInput, StyleSheet, ScrollView, type KeyboardTypeOptions } from "react-native";
import MaterialIcon from "@react-native-vector-icons/material-design-icons";
import { colors, spacing, radius } from "@/src/theme";
import { store } from "@/src/lib/store";
import { useAeps, type AepsStatus, type AepsTxn, type AepsType } from "@/src/lib/data";
import { AEPS_META, AEPS_TYPES, BANKS, BILLERS, FIELD_LABEL, OPERATORS, STATUS_META, type AepsField } from "@/src/lib/aeps";
import { nowHM, todayISO } from "@/src/lib/format";
import { Pressable } from "@/src/components/tap";
import { Chip, DateField, Field, PrimaryButton, SheetShell, inputStyle } from "@/src/components/sheets";

type Form = Omit<AepsTxn, "id" | "createdAt">;

const blank = (type: AepsType): Form => ({
  type,
  date: todayISO(),
  time: nowHM(),
  customerName: "",
  mobile: "",
  aadhaarLast4: "",
  bankName: "",
  amount: 0,
  commission: 0,
  status: "success",
  reference: "",
  operator: "",
  rechargeNumber: "",
  billerName: "",
  billAccount: "",
  beneficiaryName: "",
  accountNumber: "",
  ifsc: "",
  notes: "",
});

const TEXT_FIELDS: Exclude<AepsField, "amount" | "commission">[] = [
  "mobile", "aadhaarLast4", "bankName", "reference", "operator", "rechargeNumber",
  "billerName", "billAccount", "beneficiaryName", "accountNumber", "ifsc",
];

const digits = (v: string, max: number) => v.replace(/\D/g, "").slice(0, max);

export function AepsSheet({ visible, initial, onClose }: { visible: boolean; initial?: AepsTxn | null; onClose: () => void }) {
  const history = useAeps().data ?? [];
  const [form, setForm] = useState<Form>(blank("withdrawal"));
  const [amount, setAmount] = useState("");
  const [commission, setCommission] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    if (initial) {
      const { id: _id, createdAt: _c, ...rest } = initial;
      setForm(rest);
      setAmount(initial.amount > 0 ? String(initial.amount) : "");
      setCommission(initial.commission > 0 ? String(initial.commission) : "");
    } else {
      setForm(blank("withdrawal"));
      setAmount("");
      setCommission("");
    }
  }, [visible, initial]);

  const meta = AEPS_META[form.type];
  const has = (f: AepsField) => meta.fields.includes(f);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  // Regular customers come back often: fill their details from the last visit.
  const onMobile = (v: string) => {
    const m = digits(v, 10);
    setForm((f) => {
      const next = { ...f, mobile: m };
      if (m.length === 10 && !initial) {
        const prev = [...history].reverse().find((t) => t.mobile === m);
        if (prev) {
          if (!next.customerName) next.customerName = prev.customerName;
          if (!next.aadhaarLast4) next.aadhaarLast4 = prev.aadhaarLast4;
          if (!next.bankName) next.bankName = prev.bankName;
        }
      }
      return next;
    });
  };

  const amt = parseFloat(amount) || 0;
  const needsAmount = form.type !== "balance" && form.type !== "other";
  const valid = !!form.customerName.trim() && (!needsAmount || amt > 0);

  const save = () => {
    if (!valid) return;
    setSaving(true);
    try {
      const payload: Form = { ...form, customerName: form.customerName.trim(), notes: form.notes.trim(), amount: amt, commission: parseFloat(commission) || 0 };
      for (const f of TEXT_FIELDS) payload[f] = has(f) ? String(payload[f] ?? "").trim() : "";
      if (!has("commission")) payload.commission = 0;
      payload.ifsc = payload.ifsc.toUpperCase();
      if (initial) store.updateAeps(initial.id, payload);
      else store.createAeps(payload);
      onClose();
    } finally { setSaving(false); }
  };

  const textField = (f: Exclude<AepsField, "amount" | "commission">, opts: { placeholder?: string; keyboard?: KeyboardTypeOptions; max?: number; caps?: "characters" | "words" | "none" } = {}) =>
    has(f) ? (
      <Field label={FIELD_LABEL[f]}>
        <TextInput
          style={inputStyle}
          value={form[f]}
          onChangeText={(v) => (f === "mobile" ? onMobile(v) : f === "aadhaarLast4" ? set(f, digits(v, 4)) : set(f, v))}
          placeholder={opts.placeholder}
          placeholderTextColor={colors.muted}
          keyboardType={opts.keyboard}
          maxLength={opts.max}
          autoCapitalize={opts.caps}
          testID={`aeps-input-${f}`}
        />
        {f === "bankName" ? <Presets items={BANKS} value={form.bankName} onPick={(v) => set("bankName", v)} /> : null}
        {f === "operator" ? <Presets items={OPERATORS} value={form.operator} onPick={(v) => set("operator", v)} /> : null}
        {f === "billerName" ? <Presets items={BILLERS} value={form.billerName} onPick={(v) => set("billerName", v)} /> : null}
      </Field>
    ) : null;

  return (
    <SheetShell visible={visible} onClose={onClose} title={initial ? "लेन-देन बदलें" : "नया लेन-देन"} testID="sheet-aeps">
      <Field label="सेवा चुनें">
        <View style={styles.typeGrid}>
          {AEPS_TYPES.map((t) => {
            const m = AEPS_META[t];
            const active = form.type === t;
            return (
              <Pressable key={t} onPress={() => set("type", t)} style={[styles.typeTile, active && { backgroundColor: m.color, borderColor: m.color }]} testID={`aeps-type-${t}`}>
                <MaterialIcon name={m.icon as any} size={20} color={active ? "#fff" : m.color} />
                <Text style={[styles.typeText, active && { color: "#fff" }]} numberOfLines={1}>{m.short}</Text>
              </Pressable>
            );
          })}
        </View>
      </Field>

      <Field label={form.type === "transfer" ? "भेजने वाले का नाम" : "ग्राहक का नाम"}>
        <TextInput style={inputStyle} value={form.customerName} onChangeText={(v) => set("customerName", v)} placeholder="जैसे सुनीता देवी" placeholderTextColor={colors.muted} autoCapitalize="words" testID="aeps-input-name" />
      </Field>

      {textField("mobile", { placeholder: "10 अंक", keyboard: "phone-pad", max: 10 })}
      {textField("aadhaarLast4", { placeholder: "जैसे 4821", keyboard: "number-pad", max: 4 })}
      {has("aadhaarLast4") ? <Text style={styles.privacy}>सुरक्षा के लिए पूरा आधार नंबर सेव नहीं होता।</Text> : null}
      {textField("beneficiaryName", { placeholder: "जिसे पैसे भेजे", caps: "words" })}
      {textField("bankName", { placeholder: "बैंक का नाम" })}
      {textField("accountNumber", { placeholder: "खाता नंबर", keyboard: "number-pad", max: 20 })}
      {textField("ifsc", { placeholder: "जैसे SBIN0001234", caps: "characters", max: 11 })}
      {textField("operator", { placeholder: "ऑपरेटर" })}
      {textField("rechargeNumber", { placeholder: "मोबाइल या DTH ID", keyboard: "number-pad", max: 15 })}
      {textField("billerName", { placeholder: "जैसे बिजली — JVVNL" })}
      {textField("billAccount", { placeholder: "बिल पर लिखा नंबर" })}

      <Field label={meta.amountLabel}>
        <TextInput style={[inputStyle, styles.amountInput]} value={amount} onChangeText={setAmount} placeholder="0" placeholderTextColor={colors.muted} keyboardType="numeric" testID="aeps-input-amount" />
      </Field>
      {has("commission") ? (
        <Field label={FIELD_LABEL.commission}>
          <TextInput style={inputStyle} value={commission} onChangeText={setCommission} placeholder="0" placeholderTextColor={colors.muted} keyboardType="numeric" testID="aeps-input-commission" />
        </Field>
      ) : null}
      {textField("reference", { placeholder: "रसीद / SMS में लिखा नंबर", caps: "characters" })}

      <Field label="स्थिति">
        <View style={styles.chipRow}>
          {(Object.keys(STATUS_META) as AepsStatus[]).map((s) => (
            <Chip key={s} label={STATUS_META[s].label} icon={STATUS_META[s].icon} active={form.status === s} tone={STATUS_META[s].color} onPress={() => set("status", s)} testID={`aeps-status-${s}`} />
          ))}
        </View>
      </Field>
      <DateField label="तारीख" value={form.date} onChange={(v) => set("date", v)} testID="aeps-input-date" />
      <Field label="समय">
        <TextInput style={inputStyle} value={form.time} onChangeText={(v) => set("time", v)} placeholder="HH:MM" placeholderTextColor={colors.muted} maxLength={5} testID="aeps-input-time" />
      </Field>
      <Field label="नोट (वैकल्पिक)">
        <TextInput style={[inputStyle, { minHeight: 56 }]} value={form.notes} onChangeText={(v) => set("notes", v)} multiline placeholderTextColor={colors.muted} testID="aeps-input-notes" />
      </Field>

      <PrimaryButton label={initial ? "बदलाव सेव करें" : "लेन-देन सेव करें"} color={meta.color} onPress={save} disabled={!valid} saving={saving} testID="aeps-save-btn" />
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
  typeGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  typeTile: { width: "23%", flexGrow: 1, alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary },
  typeText: { fontSize: 12, fontWeight: "700", color: colors.onSurface },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  amountInput: { fontSize: 22, fontWeight: "700" },
  privacy: { fontSize: 11, color: colors.muted, marginTop: -spacing.sm, marginBottom: spacing.md },
});
