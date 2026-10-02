import { View, Text, StyleSheet } from "react-native";
import MaterialIcon from "@react-native-vector-icons/material-design-icons";
import { colors, radius, spacing } from "@/src/theme";
import { formatINR } from "@/src/lib/format";
import type { Persona } from "@/src/lib/persona";
import { pocketNet, type PocketFlow, type Pocket } from "@/src/lib/wallet";

type Row = { key: keyof PocketFlow; sign: 1 | -1; label: (p: Persona) => string };

const ROWS: Row[] = [
  { key: "work", sign: 1, label: () => "काम से मिले" },
  { key: "received", sign: 1, label: (p) => (p === "business" ? "जमा / एडवांस मिले" : "मिले") },
  { key: "counterIn", sign: 1, label: () => "काउंटर में आए" },
  { key: "commission", sign: 1, label: () => "काउंटर कमीशन" },
  { key: "moveIn", sign: 1, label: () => "जोड़े / ट्रांसफर आए" },
  { key: "counterOut", sign: -1, label: () => "काउंटर से दिए" },
  { key: "expense", sign: -1, label: () => "खर्च" },
  { key: "fee", sign: -1, label: () => "फीस" },
  { key: "given", sign: -1, label: (p) => (p === "business" ? "ग्राहक को दिए" : "दिए") },
  { key: "moveOut", sign: -1, label: () => "निकाले / ट्रांसफर गए" },
];

export function pocketTitle(persona: Persona, pocket: Pocket) {
  if (pocket === "bank") return "बैंक";
  return persona === "business" ? "गल्ला" : "कैश";
}

function Header({ persona, pocket, right }: { persona: Persona; pocket: Pocket; right?: React.ReactNode }) {
  const cash = pocket === "cash";
  return (
    <View style={styles.header}>
      <MaterialIcon name={cash ? "cash-multiple" : "bank-outline"} size={20} color={cash ? colors.success : colors.info} />
      <Text style={styles.heading}>{pocketTitle(persona, pocket)}</Text>
      {right}
    </View>
  );
}

const signed = (n: number, sign: 1 | -1) => (n === 0 ? formatINR(0) : `${sign > 0 ? "+" : "-"}${formatINR(n)}`);

/** One day: what was there at the start, what moved, what should be there now. */
export function DayPocketCard({ persona, pocket, opening, flow, children }: { persona: Persona; pocket: Pocket; opening: number; flow: PocketFlow; children?: React.ReactNode }) {
  const closing = opening + pocketNet(flow);
  return (
    <View style={styles.card}>
      <Header persona={persona} pocket={pocket} />
      <View style={styles.row}>
        <Text style={styles.label}>शुरुआत</Text>
        <Text style={styles.value}>{formatINR(opening)}</Text>
      </View>
      {ROWS.filter((r) => flow[r.key] > 0).map((r) => (
        <View key={r.key} style={styles.row}>
          <Text style={styles.label}>{r.label(persona)}</Text>
          <Text style={[styles.value, { color: r.sign > 0 ? colors.success : colors.error }]}>{signed(flow[r.key], r.sign)}</Text>
        </View>
      ))}
      <View style={styles.divider} />
      <View style={styles.row}>
        <Text style={styles.totalLabel}>होने चाहिए</Text>
        <Text style={[styles.totalValue, closing < 0 && { color: colors.error }]}>{formatINR(closing)}</Text>
      </View>
      {children}
    </View>
  );
}

/** Today next to all-time, with the running balance up top. */
export function BalancePocketCard({ persona, pocket, today, total }: { persona: Persona; pocket: Pocket; today: PocketFlow; total: PocketFlow }) {
  const balance = pocketNet(total);
  const rows = ROWS.filter((r) => total[r.key] > 0 || today[r.key] > 0);
  return (
    <View style={styles.card}>
      <Header
        persona={persona}
        pocket={pocket}
        right={<Text style={[styles.balance, balance < 0 && { color: colors.error }]}>{formatINR(balance)}</Text>}
      />
      <View style={[styles.row, styles.tableHead]}>
        <Text style={[styles.label, { flex: 1 }]} />
        <Text style={styles.col}>आज</Text>
        <Text style={styles.col}>कुल</Text>
      </View>
      {rows.length === 0 ? <Text style={styles.empty}>अभी कुछ नहीं</Text> : null}
      {rows.map((r) => (
        <View key={r.key} style={styles.row}>
          <Text style={[styles.label, { flex: 1 }]} numberOfLines={1}>{r.label(persona)}</Text>
          <Text style={[styles.col, { color: today[r.key] ? (r.sign > 0 ? colors.success : colors.error) : colors.muted }]}>{signed(today[r.key], r.sign)}</Text>
          <Text style={[styles.col, { color: r.sign > 0 ? colors.success : colors.error }]}>{signed(total[r.key], r.sign)}</Text>
        </View>
      ))}
      <View style={styles.divider} />
      <View style={styles.row}>
        <Text style={[styles.totalLabel, { flex: 1 }]}>बचा</Text>
        <Text style={[styles.col, styles.colStrong]}>{signed(Math.abs(pocketNet(today)), pocketNet(today) >= 0 ? 1 : -1)}</Text>
        <Text style={[styles.col, styles.colStrong, balance < 0 && { color: colors.error }]}>{formatINR(balance)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.lg, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.lg },
  header: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: spacing.sm },
  heading: { flex: 1, fontSize: 16, fontWeight: "800", color: colors.onSurface },
  balance: { fontSize: 20, fontWeight: "800", color: colors.onSurface },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 5 },
  tableHead: { borderBottomWidth: 1, borderBottomColor: colors.border, marginBottom: 2 },
  label: { fontSize: 13, color: colors.onSurfaceSecondary },
  value: { fontSize: 14, fontWeight: "700", color: colors.onSurface },
  col: { width: 92, textAlign: "right", fontSize: 13, fontWeight: "700", color: colors.muted },
  colStrong: { fontSize: 14, color: colors.onSurface, fontWeight: "800" },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.sm },
  totalLabel: { fontSize: 14, fontWeight: "800", color: colors.onSurface },
  totalValue: { fontSize: 18, fontWeight: "800", color: colors.brandPrimary },
  empty: { fontSize: 13, color: colors.muted, paddingVertical: spacing.sm },
});
