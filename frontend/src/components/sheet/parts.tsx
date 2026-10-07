import React, { useState, useEffect, useMemo, useRef } from "react";
import { Modal, View, Text, StyleSheet, Pressable as RNPressable, TextInput, ScrollView, ActivityIndicator } from "react-native";
import MaterialIcon from "@react-native-vector-icons/material-design-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { store } from "@/src/lib/store";
import { computeBalance, isVendor, useCustomers, useEntries, type Customer, type Entry, type EntryItem } from "@/src/lib/data";
import { confirmAction } from "@/src/lib/confirm";
import { colors, spacing, radius } from "@/src/theme";
import { OLD_ENTRY_DAYS, formatDate, formatINR, isBackdated, isValidISO, parseAmount, roundMoney, todayISO } from "@/src/lib/format";
import { CalendarModal } from "@/src/components/calendar-modal";
import { Pressable, useOnce } from "@/src/components/tap";
import { useContactPicker } from "@/src/components/contact-picker-modal";
import { usePersona } from "@/src/lib/persona";
import { useKeyboardOverlap } from "@/src/lib/keyboard-overlap";
import { saveOutsideCost } from "@/src/lib/expenses";

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
    <Pressable hitSlop={{ top: 4, bottom: 4 }} onPress={onPress} style={[styles.chip, active && { backgroundColor: bg, borderColor: bg }]} testID={testID}>
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
  min,
  testID,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  future?: boolean;
  money?: boolean;
  /** When the row was first typed; a new row counts from now. */
  createdAt?: string;
  /** Earliest day that makes sense (e.g. a job can't finish before it was handed out). */
  min?: string;
  testID?: string;
}) {
  const [calendar, setCalendar] = useState(false);
  const cashLabel = usePersona().labels.cash;
  const today = todayISO();
  const old = money && isValidISO(value) && isBackdated(value, createdAt ?? new Date().toISOString());
  const ahead = !future && isValidISO(value) && value > today;
  const early = !!min && isValidISO(value) && value < min;
  const presets = (future
    ? [{ label: "आज", d: today }, { label: "कल", d: todayISO(1) }, { label: "परसों", d: todayISO(2) }, { label: "1 हफ़्ता", d: todayISO(7) }]
    : [{ label: "आज", d: today }, { label: "कल (बीता)", d: todayISO(-1) }]
  ).filter((p) => !min || p.d >= min);
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
      {early ? (
        <Text style={[styles.hint, { color: colors.error, fontWeight: "700", marginTop: 6 }]}>{formatDate(min!)} से पहले की तारीख नहीं हो सकती</Text>
      ) : ahead ? (
        <Text style={[styles.hint, { color: colors.warning, marginTop: 6 }]}>आगे की तारीख है — {formatDate(value)}</Text>
      ) : old ? (
        <Text style={[styles.hint, { color: colors.warning, marginTop: 6 }]}>{OLD_ENTRY_DAYS} दिन से पुरानी तारीख — खाते में जुड़ेगा, पर उस दिन का लेन-देन {cashLabel} / बैंक में नहीं गिना जाएगा</Text>
      ) : null}
      <CalendarModal visible={calendar} value={isValidISO(value) ? value : today} onPick={onChange} onClose={() => setCalendar(false)} max={future ? undefined : today} min={min} />
    </Field>
  );
}

export const NEW_CUSTOMER = "__new__";
export const SELF = "__self__";

export const last10 = (p: string) => p.replace(/\D/g, "").slice(-10);
/** Another person in the list who already has this phone number. */
export function samePhone(list: Customer[], phone: string, exceptId?: string): Customer | undefined {
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

  const name = isNew ? query.trim() : allCustomers.find((c) => c.id === customerId)?.name ?? "";

  return { recent, matches, exact, customerId, setCustomerId, existingId, isNew, isSelf, name, query, setQuery, newPhone, setNewPhone, ready, resolve };
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
export function useMoneyInput(
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

export type MoneyInput = ReturnType<typeof useMoneyInput>;

export function MoneyFields({
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

export type ItemRow = { key: number; title: string; amount: string };
export let itemSeq = 0;
export const itemRow = (title = "", amount = ""): ItemRow => ({ key: ++itemSeq, title, amount });
export const rowAmount = (r: ItemRow) => parseAmount(r.amount);
export const isFilled = (r: ItemRow) => !!r.title.trim() || rowAmount(r) > 0;

/** Line items of one work / purchase. `onTotal` hears every edit so the money fields follow the sum. */
export function useItems(onTotal?: (total: number) => void) {
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

export type Items = ReturnType<typeof useItems>;

export function ItemsField({ items, label, placeholder, addLabel }: { items: Items; label: string; placeholder: string; addLabel: string }) {
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
export function MoneyResult({ total, received, advance, freeAllowed }: { total: number; received: number; advance: number; freeAllowed?: boolean }) {
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

export type PayMode = "cash" | "online";

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
export type SplitPay = ReturnType<typeof useSplitPay>;
/** Splits are only real when both parts are above zero. */
export const splitOf = (s: SplitPay, total: number) => {
  if (!s.on) return null;
  const p = s.parts(total);
  return p.cash > 0 && p.online > 0 ? p : null;
};

export function PayModeField({ label, value, onChange, cashLabel = "नकद", onlineLabel = "ऑनलाइन", split, total = 0 }: { label: string; value: PayMode; onChange: (m: PayMode) => void; cashLabel?: string; onlineLabel?: string; split?: SplitPay; total?: number }) {
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
export function FeeField({ fee, setFee, feeMode, setFeeMode, amount }: { fee: string; setFee: (v: string) => void; feeMode: PayMode; setFeeMode: (m: PayMode) => void; amount: number }) {
  const n = parseAmount(fee);
  const cashFrom = usePersona().isPersonal ? "कैश से" : "गल्ले से";
  return (
    <>
      <Field label="फीस (₹)">
        <TextInput style={inputStyle} value={fee} onChangeText={setFee} placeholder="0" placeholderTextColor={colors.muted} keyboardType="numeric" testID="input-fee" />
        {n <= 0 ? <Text style={styles.hint}>सरकारी / पोर्टल फीस</Text> : null}
        {n > 0 && amount > 0 ? (
          <Text style={[styles.hint, { color: amount - n >= 0 ? colors.brandPrimary : colors.error, fontWeight: "700" }]}>
            बचत {formatINR(amount - n)}
          </Text>
        ) : null}
      </Field>
      {n > 0 ? <PayModeField label="कहाँ से दिए" value={feeMode} onChange={setFeeMode} cashLabel={cashFrom} onlineLabel="बैंक से" /> : null}
    </>
  );
}

/** Money paid out for this job besides the fee; saved as a shop expense, so it stays out of the work margin. */
export function OutsideCostField({ cost, setCost, mode, setMode }: { cost: string; setCost: (v: string) => void; mode: PayMode; setMode: (m: PayMode) => void }) {
  return (
    <>
      <Field label="बाहर का खर्च (₹)">
        <TextInput style={inputStyle} value={cost} onChangeText={setCost} placeholder="0" placeholderTextColor={colors.muted} keyboardType="numeric" testID="input-outside-cost" />
        <Text style={styles.hint}>खर्च में जुड़ेगा, आज के काम में नहीं</Text>
      </Field>
      {parseAmount(cost) > 0 ? <PayModeField label="कहाँ से दिए" value={mode} onChange={setMode} cashLabel="गल्ले से" onlineLabel="बैंक से" /> : null}
    </>
  );
}

export function bookOutsideCost(ownerId: string, amount: number, mode: PayMode, date: string, about: string) {
  if (ownerId) saveOutsideCost(ownerId, amount, mode, date, about);
}

export const settleDescription = (title: string) => `${title} — भुगतान`;

/** Money taken beyond the work amount stays with us as an advance row tied to that work. */
export function bookAdvance(customerId: string, extra: number, date: string, title: string, linkId: string, mode: PayMode) {
  if (extra <= 0) return;
  store.createEntry({ customerId, type: "payment", date, description: "एडवांस", amount: extra, mode, notes: `${title} के साथ`, linkId });
}

/** One payment row, or two (cash + online) when it was split. */
export function createPaid(base: Omit<Entry, "id" | "createdAt" | "mode" | "amount">, amount: number, mode: PayMode, split: { cash: number; online: number } | null): string {
  if (!split) return store.createEntry({ ...base, amount, mode }).id;
  const first = store.createEntry({ ...base, amount: split.cash, mode: "cash" });
  store.createEntry({ ...base, amount: split.online, mode: "online" });
  return first.id;
}

/** An edit that moves a row too far before the day it was typed takes its money out of galla / bank; ask first. */
export function confirmOldDate(was: string, next: string, createdAt: string | undefined, cashLabel: string, go: () => unknown) {
  if (!createdAt || was === next || !isBackdated(next, createdAt) || isBackdated(was, createdAt)) return void go();
  confirmAction(
    "पुरानी तारीख?",
    `${OLD_ENTRY_DAYS} दिन से पुरानी तारीख पर यह एंट्री खाते में बनी रहेगी, पर इसका पैसा ${cashLabel} / बैंक में नहीं गिना जाएगा।`,
    "हाँ, बदलें",
    () => void go(),
  );
}

export function PrimaryButton({ label, onPress, disabled, saving, color, testID }: { label: string; onPress: () => unknown; disabled?: boolean; saving?: boolean; color?: string; testID?: string }) {
  const press = useOnce(onPress);
  return (
    <Pressable
      style={[styles.primaryBtn, color ? { backgroundColor: color } : null, (disabled || saving) && { opacity: 0.5 }]}
      disabled={disabled || saving}
      onPress={press}
      testID={testID}
    >
      {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>{label}</Text>}
    </Pressable>
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

export const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: spacing.xl, maxHeight: "90%" },
  grabber: { width: 40, height: 4, backgroundColor: colors.borderStrong, borderRadius: 2, alignSelf: "center", marginBottom: spacing.md },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.lg },
  title: { fontSize: 20, fontWeight: "700", color: colors.onSurface },
  label: { fontSize: 12, color: colors.muted, fontWeight: "600", marginBottom: spacing.xs, textTransform: "uppercase" },
  hint: { fontSize: 12, color: colors.muted, marginTop: spacing.xs },
  splitBox: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  splitLabel: { fontSize: 12, fontWeight: "700", color: colors.onSurfaceSecondary, marginBottom: 4 },
  jobHead: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md, marginBottom: spacing.md },
  jobMeta: { fontSize: 12, color: colors.muted, fontWeight: "600" },
  jobEditBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 6, paddingHorizontal: 10, borderRadius: radius.pill, backgroundColor: colors.infoSoft },
  jobEditText: { fontSize: 12, fontWeight: "700", color: colors.brandPrimary },
  detailSave: { borderWidth: 1, borderColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 12, alignItems: "center", marginTop: spacing.xs },
  detailSaveText: { color: colors.brandPrimary, fontWeight: "700" },
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
  vendorBox: { marginBottom: spacing.md, padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  feeToVendor: { flexDirection: "row", alignItems: "center", gap: spacing.xs, alignSelf: "flex-start", minHeight: 36, marginTop: -spacing.sm, marginBottom: spacing.sm },
  feeToVendorText: { fontSize: 13, fontWeight: "700", color: colors.brandPrimary },
  pickedRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 48, paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.brandTertiary, borderWidth: 1, borderColor: colors.border },
  pickedName: { flex: 1, fontSize: 15, fontWeight: "700", color: colors.onSurface },
  changeText: { fontSize: 13, fontWeight: "700", color: colors.brandPrimary },
  dupeRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.sm },
  dupeText: { flex: 1, fontSize: 12, fontWeight: "600", color: colors.warning },
  chip: { flexDirection: "row", gap: 6, paddingHorizontal: spacing.md, height: 36, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  chipText: { fontSize: 13, color: colors.onSurface, fontWeight: "600" },
  segment: { flexDirection: "row", backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: 4, marginBottom: spacing.lg, borderWidth: 1, borderColor: colors.border },
  segmentBtn: { flex: 1, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", paddingVertical: 10, borderRadius: radius.sm },
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
