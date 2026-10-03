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
import { advanceOf, computeBalance, itemsOf, useCustomers, useEntries, useJobs, type Entry, type EntryItem, type EntryType, type Job } from "@/src/lib/data";
import { ADVANCE, advancesForJob, buildLedger, jobForWork, linkedPayment, removeEntryWithLinks, removeJobWithAdvances, settlementsFor, workForJob, workForPayment } from "@/src/lib/records";
import { confirmAction } from "@/src/lib/confirm";
import { colors, spacing, radius } from "@/src/theme";
import { formatDate, formatINR, todayISO } from "@/src/lib/format";
import { Pressable } from "@/src/components/tap";
import { useAuth } from "@/src/context/AuthContext";
import { useContactPicker } from "@/src/components/contact-picker-modal";
import { usePersona } from "@/src/lib/persona";
import { useRouter } from "expo-router";

// Android modals don't resize for the keyboard under edge-to-edge, so pad by the measured overlap instead.
function useKeyboardOverlap(ref: React.RefObject<View | null>) {
  const [overlap, setOverlap] = useState(0);
  useEffect(() => {
    if (Platform.OS === "web") return;
    const showEvt = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvt = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    let keyboardTop: number | null = null;
    let timers: ReturnType<typeof setTimeout>[] = [];
    const measure = () => {
      const top = keyboardTop;
      if (top === null) return;
      ref.current?.measureInWindow((_x, y, _w, h) => {
        if (h > 0 && keyboardTop !== null) setOverlap(Math.max(0, y + h - top));
      });
    };
    // A sheet that focuses a field while it is still sliding in measures mid-animation; measure again once it settles.
    const show = Keyboard.addListener(showEvt, (e) => {
      keyboardTop = e.endCoordinates.screenY;
      timers.forEach(clearTimeout);
      measure();
      timers = [setTimeout(measure, 200), setTimeout(measure, 500)];
    });
    const hide = Keyboard.addListener(hideEvt, () => {
      keyboardTop = null;
      timers.forEach(clearTimeout);
      setOverlap(0);
    });
    return () => {
      timers.forEach(clearTimeout);
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
  const scrollY = useRef(0);
  const viewH = useRef(0);
  const overlap = useKeyboardOverlap(containerRef);

  // Keeps the focused field above the keyboard, also when moving to the next field with it open.
  useEffect(() => {
    if (!overlap) return;
    let last: unknown = null;
    const reveal = () => {
      const input = TextInput.State.currentlyFocusedInput() as any;
      const inner = (scrollRef.current as any)?.getInnerViewRef?.();
      last = input;
      if (!input || !inner) return;
      try {
        input.measureLayout(
          inner,
          (_x: number, y: number, _w: number, h: number) => {
            const top = scrollY.current;
            if (y < top + 8 || y + h > top + viewH.current - 24) scrollRef.current?.scrollTo({ y: Math.max(0, y - 96), animated: true });
          },
          () => {},
        );
      } catch {}
    };
    const first = setTimeout(reveal, 80);
    const poll = setInterval(() => {
      if (TextInput.State.currentlyFocusedInput() !== last) reveal();
    }, 250);
    return () => {
      clearTimeout(first);
      clearInterval(poll);
    };
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
          <ScrollView
            ref={scrollRef}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            scrollEventThrottle={32}
            onScroll={(e) => { scrollY.current = e.nativeEvent.contentOffset.y; }}
            onLayout={(e) => { viewH.current = e.nativeEvent.layout.height; }}
          >
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

export function DateField({ label, value, onChange, future, money, testID }: { label: string; value: string; onChange: (v: string) => void; future?: boolean; money?: boolean; testID?: string }) {
  const old = money && /^\d{4}-\d{2}-\d{2}$/.test(value) && value < todayISO();
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
      {old ? <Text style={[styles.hint, { color: colors.warning, marginTop: 6 }]}>पुरानी तारीख — खाते में जुड़ेगा, गल्ला / बैंक नहीं बदलेगा</Text> : null}
    </Field>
  );
}

const NEW_CUSTOMER = "__new__";
const SELF = "__self__";

// Lets a sheet pick an existing customer (searchable, most recent first), create one from the
// typed name, or — for jobs — mark it as the shopkeeper's own task.
export function useCustomerChoice(visible: boolean, fixedCustomerId?: string) {
  const { isPersonal } = usePersona();
  const allCustomers = useCustomers().data ?? [];
  const entries = useEntries().data ?? [];
  const [customerId, setCustomerId] = useState("");
  const [query, setQuery] = useState("");
  const [newPhone, setNewPhone] = useState("");

  const customers = useMemo(() => {
    return allCustomers.filter((c) => (isPersonal ? c.persona === "personal" : c.persona !== "personal"));
  }, [allCustomers, isPersonal]);

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
    const c = store.createCustomer({
      name: query.trim(),
      phone: newPhone.trim(),
      address: "",
      notes: "",
      persona: isPersonal ? "personal" : "business",
    });
    setCustomerId(c.id);
    return c.id;
  };

  return { recent, matches, exact, customerId, setCustomerId, existingId, isNew, isSelf, query, setQuery, newPhone, setNewPhone, ready, resolve };
}

export function CustomerPicker({ choice, label = "नाम", allowSelf, testPrefix }: { choice: ReturnType<typeof useCustomerChoice>; label?: string; allowSelf?: boolean; testPrefix: string }) {
  const { recent, matches, exact, customerId, setCustomerId, isNew, isSelf, query, setQuery } = choice;
  const picked = recent.find((c) => c.id === customerId);
  const contacts = useContactPicker((name, phone) => {
    const digits = phone.replace(/\D/g, "").slice(-10);
    const known =
      (digits.length === 10 && recent.find((c) => c.phone.replace(/\D/g, "").slice(-10) === digits)) ||
      recent.find((c) => !!name.trim() && c.name.trim().toLowerCase() === name.trim().toLowerCase());
    if (known) {
      setCustomerId(known.id);
      setQuery("");
      return;
    }
    setQuery(name.trim() || phone);
    choice.setNewPhone(phone);
    setCustomerId(NEW_CUSTOMER);
  });

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
      <View style={styles.searchRow}>
        <TextInput
          style={[inputStyle, { flex: 1 }]}
          value={query}
          onChangeText={(t) => {
            setQuery(t);
            if (isNew && !t.trim()) setCustomerId("");
          }}
          placeholder="नाम या फ़ोन"
          placeholderTextColor={colors.muted}
          testID={`${testPrefix}-search`}
        />
        <Pressable style={styles.contactBtn} onPress={contacts.open} hitSlop={4} testID={`${testPrefix}-contacts`}>
          <MaterialIcon name="contacts-outline" size={22} color={colors.brandPrimary} />
        </Pressable>
      </View>
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
      {contacts.modal}
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

function MoneyFields({
  money,
  advance = 0,
  totalLabel = "कुल रकम (₹)",
  receivedLabel = "अभी कितने मिले (₹)",
  freeAllowed,
  hideTotal,
  purchase,
}: {
  money: MoneyInput;
  advance?: number;
  totalLabel?: string;
  receivedLabel?: string;
  freeAllowed?: boolean;
  /** The total comes from the item rows above. */
  hideTotal?: boolean;
  /** Money we pay out (goods / service taken) instead of money we receive. */
  purchase?: boolean;
}) {
  const t = money.totalNum;
  const r = money.receivedNum;
  return (
    <>
      {hideTotal ? null : (
        <Field label={totalLabel}>
          <TextInput style={inputStyle} value={money.total} onChangeText={money.setTotal} placeholder={freeAllowed ? "0 = मुफ़्त" : "0"} placeholderTextColor={colors.muted} keyboardType="numeric" testID="input-money-total" />
        </Field>
      )}
      {purchase ? (
        t > 0 ? (
          <>
            <Field label={receivedLabel}>
              <View style={[styles.chipRow, { marginBottom: spacing.sm }]}>
                <Chip label="कुछ नहीं" active={r === 0} onPress={() => money.setReceived("0")} tone={colors.warning} testID="money-none" />
                <Chip label={`पूरे ${formatINR(t)}`} active={r === t} onPress={() => money.setReceived(String(t))} tone={colors.success} testID="money-full" />
              </View>
              <TextInput style={inputStyle} value={money.received} onChangeText={money.setReceived} placeholder="0" placeholderTextColor={colors.muted} keyboardType="numeric" testID="input-money-received" />
            </Field>
            <View style={[styles.resultBox, { borderColor: r > t ? colors.error : r >= t ? colors.success : colors.warning }]} testID="money-result">
              <Text style={[styles.resultText, { color: r > t ? colors.error : r >= t ? colors.success : colors.warning }]}>
                {r > t ? `कुल ${formatINR(t)} से ज़्यादा नहीं` : r >= t ? "✔ पूरे चुकाए" : `${formatINR(t - r)} देने हैं`}
              </Text>
            </View>
          </>
        ) : null
      ) : null}
      {!purchase && t > 0 ? (
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
      {purchase ? null : <MoneyResult total={t} received={r} advance={advance} freeAllowed={freeAllowed} />}
    </>
  );
}

type ItemRow = { key: number; title: string; amount: string };
let itemSeq = 0;
const itemRow = (title = "", amount = ""): ItemRow => ({ key: ++itemSeq, title, amount });
const rowAmount = (r: ItemRow) => Math.max(parseFloat(r.amount) || 0, 0);
const isFilled = (r: ItemRow) => !!r.title.trim() || rowAmount(r) > 0;

/** Line items of one work / purchase. `onTotal` hears every edit so the money fields follow the sum. */
function useItems(onTotal?: (total: number) => void) {
  const [rows, setRows] = useState<ItemRow[]>(() => [itemRow()]);
  const filled = rows.filter(isFilled);
  const items: EntryItem[] = filled.map((r) => ({ title: r.title.trim(), amount: rowAmount(r) }));
  const total = items.reduce((s, i) => s + i.amount, 0);
  const commit = (next: ItemRow[]) => {
    setRows(next);
    onTotal?.(next.filter(isFilled).reduce((s, r) => s + rowAmount(r), 0));
  };
  return {
    rows,
    total,
    /** At least one item and every item has a name. */
    titled: filled.length > 0 && filled.every((r) => !!r.title.trim()),
    description: items.map((i) => i.title).join(" + "),
    /** What the entry stores: the list only when there is more than one item. */
    saved: (): EntryItem[] => (items.length > 1 ? items : []),
    update: (key: number, patch: Partial<ItemRow>) => commit(rows.map((r) => (r.key === key ? { ...r, ...patch } : r))),
    add: () => setRows([...rows, itemRow()]),
    remove: (key: number) => commit(rows.length > 1 ? rows.filter((r) => r.key !== key) : rows),
    reset: (list?: EntryItem[]) => setRows(list && list.length ? list.map((i) => itemRow(i.title, i.amount ? String(i.amount) : "")) : [itemRow()]),
  };
}

type Items = ReturnType<typeof useItems>;

function ItemsField({ items, label, placeholder, addLabel }: { items: Items; label: string; placeholder: string; addLabel: string }) {
  const many = items.rows.length > 1;
  return (
    <Field label={label}>
      <View style={{ gap: spacing.sm }}>
        {items.rows.map((r, i) => (
          <View key={r.key} style={styles.itemRow}>
            {many ? <Text style={styles.itemNo}>{i + 1}</Text> : null}
            <TextInput
              style={[inputStyle, { flex: 1 }]}
              value={r.title}
              onChangeText={(title) => items.update(r.key, { title })}
              placeholder={i === 0 ? placeholder : "और क्या"}
              placeholderTextColor={colors.muted}
              autoFocus={i > 0 && i === items.rows.length - 1 && !r.title && !r.amount}
              testID={`input-item-title-${i}`}
            />
            <View style={styles.itemAmtWrap}>
              <Text style={styles.itemRupee}>₹</Text>
              <TextInput
                style={styles.itemAmt}
                value={r.amount}
                onChangeText={(amount) => items.update(r.key, { amount })}
                placeholder="0"
                placeholderTextColor={colors.muted}
                keyboardType="numeric"
                testID={`input-item-amount-${i}`}
              />
            </View>
            {many ? (
              <Pressable onPress={() => items.remove(r.key)} hitSlop={8} testID={`remove-item-${i}`}>
                <MaterialIcon name="close-circle" size={20} color={colors.muted} />
              </Pressable>
            ) : null}
          </View>
        ))}
      </View>
      <View style={styles.itemsFoot}>
        <Pressable onPress={items.add} style={styles.addItemBtn} hitSlop={6} testID="add-item-btn">
          <MaterialIcon name="plus" size={16} color={colors.brandPrimary} />
          <Text style={styles.addItemText}>{addLabel}</Text>
        </Pressable>
        {many ? <Text style={styles.itemsTotal}>कुल {formatINR(items.total)}</Text> : null}
      </View>
    </Field>
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

type PayMode = "cash" | "online";

function PayModeField({ label, value, onChange, cashLabel = "नकद", onlineLabel = "ऑनलाइन" }: { label: string; value: PayMode; onChange: (m: PayMode) => void; cashLabel?: string; onlineLabel?: string }) {
  return (
    <Field label={label}>
      <View style={[styles.segment, { marginBottom: 0 }]}>
        <Pressable onPress={() => onChange("cash")} style={[styles.segmentBtn, value === "cash" && { backgroundColor: colors.success }]} testID="paymode-cash">
          <MaterialIcon name="cash" size={16} color={value === "cash" ? "#fff" : colors.onSurface} />
          <Text style={[styles.segmentText, value === "cash" && { color: "#fff" }]}>{cashLabel}</Text>
        </Pressable>
        <Pressable onPress={() => onChange("online")} style={[styles.segmentBtn, value === "online" && { backgroundColor: colors.info }]} testID="paymode-online">
          <MaterialIcon name="cellphone" size={16} color={value === "online" ? "#fff" : colors.onSurface} />
          <Text style={[styles.segmentText, value === "online" && { color: "#fff" }]}>{onlineLabel}</Text>
        </Pressable>
      </View>
    </Field>
  );
}

/** Portal fee / cost paid by the shop for this work. Never printed on the customer's bill. */
function FeeField({ fee, setFee, feeMode, setFeeMode, amount }: { fee: string; setFee: (v: string) => void; feeMode: PayMode; setFeeMode: (m: PayMode) => void; amount: number }) {
  const n = Math.max(parseFloat(fee) || 0, 0);
  return (
    <>
      <Field label="फीस / लागत (₹)">
        <TextInput style={inputStyle} value={fee} onChangeText={setFee} placeholder="0" placeholderTextColor={colors.muted} keyboardType="numeric" testID="input-fee" />
        {n > 0 && amount > 0 ? (
          <Text style={[styles.hint, { color: amount - n >= 0 ? colors.brandPrimary : colors.error, fontWeight: "700" }]}>
            बचत {formatINR(amount - n)}
          </Text>
        ) : null}
      </Field>
      {n > 0 ? <PayModeField label="फीस कहाँ से दी" value={feeMode} onChange={setFeeMode} cashLabel="गल्ले से" onlineLabel="बैंक से" /> : null}
    </>
  );
}

const settleDescription = (title: string) => `${title} — भुगतान`;

/** Money taken beyond the work amount stays with us as an advance row tied to that work. */
function bookAdvance(customerId: string, extra: number, date: string, title: string, linkId: string, mode: PayMode) {
  if (extra <= 0) return;
  store.createEntry({ customerId, type: "payment", date, description: "एडवांस", amount: extra, mode, notes: `${title} के साथ`, linkId });
}

// One row per piece of work: `paid` is the money taken now (capped at the amount), the rest is udhaar.
function recordWork({
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
}): string {
  if (amount <= 0) return "";
  const work = store.createEntry({
    customerId,
    type: "work",
    date,
    description: title,
    amount,
    paid: Math.min(received, amount),
    mode,
    fee: Math.max(0, fee),
    feeMode,
    notes,
    items,
  });
  bookAdvance(customerId, received - amount, date, title, work.id, mode);
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
  const { isPersonal } = usePersona();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [targetPersona, setTargetPersona] = useState<"business" | "personal">("business");
  const [saving, setSaving] = useState(false);
  const contacts = useContactPicker((n, p) => {
    if (n) setName(n);
    if (p) setPhone(p);
  });

  useEffect(() => {
    if (visible) {
      setName(initial?.name ?? "");
      setPhone(initial?.phone ?? "");
      setAddress(initial?.address ?? "");
      setNotes(initial?.notes ?? "");
      setTargetPersona(initial?.persona ?? (isPersonal ? "personal" : "business"));
    }
  }, [visible, initial, isPersonal]);

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const body = {
        name: name.trim(),
        phone: phone.trim(),
        address: address.trim(),
        notes: notes.trim(),
        persona: targetPersona,
      };
      if (initial?.id) await store.updateCustomer(initial.id, body);
      else await store.createCustomer(body);
      onClose();
    } finally { setSaving(false); }
  };

  return (
    <SheetShell visible={visible} onClose={onClose} title={initial ? "विवरण बदलें" : targetPersona === "personal" ? "नया व्यक्ति" : "नया ग्राहक"} testID="sheet-customer">
      {!initial ? (
        <View style={{ marginBottom: spacing.md, gap: spacing.sm }}>
          <Pressable
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              backgroundColor: colors.brandTertiary,
              paddingVertical: 10,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: colors.brandPrimary,
            }}
            onPress={contacts.open}
            testID="pick-contact-btn"
          >
            <MaterialIcon name="contacts" size={18} color={colors.brandPrimary} />
            <Text style={{ fontSize: 13, fontWeight: "700", color: colors.brandPrimary }}>
              फ़ोन से चुनें
            </Text>
          </Pressable>
        </View>
      ) : null}
      <Field label="नाम">
        <TextInput style={inputStyle} value={name} onChangeText={setName} placeholder="नाम" placeholderTextColor={colors.muted} testID="input-cust-name" />
      </Field>
      <Field label="फ़ोन (वैकल्पिक)">
        <TextInput style={inputStyle} value={phone} onChangeText={setPhone} placeholder="10 अंक" placeholderTextColor={colors.muted} keyboardType="phone-pad" testID="input-cust-phone" />
      </Field>
      <Field label="पता (वैकल्पिक)">
        <TextInput style={inputStyle} value={address} onChangeText={setAddress} placeholder="मोहल्ला, गली या गांव" placeholderTextColor={colors.muted} testID="input-cust-address" />
      </Field>
      <Field label="नोट (वैकल्पिक)">
        <TextInput style={[inputStyle, { minHeight: 72 }]} value={notes} onChangeText={setNotes} multiline placeholderTextColor={colors.muted} testID="input-cust-notes" />
      </Field>
      <PrimaryButton label={initial ? "बदलाव सेव करें" : targetPersona === "personal" ? "व्यक्ति जोड़ें" : "ग्राहक जोड़ें"} onPress={save} disabled={!name.trim()} saving={saving} testID="save-customer-btn" />
      {initial?.id && onDelete ? (
        <DangerLink
          label="यह खाता हटाएँ"
          testID="delete-customer-link"
          onPress={() => confirmAction(`${name || "यह खाता"} हटाएँ?`, "इनकी सारी एंट्री भी मिट जाएँगी, और पुराने दिनों का गल्ला / बैंक हिसाब बदल जाएगा।", "हटा दें", () => { onDelete(); onClose(); })}
        />
      ) : null}
      {contacts.modal}
    </SheetShell>
  );
}

const ENTRY_UI: Record<EntryType, { title: string; short: string; icon: string; color: string; placeholder: string }> = {
  work: { title: "काम", short: "काम", icon: "briefcase-outline", color: colors.error, placeholder: "जैसे पासपोर्ट फोटो 8 प्रति" },
  payment: { title: "पैसे मिले", short: "मिले", icon: "arrow-bottom-left", color: colors.success, placeholder: "जैसे पुराना हिसाब, UPI" },
  given: { title: "पैसे दिए", short: "दिए", icon: "arrow-top-right", color: colors.error, placeholder: "जैसे घर के लिए दिए" },
  purchase: { title: "सामान / सेवा ली", short: "सामान / सेवा", icon: "cart-outline", color: colors.warning, placeholder: "जैसे राशन, दवाई, मरम्मत" },
  aeps: { title: "काउंटर सेवा बाकी", short: "AEPS", icon: "fingerprint", color: colors.error, placeholder: "" },
};

const PICKER_LABEL: Record<EntryType, string> = { work: "ग्राहक", payment: "किससे मिले", given: "किसको दिए", purchase: "किससे ली (दुकान / व्यक्ति)", aeps: "ग्राहक" };

/** Plain khata row. With `kinds`, the sheet lets you switch between them (e.g. मिले / दिए / सामान). */
export function AddEntrySheet({ visible, type, kinds, onClose, customerId: fixedCustomerId, initial }: { visible: boolean; type: EntryType; kinds?: EntryType[]; onClose: () => void; customerId?: string; initial?: Entry }) {
  const choice = useCustomerChoice(visible, fixedCustomerId ?? initial?.customerId);
  const [kind, setKind] = useState<EntryType>(type);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const money = useMoneyInput();
  const items = useItems((sum) => money.setTotal(sum > 0 ? String(sum) : ""));
  const [payMode, setPayMode] = useState<"cash" | "online">("cash");
  const [date, setDate] = useState(todayISO());
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setKind(initial?.type ?? type);
    setDescription(initial?.description ?? "");
    setAmount(initial ? String(initial.amount) : "");
    if (initial?.type === "purchase") {
      items.reset(itemsOf(initial));
      money.reset(String(initial.amount), String(initial.paid ?? 0));
    } else {
      items.reset();
      money.reset("", "0");
    }
    setPayMode(initial?.mode ?? "cash");
    setDate(initial?.date ?? todayISO());
    setNotes(initial?.notes ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, initial, type]);

  const entries = useEntries().data ?? [];
  const later = initial && (initial.type === "purchase" || (initial.type === "given" && !initial.linkId)) ? settlementsFor(initial, entries) : [];
  const personId = initial ? "" : choice.existingId;
  const due = personId ? computeBalance(entries, personId) : 0;
  const ui = ENTRY_UI[kind];
  const isPurchase = kind === "purchase";
  const amt = isPurchase ? money.totalNum : parseFloat(amount);
  const paidNow = isPurchase ? money.receivedNum : 0;
  const needsDescription = kind === "work";
  const fullChip = kind === "payment" && due > 0 ? due : kind === "given" && due < 0 ? -due : 0;
  const filled = isPurchase ? items.titled && paidNow <= amt : !needsDescription || !!description.trim();
  const valid = (initial ? true : choice.ready) && filled && isFinite(amt) && amt > 0;

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      const body = isPurchase
        ? { type: kind, date, description: items.description, amount: amt, paid: paidNow, mode: payMode, notes: notes.trim(), items: items.saved() }
        : { type: kind, date, description: description.trim(), amount: amt, mode: payMode, notes: notes.trim() };
      if (initial) await store.updateEntry(initial.id, body);
      else {
        const customerId = await choice.resolve();
        await store.createEntry({ customerId, ...body });
      }
      onClose();
    } finally { setSaving(false); }
  };

  return (
    <SheetShell visible={visible} onClose={onClose} title={initial ? "एंट्री बदलें" : kinds ? "लेन-देन" : ui.title} testID={`sheet-entry-${kind}`}>
      {kinds && !initial ? (
        <View style={styles.segment}>
          {kinds.map((k) => (
            <Pressable key={k} onPress={() => setKind(k)} style={[styles.segmentBtn, kind === k && { backgroundColor: ENTRY_UI[k].color }]} testID={`entry-kind-${k}`}>
              <MaterialIcon name={ENTRY_UI[k].icon as any} size={16} color={kind === k ? "#fff" : colors.onSurface} />
              <Text style={[styles.segmentText, kind === k && { color: "#fff" }]} numberOfLines={1}>{ENTRY_UI[k].short}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {!initial && !fixedCustomerId && <CustomerPicker choice={choice} label={PICKER_LABEL[kind]} testPrefix="chip-cust" />}
      {isPurchase ? (
        <>
          <ItemsField items={items} label="क्या लिया" placeholder={ui.placeholder} addLabel="और जोड़ें" />
          <MoneyFields money={money} receivedLabel="अभी कितने दिए (₹)" hideTotal purchase />
          {paidNow > 0 ? <PayModeField label="कैसे दिए" value={payMode} onChange={setPayMode} /> : null}
        </>
      ) : (
        <>
          <Field label="रकम (₹)">
            {fullChip > 0 ? (
              <View style={[styles.chipRow, { marginBottom: spacing.sm }]}>
                <Chip
                  label={`पूरे ${kind === "payment" ? "लेने" : "देने"} हैं ${formatINR(fullChip)}`}
                  active={amt === fullChip}
                  onPress={() => setAmount(String(fullChip))}
                  tone={kind === "payment" ? colors.success : colors.warning}
                  testID="entry-full-due"
                />
              </View>
            ) : null}
            <TextInput style={inputStyle} value={amount} onChangeText={setAmount} placeholder="0" placeholderTextColor={colors.muted} keyboardType="numeric" testID="input-entry-amount" />
            {fullChip > 0 && amt > 0 ? (
              <Text style={[styles.hint, { color: amt >= fullChip ? colors.success : colors.error }]}>
                {amt > fullChip
                  ? `✔ हिसाब बराबर · ${formatINR(amt - fullChip)} ${kind === "payment" ? "एडवांस" : "ज़्यादा दिए"}`
                  : amt === fullChip
                  ? "✔ हिसाब बराबर"
                  : `${formatINR(fullChip - amt)} अभी भी ${kind === "payment" ? "लेने" : "देने"} हैं`}
              </Text>
            ) : null}
          </Field>
          {kind !== "work" ? (
            <PayModeField label={kind === "payment" ? "कैसे मिले" : "कैसे दिए"} value={payMode} onChange={setPayMode} />
          ) : null}
          <Field label={needsDescription ? "विवरण" : "किस लिए (वैकल्पिक)"}>
            <TextInput style={inputStyle} value={description} onChangeText={setDescription} placeholder={ui.placeholder} placeholderTextColor={colors.muted} testID="input-entry-desc" />
          </Field>
        </>
      )}
      {later.length > 0 ? (
        <Field label={isPurchase ? "बाद में चुकाए" : "वापस मिले"}>
          {later.map((p) => (
            <View key={p.id} style={styles.settleRow}>
              <MaterialIcon name="check-circle" size={16} color={colors.success} />
              <Text style={styles.settleText}>{formatINR(p.amount)} · {formatDate(p.date)}{p.mode === "online" ? " · ऑनलाइन" : ""}{p.notes ? ` · ${p.notes}` : ""}</Text>
              <Pressable
                hitSlop={8}
                onPress={() => confirmAction("यह भुगतान हटाएँ?", `${formatINR(p.amount)} · ${formatDate(p.date)}`, "हटा दें", () => store.deleteEntry(p.id))}
                testID={`del-settle-${p.id}`}
              >
                <MaterialIcon name="close" size={18} color={colors.muted} />
              </Pressable>
            </View>
          ))}
        </Field>
      ) : null}
      <DateField label="तारीख" value={date} onChange={setDate} money testID="input-entry-date" />
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
    const later = "\nदूसरे दिन लिए-दिए पैसे खाते में बने रहेंगे।";
    const extra =
      entry.type === "work"
        ? `\nउसी दिन मिले पैसे और काम कार्ड भी हटेंगे।${later}`
        : entry.type === "given" && !entry.linkId
          ? `\nउसी दिन वापस मिले पैसे भी हटेंगे।${later}`
          : entry.type === "purchase"
            ? `\nउसी दिन चुकाए पैसे भी हटेंगे।${later}`
            : "";
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
  const money = useMoneyInput();
  const items = useItems((sum) => money.setTotal(sum > 0 ? String(sum) : ""));
  const [payMode, setPayMode] = useState<"cash" | "online">("cash");
  const [govtFee, setGovtFee] = useState("");
  const [feeMode, setFeeMode] = useState<"online" | "cash">("online");
  const [date, setDate] = useState(todayISO());
  const [notes, setNotes] = useState("");
  const [remark, setRemark] = useState("");
  const [remarkDate, setRemarkDate] = useState(todayISO(1));
  const [saving, setSaving] = useState(false);

  const job = entry ? jobForWork(entry, jobs) : undefined;
  // Extra money taken on the work day beyond the bill, booked as a linked advance row.
  const extras = entry ? entries.filter((e) => e.type === "payment" && e.linkId === entry.id && e.date === entry.date && e.description === ADVANCE && e.notes.endsWith("के साथ")) : [];
  const extraSum = extras.reduce((s, e) => s + e.amount, 0);
  const link = entry ? linkedPayment(entry, entries) : undefined;
  const legacyLink = link && !extras.some((e) => e.id === link.id) ? link : undefined;

  useEffect(() => {
    if (!entry) return;
    items.reset(itemsOf(entry));
    money.reset(String(entry.amount), String(((entry.paid ?? 0) || (legacyLink?.amount ?? 0)) + extraSum));
    setPayMode(entry.mode ?? legacyLink?.mode ?? "cash");
    setGovtFee(entry.fee ? String(entry.fee) : "");
    setFeeMode(entry.feeMode ?? "online");
    setDate(entry.date);
    setNotes(entry.notes);
    setRemark("");
    setRemarkDate(todayISO(1));
    // Only re-initialise when a different record is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry?.id]);

  const amt = money.totalNum;
  const valid = items.titled && amt > 0;

  const save = () => {
    if (!entry || !valid) return;
    setSaving(true);
    try {
      const t = items.description;
      const taken = money.receivedNum;
      const feeNum = Math.max(parseFloat(govtFee) || 0, 0);
      store.updateEntry(entry.id, {
        type: "work",
        date,
        description: t,
        amount: amt,
        paid: Math.min(taken, amt),
        mode: payMode,
        fee: feeNum,
        feeMode,
        notes: notes.trim(),
        items: items.saved(),
      });
      extras.forEach((e) => store.deleteEntry(e.id));
      bookAdvance(entry.customerId, taken - amt, date, t, entry.id, payMode);
      // Old two-row cash records: the same-day jama is now carried by `paid`.
      if (legacyLink && !(entry.paid ?? 0)) store.deleteEntry(legacyLink.id);
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
      <ItemsField items={items} label="क्या काम" placeholder="काम" addLabel="और काम" />
      <MoneyFields money={money} receivedLabel="उस दिन मिले (₹)" hideTotal />
      {money.receivedNum > 0 ? <PayModeField label="कैसे मिले" value={payMode} onChange={setPayMode} /> : null}
      <FeeField fee={govtFee} setFee={setGovtFee} feeMode={feeMode} setFeeMode={setFeeMode} amount={amt} />
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
  const entries = useEntries().data ?? [];
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
    const adv = advancesForJob(job, entries).reduce((s, e) => s + e.amount, 0);
    confirmAction("काम हटाएँ?", adv > 0 ? `${job.title}\nइसका एडवांस ${formatINR(adv)} भी हटेगा।` : job.title, "हटा दें", () => {
      removeJobWithAdvances(job, entries);
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
  const router = useRouter();
  const aepsId = entry?.type === "aeps" ? entry.linkId : "";
  // A counter-service due is edited on its AEPS row.
  useEffect(() => {
    if (!aepsId) return;
    onClose();
    router.push(`/aeps/${aepsId}` as never);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aepsId]);
  let work: Entry | null = null;
  let plainEntry: Entry | null = null;
  let plainJob: Job | null = null;
  if (job) {
    work = workForJob(job, entries) ?? null;
    if (!work) plainJob = job;
  } else if (entry && entry.type !== "aeps") {
    if (entry.type === "work") work = entry;
    else if (entry.type === "given" || entry.type === "purchase") plainEntry = entry;
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

/** Settles one open row later: money received against work / given, or paid back against a purchase. */
export function SettleSheet({ work, onClose }: { work: Entry | null; onClose: () => void }) {
  const entries = useEntries().data ?? [];
  const [amount, setAmount] = useState("");
  const [payMode, setPayMode] = useState<"cash" | "online">("cash");
  const [date, setDate] = useState(todayISO());
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const status = work ? buildLedger(entries.filter((e) => e.customerId === work.customerId)).work.get(work.id) : undefined;
  const remaining = status?.remaining ?? 0;
  const payBack = work?.type === "purchase";
  const word = payBack ? { done: "चुकाए", left: "देने हैं", how: "कैसे दिए", when: "कब दिए", much: "कितने दिए (₹)" } : { done: "मिल चुके", left: "लेने हैं", how: "कैसे मिले", when: "कब मिले", much: "कितने मिले (₹)" };

  useEffect(() => {
    if (!work) return;
    setAmount(remaining > 0 ? String(remaining) : "");
    setPayMode("cash");
    setDate(todayISO());
    setNotes("");
    // Only re-initialise when a different record is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [work?.id]);

  const amt = parseFloat(amount) || 0;
  const valid = !!work && amt > 0 && (!payBack || amt <= remaining);

  const save = () => {
    if (!work || !valid) return;
    setSaving(true);
    try {
      store.createEntry({
        customerId: work.customerId,
        type: payBack ? "given" : "payment",
        date,
        description: settleDescription(work.description || ENTRY_UI[work.type].title),
        amount: amt,
        mode: payMode,
        notes: notes.trim(),
        linkId: work.id,
      });
      onClose();
    } finally { setSaving(false); }
  };

  return (
    <SheetShell visible={!!work} onClose={onClose} title={payBack ? "पैसे चुकाए" : work?.type === "given" ? "पैसे वापस मिले" : "पैसे मिले"} testID="sheet-settle">
      {work ? (
        <View style={styles.settleSummary}>
          <Text style={styles.jobName}>{work.description || ENTRY_UI[work.type].title}</Text>
          <Text style={styles.hint}>
            कुल {formatINR(work.amount)} · {word.done} {formatINR(status?.received ?? 0)} ·{" "}
            <Text style={{ color: payBack ? colors.warning : colors.error, fontWeight: "700" }}>{word.left} {formatINR(remaining)}</Text>
          </Text>
        </View>
      ) : null}
      <Field label={word.much}>
        {remaining > 0 ? (
          <View style={[styles.chipRow, { marginBottom: spacing.sm }]}>
            <Chip label={`पूरा ${formatINR(remaining)}`} active={amt === remaining} onPress={() => setAmount(String(remaining))} tone={colors.success} testID="settle-full" />
            {remaining >= 2 ? <Chip label="आधा" active={amt === Math.round(remaining / 2)} onPress={() => setAmount(String(Math.round(remaining / 2)))} testID="settle-half" /> : null}
          </View>
        ) : null}
        <TextInput style={inputStyle} value={amount} onChangeText={setAmount} keyboardType="numeric" placeholder="0" placeholderTextColor={colors.muted} testID="input-settle-amount" />
        {amt > 0 && amt < remaining ? <Text style={styles.hint}>{formatINR(remaining - amt)} अभी भी {word.left}</Text> : null}
        {amt > remaining && remaining > 0 ? (
          <Text style={[styles.hint, payBack && { color: colors.error }]}>{payBack ? `${formatINR(remaining)} से ज़्यादा नहीं` : `${formatINR(amt - remaining)} ज़्यादा, एडवांस में जुड़ेगा`}</Text>
        ) : null}
      </Field>
      <PayModeField label={word.how} value={payMode} onChange={setPayMode} />
      <DateField label={word.when} value={date} onChange={setDate} money testID="input-settle-date" />
      <Field label="नोट (वैकल्पिक)">
        <TextInput style={inputStyle} value={notes} onChangeText={setNotes} placeholderTextColor={colors.muted} testID="input-settle-notes" />
      </Field>
      <PrimaryButton
        label={amt >= remaining && remaining > 0 ? "चुकता करें ✔" : payBack ? "चुकाए सेव करें" : "मिले सेव करें"}
        color={colors.success}
        onPress={save}
        disabled={!valid}
        saving={saving}
        testID="save-settle-btn"
      />
    </SheetShell>
  );
}
type JobMode = "now" | "later";

export function AddJobSheet({ visible, onClose, customerId: fixedCustomerId, initialMode = "now" }: { visible: boolean; onClose: () => void; customerId?: string; initialMode?: JobMode }) {
  const choice = useCustomerChoice(visible, fixedCustomerId);
  const [mode, setMode] = useState<JobMode>(initialMode);
  const [title, setTitle] = useState("");
  const money = useMoneyInput();
  const items = useItems((sum) => money.setTotal(sum > 0 ? String(sum) : ""));
  const [payMode, setPayMode] = useState<"cash" | "online">("cash");
  const [govtFee, setGovtFee] = useState("");
  const [feeMode, setFeeMode] = useState<"online" | "cash">("online");
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
      items.reset();
      money.reset("");
      setPayMode("cash");
      setGovtFee("");
      setFeeMode("online");
      setDate(initialMode === "now" ? todayISO() : todayISO(1));
      setRemark("");
      setRemarkDate(todayISO(1));
      setPaidNow("");
      setPaidDate(todayISO());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, initialMode]);

  const entries = useEntries().data ?? [];
  const self = choice.isSelf;
  const itemized = mode === "now" && !self;

  const switchMode = (m: JobMode) => {
    setMode(m);
    setDate(m === "now" ? todayISO() : todayISO(1));
    if (m === "now") {
      money.setTotal(items.total > 0 ? String(items.total) : "");
      if (!items.titled && title.trim()) items.reset([{ title: title.trim(), amount: items.total }]);
    } else if (!title.trim() && items.description) setTitle(items.description);
  };

  const amt = self ? 0 : money.totalNum;
  const advance = choice.existingId ? advanceOf(entries, choice.existingId) : 0;
  const valid = choice.ready && (itemized ? items.titled : !!title.trim());
  const saveLabel = mode === "later" ? "आगे का काम जोड़ें" : self ? "सेव करें" : amt > 0 ? "काम सेव करें" : "मुफ़्त काम सेव करें";

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      const customerId = await choice.resolve();
      const t = itemized ? items.description : title.trim();
      const feeNum = Math.max(parseFloat(govtFee) || 0, 0);
      if (mode === "now") {
        const entryId = recordWork({
          customerId,
          title: t,
          amount: amt,
          received: money.receivedNum,
          date,
          notes: remark.trim(),
          mode: payMode,
          fee: feeNum,
          feeMode,
          items: itemized ? items.saved() : [],
        });
        store.createJob({ customerId, title: t, dueDate: date, status: "done", estimatedAmount: amt, notes: remark.trim(), entryId });
        if (remark.trim()) {
          await store.createJob({ customerId, title: remark.trim(), dueDate: remarkDate, status: "pending", estimatedAmount: 0, notes: `पिछला काम: ${t}` });
        }
      } else {
        const job = store.createJob({ customerId, title: t, dueDate: date, estimatedAmount: amt, notes: remark.trim() });
        const got = Math.max(parseFloat(paidNow) || 0, 0);
        // The advance lands in the drawer/bank on the day it was received, not on the delivery day.
        if (!self && got > 0) {
          store.createEntry({
            customerId,
            type: "payment",
            date: paidDate,
            description: "एडवांस",
            amount: got,
            mode: payMode,
            notes: `${t} के लिए`,
            linkId: job.id,
          });
        }
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
      {itemized ? (
        <ItemsField items={items} label="क्या काम" placeholder="जैसे फॉर्म भरना" addLabel="और काम" />
      ) : (
        <Field label="क्या काम">
          <TextInput style={inputStyle} value={title} onChangeText={setTitle} placeholder={self ? "जैसे पेपर मँगवाना, बिजली बिल भरना" : "जैसे शादी एलबम"} placeholderTextColor={colors.muted} testID="input-job-title" />
        </Field>
      )}
      {self ? null : mode === "now" ? (
        <>
          <MoneyFields money={money} advance={advance} freeAllowed hideTotal />
          {money.receivedNum > 0 ? <PayModeField label="कैसे मिले" value={payMode} onChange={setPayMode} /> : null}
          <FeeField fee={govtFee} setFee={setGovtFee} feeMode={feeMode} setFeeMode={setFeeMode} amount={amt} />
        </>
      ) : (
        <Field label="रकम (₹)">
          <TextInput style={inputStyle} value={money.total} onChangeText={money.setTotal} placeholder="0" placeholderTextColor={colors.muted} keyboardType="numeric" testID="input-job-amount" />
        </Field>
      )}
      {!self && mode === "later" ? (
        <>
          <Field label="एडवांस मिला (₹)">
            <TextInput style={inputStyle} value={paidNow} onChangeText={setPaidNow} placeholder="0" placeholderTextColor={colors.muted} keyboardType="numeric" testID="input-job-paid" />
          </Field>
          {(parseFloat(paidNow) || 0) > 0 ? (
            <>
              <PayModeField label="कैसे मिले" value={payMode} onChange={setPayMode} />
              <DateField label="कब मिले" value={paidDate} onChange={setPaidDate} money testID="input-job-paid-date" />
            </>
          ) : null}
        </>
      ) : null}

      {mode === "now" ? (
        <>
          <DateField label="तारीख" value={date} onChange={setDate} money testID="input-job-date" />
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

export function ShopProfileSheet({ visible, onClose, openShop }: { visible: boolean; onClose: () => void; openShop?: boolean }) {
  const { user, setShop } = useAuth();
  const isPersonal = usePersona().isPersonal && !openShop;
  const [shopName, setShopName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [gst, setGst] = useState("");
  const [upi, setUpi] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setShopName(user?.shop_name ?? "");
      setOwnerName(user?.owner_name || user?.name || "");
      setPhone(user?.shop_phone ?? "");
      setAddress(user?.shop_address ?? "");
      setGst(user?.shop_gst ?? "");
      setUpi(user?.shop_upi ?? "");
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const valid = isPersonal ? !!ownerName.trim() : !!shopName.trim();

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    setError(null);
    try {
      await setShop({
        shop_name: shopName.trim(),
        owner_name: ownerName.trim(),
        shop_phone: phone.trim(),
        shop_address: address.trim(),
        shop_gst: gst.trim().toUpperCase(),
        shop_upi: upi.trim(),
        persona: isPersonal ? "personal" : "business",
      });
      onClose();
    } catch {
      setError("सर्वर पर सेव नहीं हुआ, दोबारा कोशिश करें।");
    } finally { setSaving(false); }
  };

  return (
    <SheetShell visible={visible} onClose={onClose} title={openShop ? "दुकान खाता खोलें" : isPersonal ? "मेरी जानकारी" : "दुकान की जानकारी"} testID="sheet-shop-name">
      {isPersonal ? null : (
        <Field label="दुकान का नाम">
          <TextInput style={inputStyle} value={shopName} onChangeText={setShopName} placeholder="दुकान का नाम" placeholderTextColor={colors.muted} maxLength={60} testID="input-shop-name" />
        </Field>
      )}
      <Field label="आपका नाम">
        <TextInput style={inputStyle} value={ownerName} onChangeText={setOwnerName} placeholder="आपका नाम" placeholderTextColor={colors.muted} maxLength={60} testID="input-owner-name" />
      </Field>
      <Field label="फ़ोन">
        <TextInput style={inputStyle} value={phone} onChangeText={setPhone} keyboardType="phone-pad" maxLength={20} placeholderTextColor={colors.muted} testID="input-shop-phone" />
      </Field>
      <Field label="UPI ID">
        <TextInput style={inputStyle} value={upi} onChangeText={setUpi} autoCapitalize="none" placeholder="9876543210@upi" placeholderTextColor={colors.muted} maxLength={50} testID="input-shop-upi" />
      </Field>
      <Field label="पता (वैकल्पिक)">
        <TextInput style={inputStyle} value={address} onChangeText={setAddress} maxLength={120} placeholderTextColor={colors.muted} testID="input-shop-address" />
      </Field>
      {isPersonal ? null : (
        <Field label="GST नंबर (वैकल्पिक)">
          <TextInput style={inputStyle} value={gst} onChangeText={setGst} autoCapitalize="characters" maxLength={20} placeholderTextColor={colors.muted} testID="input-shop-gst" />
        </Field>
      )}
      {error ? <Text style={[styles.hint, { color: colors.error }]}>{error}</Text> : null}
      <PrimaryButton label="सेव करें" onPress={save} disabled={!valid} saving={saving} testID="save-shop-name-btn" />
    </SheetShell>
  );
}

export function CompleteJobSheet({ job, onClose }: { job: Job | null; onClose: () => void }) {
  const entries = useEntries().data ?? [];
  const jobAdvances = job ? advancesForJob(job, entries) : [];
  const jobAdvance = jobAdvances.reduce((s, p) => s + p.amount, 0);
  const advance = job?.customerId ? advanceOf(entries, job.customerId) : 0;
  const money = useMoneyInput();
  const [payMode, setPayMode] = useState<PayMode>("cash");
  const [fee, setFee] = useState("");
  const [feeMode, setFeeMode] = useState<PayMode>("online");
  const [workDate, setWorkDate] = useState(todayISO());
  const [cashDate, setCashDate] = useState(todayISO());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (job) {
      const est = job.estimatedAmount > 0 ? job.estimatedAmount : 0;
      // The advance for this job already sits in the drawer/bank; only the remainder is new money.
      money.reset(est ? String(est) : "", jobAdvance > 0 ? String(Math.max(est - jobAdvance, 0)) : undefined);
      setPayMode("cash");
      setFee("");
      setFeeMode("online");
      setWorkDate(todayISO());
      setCashDate(todayISO());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job]);

  const amt = job?.customerId ? money.totalNum : 0;
  const got = money.receivedNum;

  const save = async () => {
    if (!job) return;
    setSaving(true);
    try {
      const sameDay = cashDate === workDate;
      const entryId = recordWork({
        customerId: job.customerId,
        title: job.title,
        amount: amt,
        received: sameDay ? got : 0,
        date: workDate,
        notes: "काम पूरा",
        mode: payMode,
        fee: Math.max(parseFloat(fee) || 0, 0),
        feeMode,
      });
      if (entryId) {
        jobAdvances.forEach((p) => store.updateEntry(p.id, { linkId: entryId }));
        if (!sameDay && got > 0) {
          store.createEntry({ customerId: job.customerId, type: "payment", date: cashDate, description: settleDescription(job.title), amount: got, mode: payMode, notes: "", linkId: entryId });
        }
      } else if (got > 0 && job.customerId) {
        store.createEntry({ customerId: job.customerId, type: "payment", date: cashDate, description: ADVANCE, amount: got, mode: payMode, notes: `${job.title} के लिए` });
      }
      store.updateJob(job.id, { status: "done", dueDate: workDate, estimatedAmount: amt, entryId });
      onClose();
    } finally { setSaving(false); }
  };

  return (
    <SheetShell visible={!!job} onClose={onClose} title="काम पूरा करें" testID="sheet-complete-job">
      {job ? <Text style={styles.jobName}>{job.title}</Text> : null}
      {jobAdvance > 0 ? <Text style={[styles.hint, { marginTop: 0, marginBottom: spacing.md, fontWeight: "700", color: colors.success }]}>एडवांस मिल चुका {formatINR(jobAdvance)}</Text> : null}
      {job?.customerId ? (
        <>
          <MoneyFields money={money} advance={advance} receivedLabel="आज मिले (₹)" freeAllowed />
          {got > 0 ? <PayModeField label="कैसे मिले" value={payMode} onChange={setPayMode} /> : null}
          {amt > 0 ? <FeeField fee={fee} setFee={setFee} feeMode={feeMode} setFeeMode={setFeeMode} amount={amt} /> : null}
        </>
      ) : null}
      <DateField label="काम की तारीख" value={workDate} onChange={(d) => { setWorkDate(d); setCashDate(d); }} testID="input-complete-date" />
      {job?.customerId && got > 0 ? <DateField label="पैसे कब मिले" value={cashDate} onChange={setCashDate} money testID="input-complete-cash-date" /> : null}
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
  searchRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  contactBtn: { width: 48, height: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.brandPrimary, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  itemRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  itemNo: { width: 16, fontSize: 13, fontWeight: "700", color: colors.muted, textAlign: "center" },
  itemAmtWrap: { width: 104, flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: spacing.sm, minHeight: 48 },
  itemRupee: { fontSize: 15, fontWeight: "700", color: colors.muted, marginRight: 2 },
  itemAmt: { flex: 1, fontSize: 15, fontWeight: "700", color: colors.onSurface, paddingVertical: spacing.sm },
  itemsFoot: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.sm },
  addItemBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 6, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.brandPrimary, borderStyle: "dashed" },
  addItemText: { fontSize: 13, fontWeight: "700", color: colors.brandPrimary },
  itemsTotal: { fontSize: 15, fontWeight: "800", color: colors.onSurface },
  settleSummary: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md },
});
