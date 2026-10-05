import { useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import MaterialIcon from "@react-native-vector-icons/material-design-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radius, spacing } from "@/src/theme";
import { formatDateShort, formatINR, todayISO } from "@/src/lib/format";
import { Pressable } from "@/src/components/tap";
import { usePersona } from "@/src/lib/persona";
import { accountKey, accountLabel, computeFlows, pocketNet, useMoneyBook, type Move } from "@/src/lib/wallet";
import { PocketCard, pocketTitle } from "@/src/components/pocket-card";
import { MoneyMoveSheet } from "@/src/components/money-move-sheet";
export default function BalanceScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { persona } = usePersona();
  const book = useMoneyBook();
  const today = todayISO();
  const [editMove, setEditMove] = useState<Move | null>(null);
  const [shown, setShown] = useState(PAGE);
  const openPocket = (p: "cash" | "bank") => router.push({ pathname: "/pocket" as never, params: { p } });

  const before = useMemo(() => computeFlows(book, persona, (d) => d < today), [book, persona, today]);
  const todayFlows = useMemo(() => computeFlows(book, persona, (d) => d === today), [book, persona, today]);
  const cash = pocketNet(before.cash) + pocketNet(todayFlows.cash);
  const bank = pocketNet(before.bank) + pocketNet(todayFlows.bank);

  const mine = useMemo(() => {
    const keys = [accountKey(persona, "cash"), accountKey(persona, "bank")];
    return book.moves.filter((m) => keys.includes(m.from) || keys.includes(m.to)).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  }, [book.moves, persona]);

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
            {(["cash", "bank"] as const).map((p) => {
              const v = p === "cash" ? cash : bank;
              return (
                <Pressable key={p} style={styles.split} onPress={() => openPocket(p)} testID={`balance-open-${p}`}>
                  <View style={styles.splitTop}>
                    <Text style={styles.splitLabel}>{pocketTitle(persona, p)}</Text>
                    <MaterialIcon name="chevron-right" size={16} color={colors.onBrandPrimary} />
                  </View>
                  <Text style={[styles.splitValue, v < 0 && { color: "#FFD7D7" }]}>{formatINR(v)}</Text>
                  <Text style={styles.splitHint}>पूरा हिसाब देखें</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <Text style={styles.hint}>पैसे जोड़ने, निकालने या ट्रांसफर के लिए {pocketTitle(persona, "cash")} या {pocketTitle(persona, "bank")} पर टैप करें</Text>

        <PocketCard persona={persona} pocket="cash" opening={pocketNet(before.cash)} flow={todayFlows.cash} showBalance onOpen={() => openPocket("cash")} />
        <PocketCard persona={persona} pocket="bank" opening={pocketNet(before.bank)} flow={todayFlows.bank} showBalance onOpen={() => openPocket("bank")} />

        {mine.length > 0 ? (
          <>
            <Text style={styles.sectionHead}>जोड़े / निकाले</Text>
            <View style={styles.list}>
              {mine.slice(0, shown).map((m, i) => {
                const ownKeys: string[] = [accountKey(persona, "cash"), accountKey(persona, "bank")];
                const own = ownKeys.includes(m.to);
                const swap = own && ownKeys.includes(m.from);
                return (
                  <Pressable key={m.id} style={[styles.moveRow, i > 0 && styles.moveBorder]} onPress={() => setEditMove(m)} testID={`move-row-${m.id}`}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.moveTitle} numberOfLines={1}>
                        {accountLabel(m.from)} → {accountLabel(m.to)}
                      </Text>
                      <Text style={styles.moveSub} numberOfLines={1}>
                        {formatDateShort(m.date)}{m.note ? ` · ${m.note}` : ""}
                      </Text>
                    </View>
                    <Text style={[styles.moveAmt, { color: swap ? colors.onSurface : own ? colors.success : colors.error }]}>{swap ? "" : own ? "+" : "-"}{formatINR(m.amount)}</Text>
                    <MaterialIcon name="pencil-outline" size={16} color={colors.muted} />
                  </Pressable>
                );
              })}
            </View>
            {mine.length > shown ? (
              <Pressable style={styles.moreBtn} onPress={() => setShown((n) => n + PAGE)} testID="moves-more">
                <Text style={styles.link}>और दिखाएँ ({mine.length - shown})</Text>
              </Pressable>
            ) : null}
          </>
        ) : null}
      </ScrollView>

      <MoneyMoveSheet kind={null} initial={editMove} onClose={() => setEditMove(null)} />
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
  splitTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  splitLabel: { fontSize: 12, fontWeight: "600", color: colors.onBrandPrimary, opacity: 0.85 },
  splitValue: { fontSize: 18, fontWeight: "800", color: colors.onBrandPrimary, marginTop: 2 },
  splitHint: { fontSize: 12, color: colors.onBrandPrimary, opacity: 0.8, marginTop: 4 },
  hint: { fontSize: 12, color: colors.muted, textAlign: "center", marginTop: -spacing.sm, marginBottom: spacing.lg },
  sectionHead: { fontSize: 14, fontWeight: "800", color: colors.onSurface, marginBottom: spacing.sm },
  list: { borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md },
  moveRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.md },
  moveBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  moveTitle: { fontSize: 14, fontWeight: "700", color: colors.onSurface },
  moveSub: { fontSize: 12, color: colors.muted, marginTop: 2 },
  moveAmt: { fontSize: 15, fontWeight: "800" },
  moreBtn: { alignSelf: "center", paddingVertical: spacing.md, paddingHorizontal: spacing.xl },
});

// Moves are drawn a page at a time; months of adjustments add up.
const PAGE = 50;
