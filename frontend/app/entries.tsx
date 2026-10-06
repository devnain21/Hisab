import { useMemo, useState } from "react";
import { View, Text, StyleSheet, FlatList } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import MaterialIcon from "@react-native-vector-icons/material-design-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radius, spacing } from "@/src/theme";
import { type Entry } from "@/src/lib/data";
import { formatDateShort, formatINR, formatWeekdayDate, todayISO } from "@/src/lib/format";
import { Pressable } from "@/src/components/tap";
import { EditRecordSheet } from "@/src/components/sheets";
import { AddExpenseSheet } from "@/src/components/expense-sheet";
import { AEPS_META } from "@/src/lib/aeps";
import { usePersona } from "@/src/lib/persona";
import { useMoneyBook } from "@/src/lib/wallet";
import { HIDDEN, usePrefs } from "@/src/lib/prefs";
import { METRIC_KINDS, metricRows, type MetricKind, type MetricRow } from "@/src/lib/metrics";
import type { Expense } from "@/src/lib/expenses";

const TITLES: Record<MetricKind, string> = {
  work: "काम बुक",
  fee: "पोर्टल / सरकारी फीस",
  vendor: "Vendor लागत",
  workVendor: "Vendor लागत",
  commission: "AEPS / सेवा कमीशन",
  expense: "खर्च",
  collected: "पैसे मिले",
  given: "लोगों को दिए",
  paidOut: "सामान / सेवा चुकाए",
  goods: "सामान / सेवा ली",
};

const OUTFLOW = new Set<MetricKind>(["fee", "vendor", "workVendor", "expense", "given", "paidOut", "goods"]);

/** Every row behind one summary figure (Home / Report), for a day or a range; tap a row to open it. */
export default function EntriesScreen() {
  const params = useLocalSearchParams<{ kind?: string; from?: string; to?: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { persona, labels } = usePersona();
  const book = useMoneyBook();
  const { hideAmounts } = usePrefs();
  const money = (n: number) => (hideAmounts ? HIDDEN : formatINR(n));
  const today = todayISO();
  const kind: MetricKind = METRIC_KINDS.includes(params.kind as MetricKind) ? (params.kind as MetricKind) : "work";
  const from = params.from || today;
  const to = params.to || from;
  const [editing, setEditing] = useState<Entry | null>(null);
  const [editExpense, setEditExpense] = useState<Expense | null>(null);

  const rows = useMemo(() => metricRows(book, persona, kind, from, to), [book, persona, kind, from, to]);
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const oneDay = from === to;
  const dayLabel = (d: string) => (d === today ? "आज" : d === todayISO(-1) ? "कल" : formatWeekdayDate(d));
  const rangeLabel = oneDay ? dayLabel(from) : `${formatDateShort(from)} – ${formatDateShort(to)}`;
  const nameOf = (id: string) => book.customers.find((c) => c.id === id)?.name ?? labels.customer;
  const out = OUTFLOW.has(kind);

  const open = (r: MetricRow) => {
    if (r.source === "entry") setEditing(r.entry);
    else if (r.source === "expense") setEditExpense(r.expense);
    else router.push(`/aeps/${r.txn.id}` as never);
  };

  const describe = (r: MetricRow): { title: string; sub: string } => {
    if (r.source === "expense") return { title: r.expense.title, sub: [r.expense.mode === "online" ? "बैंक" : labels.cash, r.expense.notes].filter(Boolean).join(" · ") };
    if (r.source === "aeps") {
      const t = r.txn;
      return { title: t.customerName || "काउंटर ग्राहक", sub: `${AEPS_META[t.type].hi} ${formatINR(t.amount)} · कमीशन` };
    }
    const e = r.entry;
    const paid = e.paid ?? 0;
    let sub = e.description || (e.type === "work" ? "काम" : "");
    if (kind === "fee") sub = `${e.description || "काम"} · काम ${formatINR(e.amount)}`;
    else if (kind === "work") sub = `${sub} · ${paid >= e.amount ? "पूरे मिले" : paid > 0 ? `${formatINR(paid)} मिले` : "उधार"}`;
    else if (kind === "collected" && e.type === "work") sub = `${sub} · काम के साथ मिले`;
    return { title: nameOf(e.customerId), sub };
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={[styles.topBar, { paddingTop: insets.top + spacing.md }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} testID="entries-back">
          <MaterialIcon name="arrow-left" size={26} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.topTitle} numberOfLines={1}>{TITLES[kind]}</Text>
          <Text style={styles.topSub} numberOfLines={1}>{rangeLabel}</Text>
        </View>
      </View>

      <View style={styles.totalCard}>
        <Text style={styles.totalLabel}>कुल · {rows.length}</Text>
        <Text style={[styles.totalValue, { color: out ? colors.error : colors.success }]} numberOfLines={1} adjustsFontSizeToFit>
          {money(total)}
        </Text>
      </View>
      {kind === "commission" ? <Text style={styles.hint}>जमा / निकासी की रकम ग्राहक की है; सिर्फ़ कमीशन आपकी कमाई है।</Text> : null}

      <FlatList
        data={rows}
        keyExtractor={(r) => `${r.source}-${r.key}`}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl * 2, gap: spacing.sm }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <MaterialIcon name="text-box-search-outline" size={32} color={colors.muted} />
            <Text style={styles.emptyTitle}>कोई एंट्री नहीं</Text>
          </View>
        }
        renderItem={({ item: r }) => {
          const d = describe(r);
          return (
            <Pressable style={styles.row} onPress={() => open(r)} accessibilityRole="button" testID={`entries-row-${r.key}`}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.name} numberOfLines={1}>{d.title}</Text>
                {d.sub ? <Text style={styles.desc} numberOfLines={2}>{d.sub}</Text> : null}
                {oneDay ? null : <Text style={styles.date}>{formatDateShort(r.date)}</Text>}
              </View>
              <Text style={[styles.amount, { color: out ? colors.error : colors.onSurface }]}>{out ? "−" : ""}{money(r.amount)}</Text>
              <MaterialIcon name="chevron-right" size={18} color={colors.muted} />
            </Pressable>
          );
        }}
      />

      <EditRecordSheet entry={editing} onClose={() => setEditing(null)} />
      <AddExpenseSheet visible={!!editExpense} initial={editExpense} onClose={() => setEditExpense(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: "row", alignItems: "center", gap: spacing.lg, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  topTitle: { fontSize: 18, fontWeight: "700", color: colors.onSurface },
  topSub: { fontSize: 13, color: colors.muted, fontWeight: "600" },
  totalCard: { marginHorizontal: spacing.lg, marginTop: spacing.sm, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  totalLabel: { fontSize: 12, color: colors.muted, fontWeight: "700" },
  totalValue: { fontSize: 28, fontWeight: "800", marginTop: 2, fontVariant: ["tabular-nums"] },
  hint: { marginHorizontal: spacing.lg, marginTop: spacing.sm, fontSize: 12, color: colors.muted },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  name: { fontSize: 15, fontWeight: "700", color: colors.onSurface },
  desc: { fontSize: 13, color: colors.onSurfaceSecondary, marginTop: 2 },
  date: { fontSize: 12, color: colors.muted, marginTop: 2 },
  amount: { fontSize: 16, fontWeight: "800", fontVariant: ["tabular-nums"] },
  empty: { alignItems: "center", padding: spacing.xxl, gap: spacing.sm },
  emptyTitle: { fontSize: 15, fontWeight: "600", color: colors.onSurface },
});
