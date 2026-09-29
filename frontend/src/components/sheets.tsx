import React, { useState, useEffect, useRef } from "react";
import {
  Modal,
  View,
  Text,
  StyleSheet,
  Pressable as RNPressable,
  TextInput,
  ScrollView,
  Platform,
  Keyboard,
  ActivityIndicator,
} from "react-native";
import MaterialIcon from "@react-native-vector-icons/material-design-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/src/lib/api";
import { useCustomers, type Job } from "@/src/lib/data";
import { colors, spacing, radius } from "@/src/theme";
import { formatINR, todayISO } from "@/src/lib/format";
import { Pressable } from "@/src/components/tap";

// Android modals don't resize for the keyboard under edge-to-edge, so pad by the measured overlap instead.
function useKeyboardOverlap(ref: React.RefObject<View | null>) {
  const [overlap, setOverlap] = useState(0);
  useEffect(() => {
    if (Platform.OS === "web") return;
    const showEvt = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvt = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const show = Keyboard.addListener(showEvt, (e) => {
      const keyboardTop = e.endCoordinates.screenY;
      ref.current?.measureInWindow((_x, y, _w, h) => setOverlap(Math.max(0, y + h - keyboardTop)));
    });
    const hide = Keyboard.addListener(hideEvt, () => setOverlap(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, [ref]);
  return overlap;
}

function SheetShell({ visible, onClose, title, children, testID }: { visible: boolean; onClose: () => void; title: string; children: React.ReactNode; testID?: string }) {
  const insets = useSafeAreaInsets();
  const containerRef = useRef<View>(null);
  const scrollRef = useRef<ScrollView>(null);
  const overlap = useKeyboardOverlap(containerRef);

  useEffect(() => {
    if (!overlap) return;
    const t = setTimeout(() => {
      const input = TextInput.State.currentlyFocusedInput() as any;
      const inner = (scrollRef.current as any)?.getInnerViewRef?.();
      if (!input || !inner) return;
      try {
        input.measureLayout(
          inner,
          (_x: number, y: number) => scrollRef.current?.scrollTo({ y: Math.max(0, y - 80), animated: true }),
          () => {},
        );
      } catch {}
    }, 60);
    return () => clearTimeout(t);
  }, [overlap]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <View ref={containerRef} style={{ flex: 1, paddingBottom: overlap }}>
        <RNPressable style={styles.backdrop} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: (overlap ? spacing.md : insets.bottom + spacing.xl) }]} testID={testID}>
          <View style={styles.grabber} />
          <View style={styles.headerRow}>
            <Text style={styles.title}>{title}</Text>
            <Pressable onPress={onClose} testID="sheet-close" hitSlop={12} haptic={false}>
              <MaterialIcon name="close" size={22} color={colors.muted} />
            </Pressable>
          </View>
          <ScrollView ref={scrollRef} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: spacing.md }}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

const inputStyle = {
  borderWidth: 1,
  borderColor: colors.border,
  backgroundColor: colors.surface,
  borderRadius: radius.md,
  padding: spacing.md,
  fontSize: 15,
  color: colors.onSurface,
  minHeight: 48,
};

function Chip({ label, active, onPress, icon, testID, tone }: { label: string; active: boolean; onPress: () => void; icon?: string; testID?: string; tone?: string }) {
  const bg = active ? tone ?? colors.brandPrimary : colors.surfaceSecondary;
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && { backgroundColor: bg, borderColor: bg }]} testID={testID}>
      {icon ? <MaterialIcon name={icon as any} size={16} color={active ? colors.onBrandPrimary : colors.onSurface} /> : null}
      <Text style={[styles.chipText, active && { color: colors.onBrandPrimary }]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

function DateField({ label, value, onChange, future, testID }: { label: string; value: string; onChange: (v: string) => void; future?: boolean; testID?: string }) {
  const presets = future
    ? [{ label: "आज", d: todayISO() }, { label: "कल", d: todayISO(1) }, { label: "परसों", d: todayISO(2) }, { label: "1 हफ़्ता", d: todayISO(7) }]
    : [{ label: "आज", d: todayISO() }, { label: "कल (बीता)", d: todayISO(-1) }];
  return (
    <Field label={label}>
      <View style={styles.chipRow}>
        {presets.map((p) => (
          <Chip key={p.label} label={p.label} active={value === p.d} onPress={() => onChange(p.d)} />
        ))}
      </View>
      <TextInput style={[inputStyle, { marginTop: spacing.sm }]} value={value} onChangeText={onChange} placeholder="YYYY-MM-DD" placeholderTextColor={colors.muted} testID={testID} />
    </Field>
  );
}

function CustomerPicker({ value, onChange, testPrefix }: { value: string; onChange: (id: string) => void; testPrefix: string }) {
  const customers = useCustomers().data ?? [];
  if (customers.length === 0) {
    return <Text style={styles.hint}>पहले एक ग्राहक जोड़ें।</Text>;
  }
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: spacing.sm, paddingRight: spacing.md }}>
      {customers.map((c) => (
        <Chip key={c.id} label={c.name} active={value === c.id} onPress={() => onChange(c.id)} testID={`${testPrefix}-${c.id}`} />
      ))}
    </ScrollView>
  );
}

type PayMode = "cash" | "udhaar" | "partial";

function PaymentPicker({ mode, onMode, paid, onPaid, total }: { mode: PayMode; onMode: (m: PayMode) => void; paid: string; onPaid: (v: string) => void; total: number }) {
  const paidNum = parseFloat(paid) || 0;
  return (
    <Field label="पैसे का हिसाब">
      <View style={styles.chipRow}>
        <Chip label="नकद मिला" icon="cash" active={mode === "cash"} onPress={() => onMode("cash")} tone={colors.success} testID="pay-cash" />
        <Chip label="उधार" icon="book-clock-outline" active={mode === "udhaar"} onPress={() => onMode("udhaar")} tone={colors.error} testID="pay-udhaar" />
        <Chip label="कुछ जमा" icon="cash-minus" active={mode === "partial"} onPress={() => onMode("partial")} tone={colors.warning} testID="pay-partial" />
      </View>
      {mode === "partial" && (
        <>
          <TextInput style={[inputStyle, { marginTop: spacing.sm }]} value={paid} onChangeText={onPaid} placeholder="अभी कितना मिला (₹)" placeholderTextColor={colors.muted} keyboardType="numeric" testID="input-paid" />
          {total > 0 && paidNum > 0 && paidNum < total ? (
            <Text style={styles.hint}>{formatINR(total - paidNum)} उधार में जुड़ेगा</Text>
          ) : null}
        </>
      )}
    </Field>
  );
}

// Work is always booked as udhaar; whatever was paid now is booked as jama so the khata stays balanced.
async function recordWork({ customerId, title, amount, mode, paid, date, notes }: { customerId: string; title: string; amount: number; mode: PayMode; paid: number; date: string; notes: string }) {
  if (amount <= 0) return;
  await api.createEntry({ customerId, type: "work", date, description: title, amount, notes });
  const paidNow = mode === "cash" ? amount : mode === "partial" ? Math.min(Math.max(paid, 0), amount) : 0;
  if (paidNow > 0) {
    await api.createEntry({ customerId, type: "payment", date, description: `${title} — ${mode === "cash" ? "नकद" : "आंशिक जमा"}`, amount: paidNow, notes: "" });
  }
}

function payNote(mode: PayMode, amount: number, paid: number) {
  if (amount <= 0) return "";
  if (mode === "cash") return `${formatINR(amount)} नकद मिला`;
  if (mode === "udhaar") return `${formatINR(amount)} उधार`;
  const p = Math.min(Math.max(paid, 0), amount);
  return `${formatINR(p)} जमा, ${formatINR(amount - p)} उधार`;
}

function PrimaryButton({ label, onPress, disabled, saving, color, testID }: { label: string; onPress: () => void; disabled?: boolean; saving?: boolean; color?: string; testID?: string }) {
  return (
    <Pressable
      style={[styles.primaryBtn, color ? { backgroundColor: color } : null, (disabled || saving) && { opacity: 0.5 }]}
      disabled={disabled || saving}
      onPress={onPress}
      testID={testID}
    >
      {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>{label}</Text>}
    </Pressable>
  );
}

export function AddCustomerSheet({ visible, onClose, initial }: { visible: boolean; onClose: () => void; initial?: any }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      setName(initial?.name ?? "");
      setPhone(initial?.phone ?? "");
      setAddress(initial?.address ?? "");
      setNotes(initial?.notes ?? "");
    }
  }, [visible, initial]);

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const body = { name: name.trim(), phone: phone.trim(), address: address.trim(), notes: notes.trim() };
      if (initial?.id) await api.updateCustomer(initial.id, body);
      else await api.createCustomer(body);
      qc.invalidateQueries({ queryKey: ["customers"] });
      onClose();
    } finally { setSaving(false); }
  };

  return (
    <SheetShell visible={visible} onClose={onClose} title={initial ? "ग्राहक बदलें" : "नया ग्राहक"} testID="sheet-customer">
      <Field label="नाम">
        <TextInput style={inputStyle} value={name} onChangeText={setName} placeholder="जैसे रामलाल शर्मा" placeholderTextColor={colors.muted} testID="input-cust-name" />
      </Field>
      <Field label="फ़ोन (वैकल्पिक)">
        <TextInput style={inputStyle} value={phone} onChangeText={setPhone} placeholder="10 अंक" placeholderTextColor={colors.muted} keyboardType="phone-pad" testID="input-cust-phone" />
      </Field>
      <Field label="पता (वैकल्पिक)">
        <TextInput style={inputStyle} value={address} onChangeText={setAddress} placeholder="मोहल्ला, गली" placeholderTextColor={colors.muted} testID="input-cust-address" />
      </Field>
      <Field label="नोट (वैकल्पिक)">
        <TextInput style={[inputStyle, { minHeight: 72 }]} value={notes} onChangeText={setNotes} multiline placeholderTextColor={colors.muted} testID="input-cust-notes" />
      </Field>
      <PrimaryButton label={initial ? "बदलाव सेव करें" : "ग्राहक जोड़ें"} onPress={save} disabled={!name.trim()} saving={saving} testID="save-customer-btn" />
    </SheetShell>
  );
}

export function AddEntrySheet({ visible, type, onClose, customerId: fixedCustomerId }: { visible: boolean; type: "work" | "payment"; onClose: () => void; customerId?: string }) {
  const qc = useQueryClient();
  const customers = useCustomers().data ?? [];
  const [customerId, setCustomerId] = useState<string>("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayISO());
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      setCustomerId(fixedCustomerId ?? customers[0]?.id ?? "");
      setDescription("");
      setAmount("");
      setDate(todayISO());
      setNotes("");
    }
  }, [visible, fixedCustomerId, customers.length]);

  const amt = parseFloat(amount);
  const valid = !!customerId && !!description.trim() && isFinite(amt) && amt > 0;

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      await api.createEntry({ customerId, type, date, description: description.trim(), amount: amt, notes: notes.trim() });
      qc.invalidateQueries({ queryKey: ["entries"] });
      onClose();
    } finally { setSaving(false); }
  };

  return (
    <SheetShell visible={visible} onClose={onClose} title={type === "work" ? "उधार काम जोड़ें" : "जमा लिखें"} testID={`sheet-entry-${type}`}>
      {!fixedCustomerId && (
        <Field label="ग्राहक">
          <CustomerPicker value={customerId} onChange={setCustomerId} testPrefix="chip-cust" />
        </Field>
      )}
      <Field label="विवरण">
        <TextInput style={inputStyle} value={description} onChangeText={setDescription} placeholder={type === "work" ? "जैसे पासपोर्ट फोटो 8 प्रति" : "आंशिक जमा"} placeholderTextColor={colors.muted} testID="input-entry-desc" />
      </Field>
      <Field label="रकम (₹)">
        <TextInput style={inputStyle} value={amount} onChangeText={setAmount} placeholder="0" placeholderTextColor={colors.muted} keyboardType="numeric" testID="input-entry-amount" />
      </Field>
      <DateField label="तारीख" value={date} onChange={setDate} testID="input-entry-date" />
      <Field label="नोट (वैकल्पिक)">
        <TextInput style={inputStyle} value={notes} onChangeText={setNotes} placeholderTextColor={colors.muted} testID="input-entry-notes" />
      </Field>
      <PrimaryButton
        label={type === "work" ? "उधार जोड़ें" : "जमा जोड़ें"}
        color={type === "work" ? colors.error : colors.success}
        onPress={save}
        disabled={!valid}
        saving={saving}
        testID="save-entry-btn"
      />
    </SheetShell>
  );
}

type JobMode = "now" | "later";

export function AddJobSheet({ visible, onClose, customerId: fixedCustomerId, initialMode = "now" }: { visible: boolean; onClose: () => void; customerId?: string; initialMode?: JobMode }) {
  const qc = useQueryClient();
  const customers = useCustomers().data ?? [];
  const [mode, setMode] = useState<JobMode>(initialMode);
  const [customerId, setCustomerId] = useState("");
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [pay, setPay] = useState<PayMode>("cash");
  const [paid, setPaid] = useState("");
  const [date, setDate] = useState(todayISO());
  const [remark, setRemark] = useState("");
  const [remarkDate, setRemarkDate] = useState(todayISO(1));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      setMode(initialMode);
      setCustomerId(fixedCustomerId ?? customers[0]?.id ?? "");
      setTitle("");
      setAmount("");
      setPay("cash");
      setPaid("");
      setDate(initialMode === "now" ? todayISO() : todayISO(1));
      setRemark("");
      setRemarkDate(todayISO(1));
    }
  }, [visible, fixedCustomerId, customers.length, initialMode]);

  const switchMode = (m: JobMode) => {
    setMode(m);
    setDate(m === "now" ? todayISO() : todayISO(1));
  };

  const amt = parseFloat(amount) || 0;
  const valid = !!customerId && !!title.trim() && (mode === "later" || amt > 0);

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      const t = title.trim();
      if (mode === "now") {
        const paidNum = parseFloat(paid) || 0;
        const note = payNote(pay, amt, paidNum);
        await recordWork({ customerId, title: t, amount: amt, mode: pay, paid: paidNum, date, notes: remark.trim() });
        await api.createJob({ customerId, title: t, dueDate: date, status: "done", estimatedAmount: amt, notes: [note, remark.trim()].filter(Boolean).join(" · ") });
        if (remark.trim()) {
          await api.createJob({ customerId, title: remark.trim(), dueDate: remarkDate, status: "pending", estimatedAmount: 0, notes: `पिछला काम: ${t}` });
        }
        qc.invalidateQueries({ queryKey: ["entries"] });
      } else {
        await api.createJob({ customerId, title: t, dueDate: date, estimatedAmount: amt, notes: remark.trim() });
      }
      qc.invalidateQueries({ queryKey: ["jobs"] });
      onClose();
    } finally { setSaving(false); }
  };

  return (
    <SheetShell visible={visible} onClose={onClose} title="काम जोड़ें" testID="sheet-job">
      <View style={styles.segment}>
        {(["now", "later"] as JobMode[]).map((m) => (
          <Pressable key={m} onPress={() => switchMode(m)} style={[styles.segmentBtn, mode === m && styles.segmentActive]} testID={`job-mode-${m}`}>
            <MaterialIcon name={m === "now" ? "check-circle-outline" : "calendar-clock"} size={16} color={mode === m ? colors.onBrandPrimary : colors.onSurface} />
            <Text style={[styles.segmentText, mode === m && { color: colors.onBrandPrimary }]}>{m === "now" ? "अभी किया काम" : "आगे का काम"}</Text>
          </Pressable>
        ))}
      </View>

      {!fixedCustomerId && (
        <Field label="ग्राहक">
          <CustomerPicker value={customerId} onChange={setCustomerId} testPrefix="chip-job-cust" />
        </Field>
      )}
      <Field label="क्या काम">
        <TextInput style={inputStyle} value={title} onChangeText={setTitle} placeholder={mode === "now" ? "जैसे पासपोर्ट फोटो, फोटोकॉपी 20 पेज" : "जैसे शादी एलबम"} placeholderTextColor={colors.muted} testID="input-job-title" />
      </Field>
      <Field label={mode === "now" ? "रकम (₹)" : "अनुमानित रकम (₹, वैकल्पिक)"}>
        <TextInput style={inputStyle} value={amount} onChangeText={setAmount} placeholder="0" placeholderTextColor={colors.muted} keyboardType="numeric" testID="input-job-amount" />
      </Field>

      {mode === "now" ? (
        <>
          <PaymentPicker mode={pay} onMode={setPay} paid={paid} onPaid={setPaid} total={amt} />
          <DateField label="तारीख" value={date} onChange={setDate} testID="input-job-date" />
          <Field label="आगे का रिमार्क (वैकल्पिक)">
            <TextInput style={[inputStyle, { minHeight: 64 }]} value={remark} onChangeText={setRemark} multiline placeholder="जैसे कल प्रिंट देने हैं, बाकी पैसे शनिवार को" placeholderTextColor={colors.muted} testID="input-job-remark" />
          </Field>
          {remark.trim() ? <DateField label="रिमार्क कब देखना है" value={remarkDate} onChange={setRemarkDate} future testID="input-remark-date" /> : null}
        </>
      ) : (
        <>
          <DateField label="डिलीवरी तारीख" value={date} onChange={setDate} future testID="input-job-date" />
          <Field label="नोट (वैकल्पिक)">
            <TextInput style={inputStyle} value={remark} onChangeText={setRemark} placeholderTextColor={colors.muted} testID="input-job-notes" />
          </Field>
        </>
      )}

      <PrimaryButton label={mode === "now" ? "काम सेव करें" : "आगे का काम जोड़ें"} onPress={save} disabled={!valid} saving={saving} testID="save-job-btn" />
    </SheetShell>
  );
}

export function CompleteJobSheet({ job, onClose }: { job: Job | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState("");
  const [pay, setPay] = useState<PayMode>("cash");
  const [paid, setPaid] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (job) {
      setAmount(job.estimatedAmount > 0 ? String(job.estimatedAmount) : "");
      setPay("cash");
      setPaid("");
    }
  }, [job]);

  const amt = parseFloat(amount) || 0;

  const save = async () => {
    if (!job) return;
    setSaving(true);
    try {
      const paidNum = parseFloat(paid) || 0;
      const date = todayISO();
      await recordWork({ customerId: job.customerId, title: job.title, amount: amt, mode: pay, paid: paidNum, date, notes: "काम पूरा" });
      const note = payNote(pay, amt, paidNum);
      await api.updateJob(job.id, { status: "done", estimatedAmount: amt, notes: [job.notes, note].filter(Boolean).join(" · ") });
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["entries"] });
      onClose();
    } finally { setSaving(false); }
  };

  return (
    <SheetShell visible={!!job} onClose={onClose} title="काम पूरा करें" testID="sheet-complete-job">
      {job ? <Text style={styles.jobName}>{job.title}</Text> : null}
      <Field label="रकम (₹) — खाली छोड़ें अगर पैसा नहीं लेना">
        <TextInput style={inputStyle} value={amount} onChangeText={setAmount} placeholder="0" placeholderTextColor={colors.muted} keyboardType="numeric" testID="input-complete-amount" />
      </Field>
      {amt > 0 ? <PaymentPicker mode={pay} onMode={setPay} paid={paid} onPaid={setPaid} total={amt} /> : null}
      <PrimaryButton label="पूरा हुआ" color={colors.success} onPress={save} saving={saving} testID="save-complete-btn" />
    </SheetShell>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: spacing.xl, maxHeight: "90%" },
  grabber: { width: 40, height: 4, backgroundColor: colors.borderStrong, borderRadius: 2, alignSelf: "center", marginBottom: spacing.md },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.lg },
  title: { fontSize: 20, fontWeight: "700", color: colors.onSurface },
  label: { fontSize: 12, color: colors.muted, fontWeight: "600", marginBottom: spacing.xs, textTransform: "uppercase", letterSpacing: 0.5 },
  hint: { fontSize: 12, color: colors.muted, marginTop: spacing.xs },
  jobName: { fontSize: 16, fontWeight: "700", color: colors.onSurface, marginBottom: spacing.md },
  primaryBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 15, alignItems: "center", marginTop: spacing.md, minHeight: 52, justifyContent: "center" },
  primaryText: { color: colors.onBrandPrimary, fontSize: 16, fontWeight: "700" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { flexDirection: "row", gap: 6, paddingHorizontal: spacing.md, height: 36, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  chipText: { fontSize: 13, color: colors.onSurface, fontWeight: "600" },
  segment: { flexDirection: "row", backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: 4, marginBottom: spacing.lg, borderWidth: 1, borderColor: colors.border },
  segmentBtn: { flex: 1, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", paddingVertical: 10, borderRadius: radius.sm },
  segmentActive: { backgroundColor: colors.brandPrimary },
  segmentText: { fontSize: 13, fontWeight: "700", color: colors.onSurface },
});
