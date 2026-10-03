import { View, Text, StyleSheet } from "react-native";
import MaterialIcon from "@react-native-vector-icons/material-design-icons";
import { colors, radius, spacing } from "@/src/theme";
import { formatINR } from "@/src/lib/format";
import type { Persona } from "@/src/lib/persona";
import { pocketIn, pocketNet, pocketOut, type PocketFlow, type Pocket } from "@/src/lib/wallet";

type Row = { key: keyof PocketFlow; label: (p: Persona, pocket: Pocket) => string };

const IN_ROWS: Row[] = [
  { key: "work", label: (p, k) => (p === "personal" ? "काम से मिले" : k === "cash" ? "नगद (काम)" : "ऑनलाइन (काम)") },
  { key: "received", label: (p) => (p === "business" ? "उधार / एडवांस मिले" : "मिले") },
  { key: "counterIn", label: () => "AEPS आए" },
  { key: "commission", label: () => "AEPS कमीशन" },
  { key: "moveIn", label: () => "जोड़े / ट्रांसफर आए" },
];

const OUT_ROWS: Row[] = [
  { key: "counterOut", label: () => "AEPS गए" },
  { key: "given", label: (p) => (p === "business" ? "उधार दिए" : "दिए") },
  { key: "purchase", label: () => "सामान / सेवा" },
  { key: "expense", label: () => "खर्च" },
  { key: "fee", label: () => "फीस" },
  { key: "moveOut", label: () => "निकाले / ट्रांसफर गए" },
];

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
  children,
}: {
  persona: Persona;
  pocket: Pocket;
  opening: number;
  flow: PocketFlow;
  dayLabel?: string;
  showBalance?: boolean;
  children?: React.ReactNode;
}) {
  const net = pocketNet(flow);
  const closing = opening + net;
  const ins = IN_ROWS.filter((r) => flow[r.key] > 0);
  const outs = OUT_ROWS.filter((r) => flow[r.key] > 0);
  const cash = pocket === "cash";

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <MaterialIcon name={cash ? "cash-multiple" : "bank-outline"} size={20} color={cash ? colors.success : colors.info} />
        <Text style={styles.heading}>{pocketTitle(persona, pocket)}</Text>
        {showBalance ? <Text style={[styles.balance, closing < 0 && { color: colors.error }]}>{formatINR(closing)}</Text> : null}
      </View>

      <Text style={styles.group}>{dayLabel} आए</Text>
      {ins.length === 0 ? <Text style={styles.none}>कुछ नहीं</Text> : null}
      {ins.map((r) => (
        <View key={r.key} style={styles.row}>
          <Text style={styles.label}>{r.label(persona, pocket)}</Text>
          <Text style={[styles.value, { color: colors.success }]}>+{formatINR(flow[r.key])}</Text>
        </View>
      ))}

      <Text style={styles.group}>{dayLabel} गए</Text>
      {outs.length === 0 ? <Text style={styles.none}>कुछ नहीं</Text> : null}
      {outs.map((r) => (
        <View key={r.key} style={styles.row}>
          <Text style={styles.label}>{r.label(persona, pocket)}</Text>
          <Text style={[styles.value, { color: colors.error }]}>−{formatINR(flow[r.key])}</Text>
        </View>
      ))}

      <View style={styles.divider} />
      <View style={styles.row}>
        <Text style={styles.label}>{dayLabel} का कुल (आए {formatINR(pocketIn(flow))} − गए {formatINR(pocketOut(flow))})</Text>
        <Text style={[styles.value, { color: net < 0 ? colors.error : colors.success }]}>{signed(net)}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>{dayLabel === "आज" ? "कल तक का बचा" : "पहले का बचा"}</Text>
        <Text style={[styles.value, opening < 0 && { color: colors.error }]}>{formatINR(opening)}</Text>
      </View>
      <View style={[styles.row, styles.closingRow]}>
        <Text style={styles.totalLabel}>अब बचा</Text>
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
