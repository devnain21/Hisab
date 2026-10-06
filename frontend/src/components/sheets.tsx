import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Modal,
  View,
  Text,
  StyleSheet,
  Pressable as RNPressable,
  TextInput,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import MaterialIcon from "@react-native-vector-icons/material-design-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { store } from "@/src/lib/store";
import { advanceOf, computeBalance, isVendor, itemsOf, useCustomers, useEntries, useJobs, type Customer, type Entry, type EntryItem, type EntryType, type Job } from "@/src/lib/data";
import { ADVANCE, advancesForJob, buildLedger, jobForWork, linkedPayment, olderAdvances, removeEntryWithLinks, removeJobWithAdvances, settlementsFor, workForJob, workForPayment } from "@/src/lib/records";
import { confirmAction } from "@/src/lib/confirm";
import { colors, spacing, radius } from "@/src/theme";
import { OLD_ENTRY_DAYS, cleanAmountInput, dateOnSave, formatDate, formatINR, isBackdated, isValidISO, parseAmount, roundMoney, todayISO } from "@/src/lib/format";
import { CalendarModal } from "@/src/components/calendar-modal";
import { Pressable } from "@/src/components/tap";
import { useAuth } from "@/src/context/AuthContext";
import { useContactPicker } from "@/src/components/contact-picker-modal";
import { usePersona } from "@/src/lib/persona";
import { getPrefs, savePrefs } from "@/src/lib/prefs";
import { useKeyboardOverlap } from "@/src/lib/keyboard-overlap";
import { useRouter } from "expo-router";
import { EditHistory } from "@/src/components/edit-history";

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

/** Shown while typing new udhaar that would take the customer past their credit limit. */
export function LimitWarning({ customerId, extra }: { customerId?: string; extra: number }) {
  const customers = useCustomers().data ?? [];
  const entries = useEntries().data ?? [];
  const limit = (customerId && customers.find((c) => c.id === customerId)?.creditLimit) || 0;
  if (!limit || !(extra > 0)) return null;
  const after = roundMoney(computeBalance(entries, customerId!) + extra);
  if (after <= limit) return null;
  return (
    <View style={styles.limitBox} testID="credit-limit-warning">
      <MaterialIcon name="alert-octagon-outline" size={18} color={colors.error} />
      <Text style={styles.limitText}>
        उधार सीमा {formatINR(limit)} पार हो जाएगी — कुल बाकी {formatINR(after)} होगा
      </Text>
    </View>
  );
}

/** Optional fields folded away so the sheet opens with only what every entry needs. */
export function MoreInfo({ open: forceOpen, hint = "विवरण, नोट", children, testID }: { open?: boolean; hint?: string; children: React.ReactNode; testID?: string }) {
  const [open, setOpen] = useState(!!forceOpen);
  useEffect(() => {
    if (forceOpen) setOpen(true);
  }, [forceOpen]);
  return (
    <View style={{ marginBottom: spacing.md }}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        style={styles.moreInfo}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        testID={testID}
      >
        <MaterialIcon name={open ? "chevron-up" : "chevron-down"} size={20} color={colors.brandPrimary} />
        <Text style={styles.moreInfoText}>और जानकारी</Text>
        {!open ? <Text style={styles.moreInfoHint} numberOfLines={1}>{hint}</Text> : null}
      </Pressable>
      {open ? <View style={{ marginTop: spacing.sm }}>{children}</View> : null}
    </View>
  );
}

export function Chip({ label, active, onPress, icon, testID, tone }: { label: string; active: boolean; onPress: () => void; icon?: string; testID?: string; tone?: string }) {
  const bg = active ? tone ?? colors.brandPrimary : colors.surfaceSecondary;
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && { backgroundColor: bg, borderColor: bg }]} testID={testID}>
      {icon ? <MaterialIcon name={icon as any} size={16} color={active ? colors.onBrandPrimary : colors.onSurface} /> : null}
      <Text style={[styles.chipText, active && { color: colors.onBrandPrimary }]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

/**
 * Day chips, a calendar and a typed date. Only a real calendar day reaches `onChange`, so a
 * half-typed or impossible date can never be saved; the box shows what is wrong instead.
 */
export function DateField({
  label,
  value,
  onChange,
  future,
  money,
  createdAt,
  testID,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  future?: boolean;
  money?: boolean;
  /** When the row was first typed; a new row counts from now. */
  createdAt?: string;
  testID?: string;
}) {
  const [calendar, setCalendar] = useState(false);
  const cashLabel = usePersona().labels.cash;
  const today = todayISO();
  const old = money && isValidISO(value) && isBackdated(value, createdAt ?? new Date().toISOString());
  const ahead = !future && isValidISO(value) && value > today;
  const presets = future
    ? [{ label: "आज", d: today }, { label: "कल", d: todayISO(1) }, { label: "परसों", d: todayISO(2) }, { label: "1 हफ़्ता", d: todayISO(7) }]
    : [{ label: "आज", d: today }, { label: "कल (बीता)", d: todayISO(-1) }];
  const onPreset = presets.some((p) => p.d === value);
  return (
    <Field label={label}>
      <View style={styles.chipRow} testID={testID}>
        {presets.map((p) => (
          <Chip key={p.label} label={p.label} active={value === p.d} onPress={() => onChange(p.d)} />
        ))}
        <Chip
          label={onPreset || !isValidISO(value) ? "दूसरी तारीख" : formatDate(value)}
          icon="calendar-month-outline"
          active={!onPreset}
          onPress={() => setCalendar(true)}
          testID={testID ? `${testID}-cal` : undefined}
        />
      </View>
      {ahead ? (
        <Text style={[styles.hint, { color: colors.warning, marginTop: 6 }]}>आगे की तारीख है — {formatDate(value)}</Text>
      ) : old ? (
        <Text style={[styles.hint, { color: colors.warning, marginTop: 6 }]}>{OLD_ENTRY_DAYS} दिन से पुरानी तारीख — खाते में जुड़ेगा, पर उस दिन का लेन-देन {cashLabel} / बैंक में नहीं गिना जाएगा</Text>
      ) : null}
      <CalendarModal visible={calendar} value={isValidISO(value) ? value : today} onPick={onChange} onClose={() => setCalendar(false)} max={future ? undefined : today} />
    </Field>
  );
}

const NEW_CUSTOMER = "__new__";
const SELF = "__self__";

const last10 = (p: string) => p.replace(/\D/g, "").slice(-10);
/** Another person in the list who already has this phone number. */
function samePhone(list: Customer[], phone: string, exceptId?: string): Customer | undefined {
  const d = last10(phone);
  if (d.length < 10) return undefined;
  return list.find((c) => c.id !== exceptId && last10(c.phone || "") === d);
}

// Lets a sheet pick an existing customer (searchable, most recent first), create one from the
// typed name, or — for jobs — mark it as the shopkeeper's own task.
export function useCustomerChoice(visible: boolean, fixedCustomerId?: string, role: "customer" | "vendor" = "customer") {
  const { isPersonal } = usePersona();
  const allCustomers = useCustomers().data ?? [];
  const entries = useEntries().data ?? [];
  const [customerId, setCustomerId] = useState("");
  const [query, setQuery] = useState("");
  const [newPhone, setNewPhone] = useState("");

  // Shop vendors are never offered where a customer is picked, and the other way round.
  const customers = useMemo(() => {
    return allCustomers.filter((c) => (isPersonal ? c.persona === "personal" : c.persona !== "personal" && isVendor(c) === (role === "vendor")));
  }, [allCustomers, isPersonal, role]);

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
      ...(!isPersonal && role === "vendor" ? { role: "vendor" as const } : {}),
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
  const dupe = isNew ? samePhone(recent, choice.newPhone) : undefined;
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
      {isNew && dupe ? (
        <Pressable style={styles.dupeRow} onPress={() => { setCustomerId(dupe.id); setQuery(""); }} testID={`${testPrefix}-dupe`}>
          <MaterialIcon name="alert-circle-outline" size={16} color={colors.warning} />
          <Text style={styles.dupeText}>यह नंबर पहले से &quot;{dupe.name}&quot; के नाम है — उन्हें चुनें</Text>
        </Pressable>
      ) : null}
      {contacts.modal}
    </Field>
  );
}

/**
 * "कुल रकम" + "अभी मिले". Received follows the total until the user edits it, so the common
 * cash case is just typing the amount.
 */
function useMoneyInput(
  /** Leave "received" empty until the user says, so forgetting a tap can't book udhaar as a cash sale. */
  ask = false,
) {
  const [total, setTotalRaw] = useState("");
  const [received, setReceivedRaw] = useState("");
  const [touched, setTouched] = useState(false);
  // Already-received money (e.g. a job advance) that the "received now" default leaves out.
  const [less, setLess] = useState(0);
  const minus = (t: string, by: number) => (t.trim() ? String(Math.max(roundMoney(parseAmount(t) - by), 0)) : "");
  const follow = (t: string) => (less ? minus(t, less) : t);
  const totalNum = parseAmount(total);
  return {
    total,
    received,
    totalNum,
    receivedNum: parseAmount(received),
    /** Paying in full now: the total less what was already received. */
    fullNow: Math.max(roundMoney(totalNum - less), 0),
    /** The user has said how much came in (always true outside ask mode). */
    answered: !ask || received.trim() !== "",
    setTotal: (t: string) => {
      setTotalRaw(t);
      if (!touched && !ask) setReceivedRaw(follow(t));
    },
    setReceived: (r: string) => {
      setTouched(true);
      setReceivedRaw(r);
    },
    reset: (t: string, r?: string, alreadyGot = 0) => {
      setLess(alreadyGot);
      setTotalRaw(t);
      setTouched(r !== undefined);
      if (r !== undefined) setReceivedRaw(r);
      else if (ask) setReceivedRaw("");
      else setReceivedRaw(alreadyGot ? minus(t, alreadyGot) : t);
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
                {r > t ? `कुल ${formatINR(t)} से ज़्यादा नहीं` : r >= t ? "पूरे चुकाए" : `${formatINR(t - r)} देने हैं`}
              </Text>
            </View>
          </>
        ) : null
      ) : null}
      {!purchase && t > 0 ? (
        <Field label={receivedLabel}>
          <View style={[styles.chipRow, { marginBottom: spacing.sm }]}>
            <Chip label={`पूरे मिले ${formatINR(money.fullNow)}`} active={money.received !== "" && r === money.fullNow} onPress={() => money.setReceived(String(money.fullNow))} tone={colors.success} testID="money-full" />
            {advance > 0 ? (
              <Chip label={`एडवांस काटकर ${formatINR(Math.max(t - advance, 0))}`} active={money.received !== "" && r === Math.max(t - advance, 0) && r !== money.fullNow} onPress={() => money.setReceived(String(Math.max(t - advance, 0)))} tone={colors.success} testID="money-advance" />
            ) : null}
            <Chip label="उधार · कुछ नहीं मिला" active={money.received !== "" && r === 0} onPress={() => money.setReceived("0")} tone={colors.error} testID="money-none" />
          </View>
          <TextInput style={inputStyle} value={money.received} onChangeText={money.setReceived} placeholder={money.answered ? "0" : "कितने मिले? ऊपर चुनें या लिखें"} placeholderTextColor={colors.muted} keyboardType="numeric" testID="input-money-received" />
        </Field>
      ) : null}
      {purchase ? null : !money.answered && t > 0 ? (
        <View style={[styles.resultBox, { borderColor: colors.warning }]} testID="money-result">
          <Text style={[styles.resultText, { color: colors.warning }]}>पैसे मिले या उधार — एक चुनें</Text>
        </View>
      ) : (
        <MoneyResult total={t} received={r} advance={advance} freeAllowed={freeAllowed} />
      )}
    </>
  );
}

type ItemRow = { key: number; title: string; amount: string };
let itemSeq = 0;
const itemRow = (title = "", amount = ""): ItemRow => ({ key: ++itemSeq, title, amount });
const rowAmount = (r: ItemRow) => parseAmount(r.amount);
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
    text = received > total ? `पूरे मिले · ${formatINR(received - total)} एडवांस रहेगा` : "पूरे पैसे मिले";
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

/** Part cash, part online in one go. `cash` is typed; online is the rest of the total. */
export function useSplitPay() {
  const [on, setOn] = useState(false);
  const [cash, setCash] = useState("");
  const parts = (total: number) => {
    const c = Math.min(Math.max(parseAmount(cash), 0), total);
    return { cash: roundMoney(c), online: roundMoney(total - c) };
  };
  return { on, setOn, cash, setCash, parts, reset: () => { setOn(false); setCash(""); } };
}
type SplitPay = ReturnType<typeof useSplitPay>;
/** Splits are only real when both parts are above zero. */
const splitOf = (s: SplitPay, total: number) => {
  if (!s.on) return null;
  const p = s.parts(total);
  return p.cash > 0 && p.online > 0 ? p : null;
};

function PayModeField({ label, value, onChange, cashLabel = "नकद", onlineLabel = "ऑनलाइन", split, total = 0 }: { label: string; value: PayMode; onChange: (m: PayMode) => void; cashLabel?: string; onlineLabel?: string; split?: SplitPay; total?: number }) {
  const both = !!split?.on;
  const pick = (m: PayMode) => {
    split?.setOn(false);
    onChange(m);
  };
  const p = split && both ? split.parts(total) : null;
  return (
    <Field label={label}>
      <View style={[styles.segment, { marginBottom: 0 }]}>
        <Pressable onPress={() => pick("cash")} style={[styles.segmentBtn, !both && value === "cash" && { backgroundColor: colors.success }]} testID="paymode-cash">
          <MaterialIcon name="cash" size={16} color={!both && value === "cash" ? "#fff" : colors.onSurface} />
          <Text style={[styles.segmentText, !both && value === "cash" && { color: "#fff" }]}>{cashLabel}</Text>
        </Pressable>
        <Pressable onPress={() => pick("online")} style={[styles.segmentBtn, !both && value === "online" && { backgroundColor: colors.info }]} testID="paymode-online">
          <MaterialIcon name="cellphone" size={16} color={!both && value === "online" ? "#fff" : colors.onSurface} />
          <Text style={[styles.segmentText, !both && value === "online" && { color: "#fff" }]}>{onlineLabel}</Text>
        </Pressable>
        {split && total > 0 ? (
          <Pressable onPress={() => split.setOn(true)} style={[styles.segmentBtn, both && { backgroundColor: colors.brandPrimary }]} testID="paymode-both">
            <MaterialIcon name="call-split" size={16} color={both ? "#fff" : colors.onSurface} />
            <Text style={[styles.segmentText, both && { color: "#fff" }]}>दोनों</Text>
          </Pressable>
        ) : null}
      </View>
      {p ? (
        <View style={styles.splitBox}>
          <View style={{ flex: 1 }}>
            <Text style={styles.splitLabel}>नकद (₹)</Text>
            <TextInput style={inputStyle} value={split!.cash} onChangeText={split!.setCash} placeholder="0" placeholderTextColor={colors.muted} keyboardType="numeric" testID="input-split-cash" />
          </View>
          <MaterialIcon name="plus" size={18} color={colors.muted} style={{ marginTop: 26 }} />
          <View style={{ flex: 1 }}>
            <Text style={styles.splitLabel}>ऑनलाइन (₹)</Text>
            <View style={[inputStyle, { justifyContent: "center", backgroundColor: colors.surfaceSecondary }]}>
              <Text style={{ fontSize: 16, fontWeight: "700", color: colors.info }}>{formatINR(p.online)}</Text>
            </View>
          </View>
        </View>
      ) : null}
      {p && (p.cash <= 0 || p.online <= 0) ? <Text style={styles.hint}>नकद हिस्सा {formatINR(total)} से कम लिखें, बाकी ऑनलाइन माना जाएगा</Text> : null}
    </Field>
  );
}

/** Portal fee / cost paid by the shop for this work. Never printed on the customer's bill. */
function FeeField({ fee, setFee, feeMode, setFeeMode, amount }: { fee: string; setFee: (v: string) => void; feeMode: PayMode; setFeeMode: (m: PayMode) => void; amount: number }) {
  const n = parseAmount(fee);
  const cashFrom = usePersona().isPersonal ? "कैश से" : "गल्ले से";
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
      {n > 0 ? <PayModeField label="फीस कहाँ से दी" value={feeMode} onChange={setFeeMode} cashLabel={cashFrom} onlineLabel="बैंक से" /> : null}
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
  split = null,
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
}): string {
  // Free work is still booked when the shop paid a fee for it, so the cost shows up.
  if (amount <= 0 && !(fee > 0 && customerId)) return "";
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

/** One payment row, or two (cash + online) when it was split. */
function createPaid(base: Omit<Entry, "id" | "createdAt" | "mode" | "amount">, amount: number, mode: PayMode, split: { cash: number; online: number } | null): string {
  if (!split) return store.createEntry({ ...base, amount, mode }).id;
  const first = store.createEntry({ ...base, amount: split.cash, mode: "cash" });
  store.createEntry({ ...base, amount: split.online, mode: "online" });
  return first.id;
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

export function AddCustomerSheet({ visible, onClose, initial, onDelete, role: roleProp }: { visible: boolean; onClose: () => void; initial?: any; onDelete?: () => void; role?: "customer" | "vendor" }) {
  const { isPersonal } = usePersona();
  const [role, setRole] = useState<"customer" | "vendor">("customer");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [limit, setLimit] = useState("");
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
      setLimit(initial?.creditLimit ? String(initial.creditLimit) : "");
      // Rows saved before personas existed belong to the shop.
      setTargetPersona(initial ? (initial.persona === "personal" ? "personal" : "business") : isPersonal ? "personal" : "business");
      setRole(initial ? (isVendor(initial) ? "vendor" : "customer") : roleProp ?? "customer");
    }
    // Only when the sheet opens for a record, not when a sync hands over a fresh copy of it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, initial?.id, isPersonal]);

  const allCustomers = useCustomers().data ?? [];
  const asVendor = targetPersona !== "personal" && role === "vendor";
  const sameBook = allCustomers.filter((c) => (targetPersona === "personal" ? c.persona === "personal" : c.persona !== "personal"));
  const phoneDupe = samePhone(sameBook, phone, initial?.id);
  const nameDupe = !!name.trim() && sameBook.some((c) => c.id !== initial?.id && c.name.trim().toLowerCase() === name.trim().toLowerCase());

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
        creditLimit: targetPersona === "personal" || asVendor ? 0 : parseAmount(limit) || 0,
        ...(targetPersona === "personal" ? {} : { role: asVendor ? ("vendor" as const) : ("customer" as const) }),
      };
      if (initial?.id) await store.updateCustomer(initial.id, body);
      else await store.createCustomer(body);
      onClose();
    } finally { setSaving(false); }
  };

  return (
    <SheetShell visible={visible} onClose={onClose} title={initial ? "विवरण बदलें" : targetPersona === "personal" ? "नया व्यक्ति" : asVendor ? "नया Vendor" : "नया ग्राहक"} testID="sheet-customer">
      {targetPersona !== "personal" ? (
        <View style={styles.segment}>
          {(["customer", "vendor"] as const).map((r) => (
            <Pressable key={r} onPress={() => setRole(r)} style={[styles.segmentBtn, role === r && { backgroundColor: colors.brandPrimary }]} testID={`cust-role-${r}`}>
              <MaterialIcon name={r === "vendor" ? "truck-outline" : "account-outline"} size={16} color={role === r ? "#fff" : colors.onSurface} />
              <Text style={[styles.segmentText, role === r && { color: "#fff" }]}>{r === "vendor" ? "Vendor / कारीगर" : "ग्राहक"}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
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
      {nameDupe ? (
        <View style={[styles.dupeRow, { marginTop: -spacing.sm, marginBottom: spacing.sm }]}>
          <MaterialIcon name="alert-circle-outline" size={16} color={colors.warning} />
          <Text style={styles.dupeText}>इस नाम से पहले से एक खाता है</Text>
        </View>
      ) : null}
      <Field label="फ़ोन (वैकल्पिक)">
        <TextInput style={inputStyle} value={phone} onChangeText={setPhone} placeholder="10 अंक" placeholderTextColor={colors.muted} keyboardType="phone-pad" testID="input-cust-phone" />
        {phoneDupe ? (
          <View style={styles.dupeRow}>
            <MaterialIcon name="alert-circle-outline" size={16} color={colors.warning} />
            <Text style={styles.dupeText}>यह नंबर पहले से &quot;{phoneDupe.name}&quot; के नाम है</Text>
          </View>
        ) : null}
      </Field>
      <MoreInfo
        open={!!address || !!notes || !!limit}
        hint={targetPersona === "personal" || asVendor ? "पता, नोट" : "पता, नोट, उधार सीमा"}
        testID="cust-more-info"
      >
        <Field label="पता">
          <TextInput style={inputStyle} value={address} onChangeText={setAddress} placeholder="मोहल्ला, गली या गांव" placeholderTextColor={colors.muted} testID="input-cust-address" />
        </Field>
        <Field label="नोट">
          <TextInput style={[inputStyle, { minHeight: 72 }]} value={notes} onChangeText={setNotes} multiline placeholderTextColor={colors.muted} testID="input-cust-notes" />
        </Field>
        {targetPersona === "personal" || asVendor ? null : (
          <Field label="उधार सीमा (₹)">
            <TextInput style={inputStyle} value={limit} onChangeText={(v) => setLimit(cleanAmountInput(v))} placeholder="खाली = कोई सीमा नहीं" placeholderTextColor={colors.muted} keyboardType="numeric" testID="input-cust-limit" />
            <Text style={styles.hint}>इससे ज़्यादा उधार होने पर एंट्री लिखते समय चेतावनी दिखेगी</Text>
          </Field>
        )}
      </MoreInfo>
      <PrimaryButton label={initial ? "बदलाव सेव करें" : targetPersona === "personal" ? "व्यक्ति जोड़ें" : asVendor ? "Vendor जोड़ें" : "ग्राहक जोड़ें"} onPress={save} disabled={!name.trim()} saving={saving} testID="save-customer-btn" />
      {initial?.id && onDelete ? (
        <DangerLink
          label="यह खाता हटाएँ"
          testID="delete-customer-link"
          onPress={() => confirmAction(`${name || "यह खाता"} हटाएँ?`, `इनकी सारी एंट्री${targetPersona === "personal" ? "" : " और काम"} भी हटेंगे, और पुराने दिनों का ${targetPersona === "personal" ? "कैश" : "गल्ला"} / बैंक हिसाब बदल जाएगा। गलती से हटाया तो प्रोफ़ाइल › कचरा पेटी से पूरा खाता वापस ला सकते हैं।`, "हटा दें", () => { onDelete(); onClose(); })}
        />
      ) : null}
      {initial?.id ? <EditHistory coll="customers" id={initial.id} /> : null}
      {contacts.modal}
    </SheetShell>
  );
}

const ENTRY_UI: Record<EntryType, { title: string; short: string; icon: string; color: string; placeholder: string }> = {
  work: { title: "काम", short: "काम", icon: "briefcase-outline", color: colors.error, placeholder: "जैसे पासपोर्ट फोटो 8 प्रति" },
  payment: { title: "पैसे मिले", short: "मिले", icon: "arrow-bottom-left", color: colors.success, placeholder: "जैसे पुराना हिसाब, UPI" },
  given: { title: "पैसे दिए", short: "दिए", icon: "arrow-top-right", color: colors.error, placeholder: "जैसे घर के लिए दिए" },
  purchase: { title: "सामान / सेवा ली", short: "सामान", icon: "cart-outline", color: colors.warning, placeholder: "जैसे राशन, दवाई, मरम्मत" },
  aeps: { title: "काउंटर सेवा बाकी", short: "AEPS", icon: "fingerprint", color: colors.error, placeholder: "" },
};

const PICKER_LABEL: Record<EntryType, string> = { work: "ग्राहक", payment: "किससे मिले", given: "किसको दिए", purchase: "किससे ली", aeps: "ग्राहक" };

/** Plain khata row. With `kinds`, the sheet lets you switch between them (e.g. मिले / दिए / सामान). */
export function AddEntrySheet({
  visible,
  type,
  kinds,
  onClose,
  customerId: fixedCustomerId,
  initial,
  vendor: vendorProp,
}: {
  visible: boolean;
  type: EntryType;
  kinds?: EntryType[];
  onClose: () => void;
  customerId?: string;
  initial?: Entry;
  /** Shop vendor order: purchase from a vendor with a promised date and terms. */
  vendor?: boolean;
}) {
  const allCustomers = useCustomers().data ?? [];
  const vendor = !!vendorProp || (initial?.type === "purchase" && isVendor(allCustomers.find((c) => c.id === initial.customerId)));
  const choice = useCustomerChoice(visible, fixedCustomerId ?? initial?.customerId, vendor ? "vendor" : "customer");
  const [kind, setKind] = useState<EntryType>(type);
  const [dueDate, setDueDate] = useState(todayISO(3));
  const [delivered, setDelivered] = useState(false);
  const [terms, setTerms] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const money = useMoneyInput();
  const items = useItems((sum) => money.setTotal(sum > 0 ? String(sum) : ""));
  const [payMode, setPayMode] = useState<"cash" | "online">("cash");
  const split = useSplitPay();
  const [date, setDate] = useState(todayISO());
  const [openedOn, setOpenedOn] = useState(todayISO());
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [remind, setRemind] = useState(false);
  const [returnDate, setReturnDate] = useState(todayISO(7));
  const isPersonalBook = usePersona().isPersonal;

  useEffect(() => {
    if (!visible) return;
    split.reset();
    setRemind(false);
    setReturnDate(todayISO(7));
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
    // Rows saved before the mode field existed were cash; the default only applies to new entries.
    setPayMode(initial ? (initial.mode ?? "cash") : getPrefs().defaultMode);
    setDate(initial?.date ?? todayISO());
    setOpenedOn(todayISO());
    setNotes(initial?.notes ?? "");
    setDueDate(initial?.dueDate || todayISO(3));
    setDelivered(initial ? initial.status !== "ordered" : false);
    setTerms(initial ? initial.terms ?? "" : getPrefs().vendorTerms);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, initial, type]);

  const entries = useEntries().data ?? [];
  const later = initial && (initial.type === "purchase" || (initial.type === "given" && !initial.linkId)) ? settlementsFor(initial, entries) : [];
  const personId = initial ? "" : choice.existingId;
  const due = personId ? computeBalance(entries, personId) : 0;
  const ui = ENTRY_UI[kind];
  const isPurchase = kind === "purchase";
  const amt = isPurchase ? money.totalNum : parseAmount(amount);
  const paidNow = isPurchase ? money.receivedNum : 0;
  const needsDescription = kind === "work";
  const fullChip = kind === "payment" && due > 0 ? due : kind === "given" && due < 0 ? -due : 0;
  // Paid back later against this purchase; the amount can't go below it or the extra has no row to show on.
  const repaidLater = isPurchase ? roundMoney(later.reduce((s, p) => s + p.amount, 0)) : 0;
  const overRepaid = isPurchase && amt > 0 && paidNow + repaidLater > amt + 0.005;
  const filled = isPurchase ? items.titled && paidNow <= amt && !overRepaid : !needsDescription || !!description.trim();
  const valid = (initial ? true : choice.ready) && filled && isFinite(amt) && amt > 0;
  // Personal: lent money, or goods still to be paid for, can carry a "by when" that lands in मेरे काम.
  const canRemind = !initial && isPersonalBook && (kind === "given" || (isPurchase && amt - paidNow > 0));

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      const day = initial ? date : dateOnSave(date, openedOn);
      const order = vendor ? { dueDate, status: delivered ? ("delivered" as const) : ("ordered" as const), terms: terms.trim() } : {};
      if (vendor && terms.trim() !== getPrefs().vendorTerms) void savePrefs({ vendorTerms: terms.trim() });
      const body = isPurchase
        ? { type: kind, date: day, description: items.description, amount: amt, paid: paidNow, mode: payMode, notes: notes.trim(), items: items.saved(), ...order }
        : { type: kind, date: day, description: description.trim(), amount: amt, mode: payMode, notes: notes.trim() };
      if (initial) await store.updateEntry(initial.id, body);
      else {
        const customerId = await choice.resolve();
        const parts = splitOf(split, isPurchase ? paidNow : amt);
        let rowId: string;
        if (!parts) rowId = store.createEntry({ customerId, ...body }).id;
        else if (isPurchase) {
          // Paid for goods both ways: cash on the purchase row, the online part as a same-day payback.
          rowId = store.createEntry({ customerId, ...body, paid: parts.cash, mode: "cash" }).id;
          store.createEntry({ customerId, type: "given", date: day, description: settleDescription(items.description), amount: parts.online, mode: "online", notes: "", linkId: rowId });
        } else rowId = createPaid({ customerId, type: kind, date: day, description: description.trim(), notes: notes.trim() }, amt, payMode, parts);
        if (canRemind && remind && returnDate > day) {
          const who = choice.recent.find((c) => c.id === customerId)?.name ?? choice.query.trim();
          const title = kind === "given" ? `${who} से ${formatINR(amt)} वापस लेने हैं` : `${who} को ${formatINR(amt - paidNow)} चुकाने हैं`;
          store.createJob({ customerId: "", title, dueDate: returnDate, status: "pending", estimatedAmount: 0, notes: description.trim() || items.description, entryId: rowId, persona: "personal" });
        }
      }
      onClose();
    } finally { setSaving(false); }
  };

  return (
    <SheetShell visible={visible} onClose={onClose} title={vendor ? (initial ? "Vendor ऑर्डर बदलें" : "नया Vendor ऑर्डर") : initial ? "एंट्री बदलें" : kinds ? "लेन-देन" : ui.title} testID={`sheet-entry-${vendor ? "vendor" : kind}`}>
      {kinds && !initial && !vendor ? (
        <View style={styles.segment}>
          {kinds.map((k) => (
            <Pressable key={k} onPress={() => setKind(k)} style={[styles.segmentBtn, kind === k && { backgroundColor: ENTRY_UI[k].color }]} testID={`entry-kind-${k}`}>
              <MaterialIcon name={ENTRY_UI[k].icon as any} size={16} color={kind === k ? "#fff" : colors.onSurface} />
              <Text style={[styles.segmentText, kind === k && { color: "#fff" }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{ENTRY_UI[k].short}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {isPurchase && !initial && !fixedCustomerId ? <CustomerPicker choice={choice} label={vendor ? "Vendor / कारीगर" : PICKER_LABEL[kind]} testPrefix="chip-cust" /> : null}
      {isPurchase ? (
        <>
          <ItemsField items={items} label={vendor ? "काम / सामान क्या" : "क्या लिया"} placeholder={vendor ? "जैसे फ्रेम 12×18 · 20 पीस" : ui.placeholder} addLabel="और जोड़ें" />
          <MoneyFields money={money} receivedLabel={vendor ? "एडवांस दिया (₹)" : "अभी कितने दिए (₹)"} hideTotal purchase />
          {vendor ? (
            <>
              <DateField label="कब तक होगा" value={dueDate} onChange={setDueDate} future testID="input-vendor-due" />
              {initial ? (
                <View style={{ marginBottom: spacing.md }}>
                  <Chip label={delivered ? "डिलीवर हो गया" : "अभी बाकी है"} icon={delivered ? "check-circle" : "progress-clock"} active={delivered} onPress={() => setDelivered(!delivered)} tone={colors.success} testID="vendor-delivered" />
                </View>
              ) : null}
            </>
          ) : null}
          {overRepaid ? (
            <Text style={[styles.hint, { color: colors.error }]}>
              कुल {formatINR(paidNow + repaidLater)} चुका चुके हैं — रकम इससे कम नहीं हो सकती। ज़्यादा दिए पैसे नीचे से हटाएँ।
            </Text>
          ) : null}
          {paidNow > 0 ? <PayModeField label="कैसे दिए" value={payMode} onChange={setPayMode} split={initial ? undefined : split} total={paidNow} /> : null}
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
                  ? `हिसाब बराबर · ${formatINR(amt - fullChip)} ${kind === "payment" ? "एडवांस" : "ज़्यादा दिए"}`
                  : amt === fullChip
                  ? "हिसाब बराबर"
                  : `${formatINR(fullChip - amt)} अभी भी ${kind === "payment" ? "लेने" : "देने"} हैं`}
              </Text>
            ) : null}
          </Field>
          {!initial && !fixedCustomerId && <CustomerPicker choice={choice} label={PICKER_LABEL[kind]} testPrefix="chip-cust" />}
          {kind !== "work" ? (
            <PayModeField label={kind === "payment" ? "कैसे मिले" : "कैसे दिए"} value={payMode} onChange={setPayMode} split={initial ? undefined : split} total={amt} />
          ) : null}
          {needsDescription ? (
            <Field label="विवरण">
              <TextInput style={inputStyle} value={description} onChangeText={setDescription} placeholder={ui.placeholder} placeholderTextColor={colors.muted} testID="input-entry-desc" />
            </Field>
          ) : null}
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
      <DateField label="तारीख" value={date} onChange={setDate} money createdAt={initial?.createdAt} testID="input-entry-date" />
      {canRemind ? (
        <View style={{ marginBottom: spacing.md }}>
          <Chip
            label={kind === "given" ? "वापसी की तारीख याद दिलाएँ" : "चुकाने की तारीख याद दिलाएँ"}
            icon="bell-ring-outline"
            active={remind}
            onPress={() => setRemind(!remind)}
            tone={colors.info}
            testID="entry-remind"
          />
          {remind ? (
            <View style={{ marginTop: spacing.sm }}>
              <DateField label={kind === "given" ? "कब तक वापस मिलेंगे" : "कब तक चुकाने हैं"} value={returnDate} onChange={setReturnDate} future testID="input-entry-return" />
              <Text style={styles.hint}>उस दिन “मेरे काम” में याद दिलाएगा</Text>
            </View>
          ) : null}
        </View>
      ) : null}
      <MoreInfo open={!!notes || (!needsDescription && !isPurchase && !!description)} hint={!needsDescription && !isPurchase ? "किस लिए, नोट" : "नोट"} testID="entry-more-info">
        {!needsDescription && !isPurchase ? (
          <Field label="किस लिए">
            <TextInput style={inputStyle} value={description} onChangeText={setDescription} placeholder={ui.placeholder} placeholderTextColor={colors.muted} testID="input-entry-desc" />
          </Field>
        ) : null}
        <Field label="नोट">
          <TextInput style={inputStyle} value={notes} onChangeText={setNotes} placeholderTextColor={colors.muted} testID="input-entry-notes" />
        </Field>
        {vendor ? (
          <Field label="शर्तें (Work Order पर छपेंगी)">
            <TextInput style={[inputStyle, { minHeight: 72, textAlignVertical: "top" }]} value={terms} onChangeText={setTerms} multiline placeholder="जैसे बाकी भुगतान डिलीवरी पर · सैंपल जैसी क्वालिटी" placeholderTextColor={colors.muted} testID="input-vendor-terms" />
          </Field>
        ) : null}
      </MoreInfo>
      {kind === "work" || kind === "given" ? <LimitWarning customerId={personId} extra={amt} /> : null}
      <PrimaryButton
        label={initial ? "बदलाव सेव करें" : vendor ? "ऑर्डर सेव करें" : `${ui.title} — सेव करें`}
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
  return (
    <>
      <DangerLink label="यह एंट्री हटाएँ" onPress={remove} testID="delete-entry-link" />
      <EditHistory coll="entries" id={entry.id} />
    </>
  );
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
  const sameDayExtras = entry ? entries.filter((e) => e.type === "payment" && e.linkId === entry.id && e.date === entry.date && e.description === ADVANCE && e.notes.endsWith("के साथ")) : [];
  const link = entry ? linkedPayment(entry, entries) : undefined;
  // Only an old unlinked two-row record is folded into `paid`. A linked "पैसे मिले" written later
  // the same day is its own row (own mode, own notes) and must stay as it is.
  const legacyLink = entry && link && !link.linkId && !(entry.paid ?? 0) && !sameDayExtras.some((e) => e.id === link.id) ? link : undefined;
  const rowMode: PayMode = legacyLink?.mode ?? entry?.mode ?? "cash";
  // The form has one pay mode; an advance taken the other way (online part of a split) stays its own row.
  const extras = sameDayExtras.filter((e) => (e.mode ?? "cash") === rowMode);
  const extraSum = extras.reduce((s, e) => s + e.amount, 0);
  // Every other payment booked against this work, shown so it can be seen / removed here.
  const later = entry ? settlementsFor(entry, entries).filter((p) => p.id !== legacyLink?.id && !extras.some((e) => e.id === p.id)) : [];

  useEffect(() => {
    if (!entry) return;
    items.reset(itemsOf(entry));
    money.reset(String(entry.amount), String(((entry.paid ?? 0) || (legacyLink?.amount ?? 0)) + extraSum));
    setPayMode(rowMode);
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
  const valid = items.titled && (amt > 0 || parseAmount(govtFee) > 0);

  const save = () => {
    if (!entry || !valid) return;
    setSaving(true);
    try {
      const t = items.description;
      const taken = money.receivedNum;
      const feeNum = parseAmount(govtFee);
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
      // Money taken on the work day (online part of a split, other-mode advance) moves with the work's date.
      if (date !== entry.date) later.filter((p) => p.date === entry.date && p.linkId === entry.id).forEach((p) => store.updateEntry(p.id, { date }));
      bookAdvance(entry.customerId, taken - amt, date, t, entry.id, payMode);
      // Old two-row cash records: the same-day jama is now carried by `paid`.
      if (legacyLink) store.deleteEntry(legacyLink.id);
      if (job) {
        // The job card keeps its own notes (size, copies…); the work row's notes are separate.
        store.updateJob(job.id, { title: t, dueDate: date, estimatedAmount: amt, entryId: entry.id });
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
        <Field label="अलग से मिले पैसे">
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
      <DateField label="तारीख" value={date} onChange={setDate} money createdAt={entry?.createdAt} testID="input-edit-work-date" />
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
      store.updateJob(job.id, { title: title.trim(), estimatedAmount: parseAmount(amount), dueDate: date, notes: notes.trim(), status });
      onClose();
    } finally { setSaving(false); }
  };

  const remove = () => {
    if (!job) return;
    const all = advancesForJob(job, entries).reduce((s, e) => s + e.amount, 0);
    const kept = olderAdvances(job, entries).reduce((s, e) => s + e.amount, 0);
    const gone = all - kept;
    const lines = [job.title];
    if (gone > 0) lines.push(`आज का एडवांस ${formatINR(gone)} भी हटेगा।`);
    if (kept > 0) lines.push(`पहले लिया एडवांस ${formatINR(kept)} खाते में जमा रहेगा (लौटाएँ तो "पैसे दिए" लिखें)।`);
    confirmAction("काम हटाएँ?", lines.join("\n"), "हटा दें", () => {
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
      {job ? <EditHistory coll="jobs" id={job.id} /> : null}
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
  const [openedOn, setOpenedOn] = useState(todayISO());
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const status = work ? buildLedger(entries.filter((e) => e.customerId === work.customerId)).work.get(work.id) : undefined;
  const remaining = status?.remaining ?? 0;
  const payBack = work?.type === "purchase";
  const word = payBack ? { done: "चुकाए", left: "देने हैं", how: "कैसे दिए", when: "कब दिए", much: "कितने दिए (₹)" } : { done: "मिल चुके", left: "लेने हैं", how: "कैसे मिले", when: "कब मिले", much: "कितने मिले (₹)" };

  const split = useSplitPay();
  useEffect(() => {
    if (!work) return;
    split.reset();
    setAmount(remaining > 0 ? String(remaining) : "");
    setPayMode(getPrefs().defaultMode);
    setDate(todayISO());
    setOpenedOn(todayISO());
    setNotes("");
    // Only re-initialise when a different record is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [work?.id]);

  const amt = parseAmount(amount);
  const valid = !!work && amt > 0 && (!payBack || amt <= remaining);

  const save = () => {
    if (!work || !valid) return;
    setSaving(true);
    try {
      createPaid(
        {
          customerId: work.customerId,
          type: payBack ? "given" : "payment",
          date: dateOnSave(date, openedOn),
          description: settleDescription(work.description || ENTRY_UI[work.type].title),
          notes: notes.trim(),
          linkId: work.id,
        },
        amt,
        payMode,
        splitOf(split, amt),
      );
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
      <PayModeField label={word.how} value={payMode} onChange={setPayMode} split={split} total={amt} />
      <DateField label={word.when} value={date} onChange={setDate} money testID="input-settle-date" />
      <Field label="नोट (वैकल्पिक)">
        <TextInput style={inputStyle} value={notes} onChangeText={setNotes} placeholderTextColor={colors.muted} testID="input-settle-notes" />
      </Field>
      <PrimaryButton
        label={amt >= remaining && remaining > 0 ? "चुकता करें" : payBack ? "चुकाए सेव करें" : "मिले सेव करें"}
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
  const money = useMoneyInput(true);
  const items = useItems((sum) => money.setTotal(sum > 0 ? String(sum) : ""));
  const [payMode, setPayMode] = useState<"cash" | "online">("cash");
  const [govtFee, setGovtFee] = useState("");
  const [feeMode, setFeeMode] = useState<"online" | "cash">("online");
  const [date, setDate] = useState(todayISO());
  const [remark, setRemark] = useState("");
  const [remarkDate, setRemarkDate] = useState(todayISO(1));
  const [paidNow, setPaidNow] = useState("");
  const [paidDate, setPaidDate] = useState(todayISO());
  const [openedOn, setOpenedOn] = useState(todayISO());
  const [saving, setSaving] = useState(false);
  const split = useSplitPay();

  useEffect(() => {
    if (visible) {
      split.reset();
      setMode(initialMode);
      setTitle("");
      items.reset();
      money.reset("");
      setPayMode(getPrefs().defaultMode);
      setGovtFee("");
      setFeeMode("online");
      setDate(initialMode === "now" ? todayISO() : todayISO(1));
      setRemark("");
      setRemarkDate(todayISO(1));
      setPaidNow("");
      setPaidDate(todayISO());
      setOpenedOn(todayISO());
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
  const valid = choice.ready && (itemized ? items.titled : !!title.trim()) && (mode !== "now" || self || amt <= 0 || money.answered);
  const saveLabel = mode === "later" ? "आगे का काम जोड़ें" : self ? "सेव करें" : amt > 0 ? "काम सेव करें" : "मुफ़्त काम सेव करें";

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      const customerId = await choice.resolve();
      const t = itemized ? items.description : title.trim();
      const feeNum = parseAmount(govtFee);
      const day = dateOnSave(date, openedOn);
      if (mode === "now") {
        const entryId = recordWork({
          customerId,
          title: t,
          amount: amt,
          received: money.receivedNum,
          date: day,
          notes: remark.trim(),
          mode: payMode,
          fee: feeNum,
          feeMode,
          items: itemized ? items.saved() : [],
          split: splitOf(split, money.receivedNum),
        });
        // Free work books no row, but money taken with it still came in and stays with the customer as advance.
        if (!entryId && !self && customerId && money.receivedNum > 0) {
          createPaid({ customerId, type: "payment", date: day, description: ADVANCE, notes: `${t} के साथ` }, money.receivedNum, payMode, splitOf(split, money.receivedNum));
        }
        store.createJob({ customerId, title: t, dueDate: day, status: "done", estimatedAmount: amt, notes: remark.trim(), entryId });
        if (remark.trim()) {
          await store.createJob({ customerId, title: remark.trim(), dueDate: remarkDate, status: "pending", estimatedAmount: 0, notes: `पिछला काम: ${t}` });
        }
      } else {
        const job = store.createJob({ customerId, title: t, dueDate: day, estimatedAmount: amt, notes: remark.trim() });
        const got = parseAmount(paidNow);
        // The advance lands in the drawer/bank on the day it was received, not on the delivery day.
        if (!self && got > 0) {
          createPaid({ customerId, type: "payment", date: dateOnSave(paidDate, openedOn), description: "एडवांस", notes: `${t} के लिए`, linkId: job.id }, got, payMode, splitOf(split, got));
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
          {money.receivedNum > 0 ? <PayModeField label="कैसे मिले" value={payMode} onChange={setPayMode} split={split} total={money.receivedNum} /> : null}
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
          {parseAmount(paidNow) > 0 ? (
            <>
              <PayModeField label="कैसे मिले" value={payMode} onChange={setPayMode} split={split} total={parseAmount(paidNow)} />
              <DateField label="कब मिले" value={paidDate} onChange={setPaidDate} money testID="input-job-paid-date" />
            </>
          ) : null}
        </>
      ) : null}

      {mode === "now" ? (
        <>
          <DateField label="तारीख" value={date} onChange={setDate} money testID="input-job-date" />
          <MoreInfo open={!!remark || !!govtFee} hint={self ? "रिमार्क" : "सरकारी फीस, रिमार्क"} testID="job-more-info">
            {self ? null : <FeeField fee={govtFee} setFee={setGovtFee} feeMode={feeMode} setFeeMode={setFeeMode} amount={amt} />}
            <Field label="आगे का रिमार्क">
              <TextInput style={[inputStyle, { minHeight: 64 }]} value={remark} onChangeText={setRemark} multiline placeholder="जैसे कल प्रिंट देने हैं, बाकी पैसे शनिवार को" placeholderTextColor={colors.muted} testID="input-job-remark" />
            </Field>
            {remark.trim() ? <DateField label="रिमार्क कब देखना है" value={remarkDate} onChange={setRemarkDate} future testID="input-remark-date" /> : null}
          </MoreInfo>
        </>
      ) : (
        <>
          <DateField label={self ? "कब करना है" : "डिलीवरी तारीख"} value={date} onChange={setDate} future testID="input-job-date" />
          <MoreInfo open={!!remark} hint="नोट" testID="job-more-info">
            <Field label="नोट">
              <TextInput style={inputStyle} value={remark} onChangeText={setRemark} placeholderTextColor={colors.muted} testID="input-job-notes" />
            </Field>
          </MoreInfo>
        </>
      )}

      {mode === "now" && !self ? <LimitWarning customerId={choice.existingId} extra={roundMoney(amt - money.receivedNum)} /> : null}
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
  const money = useMoneyInput(true);
  const [payMode, setPayMode] = useState<PayMode>("cash");
  const [fee, setFee] = useState("");
  const [feeMode, setFeeMode] = useState<PayMode>("online");
  const [workDay, setWorkDate] = useState(todayISO());
  const [cashDay, setCashDate] = useState(todayISO());
  const [openedOn, setOpenedOn] = useState(todayISO());
  const [saving, setSaving] = useState(false);
  const split = useSplitPay();

  useEffect(() => {
    if (job) {
      split.reset();
      const est = job.estimatedAmount > 0 ? job.estimatedAmount : 0;
      // The advance for this job already sits in the drawer/bank; only the remainder is new money.
      money.reset(est ? String(est) : "", undefined, jobAdvance);
      setPayMode(getPrefs().defaultMode);
      setFee("");
      setFeeMode("online");
      setWorkDate(todayISO());
      setCashDate(todayISO());
      setOpenedOn(todayISO());
    }
    // Only re-initialise when a different job is opened, not when a sync refreshes it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id]);

  const amt = job?.customerId ? money.totalNum : 0;
  const got = money.receivedNum;

  const save = async () => {
    if (!job) return;
    setSaving(true);
    try {
      const workDate = dateOnSave(workDay, openedOn);
      const cashDate = dateOnSave(cashDay, openedOn);
      const sameDay = cashDate === workDate;
      const parts = splitOf(split, got);
      const entryId = recordWork({
        customerId: job.customerId,
        title: job.title,
        amount: amt,
        received: sameDay ? got : 0,
        date: workDate,
        notes: "काम पूरा",
        mode: payMode,
        fee: parseAmount(fee),
        feeMode,
        split: sameDay ? parts : null,
      });
      if (entryId) {
        jobAdvances.forEach((p) => store.updateEntry(p.id, { linkId: entryId }));
        if (!sameDay && got > 0) {
          createPaid({ customerId: job.customerId, type: "payment", date: cashDate, description: settleDescription(job.title), notes: "", linkId: entryId }, got, payMode, parts);
        }
      } else if (got > 0 && job.customerId) {
        createPaid({ customerId: job.customerId, type: "payment", date: cashDate, description: ADVANCE, notes: `${job.title} के लिए` }, got, payMode, parts);
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
          {got > 0 ? <PayModeField label="कैसे मिले" value={payMode} onChange={setPayMode} split={split} total={got} /> : null}
          <FeeField fee={fee} setFee={setFee} feeMode={feeMode} setFeeMode={setFeeMode} amount={amt} />
        </>
      ) : null}
      <DateField label="काम की तारीख" value={workDay} onChange={(d) => { setWorkDate(d); setCashDate(d); }} testID="input-complete-date" />
      {job?.customerId && got > 0 ? <DateField label="पैसे कब मिले" value={cashDay} onChange={setCashDate} money testID="input-complete-cash-date" /> : null}
      {job?.customerId ? <LimitWarning customerId={job.customerId} extra={roundMoney(amt - got)} /> : null}
      <PrimaryButton label={job?.customerId && amt <= 0 ? "मुफ़्त — पूरा हुआ" : "पूरा हुआ"} onPress={save} disabled={!!job?.customerId && amt > 0 && !money.answered} saving={saving} testID="save-complete-btn" />
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
  splitBox: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  splitLabel: { fontSize: 12, fontWeight: "700", color: colors.onSurfaceSecondary, marginBottom: 4 },
  jobName: { fontSize: 16, fontWeight: "700", color: colors.onSurface, marginBottom: spacing.md },
  primaryBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 15, alignItems: "center", marginTop: spacing.md, minHeight: 52, justifyContent: "center" },
  primaryText: { color: colors.onBrandPrimary, fontSize: 16, fontWeight: "700" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  limitBox: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, marginBottom: spacing.md, borderRadius: radius.md, backgroundColor: colors.errorSoft, borderWidth: 1, borderColor: colors.error },
  limitText: { flex: 1, fontSize: 13, fontWeight: "700", color: colors.error },
  moreInfo: { flexDirection: "row", alignItems: "center", gap: spacing.xs, minHeight: 44, paddingHorizontal: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderStyle: "dashed", borderColor: colors.border },
  moreInfoText: { fontSize: 14, fontWeight: "700", color: colors.brandPrimary },
  moreInfoHint: { flex: 1, fontSize: 12, color: colors.muted, textAlign: "right" },
  resultBox: { marginBottom: spacing.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderStyle: "dashed" },
  resultText: { fontSize: 14, fontWeight: "700" },
  pickedRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 48, paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.brandTertiary, borderWidth: 1, borderColor: colors.border },
  pickedName: { flex: 1, fontSize: 15, fontWeight: "700", color: colors.onSurface },
  changeText: { fontSize: 13, fontWeight: "700", color: colors.brandPrimary },
  dupeRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.sm },
  dupeText: { flex: 1, fontSize: 12, fontWeight: "600", color: colors.warning },
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
