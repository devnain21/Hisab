import React, { useState, useEffect, useMemo, useRef } from "react";
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
import { advanceOf, computeBalance, useCustomers, useEntries, useJobs, type Entry, type EntryType, type Job } from "@/src/lib/data";
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
const SELF = "__self__";

// Lets a sheet pick an existing customer (searchable, most recent first), create one from the
// typed name, or — for jobs — mark it as the shopkeeper's own task.
function useCustomerChoice(visible: boolean, fixedCustomerId?: string) {
  const customers = useCustomers().data ?? [];
  const entries = useEntries().data ?? [];
  const [customerId, setCustomerId] = useState("");
  const [query, setQuery] = useState("");
  const [newPhone, setNewPhone] = useState("");

  useEffect(() => {
    if (visible) {
      setCustomerId(fixedCustomerId ?? "");
      setQuery("");
      setNewPhone("");
    }
  }, [visible, fixedCustomerId]);

  const recent = useMemo(() => {
    const last = new Map<string, string>();
    entries.forEach((e) => {
      if ((last.get(e.customerId) ?? "") < e.createdAt) last.set(e.customerId, e.createdAt);
    });
    return [...customers].sort((a, b) => (last.get(b.id) ?? b.createdAt).localeCompare(last.get(a.id) ?? a.createdAt));
  }, [customers, entries]);

  const needle = query.trim().toLowerCase();
  const matches = (needle ? recent.filter((c) => c.name.toLowerCase().includes(needle) || c.phone.includes(needle)) : recent).slice(0, 12);
  const exact = !!needle && recent.some((c) => c.name.trim().toLowerCase() === needle);

  const isNew = customerId === NEW_CUSTOMER;
  const isSelf = customerId === SELF;
  const ready = isNew ? !!needle && !exact : !!customerId;
  const existingId = customerId && !isNew && !isSelf ? customerId : "";

  const resolve = async (): Promise<string> => {
    if (isSelf) return "";
    if (!isNew) return customerId;
    const c = store.createCustomer({ name: query.trim(), phone: newPhone.trim(), address: "", notes: "" });
    setCustomerId(c.id);
    return c.id;
  };

  return { recent, matches, exact, customerId, setCustomerId, existingId, isNew, isSelf, query, setQuery, newPhone, setNewPhone, ready, resolve };
}

function CustomerPicker({ choice, label = "ग्राहक", allowSelf, testPrefix }: { choice: ReturnType<typeof useCustomerChoice>; label?: string; allowSelf?: boolean; testPrefix: string }) {
  const { recent, matches, exact, customerId, setCustomerId, isNew, isSelf, query, setQuery } = choice;
  const picked = recent.find((c) => c.id === customerId);

  if (picked || isSelf) {
    return (
      <Field label={label}>
        <View style={styles.pickedRow}>
          <MaterialIcon name={isSelf ? "account-circle-outline" : "account"} size={20} color={colors.brandPrimary} />
          <Text style={styles.pickedName} numberOfLines={1}>{isSelf ? "खुद का काम" : picked!.name}</Text>
          <Pressable onPress={() => setCustomerId("")} hitSlop={8} testID={`${testPrefix}-change`}>
            <Text style={styles.changeText}>बदलें</Text>
          </Pressable>
        </View>
      </Field>
    );
  }

  const typed = query.trim();
  return (
    <Field label={label}>
      <TextInput
        style={inputStyle}
        value={query}
        onChangeText={(t) => {
          setQuery(t);
          if (isNew && !t.trim()) setCustomerId("");
        }}
        placeholder="नाम या फ़ोन"
        placeholderTextColor={colors.muted}
        testID={`${testPrefix}-search`}
      />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: spacing.sm, paddingTop: spacing.sm, paddingRight: spacing.md }}>
        {allowSelf && !typed ? <Chip label="खुद का काम" icon="account-circle-outline" active={false} onPress={() => setCustomerId(SELF)} testID={`${testPrefix}-self`} /> : null}
        {typed && !exact ? (
          <Chip label={`नया: ${typed}`} icon="account-plus-outline" active={isNew} onPress={() => setCustomerId(NEW_CUSTOMER)} testID={`${testPrefix}-new`} />
        ) : null}
        {matches.map((c) => (
          <Chip key={c.id} label={c.name} active={false} onPress={() => { setCustomerId(c.id); setQuery(""); }} testID={`${testPrefix}-${c.id}`} />
        ))}
      </ScrollView>
      {isNew ? (
        <TextInput style={[inputStyle, { marginTop: spacing.sm }]} value={choice.newPhone} onChangeText={choice.setNewPhone} placeholder="फ़ोन (वैकल्पिक)" placeholderTextColor={colors.muted} keyboardType="phone-pad" testID="input-new-cust-phone" />
      ) : null}
    </Field>
  );
}

/**
 * "कुल रकम" + "अभी मिले". Received follows the total until the user edits it, so the common
 * cash case is just typing the amount.
 */
function useMoneyInput() {
  const [total, setTotalRaw] = useState("");
  const [received, setReceivedRaw] = useState("");
  const [touched, setTouched] = useState(false);
  return {
    total,
    received,
    totalNum: Math.max(parseFloat(total) || 0, 0),
    receivedNum: Math.max(parseFloat(received) || 0, 0),
    setTotal: (t: string) => {
      setTotalRaw(t);
      if (!touched) setReceivedRaw(t);
    },
    setReceived: (r: string) => {
      setTouched(true);
      setReceivedRaw(r);
    },
    reset: (t: string, r?: string) => {
      setTotalRaw(t);
      setReceivedRaw(r ?? t);
      setTouched(r !== undefined);
    },
  };
}

type MoneyInput = ReturnType<typeof useMoneyInput>;

function MoneyFields({ money, advance = 0, totalLabel = "कुल रकम (₹)", receivedLabel = "अभी कितने मिले (₹)", freeAllowed }: { money: MoneyInput; advance?: number; totalLabel?: string; receivedLabel?: string; freeAllowed?: boolean }) {
  const t = money.totalNum;
  const r = money.receivedNum;
  return (
    <>
      <Field label={totalLabel}>
        <TextInput style={inputStyle} value={money.total} onChangeText={money.setTotal} placeholder={freeAllowed ? "0 = मुफ़्त" : "0"} placeholderTextColor={colors.muted} keyboardType="numeric" testID="input-money-total" />
      </Field>
      {t > 0 ? (
        <Field label={receivedLabel}>
          <View style={[styles.chipRow, { marginBottom: spacing.sm }]}>
            <Chip label={`पूरे ${formatINR(t)}`} active={r === t} onPress={() => money.setReceived(String(t))} tone={colors.success} testID="money-full" />
            {advance > 0 ? (
              <Chip label={`एडवांस काटकर ${formatINR(Math.max(t - advance, 0))}`} active={r === Math.max(t - advance, 0) && r !== t} onPress={() => money.setReceived(String(Math.max(t - advance, 0)))} tone={colors.success} testID="money-advance" />
            ) : null}
            <Chip label="कुछ नहीं" active={money.received !== "" && r === 0} onPress={() => money.setReceived("0")} tone={colors.error} testID="money-none" />
          </View>
          <TextInput style={inputStyle} value={money.received} onChangeText={money.setReceived} placeholder="0" placeholderTextColor={colors.muted} keyboardType="numeric" testID="input-money-received" />
        </Field>
      ) : null}
      <MoneyResult total={t} received={r} advance={advance} freeAllowed={freeAllowed} />
    </>
  );
}

/** One line that says exactly what will be booked. */
function MoneyResult({ total, received, advance, freeAllowed }: { total: number; received: number; advance: number; freeAllowed?: boolean }) {
  let text = "";
  let tone: string = colors.success;
  if (total <= 0) {
    if (!freeAllowed) return null;
    text = "मुफ़्त काम";
    tone = colors.onSurfaceSecondary;
  } else if (received >= total) {
    text = received > total ? `✔ पूरे मिले · ${formatINR(received - total)} एडवांस रहेगा` : "✔ पूरे पैसे मिले";
  } else {
    const due = total - received;
    const fromAdvance = Math.min(advance, due);
    const left = due - fromAdvance;
    const parts = [];
    if (fromAdvance > 0) parts.push(`${formatINR(fromAdvance)} एडवांस से कटेगा`);
    if (left > 0) parts.push(`${formatINR(left)} लेने हैं`);
    text = parts.join(" · ");
    tone = left > 0 ? colors.error : colors.success;
  }
  return (
    <View style={[styles.resultBox, { borderColor: tone }]} testID="money-result">
      <Text style={[styles.resultText, { color: tone }]}>{text}</Text>
    </View>
  );
}

const settleDescription = (title: string) => `${title} — भुगतान`;

/** Money taken beyond the work amount stays with us as a separate advance row. */
function bookAdvance(customerId: string, extra: number, date: string, title: string) {
  if (extra <= 0) return;
  store.createEntry({ customerId, type: "payment", date, description: "एडवांस", amount: extra, notes: `${title} के साथ` });
}

// One row per piece of work: `paid` is the cash taken now (capped at the amount), the rest is udhaar.
function recordWork({ customerId, title, amount, received, date, notes }: { customerId: string; title: string; amount: number; received: number; date: string; notes: string }): string {
  if (amount <= 0) return "";
  const work = store.createEntry({ customerId, type: "work", date, description: title, amount, paid: Math.min(received, amount), notes });
  bookAdvance(customerId, received - amount, date, title);
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

export function AddCustomerSheet({ visible, onClose, initial, onDelete }: { visible: boolean; onClose: () => void; initial?: any; onDelete?: () => void }) {
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
      {initial?.id && onDelete ? (
        <DangerLink
          label="यह ग्राहक हटाएँ"
          testID="delete-customer-link"
          onPress={() => confirmAction(`${name || "ग्राहक"} को हटाएँ?`, "इनका पूरा खाता मिट जाएगा।", "हटा दें", () => { onDelete(); onClose(); })}
        />
      ) : null}
    </SheetShell>
  );
}

const ENTRY_UI: Record<EntryType, { title: string; icon: string; color: string; placeholder: string }> = {
  work: { title: "काम", icon: "briefcase-outline", color: colors.error, placeholder: "जैसे पासपोर्ट फोटो 8 प्रति" },
  payment: { title: "पैसे मिले", icon: "arrow-bottom-left", color: colors.success, placeholder: "जैसे पुराना हिसाब, UPI" },
  given: { title: "पैसे दिए", icon: "arrow-top-right", color: colors.error, placeholder: "जैसे घर के लिए दिए" },
};

/** Plain khata row. With `kinds`, the sheet lets you switch between them (e.g. मिले / दिए). */
export function AddEntrySheet({ visible, type, kinds, onClose, customerId: fixedCustomerId, initial }: { visible: boolean; type: EntryType; kinds?: EntryType[]; onClose: () => void; customerId?: string; initial?: Entry }) {
  const choice = useCustomerChoice(visible, fixedCustomerId ?? initial?.customerId);
  const [kind, setKind] = useState<EntryType>(type);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayISO());
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setKind(initial?.type ?? type);
    setDescription(initial?.description ?? "");
    setAmount(initial ? String(initial.amount) : "");
    setDate(initial?.date ?? todayISO());
    setNotes(initial?.notes ?? "");
  }, [visible, initial, type]);

  const entries = useEntries().data ?? [];
  const personId = initial ? "" : choice.existingId;
  const due = personId ? computeBalance(entries, personId) : 0;
  const ui = ENTRY_UI[kind];
  const amt = parseFloat(amount);
  const needsDescription = kind === "work";
  const valid = (initial ? true : choice.ready) && (!needsDescription || !!description.trim()) && isFinite(amt) && amt > 0;

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      const body = { type: kind, date, description: description.trim(), amount: amt, notes: notes.trim() };
      if (initial) await store.updateEntry(initial.id, body);
      else {
        const customerId = await choice.resolve();
        await store.createEntry({ customerId, ...body });
      }
      onClose();
    } finally { setSaving(false); }
  };

  return (
    <SheetShell visible={visible} onClose={onClose} title={initial ? "एंट्री बदलें" : kinds ? "मिले या दिए" : ui.title} testID={`sheet-entry-${kind}`}>
      {kinds && !initial ? (
        <View style={styles.segment}>
          {kinds.map((k) => (
            <Pressable key={k} onPress={() => setKind(k)} style={[styles.segmentBtn, kind === k && { backgroundColor: ENTRY_UI[k].color }]} testID={`entry-kind-${k}`}>
              <MaterialIcon name={ENTRY_UI[k].icon as any} size={16} color={kind === k ? "#fff" : colors.onSurface} />
              <Text style={[styles.segmentText, kind === k && { color: "#fff" }]}>{ENTRY_UI[k].title}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {!initial && !fixedCustomerId && <CustomerPicker choice={choice} label={kind === "work" ? "ग्राहक" : kind === "payment" ? "किससे मिले" : "किसको दिए"} testPrefix="chip-cust" />}
      <Field label="रकम (₹)">
        {kind === "payment" && due > 0 ? (
          <View style={[styles.chipRow, { marginBottom: spacing.sm }]}>
            <Chip label={`पूरे लेने हैं ${formatINR(due)}`} active={amt === due} onPress={() => setAmount(String(due))} tone={colors.success} testID="entry-full-due" />
          </View>
        ) : null}
        <TextInput style={inputStyle} value={amount} onChangeText={setAmount} placeholder="0" placeholderTextColor={colors.muted} keyboardType="numeric" testID="input-entry-amount" />
        {kind === "payment" && due > 0 && amt > 0 ? (
          <Text style={[styles.hint, { color: amt >= due ? colors.success : colors.error }]}>
            {amt > due ? `✔ हिसाब बराबर · ${formatINR(amt - due)} एडवांस` : amt === due ? "✔ हिसाब बराबर" : `${formatINR(due - amt)} अभी भी लेने हैं`}
          </Text>
        ) : null}
      </Field>
      <Field label={needsDescription ? "विवरण" : "किस लिए (वैकल्पिक)"}>
        <TextInput style={inputStyle} value={description} onChangeText={setDescription} placeholder={ui.placeholder} placeholderTextColor={colors.muted} testID="input-entry-desc" />
      </Field>
      <DateField label="तारीख" value={date} onChange={setDate} testID="input-entry-date" />
      <Field label="नोट (वैकल्पिक)">
        <TextInput style={inputStyle} value={notes} onChangeText={setNotes} placeholderTextColor={colors.muted} testID="input-entry-notes" />
      </Field>
      <PrimaryButton
        label={initial ? "बदलाव सेव करें" : `${ui.title} — सेव करें`}
        color={ui.color}
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
    const extra = entry.type === "work" ? "\nइसके साथ लिखे मिले और काम कार्ड भी हटेंगे।" : entry.type === "given" ? "\nइसके वापस मिले पैसे भी हटेंगे।" : "";
    confirmAction("एंट्री हटाएँ?", `${entry.description || ENTRY_UI[entry.type].title} · ${formatINR(entry.amount)}${extra}`, "हटा दें", () => {
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

/** Edits a finished piece of work: the work entry, the money taken with it and its job card. */
export function WorkEditSheet({ entry, onClose }: { entry: Entry | null; onClose: () => void }) {
  const entries = useEntries().data ?? [];
  const jobs = useJobs().data ?? [];
  const later = entry ? settlementsFor(entry, entries).filter((p) => p.date !== entry.date) : [];
  const [title, setTitle] = useState("");
  const money = useMoneyInput();
  const [date, setDate] = useState(todayISO());
  const [notes, setNotes] = useState("");
  const [remark, setRemark] = useState("");
  const [remarkDate, setRemarkDate] = useState(todayISO(1));
  const [saving, setSaving] = useState(false);

  const link = entry ? linkedPayment(entry, entries) : undefined;
  const job = entry ? jobForWork(entry, jobs) : undefined;

  useEffect(() => {
    if (!entry) return;
    setTitle(entry.description);
    money.reset(String(entry.amount), String((entry.paid ?? 0) || (link?.amount ?? 0)));
    setDate(entry.date);
    setNotes(entry.notes);
    setRemark("");
    setRemarkDate(todayISO(1));
    // Only re-initialise when a different record is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry?.id]);

  const amt = money.totalNum;
  const valid = !!title.trim() && amt > 0;

  const save = () => {
    if (!entry || !valid) return;
    setSaving(true);
    try {
      const t = title.trim();
      const taken = money.receivedNum;
      store.updateEntry(entry.id, { type: "work", date, description: t, amount: amt, paid: Math.min(taken, amt), notes: notes.trim() });
      bookAdvance(entry.customerId, taken - amt, date, t);
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
      <MoneyFields money={money} receivedLabel="काम के दिन कितने मिले (₹)" />
      {later.length > 0 ? (
        <Field label="बाद में मिले पैसे">
          {later.map((p) => (
            <View key={p.id} style={styles.settleRow}>
              <MaterialIcon name="check-circle" size={16} color={colors.success} />
              <Text style={styles.settleText}>{formatINR(p.amount)} · {formatDate(p.date)}{p.notes ? ` · ${p.notes}` : ""}</Text>
              <Pressable
                hitSlop={8}
                onPress={() => confirmAction("यह भुगतान हटाएँ?", `${formatINR(p.amount)} · ${formatDate(p.date)}\nहटाने के बाद ये पैसे फिर लेने होंगे।`, "हटा दें", () => store.deleteEntry(p.id))}
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
          <Chip label="काम बाकी" active={status === "pending"} onPress={() => setStatus("pending")} testID="edit-job-status-pending" />
          <Chip label="चल रहा" active={status === "doing"} onPress={() => setStatus("doing")} tone={colors.warning} testID="edit-job-status-doing" />
          {job?.status === "done" ? <Chip label="पूरा" active={status === "done"} onPress={() => setStatus("done")} tone={colors.success} /> : null}
        </View>
      </Field>
      <Field label="क्या काम">
        <TextInput style={inputStyle} value={title} onChangeText={setTitle} placeholderTextColor={colors.muted} testID="input-edit-job-title" />
      </Field>
      {job?.customerId ? (
        <Field label="अनुमानित रकम (₹, वैकल्पिक)">
          <TextInput style={inputStyle} value={amount} onChangeText={setAmount} keyboardType="numeric" placeholder="0" placeholderTextColor={colors.muted} testID="input-edit-job-amount" />
        </Field>
      ) : null}
      <DateField label={status === "done" ? "तारीख" : job?.customerId ? "डिलीवरी तारीख" : "कब करना है"} value={date} onChange={setDate} future={status !== "done"} testID="input-edit-job-date" />
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
    else if (entry.type === "given") plainEntry = entry;
    else {
      // Same-day jama from old two-row cash records belongs to the work; later settlements are their own event.
      const w = workForPayment(entry, entries);
      if (w && w.type === "work" && w.date === entry.date) work = w;
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
      store.createEntry({ customerId: work.customerId, type: "payment", date, description: settleDescription(work.description || ENTRY_UI[work.type].title), amount: amt, notes: notes.trim(), linkId: work.id });
      onClose();
    } finally { setSaving(false); }
  };

  return (
    <SheetShell visible={!!work} onClose={onClose} title={work?.type === "given" ? "पैसे वापस मिले" : "पैसे मिले"} testID="sheet-settle">
      {work ? (
        <View style={styles.settleSummary}>
          <Text style={styles.jobName}>{work.description || ENTRY_UI[work.type].title}</Text>
          <Text style={styles.hint}>
            कुल {formatINR(work.amount)} · मिल चुके {formatINR(status?.received ?? 0)} ·{" "}
            <Text style={{ color: colors.error, fontWeight: "700" }}>लेने हैं {formatINR(remaining)}</Text>
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
        {amt > 0 && amt < remaining ? <Text style={styles.hint}>{formatINR(remaining - amt)} अभी भी लेने हैं</Text> : null}
        {amt > remaining && remaining > 0 ? <Text style={styles.hint}>{formatINR(amt - remaining)} ज़्यादा — बचा हिसाब या एडवांस में जुड़ेगा</Text> : null}
      </Field>
      <DateField label="कब मिले" value={date} onChange={setDate} testID="input-settle-date" />
      <Field label="नोट (वैकल्पिक)">
        <TextInput style={inputStyle} value={notes} onChangeText={setNotes} placeholder="जैसे UPI से, PhonePe" placeholderTextColor={colors.muted} testID="input-settle-notes" />
      </Field>
      <PrimaryButton label={amt >= remaining && remaining > 0 ? "चुकता करें ✔" : "मिले सेव करें"} color={colors.success} onPress={save} disabled={!valid} saving={saving} testID="save-settle-btn" />
    </SheetShell>
  );
}

type JobMode = "now" | "later";

export function AddJobSheet({ visible, onClose, customerId: fixedCustomerId, initialMode = "now" }: { visible: boolean; onClose: () => void; customerId?: string; initialMode?: JobMode }) {
  const choice = useCustomerChoice(visible, fixedCustomerId);
  const [mode, setMode] = useState<JobMode>(initialMode);
  const [title, setTitle] = useState("");
  const money = useMoneyInput();
  const [date, setDate] = useState(todayISO());
  const [remark, setRemark] = useState("");
  const [remarkDate, setRemarkDate] = useState(todayISO(1));
  const [paidNow, setPaidNow] = useState("");
  const [paidDate, setPaidDate] = useState(todayISO());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      setMode(initialMode);
      setTitle("");
      money.reset("");
      setDate(initialMode === "now" ? todayISO() : todayISO(1));
      setRemark("");
      setRemarkDate(todayISO(1));
      setPaidNow("");
      setPaidDate(todayISO());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, initialMode]);

  const switchMode = (m: JobMode) => {
    setMode(m);
    setDate(m === "now" ? todayISO() : todayISO(1));
  };

  const entries = useEntries().data ?? [];
  const self = choice.isSelf;
  const amt = self ? 0 : money.totalNum;
  const advance = choice.existingId ? advanceOf(entries, choice.existingId) : 0;
  const valid = choice.ready && !!title.trim();
  const saveLabel = mode === "later" ? "आगे का काम जोड़ें" : self ? "सेव करें" : amt > 0 ? "काम सेव करें" : "मुफ़्त काम सेव करें";

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      const customerId = await choice.resolve();
      const t = title.trim();
      if (mode === "now") {
        const entryId = recordWork({ customerId, title: t, amount: amt, received: money.receivedNum, date, notes: remark.trim() });
        store.createJob({ customerId, title: t, dueDate: date, status: "done", estimatedAmount: amt, notes: remark.trim(), entryId });
        if (remark.trim()) {
          await store.createJob({ customerId, title: remark.trim(), dueDate: remarkDate, status: "pending", estimatedAmount: 0, notes: `पिछला काम: ${t}` });
        }
      } else {
        await store.createJob({ customerId, title: t, dueDate: date, estimatedAmount: amt, notes: remark.trim() });
        const got = Math.max(parseFloat(paidNow) || 0, 0);
        // Cash is its own row on the day it was received, not on the day the work is finished.
        if (!self && got > 0) store.createEntry({ customerId, type: "payment", date: paidDate, description: "एडवांस", amount: got, notes: `${t} के लिए` });
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

      {!fixedCustomerId && <CustomerPicker choice={choice} allowSelf testPrefix="chip-job-cust" />}
      <Field label="क्या काम">
        <TextInput style={inputStyle} value={title} onChangeText={setTitle} placeholder={self ? "जैसे पेपर मँगवाना, बिजली बिल भरना" : mode === "now" ? "जैसे पासपोर्ट फोटो, फोटोकॉपी 20 पेज" : "जैसे शादी एलबम"} placeholderTextColor={colors.muted} testID="input-job-title" />
      </Field>
      {self ? null : mode === "now" ? (
        <MoneyFields money={money} advance={advance} freeAllowed />
      ) : (
        <Field label="अनुमानित रकम (₹, वैकल्पिक)">
          <TextInput style={inputStyle} value={money.total} onChangeText={money.setTotal} placeholder="0" placeholderTextColor={colors.muted} keyboardType="numeric" testID="input-job-amount" />
        </Field>
      )}
      {!self && mode === "later" ? (
        <>
          <Field label="अभी मिले (₹)">
            <TextInput style={inputStyle} value={paidNow} onChangeText={setPaidNow} placeholder="0" placeholderTextColor={colors.muted} keyboardType="numeric" testID="input-job-paid" />
          </Field>
          {(parseFloat(paidNow) || 0) > 0 ? <DateField label="पैसे कब मिले" value={paidDate} onChange={setPaidDate} testID="input-job-paid-date" /> : null}
        </>
      ) : null}

      {mode === "now" ? (
        <>
          <DateField label="तारीख" value={date} onChange={setDate} testID="input-job-date" />
          <Field label="आगे का रिमार्क (वैकल्पिक)">
            <TextInput style={[inputStyle, { minHeight: 64 }]} value={remark} onChangeText={setRemark} multiline placeholder="जैसे कल प्रिंट देने हैं, बाकी पैसे शनिवार को" placeholderTextColor={colors.muted} testID="input-job-remark" />
          </Field>
          {remark.trim() ? <DateField label="रिमार्क कब देखना है" value={remarkDate} onChange={setRemarkDate} future testID="input-remark-date" /> : null}
        </>
      ) : (
        <>
          <DateField label={self ? "कब करना है" : "डिलीवरी तारीख"} value={date} onChange={setDate} future testID="input-job-date" />
          <Field label="नोट (वैकल्पिक)">
            <TextInput style={inputStyle} value={remark} onChangeText={setRemark} placeholderTextColor={colors.muted} testID="input-job-notes" />
          </Field>
        </>
      )}

      <PrimaryButton label={saveLabel} onPress={save} disabled={!valid} saving={saving} testID="save-job-btn" />
    </SheetShell>
  );
}

export function ShopProfileSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { user, setShop } = useAuth();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [gst, setGst] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setName(user?.shop_name ?? "");
      setPhone(user?.shop_phone ?? "");
      setAddress(user?.shop_address ?? "");
      setGst(user?.shop_gst ?? "");
      setError(null);
    }
  }, [visible, user?.shop_name, user?.shop_phone, user?.shop_address, user?.shop_gst]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await setShop({ shop_name: name.trim(), shop_phone: phone.trim(), shop_address: address.trim(), shop_gst: gst.trim().toUpperCase() });
      onClose();
    } catch {
      setError("सेव नहीं हुआ, दोबारा कोशिश करें।");
    } finally { setSaving(false); }
  };

  return (
    <SheetShell visible={visible} onClose={onClose} title="बिल पर क्या छपे" testID="sheet-shop-name">
      <Field label="नाम">
        <TextInput style={inputStyle} value={name} onChangeText={setName} placeholder="दुकान का नाम, या आपका नाम" placeholderTextColor={colors.muted} maxLength={60} testID="input-shop-name" />
      </Field>
      <Field label="फ़ोन (रसीद पर छपेगा)">
        <TextInput style={inputStyle} value={phone} onChangeText={setPhone} keyboardType="phone-pad" maxLength={20} placeholderTextColor={colors.muted} testID="input-shop-phone" />
      </Field>
      <Field label="पता (वैकल्पिक)">
        <TextInput style={inputStyle} value={address} onChangeText={setAddress} maxLength={120} placeholderTextColor={colors.muted} testID="input-shop-address" />
      </Field>
      <Field label="GST नंबर (वैकल्पिक)">
        <TextInput style={inputStyle} value={gst} onChangeText={setGst} autoCapitalize="characters" maxLength={20} placeholderTextColor={colors.muted} testID="input-shop-gst" />
      </Field>
      {error ? <Text style={[styles.hint, { color: colors.error }]}>{error}</Text> : null}
      <PrimaryButton label="सेव करें" onPress={save} disabled={!name.trim()} saving={saving} testID="save-shop-name-btn" />
    </SheetShell>
  );
}

export function CompleteJobSheet({ job, onClose }: { job: Job | null; onClose: () => void }) {
  const entries = useEntries().data ?? [];
  const advance = job?.customerId ? advanceOf(entries, job.customerId) : 0;
  const money = useMoneyInput();
  const [cashDate, setCashDate] = useState(todayISO());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (job) {
      const already = job.customerId ? advanceOf(entries, job.customerId) : 0;
      // Money already in hand must not be typed again, or it would show up as cash today.
      money.reset(job.estimatedAmount > 0 ? String(job.estimatedAmount) : "", already > 0 ? "0" : undefined);
      setCashDate(todayISO());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job]);

  const amt = job?.customerId ? money.totalNum : 0;

  const save = async () => {
    if (!job) return;
    setSaving(true);
    try {
      const workDate = todayISO();
      const got = money.receivedNum;
      const sameDay = cashDate === workDate;
      const entryId = recordWork({ customerId: job.customerId, title: job.title, amount: amt, received: sameDay ? got : 0, date: workDate, notes: "काम पूरा" });
      if (!sameDay && got > 0) store.createEntry({ customerId: job.customerId, type: "payment", date: cashDate, description: "एडवांस", amount: got, notes: `${job.title} के लिए` });
      store.updateJob(job.id, { status: "done", dueDate: workDate, estimatedAmount: amt, entryId });
      onClose();
    } finally { setSaving(false); }
  };

  return (
    <SheetShell visible={!!job} onClose={onClose} title="काम पूरा करें" testID="sheet-complete-job">
      {job ? <Text style={styles.jobName}>{job.title}</Text> : null}
      {advance > 0 ? <Text style={styles.hint}>पहले मिल चुके {formatINR(advance)}। आज नई रकम ही लिखें।</Text> : null}
      {job?.customerId ? <MoneyFields money={money} advance={advance} receivedLabel="आज कितने मिले (₹)" freeAllowed /> : null}
      {job?.customerId && money.receivedNum > 0 ? <DateField label="यह नकद कब मिला" value={cashDate} onChange={setCashDate} testID="input-complete-cash-date" /> : null}
      <PrimaryButton label={job?.customerId && amt <= 0 ? "मुफ़्त — पूरा हुआ" : "पूरा हुआ"} color={colors.success} onPress={save} saving={saving} testID="save-complete-btn" />
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
  resultBox: { marginBottom: spacing.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderStyle: "dashed" },
  resultText: { fontSize: 14, fontWeight: "700" },
  pickedRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 48, paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.brandTertiary, borderWidth: 1, borderColor: colors.border },
  pickedName: { flex: 1, fontSize: 15, fontWeight: "700", color: colors.onSurface },
  changeText: { fontSize: 13, fontWeight: "700", color: colors.brandPrimary },
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
