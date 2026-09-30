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
import { store } from "@/src/lib/store";
import { useCustomers, useEntries, useJobs, type Entry, type Job } from "@/src/lib/data";
import { buildLedger, jobForWork, linkedPayment, removeEntryWithLinks, settlementsFor, workForJob, workForPayment } from "@/src/lib/records";
import { confirmAction } from "@/src/lib/confirm";
import { colors, spacing, radius } from "@/src/theme";
import { formatDate, formatINR, todayISO } from "@/src/lib/format";
import { Pressable } from "@/src/components/tap";
import { useAuth } from "@/src/context/AuthContext";

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

export function SheetShell({ visible, onClose, title, children, testID }: { visible: boolean; onClose: () => void; title: string; children: React.ReactNode; testID?: string }) {
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

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: spacing.md }}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

export const inputStyle = {
  borderWidth: 1,
  borderColor: colors.border,
  backgroundColor: colors.surface,
  borderRadius: radius.md,
  padding: spacing.md,
  fontSize: 15,
  color: colors.onSurface,
  minHeight: 48,
};

export function Chip({ label, active, onPress, icon, testID, tone }: { label: string; active: boolean; onPress: () => void; icon?: string; testID?: string; tone?: string }) {
  const bg = active ? tone ?? colors.brandPrimary : colors.surfaceSecondary;
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && { backgroundColor: bg, borderColor: bg }]} testID={testID}>
      {icon ? <MaterialIcon name={icon as any} size={16} color={active ? colors.onBrandPrimary : colors.onSurface} /> : null}
      <Text style={[styles.chipText, active && { color: colors.onBrandPrimary }]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

export function DateField({ label, value, onChange, future, testID }: { label: string; value: string; onChange: (v: string) => void; future?: boolean; testID?: string }) {
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

const NEW_CUSTOMER = "__new__";

// Lets a sheet either pick an existing customer or create one inline before saving.
function useCustomerChoice(visible: boolean, fixedCustomerId?: string) {
  const customers = useCustomers().data ?? [];
  const [customerId, setCustomerId] = useState("");
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");

  useEffect(() => {
    if (visible) {
      setCustomerId(fixedCustomerId ?? customers[0]?.id ?? NEW_CUSTOMER);
      setNewName("");
      setNewPhone("");
    }
  }, [visible, fixedCustomerId, customers.length]);

  const isNew = customerId === NEW_CUSTOMER;
  const ready = isNew ? !!newName.trim() : !!customerId;

  const resolve = async (): Promise<string> => {
    if (!isNew) return customerId;
    const c = await store.createCustomer({ name: newName.trim(), phone: newPhone.trim(), address: "", notes: "" });
    setCustomerId(c.id);
    return c.id;
  };

  return { customers, customerId, setCustomerId, isNew, newName, setNewName, newPhone, setNewPhone, ready, resolve };
}

function CustomerPicker({ choice, testPrefix }: { choice: ReturnType<typeof useCustomerChoice>; testPrefix: string }) {
  const { customers, customerId, setCustomerId, isNew } = choice;
  return (
    <Field label="ग्राहक">
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: spacing.sm, paddingRight: spacing.md }}>
        <Chip label="नया ग्राहक" icon="account-plus-outline" active={isNew} onPress={() => setCustomerId(NEW_CUSTOMER)} testID={`${testPrefix}-new`} />
        {customers.map((c) => (
          <Chip key={c.id} label={c.name} active={customerId === c.id} onPress={() => setCustomerId(c.id)} testID={`${testPrefix}-${c.id}`} />
        ))}
      </ScrollView>
      {isNew && (
        <View style={styles.newCustomerBox}>
          <TextInput style={inputStyle} value={choice.newName} onChangeText={choice.setNewName} placeholder="नए ग्राहक का नाम" placeholderTextColor={colors.muted} testID="input-new-cust-name" />
          <TextInput style={[inputStyle, { marginTop: spacing.sm }]} value={choice.newPhone} onChangeText={choice.setNewPhone} placeholder="फ़ोन (वैकल्पिक)" placeholderTextColor={colors.muted} keyboardType="phone-pad" testID="input-new-cust-phone" />
        </View>
      )}
    </Field>
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

const paidFor = (mode: PayMode, amount: number, paid: number) =>
  mode === "cash" ? amount : mode === "partial" ? Math.min(Math.max(paid, 0), amount) : 0;
const settleDescription = (title: string) => `${title} — भुगतान`;

// One row per piece of work: `paid` is the cash taken now, the rest is udhaar.
function recordWork({ customerId, title, amount, mode, paid, date, notes }: { customerId: string; title: string; amount: number; mode: PayMode; paid: number; date: string; notes: string }): string {
  if (amount <= 0) return "";
  const work = store.createEntry({ customerId, type: "work", date, description: title, amount, paid: paidFor(mode, amount, paid), notes });
  return work.id;
}

export function PrimaryButton({ label, onPress, disabled, saving, color, testID }: { label: string; onPress: () => void; disabled?: boolean; saving?: boolean; color?: string; testID?: string }) {
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
      if (initial?.id) await store.updateCustomer(initial.id, body);
      else await store.createCustomer(body);
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

export function AddEntrySheet({ visible, type, onClose, customerId: fixedCustomerId, initial }: { visible: boolean; type: "work" | "payment"; onClose: () => void; customerId?: string; initial?: Entry }) {
  const choice = useCustomerChoice(visible, fixedCustomerId ?? initial?.customerId);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayISO());
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setDescription(initial?.description ?? "");
    setAmount(initial ? String(initial.amount) : "");
    setDate(initial?.date ?? todayISO());
    setNotes(initial?.notes ?? "");
  }, [visible, initial]);

  const amt = parseFloat(amount);
  const valid = (initial ? true : choice.ready) && !!description.trim() && isFinite(amt) && amt > 0;

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      const body = { type, date, description: description.trim(), amount: amt, notes: notes.trim() };
      if (initial) await store.updateEntry(initial.id, body);
      else {
        const customerId = await choice.resolve();
        await store.createEntry({ customerId, ...body });
      }
      onClose();
    } finally { setSaving(false); }
  };

  return (
    <SheetShell visible={visible} onClose={onClose} title={initial ? "एंट्री बदलें" : type === "work" ? "उधार काम जोड़ें" : "जमा लिखें"} testID={`sheet-entry-${type}`}>
      {!initial && !fixedCustomerId && <CustomerPicker choice={choice} testPrefix="chip-cust" />}
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
        label={initial ? "बदलाव सेव करें" : type === "work" ? "उधार जोड़ें" : "जमा जोड़ें"}
        color={type === "work" ? colors.error : colors.success}
        onPress={save}
        disabled={!valid}
        saving={saving}
        testID="save-entry-btn"
      />
      {initial ? <DeleteEntryLink entry={initial} onDone={onClose} /> : null}
    </SheetShell>
  );
}

function DeleteEntryLink({ entry, onDone }: { entry: Entry; onDone: () => void }) {
  const entries = useEntries().data ?? [];
  const jobs = useJobs().data ?? [];
  const remove = () => {
    confirmAction("एंट्री हटाएँ?", `${entry.description} · ${formatINR(entry.amount)}\nइसके साथ लिखी जमा और काम कार्ड भी हटेंगे।`, "हटा दें", () => {
      removeEntryWithLinks(entry, entries, jobs);
      onDone();
    });
  };
  return <DangerLink label="यह एंट्री हटाएँ" onPress={remove} testID="delete-entry-link" />;
}

export function DangerLink({ label, onPress, testID }: { label: string; onPress: () => void; testID?: string }) {
  return (
    <Pressable onPress={onPress} style={styles.dangerLink} testID={testID}>
      <MaterialIcon name="trash-can-outline" size={16} color={colors.error} />
      <Text style={styles.dangerText}>{label}</Text>
    </Pressable>
  );
}

function payModeOf(amount: number, paid: number): { mode: PayMode; paid: string } {
  if (paid <= 0) return { mode: "udhaar", paid: "" };
  if (paid >= amount) return { mode: "cash", paid: "" };
  return { mode: "partial", paid: String(paid) };
}

/** Edits a finished piece of work: the work entry, the money taken with it and its job card. */
export function WorkEditSheet({ entry, onClose }: { entry: Entry | null; onClose: () => void }) {
  const entries = useEntries().data ?? [];
  const jobs = useJobs().data ?? [];
  const later = entry ? settlementsFor(entry, entries).filter((p) => p.date !== entry.date) : [];
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [pay, setPay] = useState<PayMode>("udhaar");
  const [paid, setPaid] = useState("");
  const [date, setDate] = useState(todayISO());
  const [notes, setNotes] = useState("");
  const [remark, setRemark] = useState("");
  const [remarkDate, setRemarkDate] = useState(todayISO(1));
  const [saving, setSaving] = useState(false);

  const link = entry ? linkedPayment(entry, entries) : undefined;
  const job = entry ? jobForWork(entry, jobs) : undefined;

  useEffect(() => {
    if (!entry) return;
    const p = payModeOf(entry.amount, (entry.paid ?? 0) || (link?.amount ?? 0));
    setTitle(entry.description);
    setAmount(String(entry.amount));
    setPay(p.mode);
    setPaid(p.paid);
    setDate(entry.date);
    setNotes(entry.notes);
    setRemark("");
    setRemarkDate(todayISO(1));
    // Only re-initialise when a different record is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry?.id]);

  const amt = parseFloat(amount) || 0;
  const valid = !!title.trim() && amt > 0;

  const save = () => {
    if (!entry || !valid) return;
    setSaving(true);
    try {
      const t = title.trim();
      const paidNum = parseFloat(paid) || 0;
      const paidNow = paidFor(pay, amt, paidNum);
      store.updateEntry(entry.id, { type: "work", date, description: t, amount: amt, paid: paidNow, notes: notes.trim() });
      // Old two-row cash records: the same-day jama is now carried by `paid`.
      if (link && !(entry.paid ?? 0)) store.deleteEntry(link.id);
      if (job) {
        store.updateJob(job.id, { title: t, dueDate: date, estimatedAmount: amt, notes: notes.trim(), entryId: entry.id });
      }
      if (remark.trim()) {
        store.createJob({ customerId: entry.customerId, title: remark.trim(), dueDate: remarkDate, status: "pending", estimatedAmount: 0, notes: `पिछला काम: ${t}` });
      }
      onClose();
    } finally { setSaving(false); }
  };

  return (
    <SheetShell visible={!!entry} onClose={onClose} title="काम बदलें" testID="sheet-edit-work">
      <Field label="क्या काम">
        <TextInput style={inputStyle} value={title} onChangeText={setTitle} placeholderTextColor={colors.muted} testID="input-edit-work-title" />
      </Field>
      <Field label="रकम (₹)">
        <TextInput style={inputStyle} value={amount} onChangeText={setAmount} keyboardType="numeric" placeholder="0" placeholderTextColor={colors.muted} testID="input-edit-work-amount" />
      </Field>
      <PaymentPicker mode={pay} onMode={setPay} paid={paid} onPaid={setPaid} total={amt} />
      {later.length > 0 ? (
        <Field label="बाद में मिले पैसे">
          {later.map((p) => (
            <View key={p.id} style={styles.settleRow}>
              <MaterialIcon name="check-circle" size={16} color={colors.success} />
              <Text style={styles.settleText}>{formatINR(p.amount)} · {formatDate(p.date)}{p.notes ? ` · ${p.notes}` : ""}</Text>
              <Pressable
                hitSlop={8}
                onPress={() => confirmAction("यह भुगतान हटाएँ?", `${formatINR(p.amount)} · ${formatDate(p.date)}\nयह रकम फिर से उधार में जुड़ जाएगी।`, "हटा दें", () => store.deleteEntry(p.id))}
                testID={`del-settle-${p.id}`}
              >
                <MaterialIcon name="close" size={18} color={colors.muted} />
              </Pressable>
            </View>
          ))}
        </Field>
      ) : null}
      <DateField label="तारीख" value={date} onChange={setDate} testID="input-edit-work-date" />
      <Field label="नोट (वैकल्पिक)">
        <TextInput style={inputStyle} value={notes} onChangeText={setNotes} placeholderTextColor={colors.muted} testID="input-edit-work-notes" />
      </Field>
      <Field label="नया आगे का काम / रिमार्क (वैकल्पिक)">
        <TextInput style={[inputStyle, { minHeight: 56 }]} value={remark} onChangeText={setRemark} multiline placeholder="जैसे बाकी पैसे शनिवार को" placeholderTextColor={colors.muted} testID="input-edit-work-remark" />
      </Field>
      {remark.trim() ? <DateField label="रिमार्क कब देखना है" value={remarkDate} onChange={setRemarkDate} future /> : null}
      <PrimaryButton label="बदलाव सेव करें" onPress={save} disabled={!valid} saving={saving} testID="save-edit-work-btn" />
      {entry ? <DeleteEntryLink entry={entry} onDone={onClose} /> : null}
    </SheetShell>
  );
}

/** Edits an open (or money-less finished) job card. */
export function EditJobSheet({ job, onClose }: { job: Job | null; onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayISO());
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<Job["status"]>("pending");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!job) return;
    setTitle(job.title);
    setAmount(job.estimatedAmount > 0 ? String(job.estimatedAmount) : "");
    setDate(job.dueDate);
    setNotes(job.notes);
    setStatus(job.status);
  }, [job]);

  const save = () => {
    if (!job || !title.trim()) return;
    setSaving(true);
    try {
      store.updateJob(job.id, { title: title.trim(), estimatedAmount: parseFloat(amount) || 0, dueDate: date, notes: notes.trim(), status });
      onClose();
    } finally { setSaving(false); }
  };

  const remove = () => {
    if (!job) return;
    confirmAction("काम हटाएँ?", job.title, "हटा दें", () => {
      store.deleteJob(job.id);
      onClose();
    });
  };

  return (
    <SheetShell visible={!!job} onClose={onClose} title="काम बदलें" testID="sheet-edit-job">
      <Field label="स्थिति">
        <View style={styles.chipRow}>
          <Chip label="बाकी" active={status === "pending"} onPress={() => setStatus("pending")} testID="edit-job-status-pending" />
          <Chip label="चल रहा" active={status === "doing"} onPress={() => setStatus("doing")} tone={colors.warning} testID="edit-job-status-doing" />
          {job?.status === "done" ? <Chip label="पूरा" active={status === "done"} onPress={() => setStatus("done")} tone={colors.success} /> : null}
        </View>
      </Field>
      <Field label="क्या काम">
        <TextInput style={inputStyle} value={title} onChangeText={setTitle} placeholderTextColor={colors.muted} testID="input-edit-job-title" />
      </Field>
      <Field label="अनुमानित रकम (₹, वैकल्पिक)">
        <TextInput style={inputStyle} value={amount} onChangeText={setAmount} keyboardType="numeric" placeholder="0" placeholderTextColor={colors.muted} testID="input-edit-job-amount" />
      </Field>
      <DateField label={status === "done" ? "तारीख" : "डिलीवरी तारीख"} value={date} onChange={setDate} future={status !== "done"} testID="input-edit-job-date" />
      <Field label="नोट / रिमार्क">
        <TextInput style={[inputStyle, { minHeight: 56 }]} value={notes} onChangeText={setNotes} multiline placeholderTextColor={colors.muted} testID="input-edit-job-notes" />
      </Field>
      <PrimaryButton label="बदलाव सेव करें" onPress={save} disabled={!title.trim()} saving={saving} testID="save-edit-job-btn" />
      <DangerLink label="यह काम हटाएँ" onPress={remove} testID="delete-job-link" />
    </SheetShell>
  );
}

/**
 * One entry point for "tap to edit" anywhere: picks the work editor when the row belongs to a
 * work record, otherwise the plain entry or job editor.
 */
export function EditRecordSheet({ entry, job, onClose }: { entry?: Entry | null; job?: Job | null; onClose: () => void }) {
  const entries = useEntries().data ?? [];
  let work: Entry | null = null;
  let plainEntry: Entry | null = null;
  let plainJob: Job | null = null;
  if (job) {
    work = workForJob(job, entries) ?? null;
    if (!work) plainJob = job;
  } else if (entry) {
    if (entry.type === "work") work = entry;
    else {
      // Same-day jama from old two-row cash records belongs to the work; later settlements are their own event.
      const w = workForPayment(entry, entries);
      if (w && w.date === entry.date) work = w;
      else plainEntry = entry;
    }
  }
  return (
    <>
      <WorkEditSheet entry={work} onClose={onClose} />
      <EditJobSheet job={plainJob} onClose={onClose} />
      <AddEntrySheet visible={!!plainEntry} type={plainEntry?.type ?? "payment"} initial={plainEntry ?? undefined} customerId={plainEntry?.customerId} onClose={onClose} />
    </>
  );
}

/** "पैसे मिले": records money received later against one udhaar work entry. */
export function SettleSheet({ work, onClose }: { work: Entry | null; onClose: () => void }) {
  const entries = useEntries().data ?? [];
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayISO());
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const status = work ? buildLedger(entries.filter((e) => e.customerId === work.customerId)).work.get(work.id) : undefined;
  const remaining = status?.remaining ?? 0;

  useEffect(() => {
    if (!work) return;
    setAmount(remaining > 0 ? String(remaining) : "");
    setDate(todayISO());
    setNotes("");
    // Only re-initialise when a different record is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [work?.id]);

  const amt = parseFloat(amount) || 0;
  const valid = !!work && amt > 0;

  const save = () => {
    if (!work || !valid) return;
    setSaving(true);
    try {
      store.createEntry({ customerId: work.customerId, type: "payment", date, description: settleDescription(work.description), amount: amt, notes: notes.trim(), linkId: work.id });
      onClose();
    } finally { setSaving(false); }
  };

  return (
    <SheetShell visible={!!work} onClose={onClose} title="पैसे मिले" testID="sheet-settle">
      {work ? (
        <View style={styles.settleSummary}>
          <Text style={styles.jobName}>{work.description}</Text>
          <Text style={styles.hint}>
            कुल {formatINR(work.amount)} · मिल चुके {formatINR(status?.received ?? 0)} ·{" "}
            <Text style={{ color: colors.error, fontWeight: "700" }}>बाकी {formatINR(remaining)}</Text>
          </Text>
        </View>
      ) : null}
      <Field label="कितने मिले (₹)">
        {remaining > 0 ? (
          <View style={[styles.chipRow, { marginBottom: spacing.sm }]}>
            <Chip label={`पूरा ${formatINR(remaining)}`} active={amt === remaining} onPress={() => setAmount(String(remaining))} tone={colors.success} testID="settle-full" />
            {remaining >= 2 ? <Chip label="आधा" active={amt === Math.round(remaining / 2)} onPress={() => setAmount(String(Math.round(remaining / 2)))} testID="settle-half" /> : null}
          </View>
        ) : null}
        <TextInput style={inputStyle} value={amount} onChangeText={setAmount} keyboardType="numeric" placeholder="0" placeholderTextColor={colors.muted} testID="input-settle-amount" />
        {amt > 0 && amt < remaining ? <Text style={styles.hint}>{formatINR(remaining - amt)} अभी भी उधार रहेगा</Text> : null}
        {amt > remaining && remaining > 0 ? <Text style={styles.hint}>{formatINR(amt - remaining)} ज़्यादा — बाकी पुराने उधार / एडवांस में जुड़ेगा</Text> : null}
      </Field>
      <DateField label="कब मिले" value={date} onChange={setDate} testID="input-settle-date" />
      <Field label="नोट (वैकल्पिक)">
        <TextInput style={inputStyle} value={notes} onChangeText={setNotes} placeholder="जैसे UPI से, PhonePe" placeholderTextColor={colors.muted} testID="input-settle-notes" />
      </Field>
      <PrimaryButton label={amt >= remaining && remaining > 0 ? "चुकता करें ✔" : "जमा करें"} color={colors.success} onPress={save} disabled={!valid} saving={saving} testID="save-settle-btn" />
    </SheetShell>
  );
}

type JobMode = "now" | "later";

export function AddJobSheet({ visible, onClose, customerId: fixedCustomerId, initialMode = "now" }: { visible: boolean; onClose: () => void; customerId?: string; initialMode?: JobMode }) {
  const choice = useCustomerChoice(visible, fixedCustomerId);
  const [mode, setMode] = useState<JobMode>(initialMode);
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
      setTitle("");
      setAmount("");
      setPay("cash");
      setPaid("");
      setDate(initialMode === "now" ? todayISO() : todayISO(1));
      setRemark("");
      setRemarkDate(todayISO(1));
    }
  }, [visible, initialMode]);

  const switchMode = (m: JobMode) => {
    setMode(m);
    setDate(m === "now" ? todayISO() : todayISO(1));
  };

  const amt = parseFloat(amount) || 0;
  const valid = choice.ready && !!title.trim() && (mode === "later" || amt > 0);

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      const customerId = await choice.resolve();
      const t = title.trim();
      if (mode === "now") {
        const paidNum = parseFloat(paid) || 0;
        const entryId = recordWork({ customerId, title: t, amount: amt, mode: pay, paid: paidNum, date, notes: remark.trim() });
        store.createJob({ customerId, title: t, dueDate: date, status: "done", estimatedAmount: amt, notes: remark.trim(), entryId });
        if (remark.trim()) {
          await store.createJob({ customerId, title: remark.trim(), dueDate: remarkDate, status: "pending", estimatedAmount: 0, notes: `पिछला काम: ${t}` });
        }
      } else {
        await store.createJob({ customerId, title: t, dueDate: date, estimatedAmount: amt, notes: remark.trim() });
      }
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

      {!fixedCustomerId && <CustomerPicker choice={choice} testPrefix="chip-job-cust" />}
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

export function ShopNameSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { user, setShopName } = useAuth();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setName(user?.shop_name ?? "");
      setError(null);
    }
  }, [visible, user?.shop_name]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await setShopName(name.trim());
      onClose();
    } catch {
      setError("सेव नहीं हुआ, दोबारा कोशिश करें।");
    } finally { setSaving(false); }
  };

  return (
    <SheetShell visible={visible} onClose={onClose} title="दुकान का नाम" testID="sheet-shop-name">
      <Field label="आपकी दुकान / बिज़नेस का नाम">
        <TextInput style={inputStyle} value={name} onChangeText={setName} placeholder="जैसे नैन फोटो स्टेट" placeholderTextColor={colors.muted} maxLength={60} autoFocus testID="input-shop-name" />
      </Field>
      {error ? <Text style={[styles.hint, { color: colors.error }]}>{error}</Text> : null}
      <PrimaryButton label="सेव करें" onPress={save} disabled={!name.trim()} saving={saving} testID="save-shop-name-btn" />
    </SheetShell>
  );
}

export function CompleteJobSheet({ job, onClose }: { job: Job | null; onClose: () => void }) {
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
      const entryId = recordWork({ customerId: job.customerId, title: job.title, amount: amt, mode: pay, paid: paidNum, date, notes: "काम पूरा" });
      store.updateJob(job.id, { status: "done", dueDate: date, estimatedAmount: amt, entryId });
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
  label: { fontSize: 12, color: colors.muted, fontWeight: "600", marginBottom: spacing.xs, textTransform: "uppercase" },
  hint: { fontSize: 12, color: colors.muted, marginTop: spacing.xs },
  jobName: { fontSize: 16, fontWeight: "700", color: colors.onSurface, marginBottom: spacing.md },
  primaryBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 15, alignItems: "center", marginTop: spacing.md, minHeight: 52, justifyContent: "center" },
  primaryText: { color: colors.onBrandPrimary, fontSize: 16, fontWeight: "700" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  newCustomerBox: { marginTop: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.brandTertiary, borderWidth: 1, borderColor: colors.border },
  chip: { flexDirection: "row", gap: 6, paddingHorizontal: spacing.md, height: 36, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  chipText: { fontSize: 13, color: colors.onSurface, fontWeight: "600" },
  segment: { flexDirection: "row", backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: 4, marginBottom: spacing.lg, borderWidth: 1, borderColor: colors.border },
  segmentBtn: { flex: 1, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", paddingVertical: 10, borderRadius: radius.sm },
  segmentActive: { backgroundColor: colors.brandPrimary },
  segmentText: { fontSize: 13, fontWeight: "700", color: colors.onSurface },
  dangerLink: { flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", paddingVertical: spacing.md, marginTop: spacing.sm },
  dangerText: { color: colors.error, fontWeight: "600", fontSize: 14 },
  settleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  settleText: { flex: 1, fontSize: 14, color: colors.onSurface },
  settleSummary: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md },
});
