import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import MaterialIcon from "@react-native-vector-icons/material-design-icons";
import { colors, radius, semantic, spacing, type } from "@/src/theme";
import { Pressable } from "@/src/components/tap";
import { formatINR } from "@/src/lib/format";

export type Dir = "in" | "out" | "net";

/** The one In / Out / Net vocabulary for every money summary. */
export const FLOW: Record<Dir, { title: string; hi: string; icon: "arrow-down-circle" | "arrow-up-circle" | "scale-balance"; color: string; soft: string }> = {
  in: { title: "पैसे आए", hi: "पैसे आए", icon: "arrow-down-circle", color: semantic.received, soft: semantic.receivedSoft },
  out: { title: "पैसे गए", hi: "पैसे गए", icon: "arrow-up-circle", color: semantic.due, soft: semantic.dueSoft },
  net: { title: "बचत", hi: "", icon: "scale-balance", color: colors.info, soft: colors.infoSoft },
};

/** Big tappable tile: icon, title, amount. */
export function FlowTile({ dir, value, onPress, testID, style }: { dir: Dir; value: string; onPress?: () => void; testID?: string; style?: StyleProp<ViewStyle> }) {
  const f = FLOW[dir];
  return (
    <Pressable style={[styles.tile, { backgroundColor: f.soft }, style]} onPress={onPress} disabled={!onPress} accessibilityRole="button" accessibilityLabel={`${f.title} ${value}`} testID={testID}>
      <View style={styles.tileTop}>
        <MaterialIcon name={f.icon} size={18} color={f.color} />
        <Text style={[styles.tileTitle, { color: f.color }]} numberOfLines={1}>{f.title}</Text>
        {onPress ? <MaterialIcon name="chevron-right" size={16} color={f.color} style={{ marginLeft: "auto" }} /> : null}
      </View>
      <Text style={[styles.tileValue, { color: f.color }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{value}</Text>
    </Pressable>
  );
}

/** Section heading inside a breakdown: ⬇ पैसे आए … total. */
export function FlowHead({ dir, total }: { dir: Exclude<Dir, "net">; total?: string }) {
  const f = FLOW[dir];
  return (
    <View style={styles.head}>
      <MaterialIcon name={f.icon} size={16} color={f.color} />
      <Text style={[styles.headText, { color: f.color }]}>{f.title}</Text>
      {total ? <Text style={[styles.headTotal, { color: f.color }]}>{total}</Text> : null}
    </View>
  );
}

/** One line of a summary; tappable lines carry a chevron. */
export function FlowRow({
  label,
  value,
  color,
  bold,
  active,
  onPress,
  testID,
}: {
  label: string;
  value: string;
  color?: string;
  bold?: boolean;
  active?: boolean;
  onPress?: () => void;
  testID?: string;
}) {
  const body = (
    <>
      <Text style={[styles.rowLabel, bold && styles.rowBold, active && { color: colors.brandPrimary, fontWeight: "800" }]} numberOfLines={1}>{label}</Text>
      <Text style={[styles.rowValue, bold && styles.rowValueBold, color ? { color } : null]} numberOfLines={1}>{value}</Text>
      {onPress ? <MaterialIcon name="chevron-right" size={16} color={colors.muted} /> : null}
    </>
  );
  if (!onPress) return <View style={styles.row}>{body}</View>;
  return (
    <Pressable style={[styles.row, active && styles.rowActive]} onPress={onPress} testID={testID}>
      {body}
    </Pressable>
  );
}

/** ⚖ Net line with its sign and colour. */
export function NetRow({ value, label = "बचत", onPress, testID, fmt }: { value: number; label?: string; onPress?: () => void; testID?: string; fmt?: (n: number) => string }) {
  return <FlowRow label={label} value={signedINR(value, fmt)} color={value < 0 ? semantic.due : FLOW.net.color} bold onPress={onPress} testID={testID} />;
}

export function signedINR(n: number, fmt: (n: number) => string = formatINR): string {
  return `${n < 0 ? "−" : "+"}${fmt(Math.abs(n))}`;
}

const styles = StyleSheet.create({
  tile: { flex: 1, minWidth: 0, padding: spacing.md, borderRadius: radius.md, gap: 4 },
  tileTop: { flexDirection: "row", alignItems: "center", gap: 6 },
  tileTitle: { fontSize: 13, fontWeight: "800" },
  tileValue: { ...type.title, fontWeight: "800", fontVariant: ["tabular-nums"] },
  head: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.sm, marginBottom: 2 },
  headText: { flex: 1, fontSize: 13, fontWeight: "800" },
  headTotal: { fontSize: 14, fontWeight: "800", fontVariant: ["tabular-nums"] },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 7, minHeight: 36 },
  rowActive: { backgroundColor: colors.brandTertiary, borderRadius: radius.sm, paddingHorizontal: 6 },
  rowLabel: { flex: 1, fontSize: 14, color: colors.onSurfaceSecondary },
  rowBold: { fontSize: 15, fontWeight: "800", color: colors.onSurface },
  rowValue: { fontSize: 14, fontWeight: "700", color: colors.onSurface, fontVariant: ["tabular-nums"] },
  rowValueBold: { fontSize: 17, fontWeight: "800" },
});
