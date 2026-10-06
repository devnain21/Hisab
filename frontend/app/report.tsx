import { useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Alert } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import MaterialIcon from "@react-native-vector-icons/material-design-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radius, semantic, spacing } from "@/src/theme";
import { formatDateShort, formatINR, formatMonth, formatWeekdayDate, monthRange, roundMoney, shiftISO, todayISO, weekRange } from "@/src/lib/format";
import { Pressable } from "@/src/components/tap";
import { usePersona, type Persona } from "@/src/lib/persona";
import { computeBalance, isVendor } from "@/src/lib/data";
import { cashTotals, computeFlows, pocketIn, pocketNet, pocketOut, useMoneyBook, type FlowKey, type Pocket } from "@/src/lib/wallet";
import { metricRows, metricSum, shopProfit, type MetricKind } from "@/src/lib/metrics";
import { useBudget } from "@/src/lib/budget";
import { useAuth } from "@/src/context/AuthContext";
import { pdfSupported, reportDoc, sharePdf, type Line } from "@/src/lib/receipt";
import { shareMessage } from "@/src/lib/share-text";
import { exportFullLedgerCsv } from "@/src/lib/export-data";
import { TERMS, balanceTerm } from "@/src/lib/terms";
import { HIDDEN, usePrefs } from "@/src/lib/prefs";
import { IN_ROWS, OUT_ROWS, pocketTitle } from "@/src/components/pocket-card";
import { FLOW, FlowHead, FlowRow, FlowTile, NetRow, signedINR } from "@/src/components/money-flow";
import { CalendarModal } from "@/src/components/calendar-modal";

type Book = ReturnType<typeof useMoneyBook>;
type Period = "day" | "week" | "month";
const PERIODS: { id: Period; label: string }[] = [
  { id: "day", label: "दिन" },
  { id: "week", label: "हफ़्ता" },
  { id: "month", label: "महीना" },
];

type Stats = {
  billed: number;
  billedCount: number;
  collected: number;
  commission: number;
  fee: number;
  expense: number;
  given: number;
  paidOut: number;
  /** Business: agreed value of vendor orders booked in the period (outsourced work / stock). */
  vendorCost: number;
  byCat: [string, number][];
  /** Business: billed + commission − expenses − fees − vendor cost. Personal: money in − money out. */
  result: number;
};

function periodStats(book: Book, persona: Persona, from: string, to: string): Stats {
  const sum = (k: MetricKind) => metricSum(book, persona, k, from, to);
  const work = metricRows(book, persona, "work", from, to);
  const cats = new Map<string, number>();
  for (const r of metricRows(book, persona, "expense", from, to)) {
    if (r.source === "expense") cats.set(r.expense.title, (cats.get(r.expense.title) ?? 0) + r.amount);
  }
  const billed = roundMoney(work.reduce((s, r) => s + r.amount, 0));
  const collected = sum("collected");
  const commission = sum("commission");
  const fee = sum("fee");
  const expense = sum("expense");
  const given = sum("given");
  const paidOut = sum("paidOut");
  const vendorCost = sum("vendor");
  const result = persona === "business" ? shopProfit(book, from, to).profit : collected - given - paidOut - expense;
  return {
    billed,
    billedCount: work.length,
    collected,
    commission,
    fee,
    expense,
    given,
    paidOut,
    vendorCost,
    byCat: [...cats].sort((x, y) => y[1] - x[1]),
    result: roundMoney(result),
  };
}

/** "+12%" against the period before; empty when that had nothing to compare with. */
function change(now: number, before: number): { text: string; up: boolean } | null {
  if (before <= 0 || now === before) return null;
  const pct = Math.round(((now - before) / before) * 100);
  if (pct === 0) return null;
  return { text: `${pct > 0 ? "+" : ""}${pct}%`, up: pct > 0 };
}

function rangeOf(period: Period, date: string) {
  return period === "week" ? weekRange(date) : period === "month" ? monthRange(date) : { from: date, to: date };
}

/** Every summary in one place: cash in / out, the two accounts, where money came from and went, profit and what is still owed. */
export default function ReportScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { persona, isPersonal } = usePersona();
  const { user } = useAuth();
  const book = useMoneyBook();
  const budget = useBudget();
  const { hideAmounts } = usePrefs();
  const money = (n: number) => (hideAmounts ? HIDDEN : formatINR(n));
  const today = todayISO();
  const params = useLocalSearchParams<{ month?: string; period?: string; date?: string }>();
  const { month } = params;
  const askedPeriod = params.period === "day" || params.period === "week" || params.period === "month" ? (params.period as Period) : null;
  const askedDate = params.date && params.date <= today ? params.date : null;
  const [period, setPeriod] = useState<Period>(askedPeriod ?? (month ? "month" : "day"));
  const [date, setDate] = useState(askedDate ?? (month === "prev" ? monthRange(today, -1).from : today));
  const [calendar, setCalendar] = useState(false);
  const [sharing, setSharing] = useState(false);

  const range = rangeOf(period, date);
  const { from, to: end } = range;
  const to = end < today ? end : today;
  const prevRange = rangeOf(period, period === "week" ? shiftISO(from, -7) : period === "month" ? monthRange(from, -1).from : shiftISO(from, -1));
  const prevFrom = prevRange.from;
  const prevTo = prevRange.to;
  const isCurrent = range.to >= today;
  const label =
    period === "day"
      ? date === today ? "आज" : date === todayISO(-1) ? "कल" : formatWeekdayDate(date)
      : period === "week"
        ? `${formatDateShort(range.from)} – ${formatDateShort(range.to)}`
        : formatMonth(range.from);
  const step = (n: number) => {
    const next = period === "week" ? shiftISO(date, 7 * n) : period === "month" ? monthRange(date, n).from : shiftISO(date, n);
    setDate(next > today ? today : next);
  };
  const nav = { period, date: period === "day" ? date : range.from };

  const flow = useMemo(() => cashTotals(book, persona, (d) => d >= from && d <= to), [book, persona, from, to]);
  const accounts = useMemo(() => {
    const before = computeFlows(book, persona, (d) => d < from);
    const during = computeFlows(book, persona, (d) => d >= from && d <= to);
    return (["cash", "bank"] as Pocket[]).map((p) => {
      const opening = pocketNet(before[p]);
      return { p, opening, ins: pocketIn(during[p]), outs: pocketOut(during[p]), closing: roundMoney(opening + pocketNet(during[p])) };
    });
  }, [book, persona, from, to]);
  // Rows dated after today are plans, not money yet; the cash figures stop at today too.
  const now = useMemo(() => periodStats(book, persona, from, to), [book, persona, from, to]);
  const prev = useMemo(() => periodStats(book, persona, prevFrom, prevTo), [book, persona, prevFrom, prevTo]);

  const balances = useMemo(() => {
    const mine = book.customers.filter((c) => (isPersonal ? c.persona === "personal" : c.persona !== "personal"));
    return mine.map((c) => ({ c, bal: roundMoney(computeBalance(book.entries, c.id)), vendor: !isPersonal && isVendor(c) }));
  }, [book.customers, book.entries, isPersonal]);
  const owedToYou = balances.filter((b) => !b.vendor && b.bal > 0).sort((a, b) => b.bal - a.bal);
  const youOwe = balances.filter((b) => !b.vendor && b.bal < 0).sort((a, b) => a.bal - b.bal);
  const vendorsOwed = balances.filter((b) => b.vendor && b.bal < 0).sort((a, b) => a.bal - b.bal);
  const vendorPayable = roundMoney(vendorsOwed.reduce((s, b) => s - b.bal, 0));
  const outstanding = roundMoney(owedToYou.reduce((s, b) => s + b.bal, 0));
  const theirs = roundMoney(youOwe.reduce((s, b) => s - b.bal, 0));
  const recovery = !isPersonal && period === "month" && isCurrent && now.collected + outstanding > 0 ? Math.round((now.collected / (now.collected + outstanding)) * 100) : null;

  const resultLabel = isPersonal ? "बचत" : "कमाई";
  const profitRows: { label: string; value: number; sign: "+" | "−"; kind: MetricKind }[] = isPersonal
    ? [
        { label: "पैसे आए", value: now.collected, sign: "+", kind: "collected" },
        { label: "लोगों को गए", value: now.given, sign: "−", kind: "given" },
        { label: "सामान / सेवा चुकाए", value: now.paidOut, sign: "−", kind: "paidOut" },
        { label: "खर्च", value: now.expense, sign: "−", kind: "expense" },
      ]
    : [
        { label: `काम / बिक्री (${now.billedCount})`, value: now.billed, sign: "+", kind: "work" },
        { label: "कमीशन", value: now.commission, sign: "+", kind: "commission" },
        { label: "खर्च", value: now.expense, sign: "−", kind: "expense" },
        { label: "पोर्टल फीस", value: now.fee, sign: "−", kind: "fee" },
        ...(now.vendorCost > 0 ? [{ label: "Vendor लागत", value: now.vendorCost, sign: "−" as const, kind: "vendor" as const }] : []),
      ];
  const openMetric = (kind: MetricKind) => router.push({ pathname: "/entries" as never, params: { kind, from, to } });
  const resultChange = change(now.result, prev.result);

  const sourceRows = (rows: typeof IN_ROWS) => rows.map((r) => ({ r, v: flow.byKey.get(r.key) ?? 0 })).filter((x) => x.v > 0);
  const ins = sourceRows(IN_ROWS);
  const outs = sourceRows(OUT_ROWS);
  const maxSource = Math.max(1, ...ins.map((x) => x.v), ...outs.map((x) => x.v));
  const openFlow = (dir: "in" | "out", key?: FlowKey) => router.push({ pathname: "/pocket" as never, params: { p: "all", dir, ...(key ? { key } : {}), ...nav } });
  const openPocket = (p: Pocket) => router.push({ pathname: "/pocket" as never, params: { p, ...nav } });
  const openCustomers = (filter: "due" | "owe") => router.push({ pathname: "/(tabs)/customers", params: { filter, book: "customer", t: String(Date.now()) } });
  const openVendors = () => router.push({ pathname: "/(tabs)/customers", params: { filter: "owe", book: "vendor", t: String(Date.now()) } });

  const sharePdfDoc = async () => {
    if (sharing) return;
    setSharing(true);
    try {
      const lines: Line[] = [
        { label: FLOW.in.title, value: formatINR(flow.ins), tone: "ok" },
        { label: FLOW.out.title, value: formatINR(flow.outs), tone: "due" },
        { label: FLOW.net.title, value: signedINR(flow.net), tone: flow.net < 0 ? "due" : "ok" },
        ...profitRows.map((r) => ({ label: r.label, value: `${r.sign}${formatINR(r.value)}` })),
      ];
      const account: Line = { label: resultLabel, value: formatINR(now.result), tone: now.result < 0 ? "due" : "ok" };
      const doc = reportDoc(user || {}, isPersonal ? "मेरी रिपोर्ट" : "रिपोर्ट", label, lines, account, [
        { title: "खाते", lines: accounts.map((a) => ({ label: pocketTitle(persona, a.p), value: `${formatINR(a.opening)} → ${formatINR(a.closing)}` })) },
        { title: "खर्च कहाँ हुआ", lines: now.byCat.map(([t, v]) => ({ label: t, value: formatINR(v) })) },
        { title: `${TERMS.get} (अभी)`, lines: owedToYou.slice(0, 10).map((b) => ({ label: b.c.name, value: formatINR(b.bal), tone: "due" as const })) },
        ...(isPersonal ? [{ title: `${TERMS.give} (अभी)`, lines: youOwe.slice(0, 10).map((b) => ({ label: b.c.name, value: formatINR(-b.bal) })) }] : []),
        ...(vendorsOwed.length ? [{ title: "Vendor को देने हैं (अभी)", lines: vendorsOwed.slice(0, 10).map((b) => ({ label: b.c.name, value: formatINR(-b.bal), tone: "due" as const })) }] : []),
      ]);
      if (pdfSupported) await sharePdf(doc);
      else await shareMessage(doc.message);
    } catch {
      Alert.alert("PDF नहीं बन पाई", "दोबारा कोशिश करें।");
    } finally {
      setSharing(false);
    }
  };

  const shareCsv = async () => {
    if (sharing) return;
    setSharing(true);
    try {
      await exportFullLedgerCsv({ ...book, jobs: [], shop: user, only: persona, range: { ...range, label } });
    } catch {
      Alert.alert("फ़ाइल नहीं बन पाई", "दोबारा कोशिश करें।");
    } finally {
      setSharing(false);
    }
  };

  const maxCat = now.byCat[0]?.[1] ?? 0;
  const monthBudget = isPersonal && period === "month" && isCurrent ? budget.total : 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors.surfaceSecondary }}>
      <View style={[styles.topBar, { paddingTop: insets.top + spacing.md }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} testID="report-back">
          <MaterialIcon name="arrow-left" size={26} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.topTitle}>रिपोर्ट</Text>
        <Pressable onPress={shareCsv} hitSlop={8} disabled={sharing} style={{ marginRight: spacing.md }} accessibilityLabel="Excel फ़ाइल भेजें" testID="report-csv">
          <MaterialIcon name="microsoft-excel" size={26} color={colors.success} />
        </Pressable>
        <Pressable onPress={sharePdfDoc} hitSlop={8} disabled={sharing} accessibilityLabel="PDF भेजें" testID="report-pdf">
          {sharing ? <ActivityIndicator size="small" color={colors.brandPrimary} /> : <MaterialIcon name="file-pdf-box" size={26} color={colors.brandPrimary} />}
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl * 2 }}>
        <View style={styles.segment}>
          {PERIODS.map((p) => (
            <Pressable hitSlop={{ top: 3, bottom: 3 }} key={p.id} onPress={() => setPeriod(p.id)} style={[styles.segmentBtn, period === p.id && styles.segmentOn]} testID={`report-period-${p.id}`}>
              <Text style={[styles.segmentText, period === p.id && { color: colors.onBrandPrimary }]}>{p.label}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.monthRow}>
          <Pressable onPress={() => step(-1)} hitSlop={10} style={styles.monthBtn} testID="report-prev">
            <MaterialIcon name="chevron-left" size={24} color={colors.onSurface} />
          </Pressable>
          <Pressable onPress={() => setCalendar(true)} style={styles.monthLabel} testID="report-date">
            <MaterialIcon name="calendar-month-outline" size={18} color={colors.brandPrimary} />
            <Text style={styles.monthText}>{label}</Text>
          </Pressable>
          <Pressable onPress={() => step(1)} hitSlop={10} style={[styles.monthBtn, isCurrent && { opacity: 0.3 }]} disabled={isCurrent} testID="report-next">
            <MaterialIcon name="chevron-right" size={24} color={colors.onSurface} />
          </Pressable>
        </View>

        <Text style={styles.sectionTitle}>पैसा आया-गया</Text>
        <View style={styles.card}>
          <View style={styles.tiles}>
            <FlowTile dir="in" value={money(flow.ins)} onPress={() => openFlow("in")} testID="report-cash-in" />
            <FlowTile dir="out" value={money(flow.outs)} onPress={() => openFlow("out")} testID="report-cash-out" />
          </View>
          <NetRow value={flow.net} fmt={money} onPress={() => (period === "day" ? router.push({ pathname: "/day", params: { type: "drawer", date } }) : router.push({ pathname: "/pocket" as never, params: { p: "all", ...nav } }))} testID="report-net" />
        </View>

        <Text style={styles.sectionTitle}>खाते</Text>
        <View style={styles.tiles}>
          {accounts.map((a) => (
            <Pressable key={a.p} style={[styles.card, styles.account]} onPress={() => openPocket(a.p)} testID={`report-account-${a.p}`}>
              <View style={styles.accountHead}>
                <MaterialIcon name={a.p === "cash" ? "cash-multiple" : "bank-outline"} size={18} color={a.p === "cash" ? semantic.cash : semantic.bank} />
                <Text style={styles.cardTitle}>{pocketTitle(persona, a.p)}</Text>
                <MaterialIcon name="chevron-right" size={16} color={colors.muted} style={{ marginLeft: "auto" }} />
              </View>
              <Text style={styles.small}>शुरू में {money(a.opening)}</Text>
              <Text style={[styles.small, { color: FLOW.in.color }]}>⬇ +{money(a.ins)}</Text>
              <Text style={[styles.small, { color: FLOW.out.color }]}>⬆ −{money(a.outs)}</Text>
              <Text style={[styles.closing, a.closing < 0 && { color: colors.error }]} numberOfLines={1} adjustsFontSizeToFit>{money(a.closing)}</Text>
              <Text style={styles.small}>अंत में</Text>
            </Pressable>
          ))}
        </View>

        {ins.length + outs.length > 0 ? (
          <View style={styles.card}>
            {ins.length ? <FlowHead dir="in" /> : null}
            {ins.map(({ r, v }) => (
              <SourceBar key={r.key} label={r.label(persona, "cash")} value={`+${money(v)}`} pct={v / maxSource} color={FLOW.in.color} onPress={() => openFlow("in", r.key)} testID={`report-in-${r.key}`} />
            ))}
            {outs.length ? <FlowHead dir="out" /> : null}
            {outs.map(({ r, v }) => (
              <SourceBar key={r.key} label={r.label(persona, "cash")} value={`−${money(v)}`} pct={v / maxSource} color={FLOW.out.color} onPress={() => openFlow("out", r.key)} testID={`report-out-${r.key}`} />
            ))}
          </View>
        ) : null}

        <Text style={styles.sectionTitle}>{resultLabel}</Text>
        <View style={styles.card}>
          <Pressable
            style={styles.profitHead}
            onPress={() => router.push({ pathname: "/day", params: { type: isPersonal ? "txns" : "work", date: period === "day" ? date : range.from, period } })}
            accessibilityRole="button"
            testID="report-result"
          >
            <Text style={[styles.profitValue, now.result < 0 && { color: colors.error }]}>{now.result < 0 ? "−" : ""}{money(Math.abs(now.result))}</Text>
            {resultChange ? (
              <View style={styles.changePill}>
                <MaterialIcon name={resultChange.up ? "arrow-up" : "arrow-down"} size={12} color={resultChange.up ? colors.success : colors.error} />
                <Text style={[styles.changeText, { color: resultChange.up ? colors.success : colors.error }]}>{resultChange.text}</Text>
              </View>
            ) : null}
            <View style={{ flex: 1 }} />
            <MaterialIcon name="chevron-right" size={18} color={colors.muted} />
          </Pressable>
          {profitRows.map((r) => (
            <FlowRow
              key={r.label}
              label={r.label}
              value={`${r.sign}${money(r.value)}`}
              color={r.sign === "+" ? FLOW.in.color : FLOW.out.color}
              onPress={() => openMetric(r.kind)}
              testID={`report-metric-${r.kind}`}
            />
          ))}
        </View>

        {monthBudget > 0 ? (
          <Pressable style={styles.card} onPress={() => openMetric("expense")} accessibilityRole="button" testID="report-budget">
            <View style={styles.rowBetween}>
              <Text style={styles.cardTitle}>बजट</Text>
              <Text style={styles.cardTitle}>{money(now.expense)} / {money(monthBudget)}</Text>
            </View>
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${Math.min(100, Math.max(2, (now.expense / monthBudget) * 100))}%`, backgroundColor: now.expense > monthBudget ? colors.error : colors.success }]} />
            </View>
          </Pressable>
        ) : null}

        {now.byCat.length > 0 ? (
          <Pressable style={styles.card} onPress={() => openMetric("expense")} testID="report-expenses">
            <View style={styles.rowBetween}>
              <Text style={styles.cardTitle}>खर्च</Text>
              <MaterialIcon name="chevron-right" size={16} color={colors.muted} />
            </View>
            {now.byCat.slice(0, 6).map(([t, v]) => (
              <View key={t} style={{ marginTop: spacing.sm }}>
                <View style={styles.rowBetween}>
                  <Text style={styles.rowLabel} numberOfLines={1}>{t}</Text>
                  <Text style={styles.rowValue}>{money(v)}</Text>
                </View>
                <View style={styles.track}>
                  <View style={[styles.fill, { width: `${Math.max(2, (v / maxCat) * 100)}%`, backgroundColor: colors.warning }]} />
                </View>
              </View>
            ))}
          </Pressable>
        ) : null}

        <Text style={styles.sectionTitle}>बाकी</Text>
        <View style={styles.tiles}>
          <Pressable style={[styles.card, styles.account]} onPress={() => openCustomers("due")} testID="report-owed">
            <Text style={styles.small}>{TERMS.getShort} · {owedToYou.length}</Text>
            <Text style={[styles.closing, { color: outstanding > 0 ? semantic.due : colors.onSurface }]} numberOfLines={1} adjustsFontSizeToFit>{money(outstanding)}</Text>
          </Pressable>
          <Pressable style={[styles.card, styles.account]} onPress={() => openCustomers("owe")} testID="report-owe">
            <Text style={styles.small}>{isPersonal ? TERMS.giveShort : TERMS.advanceShort} · {youOwe.length}</Text>
            <Text style={[styles.closing, { color: theirs > 0 ? semantic.pending : colors.onSurface }]} numberOfLines={1} adjustsFontSizeToFit>{money(theirs)}</Text>
          </Pressable>
        </View>
        {vendorsOwed.length > 0 ? (
          <Pressable style={[styles.card, styles.rowBetween]} onPress={openVendors} testID="report-vendor-payable">
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, flexShrink: 1 }}>
              <MaterialIcon name="truck-outline" size={18} color={colors.info} />
              <Text style={styles.cardTitle} numberOfLines={1}>Vendor को देने · {vendorsOwed.length}</Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
              <Text style={[styles.rowValue, { color: semantic.due, fontSize: 16 }]}>{money(vendorPayable)}</Text>
              <MaterialIcon name="chevron-right" size={16} color={colors.muted} />
            </View>
          </Pressable>
        ) : null}
        {recovery !== null ? <FlowRow label="वसूली दर (इस महीने)" value={`${recovery}%`} color={recovery >= 60 ? colors.success : recovery >= 35 ? colors.warning : colors.error} /> : null}

        {owedToYou.length > 0 ? (
          <PeopleCard title={`${TERMS.get} · सबसे ज़्यादा`} rows={owedToYou.slice(0, 5)} color={semantic.due} personal={isPersonal} money={money} onOpen={(id) => router.push(`/customer/${id}`)} onAll={() => openCustomers("due")} />
        ) : null}
        {isPersonal && youOwe.length > 0 ? (
          <PeopleCard title={`${TERMS.give} · सबसे ज़्यादा`} rows={youOwe.slice(0, 5)} color={semantic.pending} personal money={money} onOpen={(id) => router.push(`/customer/${id}`)} onAll={() => openCustomers("owe")} />
        ) : null}
      </ScrollView>

      <CalendarModal visible={calendar} value={date} onPick={(d) => setDate(d)} onClose={() => setCalendar(false)} max={today} />
    </View>
  );
}

function SourceBar({ label, value, pct, color, onPress, testID }: { label: string; value: string; pct: number; color: string; onPress: () => void; testID?: string }) {
  return (
    <Pressable style={styles.source} onPress={onPress} testID={testID}>
      <View style={styles.rowBetween}>
        <Text style={styles.rowLabel} numberOfLines={1}>{label}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
          <Text style={[styles.rowValue, { color }]}>{value}</Text>
          <MaterialIcon name="chevron-right" size={16} color={colors.muted} />
        </View>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${Math.max(2, pct * 100)}%`, backgroundColor: color }]} />
      </View>
    </Pressable>
  );
}

function PeopleCard({
  title,
  rows,
  color,
  personal,
  money,
  onOpen,
  onAll,
}: {
  title: string;
  rows: { c: { id: string; name: string }; bal: number }[];
  color: string;
  personal: boolean;
  money: (n: number) => string;
  onOpen: (id: string) => void;
  onAll: () => void;
}) {
  return (
    <View style={styles.card}>
      <Pressable style={styles.rowBetween} onPress={onAll} hitSlop={8}>
        <Text style={styles.cardTitle}>{title}</Text>
        <MaterialIcon name="chevron-right" size={16} color={colors.muted} />
      </Pressable>
      {rows.map((r, i) => (
        <Pressable key={r.c.id} style={[styles.personRow, i > 0 && styles.personBorder]} onPress={() => onOpen(r.c.id)}>
          <Text style={styles.rank}>{i + 1}</Text>
          <Text style={[styles.rowLabel, { flex: 1 }]} numberOfLines={1}>{r.c.name}</Text>
          <Text style={[styles.rowValue, { color }]}>{money(Math.abs(r.bal))}</Text>
          <Text style={styles.tag}>{balanceTerm(r.bal, personal, true)}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: "row", alignItems: "center", gap: spacing.lg, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, backgroundColor: colors.surface },
  topTitle: { flex: 1, fontSize: 18, fontWeight: "700", color: colors.onSurface },
  segment: { flexDirection: "row", gap: 4, padding: 4, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm },
  segmentBtn: { flex: 1, alignItems: "center", justifyContent: "center", minHeight: 38, borderRadius: radius.sm },
  segmentOn: { backgroundColor: colors.brandPrimary },
  segmentText: { fontSize: 13, fontWeight: "700", color: colors.onSurface },
  monthRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.sm },
  monthBtn: { width: 40, height: 40, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  monthLabel: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  monthText: { fontSize: 16, fontWeight: "800", color: colors.onSurface },
  sectionTitle: { fontSize: 13, fontWeight: "800", color: colors.muted, marginTop: spacing.md, marginBottom: spacing.sm, textTransform: "uppercase" },
  card: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm },
  tiles: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.xs },
  account: { flex: 1, minWidth: 0, gap: 2 },
  accountHead: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
  cardTitle: { fontSize: 14, fontWeight: "800", color: colors.onSurface },
  small: { fontSize: 12, color: colors.muted, fontWeight: "600", fontVariant: ["tabular-nums"] },
  closing: { fontSize: 20, fontWeight: "800", color: colors.onSurface, marginTop: 4, fontVariant: ["tabular-nums"] },
  source: { paddingVertical: 6 },
  profitHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.xs },
  profitValue: { fontSize: 28, fontWeight: "800", color: colors.brandPrimary, fontVariant: ["tabular-nums"] },
  changePill: { flexDirection: "row", alignItems: "center", gap: 2, paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary },
  changeText: { fontSize: 12, fontWeight: "700", color: colors.muted },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.surfaceSecondary, overflow: "hidden", marginTop: 6 },
  fill: { height: 6, borderRadius: 3 },
  rowLabel: { fontSize: 13, color: colors.onSurface, fontWeight: "600", flexShrink: 1 },
  rowValue: { fontSize: 13, fontWeight: "800", color: colors.onSurface, fontVariant: ["tabular-nums"] },
  personRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm },
  personBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  rank: { width: 20, fontSize: 12, fontWeight: "800", color: colors.muted },
  tag: { fontSize: 12, color: colors.muted, width: 52, textAlign: "right" },
});
