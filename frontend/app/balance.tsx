import { useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import MaterialIcon from "@react-native-vector-icons/material-design-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radius, spacing } from "@/src/theme";
import { formatDateShort, formatINR, todayISO } from "@/src/lib/format";
import { Pressable } from "@/src/components/tap";
import { usePersona } from "@/src/lib/persona";
import { accountKey, accountLabel, computeFlows, deleteMove, pocketNet, useMoneyBook } from "@/src/lib/wallet";
import { PocketCard, pocketTitle } from "@/src/components/pocket-card";
import { MoneyMoveSheet, type MoveKind } from "@/src/components/money-move-sheet";
import { AddExpenseSheet } from "@/src/components/expense-sheet";
import { confirmAction } from "@/src/lib/confirm";

export default function BalanceScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { persona } = usePersona();
  const book = useMoneyBook();
  const today = todayISO();
  const [move, setMove] = useState<MoveKind | null>(null);
  const [expense, setExpense] = useState(false);

  const before = useMemo(() => computeFlows(book, persona, (d) => d < today), [book, persona, today]);
  const todayFlows = useMemo(() => computeFlows(book, persona, (d) => d === today), [book, persona, today]);
  const cash = pocketNet(before.cash) + pocketNet(todayFlows.cash);
  const bank = pocketNet(before.bank) + pocketNet(todayFlows.bank);

  const mine = useMemo(() => {
    const keys = [accountKey(persona, "cash"), accountKey(persona, "bank")];
    return book.moves.filter((m) => keys.includes(m.from) || keys.includes(m.to)).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  }, [book.moves, persona]);

  const actions: { kind: MoveKind | "expense"; label: string; icon: string; color: string }[] = [
    { kind: "in", label: "जोड़ें", icon: "plus-circle-outline", color: colors.success },
    { kind: "out", label: "निकालें", icon: "minus-circle-outline", color: colors.error },
    { kind: "swap", label: "ट्रांसफर", icon: "swap-horizontal", color: colors.brandPrimary },
    { kind: "expense", label: "खर्च", icon: "coffee-outline", color: colors.warning },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: colors.surfaceSecondary }}>
      <View style={[styles.topBar, { paddingTop: insets.top + spacing.md }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} testID="balance-back">
          <MaterialIcon name="arrow-left" size={26} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.topTitle}>कुल बैलेंस</Text>
        <Pressable onPress={() => router.push({ pathname: "/day", params: { type: "drawer" } })} hitSlop={8} testID="balance-day">
          <Text style={styles.link}>दिन का हिसाब</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl * 2 }}>
        <View style={styles.summary}>
          <Text style={styles.summaryLabel}>कुल</Text>
          <Text style={[styles.summaryValue, cash + bank < 0 && { color: colors.error }]}>{formatINR(cash + bank)}</Text>
          <View style={styles.splitRow}>
            <View style={styles.split}>
              <Text style={styles.splitLabel}>{pocketTitle(persona, "cash")}</Text>
              <Text style={[styles.splitValue, cash < 0 && { color: colors.error }]}>{formatINR(cash)}</Text>
            </View>
            <View style={styles.split}>
              <Text style={styles.splitLabel}>बैंक</Text>
              <Text style={[styles.splitValue, bank < 0 && { color: colors.error }]}>{formatINR(bank)}</Text>
            </View>
          </View>
        </View>

        <View style={styles.actions}>
          {actions.map((a) => (
            <Pressable key={a.kind} style={styles.action} onPress={() => (a.kind === "expense" ? setExpense(true) : setMove(a.kind))} testID={`balance-${a.kind}`}>
              <MaterialIcon name={a.icon as any} size={22} color={a.color} />
              <Text style={styles.actionText}>{a.label}</Text>
            </Pressable>
          ))}
        </View>

        <PocketCard persona={persona} pocket="cash" opening={pocketNet(before.cash)} flow={todayFlows.cash} showBalance />
        <PocketCard persona={persona} pocket="bank" opening={pocketNet(before.bank)} flow={todayFlows.bank} showBalance />

        {mine.length > 0 ? (
          <>
            <Text style={styles.sectionHead}>जोड़े / निकाले</Text>
            <View style={styles.list}>
              {mine.map((m, i) => {
                const ownKeys: string[] = [accountKey(persona, "cash"), accountKey(persona, "bank")];
                const own = ownKeys.includes(m.to);
                const swap = own && ownKeys.includes(m.from);
                return (
                  <View key={m.id} style={[styles.moveRow, i > 0 && styles.moveBorder]}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.moveTitle} numberOfLines={1}>
                        {accountLabel(m.from)} → {accountLabel(m.to)}
                      </Text>
                      <Text style={styles.moveSub} numberOfLines={1}>
                        {formatDateShort(m.date)}{m.note ? ` · ${m.note}` : ""}
                      </Text>
                    </View>
                    <Text style={[styles.moveAmt, { color: swap ? colors.onSurface : own ? colors.success : colors.error }]}>{swap ? "" : own ? "+" : "-"}{formatINR(m.amount)}</Text>
                    <Pressable
                      onPress={() => confirmAction("हटाएँ?", `${accountLabel(m.from)} → ${accountLabel(m.to)} · ${formatINR(m.amount)}`, "हटा दें", () => deleteMove(m.id))}
                      hitSlop={8}
                      testID={`move-delete-${m.id}`}
                    >
                      <MaterialIcon name="delete-outline" size={18} color={colors.muted} />
                    </Pressable>
                  </View>
                );
              })}
            </View>
          </>
        ) : null}
      </ScrollView>

      <MoneyMoveSheet kind={move} onClose={() => setMove(null)} />
      <AddExpenseSheet visible={expense} onClose={() => setExpense(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: "row", alignItems: "center", gap: spacing.lg, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, backgroundColor: colors.surface },
  topTitle: { flex: 1, fontSize: 18, fontWeight: "700", color: colors.onSurface },
  link: { fontSize: 13, fontWeight: "700", color: colors.brandPrimary },
  summary: { padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.brandPrimary, marginBottom: spacing.lg },
  summaryLabel: { fontSize: 13, fontWeight: "600", color: colors.onBrandPrimary, opacity: 0.85 },
  summaryValue: { fontSize: 32, fontWeight: "800", color: colors.onBrandPrimary, marginTop: 2 },
  splitRow: { flexDirection: "row", gap: spacing.md, marginTop: spacing.md },
  split: { flex: 1, padding: spacing.md, borderRadius: radius.md, backgroundColor: "rgba(255,255,255,0.15)" },
  splitLabel: { fontSize: 12, fontWeight: "600", color: colors.onBrandPrimary, opacity: 0.85 },
  splitValue: { fontSize: 18, fontWeight: "800", color: colors.onBrandPrimary, marginTop: 2 },
  actions: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.lg },
  action: { flex: 1, alignItems: "center", gap: 4, paddingVertical: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  actionText: { fontSize: 12, fontWeight: "700", color: colors.onSurface },
  sectionHead: { fontSize: 14, fontWeight: "800", color: colors.onSurface, marginBottom: spacing.sm },
  list: { borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md },
  moveRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.md },
  moveBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  moveTitle: { fontSize: 14, fontWeight: "700", color: colors.onSurface },
  moveSub: { fontSize: 12, color: colors.muted, marginTop: 2 },
  moveAmt: { fontSize: 15, fontWeight: "800" },
});
