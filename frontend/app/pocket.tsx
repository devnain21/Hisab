import { useMemo, useState } from "react";
import { View, Text, StyleSheet, FlatList, TextInput, ActivityIndicator, Alert } from "react-native";
import { useAuth } from "@/src/context/AuthContext";
import { pdfSupported, registerDoc, sharePdf, type RegisterRow } from "@/src/lib/receipt";
import { shareMessage } from "@/src/lib/share-text";
import { useLocalSearchParams, useRouter } from "expo-router";
import MaterialIcon from "@react-native-vector-icons/material-design-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radius, spacing } from "@/src/theme";
import { formatDateShort, formatINR, formatMonth, formatWeekdayDate, monthRange, roundMoney, shiftISO, todayISO, weekRange } from "@/src/lib/format";
import { Pressable } from "@/src/components/tap";
import { usePersona, type Persona } from "@/src/lib/persona";
import { useCustomers, type Entry } from "@/src/lib/data";
import { AEPS_META } from "@/src/lib/aeps";
import type { Expense } from "@/src/lib/expenses";
import { accountLabel, computeFlows, isInflow, isInternal, pocketNet, useMoneyBook, walletTxns, type FlowKey, type Move, type Pocket, type WalletTxn } from "@/src/lib/wallet";
import { FLOW, FlowHead, FlowRow, FlowTile, NetRow } from "@/src/components/money-flow";
import { IN_ROWS, OUT_ROWS, flowLabel, pocketTitle } from "@/src/components/pocket-card";
import { EditRecordSheet } from "@/src/components/sheets";
import { AddExpenseSheet } from "@/src/components/expense-sheet";
import { MoneyMoveSheet, type MoveKind } from "@/src/components/money-move-sheet";
import { CalendarModal } from "@/src/components/calendar-modal";

type Period = "day" | "week" | "month" | "all";
const PERIODS: { id: Period; label: string }[] = [
  { id: "day", label: "दिन" },
  { id: "week", label: "हफ़्ता" },
  { id: "month", label: "महीना" },
  { id: "all", label: "शुरू से" },
];
const PAGE = 80;

type Item = { type: "day"; date: string; net: number; close: number } | { type: "txn"; t: WalletTxn; after: number };

const signed = (n: number) => `${n < 0 ? "−" : "+"}${formatINR(Math.abs(n))}`;

/** One pocket's register: what was there, every rupee in and out, and what is left — for any period. */
export default function PocketScreen() {
  const params = useLocalSearchParams<{ p?: string; date?: string; dir?: string; key?: string; period?: string }>();
  // "all" lists cash and bank together (Cash In / Cash Out drill-downs); transfers between them are left out.
  const both = params.p === "all";
  const pocket: Pocket = params.p === "bank" ? "bank" : "cash";
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { persona, labels } = usePersona();
  const customers = useCustomers().data ?? [];
  const book = useMoneyBook();
  const today = todayISO();
  const [period, setPeriod] = useState<Period>(
    PERIODS.some((p) => p.id === params.period) ? (params.period as Period) : params.date ? "day" : "month",
  );
  const [date, setDate] = useState(params.date && params.date <= today ? params.date : today);
  const [calendar, setCalendar] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const [editEntry, setEditEntry] = useState<Entry | null>(null);
  const [editExpense, setEditExpense] = useState<Expense | null>(null);
  const [editMove, setEditMove] = useState<Move | null>(null);
  const [move, setMove] = useState<MoveKind | null>(null);
  const [expense, setExpense] = useState(false);
  const [dir, setDir] = useState<"all" | "in" | "out">(params.dir === "in" || params.dir === "out" ? params.dir : "all");
  const [keyFilter, setKeyFilter] = useState<FlowKey | null>(
    [...IN_ROWS, ...OUT_ROWS].some((r) => r.key === params.key) ? (params.key as FlowKey) : null,
  );
  const [query, setQuery] = useState("");
  const [sharing, setSharing] = useState(false);
  const { user } = useAuth();

  const range =
    period === "all" ? { from: "", to: today } : period === "week" ? weekRange(date) : period === "month" ? monthRange(date) : { from: date, to: date };
  const to = range.to < today ? range.to : today;
  const step = (n: number) => {
    const next = period === "week" ? shiftISO(date, 7 * n) : period === "month" ? monthRange(date, n).from : shiftISO(date, n);
    setDate(next > today ? today : next);
    setShown(PAGE);
  };

  const data = useMemo(() => {
    const balance = (keep: (d: string) => boolean) => {
      const f = computeFlows(book, persona, keep);
      return both ? roundMoney(pocketNet(f.cash) + pocketNet(f.bank)) : pocketNet(f[pocket]);
    };
    const nowBal = balance((d) => d <= today);
    const opening = range.from ? balance((d) => d < range.from) : 0;
    const list = walletTxns(book, persona, (d) => d >= range.from && d <= to)
      .filter((t) => (both ? !isInternal(t, persona) : t.pocket === pocket))
      .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));

    const byKey = new Map<FlowKey, number>();
    let bal = opening;
    let ins = 0;
    let outs = 0;
    const withBal: { t: WalletTxn; after: number }[] = [];
    for (const t of list) {
      const inflow = isInflow(t.key);
      bal = roundMoney(bal + (inflow ? t.amount : -t.amount));
      if (inflow) ins += t.amount;
      else outs += t.amount;
      byKey.set(t.key, (byKey.get(t.key) ?? 0) + t.amount);
      withBal.push({ t, after: bal });
    }
    return { nowBal, opening, ins: roundMoney(ins), outs: roundMoney(outs), closing: roundMoney(opening + ins - outs), byKey, withBal, count: list.length };
  }, [book, persona, pocket, both, range.from, to, today]);

  const nameOf = (id: string) => customers.find((c) => c.id === id)?.name ?? labels.customer;
  const needle = query.trim().toLowerCase();
  const filtering = dir !== "all" || !!keyFilter || !!needle;
  // The running balance stays the pocket's real balance; filters only hide rows.
  const shownRows = useMemo(
    () =>
      data.withBal.filter((r) => {
        const inflow = isInflow(r.t.key);
        if (dir === "in" && !inflow) return false;
        if (dir === "out" && inflow) return false;
        if (keyFilter && r.t.key !== keyFilter) return false;
        if (needle) {
          const d = describe(r.t, persona, r.t.pocket, nameOf);
          if (!`${d.title} ${d.sub} ${r.t.amount}`.toLowerCase().includes(needle)) return false;
        }
        return true;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.withBal, dir, keyFilter, needle, persona, customers],
  );
  const items = useMemo(() => {
    // Newest day first, each day headed by its own change and closing balance.
    const out: Item[] = [];
    for (let i = shownRows.length - 1; i >= 0; ) {
      const d = shownRows[i].t.date;
      const day: Item[] = [];
      let net = 0;
      const close = shownRows[i].after;
      while (i >= 0 && shownRows[i].t.date === d) {
        const r = shownRows[i];
        net += isInflow(r.t.key) ? r.t.amount : -r.t.amount;
        day.push({ type: "txn", t: r.t, after: r.after });
        i--;
      }
      out.push({ type: "day", date: d, net: roundMoney(net), close }, ...day);
    }
    return out;
  }, [shownRows]);
  const title = both ? `${pocketTitle(persona, "cash")} + बैंक` : pocketTitle(persona, pocket);
  const periodText =
    period === "all"
      ? "शुरू से आज तक"
      : period === "day"
        ? date === today ? "आज" : formatWeekdayDate(date)
        : period === "week"
          ? `${formatDateShort(range.from)} – ${formatDateShort(range.to)}`
          : formatMonth(date);
  const dayName = (d: string) => (d === today ? "आज" : d === todayISO(-1) ? "कल" : formatWeekdayDate(d));

  const open = (t: WalletTxn) => {
    const s = t.src;
    if (s.kind === "entry") setEditEntry(s.entry);
    else if (s.kind === "expense") setEditExpense(s.expense);
    else if (s.kind === "move") setEditMove(s.move);
    else router.push(`/aeps/${s.txn.id}`);
  };

  const breakdown = (rows: typeof IN_ROWS) => rows.filter((r) => (data.byKey.get(r.key) ?? 0) > 0);
  const inRows = breakdown(IN_ROWS);
  const outRows = breakdown(OUT_ROWS);

  const header = (
    <View>
      <View style={[styles.hero, { backgroundColor: both ? colors.brandPrimary : pocket === "cash" ? colors.success : colors.info }]}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <MaterialIcon name={both ? "wallet-outline" : pocket === "cash" ? "cash-multiple" : "bank-outline"} size={20} color="#fff" />
          <Text style={styles.heroLabel}>{title} · अभी</Text>
        </View>
        <Text style={styles.heroValue}>{formatINR(data.nowBal)}</Text>
      </View>

      {both ? null : (
      <View style={styles.actions}>
        {([
          { id: "in", label: "जोड़ें", icon: "plus-circle-outline", color: colors.success },
          { id: "out", label: "निकालें", icon: "minus-circle-outline", color: colors.error },
          { id: "swap", label: pocket === "cash" ? "बैंक में डालें" : `${pocketTitle(persona, "cash")} में लें`, icon: "swap-horizontal", color: colors.brandPrimary },
          { id: "expense", label: "खर्च", icon: "coffee-outline", color: colors.warning },
        ] as const).map((a) => (
          <Pressable key={a.id} style={styles.action} onPress={() => (a.id === "expense" ? setExpense(true) : setMove(a.id))} testID={`pocket-${a.id}`}>
            <MaterialIcon name={a.icon} size={20} color={a.color} />
            <Text style={styles.actionText} numberOfLines={1} adjustsFontSizeToFit>{a.label}</Text>
          </Pressable>
        ))}
      </View>
      )}

      <View style={styles.periodRow}>
        {PERIODS.map((p) => (
          <Pressable key={p.id} onPress={() => { setPeriod(p.id); setShown(PAGE); }} style={[styles.periodChip, period === p.id && styles.periodOn]} testID={`pocket-period-${p.id}`}>
            <Text style={[styles.periodText, period === p.id && { color: colors.onBrandPrimary }]}>{p.label}</Text>
          </Pressable>
        ))}
      </View>
      {period !== "all" ? (
        <View style={styles.dateRow}>
          <Pressable style={styles.arrow} onPress={() => step(-1)} testID="pocket-prev">
            <MaterialIcon name="chevron-left" size={24} color={colors.onSurface} />
          </Pressable>
          <Pressable style={styles.dateBtn} onPress={() => setCalendar(true)} testID="pocket-date">
            <MaterialIcon name="calendar-month-outline" size={18} color={colors.brandPrimary} />
            <Text style={styles.dateText}>{periodText}</Text>
          </Pressable>
          <Pressable style={[styles.arrow, range.to >= today && { opacity: 0.3 }]} disabled={range.to >= today} onPress={() => step(1)} testID="pocket-next">
            <MaterialIcon name="chevron-right" size={24} color={colors.onSurface} />
          </Pressable>
        </View>
      ) : null}

      <View style={styles.card}>
        <View style={{ flexDirection: "row", gap: spacing.sm, marginBottom: spacing.sm }}>
          <FlowTile dir="in" value={`+${formatINR(data.ins)}`} onPress={() => setDir(dir === "in" ? "all" : "in")} testID="pocket-sum-in" style={dir === "in" ? styles.tileOn : undefined} />
          <FlowTile dir="out" value={`−${formatINR(data.outs)}`} onPress={() => setDir(dir === "out" ? "all" : "out")} testID="pocket-sum-out" style={dir === "out" ? styles.tileOn : undefined} />
        </View>
        <FlowRow label={period === "all" ? "Opening" : `Opening · ${formatDateShort(range.from)}`} value={formatINR(data.opening)} color={data.opening < 0 ? colors.error : undefined} />
        <NetRow value={roundMoney(data.ins - data.outs)} />
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>{to === today ? "Closing" : `Closing · ${formatDateShort(to)}`}</Text>
          <Text style={[styles.totalValue, data.closing < 0 && { color: colors.error }]}>{formatINR(data.closing)}</Text>
        </View>
      </View>

      {inRows.length + outRows.length > 0 ? (
        <View style={styles.card}>
          {inRows.length ? <FlowHead dir="in" /> : null}
          {inRows.map((r) => (
            <FlowRow key={r.key} label={r.label(persona, pocket)} value={`+${formatINR(data.byKey.get(r.key) ?? 0)}`} color={FLOW.in.color} active={keyFilter === r.key} onPress={() => setKeyFilter(keyFilter === r.key ? null : r.key)} testID={`pocket-key-${r.key}`} />
          ))}
          {outRows.length ? <FlowHead dir="out" /> : null}
          {outRows.map((r) => (
            <FlowRow key={r.key} label={r.label(persona, pocket)} value={`−${formatINR(data.byKey.get(r.key) ?? 0)}`} color={FLOW.out.color} active={keyFilter === r.key} onPress={() => setKeyFilter(keyFilter === r.key ? null : r.key)} testID={`pocket-key-${r.key}`} />
          ))}
        </View>
      ) : null}

      <View style={styles.searchWrap}>
        <MaterialIcon name="magnify" size={18} color={colors.muted} />
        <TextInput style={styles.search} value={query} onChangeText={setQuery} placeholder="नाम, विवरण या रकम खोजें" placeholderTextColor={colors.muted} testID="pocket-search" />
        {query ? (
          <Pressable onPress={() => setQuery("")} hitSlop={8}>
            <MaterialIcon name="close-circle" size={18} color={colors.muted} />
          </Pressable>
        ) : null}
      </View>
      <View style={[styles.periodRow, { marginTop: spacing.sm }]}>
        {(
          [
            { id: "all", label: "सब" },
            { id: "in", label: "⬇ Cash In" },
            { id: "out", label: "⬆ Cash Out" },
          ] as const
        ).map((f) => (
          <Pressable key={f.id} onPress={() => setDir(f.id)} style={[styles.periodChip, dir === f.id && styles.periodOn]} testID={`pocket-dir-${f.id}`}>
            <Text style={[styles.periodText, dir === f.id && { color: colors.onBrandPrimary }]}>{f.label}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.listHead}>
        <Text style={[styles.sectionHead, { flex: 1, marginTop: 0, marginBottom: 0 }]}>
          {filtering ? `मिले ${shownRows.length} / ${data.count}` : `सभी लेन-देन (${data.count})`}
        </Text>
        {filtering ? (
          <Pressable onPress={() => { setDir("all"); setKeyFilter(null); setQuery(""); }} hitSlop={8} testID="pocket-clear-filter">
            <Text style={styles.link}>फ़िल्टर हटाएँ</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );

  const sharePdfDoc = async () => {
    if (sharing) return;
    setSharing(true);
    try {
      const breakdownLines = [...inRows, ...outRows].map((r) => ({
        label: r.label(persona, pocket),
        value: `${isInflow(r.key) ? "+" : "−"}${formatINR(data.byKey.get(r.key) ?? 0)}`,
        tone: isInflow(r.key) ? ("ok" as const) : ("due" as const),
      }));
      const rows: RegisterRow[] = shownRows.map((r) => {
        const d = describe(r.t, persona, r.t.pocket, nameOf);
        return { date: r.t.date, title: d.title, sub: d.sub, amount: r.t.amount, inflow: isInflow(r.t.key), after: r.after };
      });
      const doc = registerDoc(user || {}, title, periodText, data, breakdownLines, rows);
      if (pdfSupported) await sharePdf(doc);
      else await shareMessage(doc.message);
    } catch {
      Alert.alert("PDF नहीं बन पाई", "दोबारा कोशिश करें।");
    } finally {
      setSharing(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surfaceSecondary }}>
      <View style={[styles.topBar, { paddingTop: insets.top + spacing.md }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} testID="pocket-back">
          <MaterialIcon name="arrow-left" size={26} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.topTitle} numberOfLines={1}>{title}</Text>
        <Pressable onPress={sharePdfDoc} hitSlop={8} disabled={sharing} testID="pocket-pdf">
          {sharing ? <ActivityIndicator size="small" color={colors.brandPrimary} /> : <MaterialIcon name="file-pdf-box" size={24} color={colors.brandPrimary} />}
        </Pressable>
        {both ? null : (
          <Pressable
            onPress={() => router.push({ pathname: "/pocket" as never, params: { p: pocket === "cash" ? "bank" : "cash", ...(period === "day" ? { date } : {}) } })}
            hitSlop={8}
            testID="pocket-switch"
          >
            <Text style={styles.link}>{pocket === "cash" ? "बैंक" : pocketTitle(persona, "cash")}</Text>
          </Pressable>
        )}
      </View>

      <FlatList
        data={items.slice(0, shown)}
        keyExtractor={(it) => (it.type === "day" ? `d-${it.date}` : it.t.id)}
        ListHeaderComponent={header}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl * 2 }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <MaterialIcon name="file-document-outline" size={32} color={colors.muted} />
            <Text style={styles.emptyText}>इस दौरान {title} में कुछ नहीं बदला</Text>
          </View>
        }
        ListFooterComponent={
          items.length > shown ? (
            <Pressable style={styles.moreBtn} onPress={() => setShown((n) => n + PAGE)} testID="pocket-more">
              <Text style={styles.link}>और दिखाएँ</Text>
            </Pressable>
          ) : null
        }
        renderItem={({ item }) =>
          item.type === "day" ? (
            <View style={styles.dayHead}>
              <Text style={styles.dayTitle}>{dayName(item.date)}</Text>
              <Text style={[styles.dayNet, { color: item.net < 0 ? colors.error : colors.success }]}>{signed(item.net)}</Text>
              <Text style={styles.dayClose}>बचा {formatINR(item.close)}</Text>
            </View>
          ) : (
            <TxnRow t={item.t} after={item.after} persona={persona} pocket={item.t.pocket} nameOf={nameOf} onPress={() => open(item.t)} />
          )
        }
      />

      <CalendarModal visible={calendar} value={date} onPick={(d) => { setDate(d); setShown(PAGE); }} onClose={() => setCalendar(false)} max={today} />
      <EditRecordSheet entry={editEntry} onClose={() => setEditEntry(null)} />
      <AddExpenseSheet visible={!!editExpense} initial={editExpense} onClose={() => setEditExpense(null)} />
      <AddExpenseSheet visible={expense && !both} initialMode={pocket === "bank" ? "online" : "cash"} onClose={() => setExpense(false)} />
      <MoneyMoveSheet kind={null} initial={editMove} onClose={() => setEditMove(null)} />
      <MoneyMoveSheet kind={move} initialPocket={pocket} onClose={() => setMove(null)} />
    </View>
  );
}

function describe(t: WalletTxn, persona: Persona, pocket: Pocket, nameOf: (id: string) => string): { title: string; sub: string; icon: string } {
  const s = t.src;
  if (s.kind === "entry") {
    const e = s.entry;
    const what =
      t.key === "fee"
        ? "पोर्टल फीस"
        : t.key === "work"
          ? "काम"
          : t.key === "received"
            ? "पैसे आए"
            : t.key === "purchase"
              ? e.type === "purchase" ? "सामान / सेवा" : "सामान / सेवा · चुकाया"
              : "पैसे गए";
    return { title: nameOf(e.customerId), sub: [what, e.description].filter(Boolean).join(" · "), icon: t.key === "fee" ? "receipt" : "account-outline" };
  }
  if (s.kind === "expense") {
    return { title: s.expense.title, sub: ["खर्च", s.expense.notes].filter(Boolean).join(" · "), icon: "coffee-outline" };
  }
  if (s.kind === "move") {
    const m = s.move;
    const title = t.key === "moveIn" ? (m.from ? `${accountLabel(m.from)} से आए` : "बाहर से जोड़े") : m.to ? `${accountLabel(m.to)} में गए` : "बाहर निकाले";
    return { title, sub: m.note || (t.key === "moveIn" ? "जोड़े" : "निकाले"), icon: m.from && m.to ? "swap-horizontal" : t.key === "moveIn" ? "plus-circle-outline" : "minus-circle-outline" };
  }
  const x = s.txn;
  return { title: x.customerName || "AEPS ग्राहक", sub: `${AEPS_META[x.type]?.hi ?? "AEPS"} · ${flowLabel(t.key, persona, pocket)}`, icon: "fingerprint" };
}

function TxnRow({ t, after, persona, pocket, nameOf, onPress }: { t: WalletTxn; after: number; persona: Persona; pocket: Pocket; nameOf: (id: string) => string; onPress: () => void }) {
  const d = describe(t, persona, pocket, nameOf);
  const inflow = isInflow(t.key);
  return (
    <Pressable style={styles.row} onPress={onPress} testID={`pocket-txn-${t.id}`}>
      <View style={[styles.rowIcon, { backgroundColor: inflow ? colors.successSoft : colors.errorSoft }]}>
        <MaterialIcon name={d.icon as never} size={18} color={inflow ? colors.success : colors.error} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.rowTitle} numberOfLines={1}>{d.title}</Text>
        <Text style={styles.rowSub} numberOfLines={2}>{d.sub}</Text>
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <Text style={[styles.rowAmt, { color: inflow ? colors.success : colors.error }]}>
          {inflow ? "+" : "−"}{formatINR(t.amount)}
        </Text>
        <Text style={[styles.rowBal, after < 0 && { color: colors.error }]}>बचा {formatINR(after)}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: "row", alignItems: "center", gap: spacing.lg, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, backgroundColor: colors.surface },
  topTitle: { flex: 1, fontSize: 18, fontWeight: "700", color: colors.onSurface },
  link: { fontSize: 13, fontWeight: "700", color: colors.brandPrimary },
  hero: { padding: spacing.lg, borderRadius: radius.lg, marginBottom: spacing.md },
  heroLabel: { fontSize: 14, fontWeight: "700", color: "#fff", opacity: 0.9 },
  heroValue: { fontSize: 32, fontWeight: "800", color: "#fff", marginTop: 4 },
  actions: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md },
  action: { flex: 1, alignItems: "center", gap: 4, paddingVertical: spacing.md, paddingHorizontal: 4, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  actionText: { fontSize: 12, fontWeight: "700", color: colors.onSurface },
  periodRow: { flexDirection: "row", gap: spacing.sm },
  periodChip: { flex: 1, alignItems: "center", paddingVertical: 7, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  periodOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  periodText: { fontSize: 13, fontWeight: "700", color: colors.onSurface },
  dateRow: { flexDirection: "row", alignItems: "center", marginTop: spacing.sm },
  arrow: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  dateBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  dateText: { fontSize: 16, fontWeight: "700", color: colors.onSurface },
  card: { marginTop: spacing.md, padding: spacing.lg, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  cardHead: { fontSize: 14, fontWeight: "800", color: colors.onSurface, marginBottom: spacing.xs },
  line: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm, paddingVertical: 5 },
  lineLabel: { flex: 1, fontSize: 14, color: colors.onSurfaceSecondary },
  lineValue: { fontSize: 15, fontWeight: "700", color: colors.onSurface },
  totalRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.xs, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  totalLabel: { fontSize: 15, fontWeight: "800", color: colors.onSurface },
  totalValue: { fontSize: 20, fontWeight: "800", color: colors.brandPrimary },
  formula: { fontSize: 12, color: colors.muted, marginTop: 6, textAlign: "right" },
  sectionHead: { fontSize: 14, fontWeight: "800", color: colors.onSurface, marginTop: spacing.lg, marginBottom: spacing.xs },
  dayHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingTop: spacing.md, paddingBottom: 6 },
  dayTitle: { flex: 1, fontSize: 13, fontWeight: "800", color: colors.onSurface },
  dayNet: { fontSize: 13, fontWeight: "800" },
  dayClose: { fontSize: 12, color: colors.muted, minWidth: 80, textAlign: "right" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, marginBottom: spacing.xs, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  rowIcon: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  rowTitle: { fontSize: 14, fontWeight: "700", color: colors.onSurface },
  rowSub: { fontSize: 12, color: colors.muted, marginTop: 2 },
  rowAmt: { fontSize: 15, fontWeight: "800" },
  rowBal: { fontSize: 12, color: colors.muted, marginTop: 2 },
  empty: { alignItems: "center", padding: spacing.xxl, gap: spacing.sm },
  emptyText: { fontSize: 14, color: colors.muted, textAlign: "center" },
  tileOn: { borderWidth: 2, borderColor: colors.brandPrimary },
  searchWrap: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: spacing.md, height: 44, borderWidth: 1, borderColor: colors.border, marginTop: spacing.lg },
  search: { flex: 1, color: colors.onSurface, fontSize: 15 },
  listHead: { flexDirection: "row", alignItems: "center", marginTop: spacing.lg, marginBottom: spacing.xs },
  moreBtn: { alignSelf: "center", paddingVertical: spacing.md, paddingHorizontal: spacing.xl },
});
