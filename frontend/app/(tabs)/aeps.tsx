import { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, TextInput, FlatList, ScrollView, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import MaterialIcon from "@react-native-vector-icons/material-design-icons";
import { colors, spacing, radius } from "@/src/theme";
import { useAeps, type AepsTxn, type AepsType } from "@/src/lib/data";
import { AEPS_META, AEPS_TYPES, STATUS_META, aepsDetailLine, aepsTotals, bankLegDate, bankOf, cashLegDate, cashOf, commissionDate, isLater } from "@/src/lib/aeps";
import { cleanAmountInput, formatDateShort, formatINR, parseAmount, roundMoney, todayISO } from "@/src/lib/format";
import { Pressable } from "@/src/components/tap";
import { DataLoadError, SlowServerHint } from "@/src/components/slow-server-hint";
import { AepsSheet } from "@/src/components/aeps-sheet";
import { completeAeps } from "@/src/lib/aeps-due";
import { confirmAction } from "@/src/lib/confirm";
import { CalendarModal } from "@/src/components/calendar-modal";
import { accountKey, addMove, balanceOf, useMoneyBook } from "@/src/lib/wallet";
import AsyncStorage from "@react-native-async-storage/async-storage";

type Range = "today" | "yesterday" | "month" | "all" | "custom";
const RANGES: { key: Range; label: string }[] = [
  { key: "today", label: "आज" },
  { key: "yesterday", label: "कल" },
  { key: "month", label: "इस महीने" },
  { key: "all", label: "सभी" },
  { key: "custom", label: "तारीख" },
];
const BANK_KEY = accountKey("business", "bank") as "business:bank";
const CASH_KEY = accountKey("business", "cash") as "business:cash";

/**
 * Typed real balance (portal / bank app, or counted notes) against the app's balance for one pocket.
 * The figure is kept for the day so it survives leaving the tab; a match is remembered with its time.
 */
function Reconcile({ label, pocketKey, app, hint, testID }: { label: string; pocketKey: "business:bank" | "business:cash"; app: number; hint?: string; testID: string }) {
  const today = todayISO();
  const valueKey = `hisab_reconcile_${pocketKey}_${today}`;
  const lastKey = `hisab_reconcile_last_${pocketKey}`;
  const [value, setValue] = useState("");
  const [last, setLast] = useState("");
  useEffect(() => {
    AsyncStorage.getItem(valueKey).then((v) => setValue(v || "")).catch(() => {});
    AsyncStorage.getItem(lastKey).then((v) => setLast(v || "")).catch(() => {});
  }, [valueKey, lastKey]);
  const save = (v: string) => {
    const clean = cleanAmountInput(v);
    setValue(clean);
    AsyncStorage.setItem(valueKey, clean).catch(() => {});
  };
  const typed = value ? parseAmount(value) : null;
  const diff = typed !== null ? roundMoney(typed - app) : null;
  const stamp = () => {
    const at = new Date().toISOString();
    setLast(at);
    AsyncStorage.setItem(lastKey, at).catch(() => {});
  };
  useEffect(() => {
    if (diff === 0) stamp();
    // Only when the figures come to match.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diff]);
  const pocketName = pocketKey === "business:bank" ? "दुकान बैंक" : "गल्ला";
  const match = () => {
    if (!diff || typed === null) return;
    confirmAction(
      `${pocketName} ${formatINR(typed)} कर दें?`,
      diff > 0 ? `हिसाब में ${formatINR(diff)} "बाहर से जोड़े" लिखे जाएँगे।` : `हिसाब में ${formatINR(-diff)} "बाहर निकाले" लिखे जाएँगे।`,
      "हाँ, बराबर करें",
      () => {
        void addMove(
          diff > 0
            ? { date: today, from: "", to: pocketKey, amount: diff, note: `${pocketName} मिलान` }
            : { date: today, from: pocketKey, to: "", amount: -diff, note: `${pocketName} मिलान` },
        );
        stamp();
      },
    );
  };
  const lastText = last ? `आख़िरी मिलान: ${formatDateShort(last.slice(0, 10))} ${new Date(last).toTimeString().slice(0, 5)}` : "अभी तक मिलान नहीं किया";
  return (
    <View style={styles.reconcileRow} testID={testID}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <Text style={styles.statLabel}>{label}</Text>
          <Text style={styles.meta}>हिसाब में: {formatINR(app)}</Text>
        </View>
        <TextInput style={styles.portalInput} value={value} onChangeText={save} keyboardType="decimal-pad" placeholder="₹ असल" placeholderTextColor={colors.muted} testID={`${testID}-input`} />
      </View>
      {diff === null ? (
        <Text style={styles.meta}>{lastText}</Text>
      ) : diff === 0 ? (
        <Text style={[styles.portalResult, { color: colors.success }]}>✓ बिल्कुल मिल गया · {lastText}</Text>
      ) : (
        <>
          <Text style={[styles.portalResult, { color: colors.error }]}>
            {diff > 0 ? `असल में ${formatINR(diff)} ज़्यादा` : `असल में ${formatINR(-diff)} कम`} — कोई एंट्री छूटी या गलत है
          </Text>
          {hint ? <Text style={styles.meta}>{hint}</Text> : null}
          <Pressable style={styles.portalBtn} onPress={match} testID={`${testID}-match`}>
            <Text style={styles.portalBtnText}>हिसाब को असल के बराबर करें</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

/** "HH:MM" for ordering within a day; rows saved without a time fall back to when they were written. */
function clockOf(t: AepsTxn): string {
  if (t.time) return t.time;
  const d = new Date(t.createdAt);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export default function AepsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ range?: Range; t?: string }>();
  const q = useAeps();
  const txns = q.data ?? [];
  const [range, setRange] = useState<Range>("today");
  const [type, setType] = useState<AepsType | "all">("all");
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const today = todayISO();
  const [custom, setCustom] = useState({ from: todayISO(-6), to: today });
  const [picking, setPicking] = useState<"from" | "to" | null>(null);
  const book = useMoneyBook();
  const appBank = useMemo(() => balanceOf(book, BANK_KEY), [book]);
  const appCash = useMemo(() => balanceOf(book, CASH_KEY), [book]);

  useEffect(() => {
    if (params.range) setRange(params.range);
  }, [params.range, params.t]);

  const yesterday = todayISO(-1);
  const monthPrefix = today.slice(0, 7);

  const inRangeDate = useMemo(
    () => (d: string) =>
      range === "today" ? d === today
      : range === "yesterday" ? d === yesterday
      : range === "month" ? d.startsWith(monthPrefix)
      : range === "custom" ? d >= custom.from && d <= custom.to
      : true,
    [range, today, yesterday, monthPrefix, custom],
  );
  const pickRange = (r: Range) => {
    setRange(r);
    if (r === "custom") setPicking("from");
  };
  const onPickDate = (d: string) => {
    if (picking === "from") {
      setCustom((c) => ({ from: d, to: c.to < d ? d : c.to }));
      setPicking("to");
    } else {
      setCustom((c) => ({ from: c.from > d ? d : c.from, to: d }));
      setPicking(null);
    }
  };
  // Same rule as the totals: a row belongs to every day one of its sides moved money.
  const inRange = useMemo(
    () => txns.filter((t) => [t.date, cashLegDate(t), bankLegDate(t), commissionDate(t)].some((d) => !!d && inRangeDate(d))),
    [txns, inRangeDate],
  );

  const pending = useMemo(
    () => txns.filter((t) => t.status === "pending").sort((a, b) => (a.dueDate || a.date).localeCompare(b.dueDate || b.date)),
    [txns],
  );
  // Likely reasons the real money and the app differ: rows still waiting on one side.
  const bankWaiting = pending.filter((t) => bankOf(t) !== "none" && !bankLegDate(t));
  const cashWaiting = pending.filter((t) => cashOf(t) !== "none" && !cashLegDate(t));
  const bankHint = bankWaiting.length
    ? `${bankWaiting.length} पेंडिंग एंट्री (${formatINR(bankWaiting.reduce((s, t) => s + t.amount, 0))}) हिसाब के बैंक में अभी नहीं जुड़ीं — पोर्टल में हो चुकी हों तो उन्हें “हो गया” करें।`
    : "आज की एंट्री, ऐप कमीशन और खर्च देख लें।";
  const cashHint = cashWaiting.length
    ? `${cashWaiting.length} पेंडिंग एंट्री में कैश अभी लेन-देन में नहीं गिना गया।`
    : "आज के खर्च, गल्ला ↔ बैंक और उधारी में मिले पैसे देख लें।";
  const completeNow = (t: AepsTxn) =>
    confirmAction("ट्रांज़ैक्शन हो गया?", `${t.customerName || AEPS_META[t.type].short} · ${formatINR(t.amount)}`, "हाँ, हो गया", () => completeAeps(t));

  const countByType = useMemo(() => {
    const m: Partial<Record<AepsType, number>> = {};
    inRange.forEach((t) => { m[t.type] = (m[t.type] ?? 0) + 1; });
    return m;
  }, [inRange]);
  const typesInRange = AEPS_TYPES.filter((t) => countByType[t]);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const narrow = typesInRange.length > 1;
    return inRange
      .filter((t) => !narrow || type === "all" || t.type === type)
      .filter(
        (t) =>
          !needle ||
          t.customerName.toLowerCase().includes(needle) ||
          t.mobile.includes(needle) ||
          t.reference.toLowerCase().includes(needle) ||
          t.accountNumber.includes(needle) ||
          t.billAccount.toLowerCase().includes(needle) ||
          t.rechargeNumber.includes(needle) ||
          (t.upiId ?? "").toLowerCase().includes(needle) ||
          t.beneficiaryName.toLowerCase().includes(needle),
      )
      .sort((a, b) => (a.date !== b.date ? b.date.localeCompare(a.date) : clockOf(b).localeCompare(clockOf(a)) || b.createdAt.localeCompare(a.createdAt)));
  }, [inRange, type, search, typesInRange.length]);

  const totals = useMemo(() => aepsTotals(txns, inRangeDate), [txns, inRangeDate]);
  const signed = (n: number) => `${n < 0 ? "−" : "+"}${formatINR(Math.abs(n))}`;

  const header = (
      <View style={{ paddingTop: insets.top + spacing.md }}>
        <Text style={styles.h1}>काउंटर</Text>
        <View style={styles.segment}>
          {RANGES.map((r) => (
            <Pressable key={r.key} onPress={() => pickRange(r.key)} style={[styles.segmentBtn, range === r.key && styles.segmentActive]} testID={`aeps-range-${r.key}`}>
              <Text style={[styles.segmentText, range === r.key && { color: colors.onBrandPrimary }]} numberOfLines={1} adjustsFontSizeToFit>{r.label}</Text>
            </Pressable>
          ))}
        </View>
        {range === "custom" ? (
          <Pressable style={styles.customRow} onPress={() => setPicking("from")} testID="aeps-custom-range">
            <MaterialIcon name="calendar-range" size={16} color={colors.brandPrimary} />
            <Text style={styles.customText}>{formatDateShort(custom.from)} – {formatDateShort(custom.to)}</Text>
            <MaterialIcon name="pencil-outline" size={14} color={colors.muted} />
          </Pressable>
        ) : null}
        <CalendarModal
          visible={picking !== null}
          value={picking === "to" ? custom.to : custom.from}
          heading={picking === "to" ? "कब तक?" : "कब से?"}
          keepOpen
          onPick={onPickDate}
          onClose={() => setPicking(null)}
          max={today}
        />

        <View style={styles.statRow} testID="aeps-summary">
          <Stat label="गल्ला" value={signed(totals.cashNet)} sub={`आए ${formatINR(totals.cashIn)} · गए ${formatINR(totals.cashOut)}`} tone={totals.cashNet < 0 ? colors.error : colors.success} />
          <Stat label="बैंक" value={signed(totals.bankNet)} sub={`आए ${formatINR(totals.bankIn)} · गए ${formatINR(totals.bankOut)}`} tone={totals.bankNet < 0 ? colors.error : colors.success} />
          <Stat label="कमीशन" value={formatINR(totals.commission)} sub={`कैश ${formatINR(totals.commissionCash)} · बैंक ${formatINR(totals.commissionBank)}`} tone={colors.brandSecondary} />
        </View>

        <View style={styles.portalBox} testID="aeps-portal">
          <Text style={styles.reconcileTitle}>⚖️ मिलान — असल पैसा बनाम हिसाब</Text>
          <Reconcile label="पोर्टल / बैंक ऐप में" pocketKey={BANK_KEY} app={appBank} hint={bankHint} testID="aeps-portal" />
          <Reconcile label="गल्ले में गिने नोट" pocketKey={CASH_KEY} app={appCash} hint={cashHint} testID="aeps-galla" />
        </View>

        {pending.length > 0 ? (
          <View style={styles.pendingBox} testID="aeps-pending">
            <View style={styles.pendingHead}>
              <MaterialIcon name="clock-outline" size={18} color={colors.warning} />
              <Text style={styles.pendingTitle}>पेंडिंग ({pending.length})</Text>
              <Text style={styles.pendingSum}>{formatINR(pending.reduce((s, t) => s + t.amount, 0))}</Text>
            </View>
            {pending.map((t) => {
              const due = t.dueDate || "";
              const late = due ? due < today : t.date < today;
              const dueText = due ? (due === today ? "आज भेजनी है" : due < today ? `${formatDateShort(due)} की थी` : `${formatDateShort(due)} को`) : "पेंडिंग";
              return (
                <Pressable key={t.id} style={styles.pendingRow} onPress={() => router.push(`/aeps/${t.id}`)} testID={`aeps-pending-${t.id}`}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.name} numberOfLines={1}>{t.customerName} · {AEPS_META[t.type].short} {formatINR(t.amount)}</Text>
                    <Text style={[styles.meta, (late || due === today) && { color: colors.error, fontWeight: "700" }]} numberOfLines={1}>
                      {dueText}{cashLegDate(t) ? " · कैश मिल गया" : cashOf(t) !== "none" ? " · कैश बाकी" : ""}
                    </Text>
                  </View>
                  <Pressable style={styles.doneBtn} onPress={() => completeNow(t)} hitSlop={6} testID={`aeps-done-${t.id}`}>
                    <MaterialIcon name="check" size={16} color="#fff" />
                    <Text style={styles.doneText}>हो गया</Text>
                  </Pressable>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        <View style={styles.searchWrap}>
          <MaterialIcon name="magnify" size={18} color={colors.muted} />
          <TextInput style={styles.search} value={search} onChangeText={setSearch} placeholder="नाम, मोबाइल, खाता या Txn ID" placeholderTextColor={colors.muted} testID="aeps-search" />
          {search ? (
            <Pressable onPress={() => setSearch("")} hitSlop={8}><MaterialIcon name="close-circle" size={18} color={colors.muted} /></Pressable>
          ) : null}
        </View>
        {typesInRange.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingVertical: spacing.md }}>
            <TypeChip label={`सब (${inRange.length})`} active={type === "all"} onPress={() => setType("all")} />
            {typesInRange.map((t) => (
              <TypeChip key={t} label={`${AEPS_META[t].short} (${countByType[t]})`} icon={AEPS_META[t].icon} color={AEPS_META[t].color} active={type === t} onPress={() => setType(t)} />
            ))}
          </ScrollView>
        ) : <View style={{ height: spacing.md }} />}
      </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
        <FlatList
          data={q.isLoading ? [] : rows}
          keyExtractor={(t) => t.id}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={header}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: Math.max(spacing.xxxl * 2, insets.bottom + 104), gap: spacing.sm }}
          ListEmptyComponent={
            q.isLoading ? (
              <View style={{ marginTop: spacing.xl, alignItems: "center" }}><ActivityIndicator color={colors.brandPrimary} /><SlowServerHint /></View>
            ) : q.isError && q.data == null ? (
              <DataLoadError onRetry={() => q.refetch()} />
            ) :
            <View style={styles.empty} testID="aeps-empty">
              <MaterialIcon name="fingerprint" size={36} color={colors.muted} />
              <Text style={styles.emptyTitle}>{search ? "कुछ नहीं मिला" : "इस समय कोई AEPS एंट्री नहीं"}</Text>
              {!search ? <Text style={styles.emptySub}>नीचे + दबाकर पहली एंट्री लिखें</Text> : null}
            </View>
          }
          renderItem={({ item: t }) => {
            const m = AEPS_META[t.type];
            const st = STATUS_META[t.status];
            const detail = aepsDetailLine(t);
            return (
              <Pressable style={styles.row} onPress={() => router.push(`/aeps/${t.id}`)} testID={`aeps-row-${t.id}`}>
                <View style={[styles.typeIcon, { backgroundColor: m.soft }]}>
                  <MaterialIcon name={m.icon as any} size={20} color={m.color} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.name} numberOfLines={1}>{t.customerName}</Text>
                  <Text style={styles.meta} numberOfLines={1}>
                    {m.short} · {t.date === today ? "आज" : formatDateShort(t.date)}{t.time ? ` ${t.time}` : ""}
                  </Text>
                  {detail ? <Text style={styles.meta} numberOfLines={1}>{detail}</Text> : null}
                </View>
                <View style={{ alignItems: "flex-end", gap: 4 }}>
                  {t.type === "balance" ? (
                    t.amount > 0 ? <Text style={styles.meta} numberOfLines={1}>खाते में {formatINR(t.amount)}</Text> : null
                  ) : t.amount > 0 ? <Text style={[styles.amount, { color: cashOf(t) === "out" ? colors.error : cashOf(t) === "in" ? colors.success : colors.onSurface }]}>{formatINR(t.amount)}</Text> : null}
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                    <MaterialIcon name="file-pdf-box" size={16} color={colors.brandPrimary} />
                    {t.status !== "success" ? (
                      <View style={[styles.statusPill, { backgroundColor: isLater(t) ? colors.infoSoft : st.soft }]}><Text style={[styles.statusText, { color: isLater(t) ? colors.info : st.color }]}>{isLater(t) ? `${formatDateShort(t.dueDate!)} को` : st.label}</Text></View>
                    ) : t.commission > 0 ? (
                      <Text style={styles.commission}>+{formatINR(t.commission)}</Text>
                    ) : (
                      <Text style={{ fontSize: 11, color: colors.muted }}>रसीद</Text>
                    )}
                  </View>
                </View>
              </Pressable>
            );
          }}
        />

      <Pressable style={[styles.fab, { bottom: insets.bottom + 16 }]} onPress={() => setAdding(true)} testID="add-aeps-fab">
        <MaterialIcon name="plus" size={26} color={colors.onBrandPrimary} />
      </Pressable>

      <AepsSheet visible={adding} onClose={() => setAdding(false)} />
    </View>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, { color: tone }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      <Text style={styles.statSub} numberOfLines={2}>{sub}</Text>
    </View>
  );
}

function TypeChip({ label, icon, color, active, onPress }: { label: string; icon?: string; color?: string; active: boolean; onPress: () => void }) {
  const bg = color ?? colors.brandPrimary;
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && { backgroundColor: bg, borderColor: bg }]}>
      {icon ? <MaterialIcon name={icon as any} size={14} color={active ? "#fff" : bg} /> : null}
      <Text style={[styles.chipText, active && { color: "#fff" }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  h1: { fontSize: 30, fontWeight: "700", color: colors.onSurface },
  sub: { fontSize: 13, color: colors.muted, marginTop: 2 },
  segment: { flexDirection: "row", backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: 4, marginTop: spacing.lg, borderWidth: 1, borderColor: colors.border },
  segmentBtn: { flex: 1, alignItems: "center", paddingVertical: 8, borderRadius: radius.sm },
  segmentActive: { backgroundColor: colors.brandPrimary },
  segmentText: { fontSize: 13, fontWeight: "700", color: colors.onSurface },
  statRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  stat: { flex: 1, padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  statLabel: { fontSize: 12, fontWeight: "700", color: colors.muted },
  statValue: { fontSize: 17, fontWeight: "800", marginTop: 2 },
  statSub: { fontSize: 10, color: colors.muted, marginTop: 2 },
  customRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: spacing.sm, paddingVertical: 6 },
  customText: { fontSize: 14, fontWeight: "700", color: colors.onSurface },
  portalBox: { marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, gap: spacing.sm },
  portalInput: { width: 120, height: 40, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: spacing.sm, fontSize: 16, fontWeight: "700", color: colors.onSurface, textAlign: "right" },
  portalResult: { fontSize: 12, fontWeight: "700" },
  reconcileTitle: { fontSize: 13, fontWeight: "800", color: colors.onSurface },
  reconcileRow: { gap: 6, paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  portalBtn: { alignSelf: "flex-start", paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.brandPrimary },
  portalBtnText: { fontSize: 12, fontWeight: "700", color: colors.brandPrimary },
  pendingBox: { marginTop: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: "#F5D7A1", backgroundColor: "#FFFBF2", padding: spacing.md, gap: spacing.sm },
  pendingHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  pendingTitle: { flex: 1, fontSize: 14, fontWeight: "800", color: colors.warning },
  pendingSum: { fontSize: 14, fontWeight: "800", color: colors.onSurface },
  pendingRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: "#F5E6C8" },
  doneBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.success, paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radius.pill },
  doneText: { color: "#fff", fontSize: 12, fontWeight: "800" },
  searchWrap: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, paddingHorizontal: spacing.md, height: 44, borderWidth: 1, borderColor: colors.border, marginTop: spacing.md },
  search: { flex: 1, color: colors.onSurface, fontSize: 15 },
  chip: { flexDirection: "row", gap: 4, height: 32, paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  chipText: { fontSize: 12, color: colors.onSurface, fontWeight: "700" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  typeIcon: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  name: { fontSize: 15, fontWeight: "700", color: colors.onSurface },
  meta: { fontSize: 12, color: colors.muted, marginTop: 2 },
  amount: { fontSize: 16, fontWeight: "800" },
  commission: { fontSize: 11, fontWeight: "700", color: colors.brandSecondary },
  statusPill: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill },
  statusText: { fontSize: 11, fontWeight: "700" },
  empty: { alignItems: "center", padding: spacing.xxl, gap: spacing.sm },
  emptyTitle: { fontSize: 15, fontWeight: "600", color: colors.onSurface },
  emptySub: { fontSize: 13, color: colors.muted },
  fab: { position: "absolute", right: 20, width: 56, height: 56, borderRadius: 28, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center", elevation: 4, shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
});
