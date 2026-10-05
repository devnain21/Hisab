import { useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Alert } from "react-native";
import { useRouter } from "expo-router";
import MaterialIcon from "@react-native-vector-icons/material-design-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radius, spacing } from "@/src/theme";
import { formatINR, formatMonth, monthRange, roundMoney, todayISO } from "@/src/lib/format";
import { Pressable } from "@/src/components/tap";
import { usePersona, type Persona } from "@/src/lib/persona";
import { computeBalance, isRepayment } from "@/src/lib/data";
import { expensePersona } from "@/src/lib/expenses";
import { personaOfEntry, useMoneyBook } from "@/src/lib/wallet";
import { commissionDate } from "@/src/lib/aeps";
import { useBudget } from "@/src/lib/budget";
import { useAuth } from "@/src/context/AuthContext";
import { pdfSupported, reportDoc, sharePdf, type Line } from "@/src/lib/receipt";
import { shareMessage } from "@/src/lib/share-text";
import { TERMS, balanceTerm } from "@/src/lib/terms";

type Book = ReturnType<typeof useMoneyBook>;

type MonthStats = {
  billed: number;
  billedCount: number;
  collected: number;
  commission: number;
  fee: number;
  expense: number;
  given: number;
  paidOut: number;
  byCat: [string, number][];
  /** Business: billed + commission − expenses − fees. Personal: money in − money out. */
  result: number;
};

function monthStats(book: Book, persona: Persona, from: string, to: string): MonthStats {
  const inMonth = (d: string) => d >= from && d <= to;
  const byId = new Map(book.customers.map((c) => [c.id, c]));
  let billed = 0, billedCount = 0, collected = 0, fee = 0, given = 0, paidOut = 0;
  for (const e of book.entries) {
    if (!inMonth(e.date) || personaOfEntry(e, byId) !== persona) continue;
    if (e.type === "work") {
      billed += e.amount;
      billedCount += 1;
      collected += e.paid ?? 0;
      fee += e.fee ?? 0;
    } else if (e.type === "payment") collected += e.amount;
    else if (e.type === "purchase") paidOut += e.paid ?? 0;
    else if (e.type === "given") {
      if (isRepayment(e)) paidOut += e.amount;
      else given += e.amount;
    }
  }
  const cats = new Map<string, number>();
  let expense = 0;
  for (const x of book.expenses) {
    if (!inMonth(x.date) || expensePersona(x) !== persona) continue;
    expense += x.amount;
    cats.set(x.title, (cats.get(x.title) ?? 0) + x.amount);
  }
  // By its day like the work and expenses above; galla flows would leave out late-typed rows.
  let commission = 0;
  if (persona === "business") {
    for (const t of book.aeps) {
      const day = t.commission > 0 ? commissionDate(t) : null;
      if (day && inMonth(day)) commission += t.commission;
    }
  }
  const result = persona === "business" ? billed + commission - expense - fee : collected - given - paidOut - expense;
  return {
    billed: roundMoney(billed),
    billedCount,
    collected: roundMoney(collected),
    commission: roundMoney(commission),
    fee: roundMoney(fee),
    expense: roundMoney(expense),
    given: roundMoney(given),
    paidOut: roundMoney(paidOut),
    byCat: [...cats].sort((a, b) => b[1] - a[1]),
    result: roundMoney(result),
  };
}

/** "+12%" against last month; empty when last month had nothing to compare with. */
function change(now: number, before: number): { text: string; up: boolean } | null {
  if (before <= 0 || now === before) return null;
  const pct = Math.round(((now - before) / before) * 100);
  if (pct === 0) return null;
  return { text: `${pct > 0 ? "+" : ""}${pct}%`, up: pct > 0 };
}

export default function ReportScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { persona, isPersonal } = usePersona();
  const { user } = useAuth();
  const book = useMoneyBook();
  const budget = useBudget();
  const today = todayISO();
  const [offset, setOffset] = useState(0);
  const [sharing, setSharing] = useState(false);

  const range = monthRange(today, offset);
  const prevRange = monthRange(today, offset - 1);
  const period = formatMonth(range.from);
  const isCurrent = offset === 0;

  const now = useMemo(() => monthStats(book, persona, range.from, range.to), [book, persona, range.from, range.to]);
  const prev = useMemo(() => monthStats(book, persona, prevRange.from, prevRange.to), [book, persona, prevRange.from, prevRange.to]);

  const balances = useMemo(() => {
    const mine = book.customers.filter((c) => (isPersonal ? c.persona === "personal" : c.persona !== "personal"));
    return mine.map((c) => ({ c, bal: roundMoney(computeBalance(book.entries, c.id)) }));
  }, [book.customers, book.entries, isPersonal]);
  const owedToYou = balances.filter((b) => b.bal > 0).sort((a, b) => b.bal - a.bal);
  const youOwe = balances.filter((b) => b.bal < 0).sort((a, b) => a.bal - b.bal);
  const outstanding = owedToYou.reduce((s, b) => s + b.bal, 0);
  const recovery = now.collected + outstanding > 0 ? Math.round((now.collected / (now.collected + outstanding)) * 100) : null;

  const resultLabel = isPersonal ? "महीने की बचत" : "अनुमानित कमाई";
  const formula = isPersonal
    ? "मिले − (लोगों को दिए + सामान/उधार चुकाए + खर्च)"
    : "काम/बिक्री + AEPS कमीशन − खर्च − पोर्टल फीस · सामान की ख़रीद इसमें नहीं जुड़ी";

  type Metric = { label: string; value: number; before: number; tone?: "good" | "bad"; goodWhenUp: boolean };
  const metrics: Metric[] = isPersonal
    ? [
        { label: "मिले", value: now.collected, before: prev.collected, tone: "good", goodWhenUp: true },
        { label: "लोगों को दिए", value: now.given, before: prev.given, goodWhenUp: false },
        { label: "चुकाए", value: now.paidOut, before: prev.paidOut, goodWhenUp: false },
        { label: "खर्च", value: now.expense, before: prev.expense, tone: "bad", goodWhenUp: false },
      ]
    : [
        { label: `काम / बिक्री (${now.billedCount})`, value: now.billed, before: prev.billed, goodWhenUp: true },
        { label: "पैसे मिले", value: now.collected, before: prev.collected, tone: "good", goodWhenUp: true },
        { label: "AEPS कमीशन", value: now.commission, before: prev.commission, tone: "good", goodWhenUp: true },
        { label: "खर्च + फीस", value: now.expense + now.fee, before: prev.expense + prev.fee, tone: "bad", goodWhenUp: false },
      ];

  const sharePdfDoc = async () => {
    if (sharing) return;
    setSharing(true);
    try {
      const lines: Line[] = metrics.map((m) => ({ label: m.label, value: formatINR(m.value), tone: m.tone === "good" ? "ok" : m.tone === "bad" ? "due" : undefined }));
      const account: Line = { label: resultLabel, value: formatINR(now.result), tone: now.result < 0 ? "due" : "ok" };
      const doc = reportDoc(user || {}, isPersonal ? "मेरी मासिक रिपोर्ट" : "मासिक रिपोर्ट", period, lines, account, [
        { title: "खर्च कहाँ हुआ", lines: now.byCat.map(([t, v]) => ({ label: t, value: formatINR(v) })) },
        { title: `${TERMS.get} (अभी)`, lines: owedToYou.slice(0, 10).map((b) => ({ label: b.c.name, value: formatINR(b.bal), tone: "due" as const })) },
        ...(isPersonal ? [{ title: `${TERMS.give} (अभी)`, lines: youOwe.slice(0, 10).map((b) => ({ label: b.c.name, value: formatINR(-b.bal) })) }] : []),
        { title: "हिसाब का तरीका", lines: [{ label: resultLabel, value: formula }] },
      ]);
      if (pdfSupported) await sharePdf(doc);
      else await shareMessage(doc.message);
    } catch {
      Alert.alert("PDF नहीं बन पाई", "दोबारा कोशिश करें।");
    } finally {
      setSharing(false);
    }
  };

  const maxCat = now.byCat[0]?.[1] ?? 0;
  const monthBudget = isPersonal && isCurrent ? budget.total : 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors.surfaceSecondary }}>
      <View style={[styles.topBar, { paddingTop: insets.top + spacing.md }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} testID="report-back">
          <MaterialIcon name="arrow-left" size={26} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.topTitle}>महीने की रिपोर्ट</Text>
        <Pressable onPress={sharePdfDoc} hitSlop={8} disabled={sharing} testID="report-pdf">
          {sharing ? <ActivityIndicator size="small" color={colors.brandPrimary} /> : <MaterialIcon name="file-pdf-box" size={26} color={colors.brandPrimary} />}
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl * 2 }}>
        <View style={styles.monthRow}>
          <Pressable onPress={() => setOffset(offset - 1)} hitSlop={10} style={styles.monthBtn} testID="report-prev">
            <MaterialIcon name="chevron-left" size={24} color={colors.onSurface} />
          </Pressable>
          <Text style={styles.monthText}>{period}{isCurrent ? " (अभी तक)" : ""}</Text>
          <Pressable onPress={() => setOffset(offset + 1)} hitSlop={10} style={[styles.monthBtn, isCurrent && { opacity: 0.3 }]} disabled={isCurrent} testID="report-next">
            <MaterialIcon name="chevron-right" size={24} color={colors.onSurface} />
          </Pressable>
        </View>

        <View style={styles.hero}>
          <Text style={styles.heroLabel}>{resultLabel}</Text>
          <Text style={styles.heroValue}>{now.result < 0 ? "−" : ""}{formatINR(Math.abs(now.result))}</Text>
          {(() => {
            const c = change(now.result, prev.result);
            return c ? (
              <Text style={styles.heroHint}>
                पिछले महीने से {c.text} · पिछला {formatINR(prev.result)}
              </Text>
            ) : (
              <Text style={styles.heroHint}>पिछला महीना: {formatINR(prev.result)}</Text>
            );
          })()}
          <Text style={styles.formula}>{formula}</Text>
        </View>

        <View style={styles.grid}>
          {metrics.map((m) => {
            const c = change(m.value, m.before);
            const good = c ? c.up === m.goodWhenUp : true;
            return (
              <View key={m.label} style={styles.metric}>
                <Text style={styles.metricLabel} numberOfLines={1}>{m.label}</Text>
                <Text style={[styles.metricValue, m.tone === "good" && { color: colors.success }, m.tone === "bad" && { color: colors.error }]}>{formatINR(m.value)}</Text>
                {c ? (
                  <View style={styles.changeRow}>
                    <MaterialIcon name={c.up ? "arrow-up" : "arrow-down"} size={12} color={good ? colors.success : colors.error} />
                    <Text style={[styles.changeText, { color: good ? colors.success : colors.error }]}>{c.text}</Text>
                  </View>
                ) : (
                  <Text style={styles.changeText}> </Text>
                )}
              </View>
            );
          })}
        </View>

        {!isPersonal && isCurrent && recovery !== null ? (
          <View style={styles.card}>
            <View style={styles.cardHead}>
              <Text style={styles.cardTitle}>वसूली दर</Text>
              <Text style={[styles.cardTitle, { color: recovery >= 60 ? colors.success : recovery >= 35 ? colors.warning : colors.error }]}>{recovery}%</Text>
            </View>
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${Math.max(2, recovery)}%`, backgroundColor: recovery >= 60 ? colors.success : recovery >= 35 ? colors.warning : colors.error }]} />
            </View>
            <Text style={styles.note}>
              इस महीने {formatINR(now.collected)} मिले, बाज़ार में अभी {formatINR(outstanding)} बकाया है। जितना ज़्यादा प्रतिशत, उतना कम पैसा फँसा।
            </Text>
          </View>
        ) : null}

        {monthBudget > 0 ? (
          <View style={styles.card}>
            <View style={styles.cardHead}>
              <Text style={styles.cardTitle}>बजट</Text>
              <Text style={styles.cardTitle}>{formatINR(now.expense)} / {formatINR(monthBudget)}</Text>
            </View>
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${Math.min(100, Math.max(2, (now.expense / monthBudget) * 100))}%`, backgroundColor: now.expense > monthBudget ? colors.error : colors.success }]} />
            </View>
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>खर्च कहाँ हुआ</Text>
          {now.byCat.length === 0 ? (
            <Text style={styles.note}>इस महीने कोई खर्च नहीं लिखा</Text>
          ) : (
            now.byCat.slice(0, 6).map(([t, v]) => (
              <View key={t} style={{ marginTop: spacing.sm }}>
                <View style={styles.cardHead}>
                  <Text style={styles.rowLabel} numberOfLines={1}>{t}</Text>
                  <Text style={styles.rowValue}>{formatINR(v)}</Text>
                </View>
                <View style={styles.track}>
                  <View style={[styles.fill, { width: `${Math.max(2, (v / maxCat) * 100)}%`, backgroundColor: colors.warning }]} />
                </View>
              </View>
            ))
          )}
        </View>

        <PeopleCard
          title={`${TERMS.get} · सबसे ज़्यादा`}
          rows={owedToYou.slice(0, 5)}
          color={colors.error}
          personal={isPersonal}
          empty="किसी से पैसे नहीं मिलने हैं"
          onOpen={(id) => router.push(`/customer/${id}`)}
          onAll={() => router.push({ pathname: "/(tabs)/customers", params: { filter: "due", t: String(Date.now()) } })}
        />
        {isPersonal ? (
          <PeopleCard
            title={`${TERMS.give} · सबसे ज़्यादा`}
            rows={youOwe.slice(0, 5)}
            color={colors.warning}
            personal
            empty="किसी को पैसे नहीं देने हैं"
            onOpen={(id) => router.push(`/customer/${id}`)}
            onAll={() => router.push({ pathname: "/(tabs)/customers", params: { filter: "owe", t: String(Date.now()) } })}
          />
        ) : null}
      </ScrollView>
    </View>
  );
}

function PeopleCard({
  title,
  rows,
  color,
  personal,
  empty,
  onOpen,
  onAll,
}: {
  title: string;
  rows: { c: { id: string; name: string }; bal: number }[];
  color: string;
  personal: boolean;
  empty: string;
  onOpen: (id: string) => void;
  onAll: () => void;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Text style={styles.cardTitle}>{title}</Text>
        {rows.length ? (
          <Pressable onPress={onAll} hitSlop={8}>
            <Text style={styles.link}>सभी देखें</Text>
          </Pressable>
        ) : null}
      </View>
      {rows.length === 0 ? <Text style={styles.note}>{empty}</Text> : null}
      {rows.map((r, i) => (
        <Pressable key={r.c.id} style={[styles.personRow, i > 0 && styles.personBorder]} onPress={() => onOpen(r.c.id)}>
          <Text style={styles.rank}>{i + 1}</Text>
          <Text style={[styles.rowLabel, { flex: 1 }]} numberOfLines={1}>{r.c.name}</Text>
          <Text style={[styles.rowValue, { color }]}>{formatINR(Math.abs(r.bal))}</Text>
          <Text style={styles.tag}>{balanceTerm(r.bal, personal, true)}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: "row", alignItems: "center", gap: spacing.lg, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, backgroundColor: colors.surface },
  topTitle: { flex: 1, fontSize: 18, fontWeight: "700", color: colors.onSurface },
  link: { fontSize: 13, fontWeight: "700", color: colors.brandPrimary },
  monthRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.md },
  monthBtn: { width: 40, height: 40, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  monthText: { fontSize: 16, fontWeight: "800", color: colors.onSurface },
  hero: { padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.brandPrimary, marginBottom: spacing.md },
  heroLabel: { fontSize: 13, fontWeight: "600", color: colors.onBrandPrimary, opacity: 0.85 },
  heroValue: { fontSize: 32, fontWeight: "800", color: colors.onBrandPrimary, marginTop: 2 },
  heroHint: { fontSize: 12, color: colors.onBrandPrimary, opacity: 0.9, marginTop: 4 },
  formula: { fontSize: 11, color: colors.onBrandPrimary, opacity: 0.75, marginTop: spacing.sm },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.md },
  metric: { width: "48.5%", flexGrow: 1, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  metricLabel: { fontSize: 12, fontWeight: "600", color: colors.muted },
  metricValue: { fontSize: 18, fontWeight: "800", color: colors.onSurface, marginTop: 4 },
  changeRow: { flexDirection: "row", alignItems: "center", gap: 2, marginTop: 2 },
  changeText: { fontSize: 11, fontWeight: "700", color: colors.muted },
  card: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md },
  cardHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  cardTitle: { fontSize: 14, fontWeight: "800", color: colors.onSurface },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.surfaceSecondary, overflow: "hidden", marginTop: 6 },
  fill: { height: 8, borderRadius: 4 },
  note: { fontSize: 12, color: colors.muted, marginTop: spacing.sm, lineHeight: 17 },
  rowLabel: { fontSize: 13, color: colors.onSurface, fontWeight: "600", flexShrink: 1 },
  rowValue: { fontSize: 13, fontWeight: "800", color: colors.onSurface },
  personRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm },
  personBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  rank: { width: 20, fontSize: 12, fontWeight: "800", color: colors.muted },
  tag: { fontSize: 11, color: colors.muted, width: 52, textAlign: "right" },
});
