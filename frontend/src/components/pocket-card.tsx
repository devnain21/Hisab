import { View, Text, StyleSheet } from "react-native";
import MaterialIcon from "@react-native-vector-icons/material-design-icons";
import { colors, radius, spacing } from "@/src/theme";
import { formatINR } from "@/src/lib/format";
import { Pressable } from "@/src/components/tap";
import { FLOW, FlowHead } from "@/src/components/money-flow";
import type { Persona } from "@/src/lib/persona";
import { pocketIn, pocketNet, pocketOut, type FlowKey, type PocketFlow, type Pocket } from "@/src/lib/wallet";

type Row = { key: FlowKey; label: (p: Persona, pocket: Pocket) => string };

// Labels name only the source; the Cash In / Cash Out heading above them says the direction.
export const IN_ROWS: Row[] = [
  { key: "work", label: () => "काम" },
  { key: "received", label: (p) => (p === "business" ? "ग्राहकों से" : "लोगों से") },
  { key: "counterIn", label: () => "काउंटर" },
  { key: "commission", label: () => "कमीशन" },
  { key: "moveIn", label: () => "जोड़े / ट्रांसफर" },
];

export const OUT_ROWS: Row[] = [
  { key: "counterOut", label: () => "काउंटर" },
  { key: "given", label: (p) => (p === "business" ? "ग्राहकों को" : "लोगों को") },
  { key: "purchase", label: () => "सामान / सेवा" },
  { key: "expense", label: () => "खर्च" },
  { key: "fee", label: () => "फीस" },
  { key: "moveOut", label: () => "निकाले / ट्रांसफर" },
];

export function flowLabel(key: FlowKey, persona: Persona, pocket: Pocket): string {
  return [...IN_ROWS, ...OUT_ROWS].find((r) => r.key === key)?.label(persona, pocket) ?? "";
}

export function pocketTitle(persona: Persona, pocket: Pocket) {
  if (pocket === "bank") return "बैंक";
  return persona === "business" ? "गल्ला" : "कैश";
}

const signed = (n: number) => `${n < 0 ? "−" : "+"}${formatINR(Math.abs(n))}`;

/**
 * One pocket for one day, written top to bottom like a register:
 * what was left before, every rupee in and out today, today's total, and what is left now.
 */
export function PocketCard({
  persona,
  pocket,
  opening,
  flow,
  dayLabel = "आज",
  showBalance,
  onOpen,
  children,
}: {
  persona: Persona;
  pocket: Pocket;
  opening: number;
  flow: PocketFlow;
  dayLabel?: string;
  showBalance?: boolean;
  /** Opens this pocket's full register. */
  onOpen?: () => void;
  children?: React.ReactNode;
}) {
  const net = pocketNet(flow);
  const closing = opening + net;
  const ins = IN_ROWS.filter((r) => flow[r.key] > 0);
  const outs = OUT_ROWS.filter((r) => flow[r.key] > 0);
  const cash = pocket === "cash";

  return (
    <View style={styles.card}>
      <Pressable style={styles.header} onPress={onOpen} disabled={!onOpen} testID={`pocket-card-${pocket}`}>
        <MaterialIcon name={cash ? "cash-multiple" : "bank-outline"} size={20} color={cash ? colors.success : colors.info} />
        <Text style={styles.heading}>{pocketTitle(persona, pocket)}</Text>
        {showBalance ? <Text style={[styles.balance, closing < 0 && { color: colors.error }]}>{formatINR(closing)}</Text> : null}
        {onOpen ? (
          <View style={styles.openPill}>
            <MaterialIcon name="chevron-right" size={16} color={colors.brandPrimary} />
          </View>
        ) : null}
      </Pressable>

      <View style={styles.row}>
        <Text style={styles.label}>शुरू में</Text>
        <Text style={[styles.value, opening < 0 && { color: colors.error }]}>{formatINR(opening)}</Text>
      </View>

      <FlowHead dir="in" total={`+${formatINR(pocketIn(flow))}`} />
      {ins.map((r) => (
        <View key={r.key} style={styles.row}>
          <Text style={styles.label}>{r.label(persona, pocket)}</Text>
          <Text style={[styles.value, { color: FLOW.in.color }]}>+{formatINR(flow[r.key])}</Text>
        </View>
      ))}

      <FlowHead dir="out" total={`−${formatINR(pocketOut(flow))}`} />
      {outs.map((r) => (
        <View key={r.key} style={styles.row}>
          <Text style={styles.label}>{r.label(persona, pocket)}</Text>
          <Text style={[styles.value, { color: FLOW.out.color }]}>−{formatINR(flow[r.key])}</Text>
        </View>
      ))}

      <View style={styles.divider} />
      <View style={styles.row}>
        <Text style={styles.label}>बचत {dayLabel}</Text>
        <Text style={[styles.value, { color: net < 0 ? FLOW.out.color : FLOW.net.color }]}>{signed(net)}</Text>
      </View>
      <View style={[styles.row, styles.closingRow]}>
        <Text style={styles.totalLabel}>अंत में</Text>
        <Text style={[styles.totalValue, closing < 0 && { color: colors.error }]}>{formatINR(closing)}</Text>
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.lg, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.lg },
  header: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: spacing.sm },
  heading: { flex: 1, fontSize: 16, fontWeight: "800", color: colors.onSurface },
  balance: { fontSize: 20, fontWeight: "800", color: colors.onSurface },
  openPill: { flexDirection: "row", alignItems: "center", paddingLeft: 8, paddingVertical: 2 },
  openText: { fontSize: 12, fontWeight: "700", color: colors.brandPrimary },
  group: { fontSize: 12, fontWeight: "800", color: colors.muted, marginTop: spacing.sm, marginBottom: 2 },
  none: { fontSize: 13, color: colors.muted, paddingVertical: 3 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm, paddingVertical: 4 },
  label: { flex: 1, fontSize: 13, color: colors.onSurfaceSecondary },
  value: { fontSize: 14, fontWeight: "700", color: colors.onSurface },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.sm },
  closingRow: { marginTop: 4, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  totalLabel: { fontSize: 15, fontWeight: "800", color: colors.onSurface },
  totalValue: { fontSize: 18, fontWeight: "800", color: colors.brandPrimary },
});
