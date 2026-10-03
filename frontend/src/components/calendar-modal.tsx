import { useEffect, useState } from "react";
import { Modal, View, Text, StyleSheet, Pressable as RNPressable } from "react-native";
import MaterialIcon from "@react-native-vector-icons/material-design-icons";
import { colors, radius, spacing } from "@/src/theme";
import { Pressable } from "@/src/components/tap";
import { formatMonth, isValidISO, monthRange, shiftISO, todayISO } from "@/src/lib/format";

const WEEK = ["सो", "मं", "बु", "गु", "शु", "श", "र"];

/** Month grid to pick one day. Days after `max` can't be chosen. */
export function CalendarModal({
  visible,
  value,
  onPick,
  onClose,
  max,
  heading,
  keepOpen,
}: {
  visible: boolean;
  value: string;
  onPick: (d: string) => void;
  onClose: () => void;
  max?: string;
  heading?: string;
  /** The parent decides when to close (e.g. picking a from/to pair). */
  keepOpen?: boolean;
}) {
  const pick = (d: string) => {
    onPick(d);
    if (!keepOpen) onClose();
  };
  const [month, setMonth] = useState(() => (isValidISO(value) ? value : todayISO()));
  useEffect(() => {
    if (visible) setMonth(isValidISO(value) ? value : todayISO());
  }, [visible, value]);

  const { from, to } = monthRange(month);
  const lead = (new Date(`${from}T12:00:00`).getDay() + 6) % 7;
  const days: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let d = from; d <= to; d = shiftISO(d, 1)) days.push(d);
  while (days.length % 7) days.push(null);
  const today = todayISO();
  const nextOk = !max || monthRange(month, 1).from <= max;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <RNPressable style={styles.backdrop} onPress={onClose}>
        <RNPressable style={styles.card} onPress={() => {}}>
          {heading ? <Text style={styles.heading}>{heading}</Text> : null}
          <View style={styles.head}>
            <Pressable onPress={() => setMonth(monthRange(month, -1).from)} hitSlop={10} testID="cal-prev">
              <MaterialIcon name="chevron-left" size={26} color={colors.onSurface} />
            </Pressable>
            <Text style={styles.title}>{formatMonth(month)}</Text>
            <Pressable onPress={() => nextOk && setMonth(monthRange(month, 1).from)} hitSlop={10} disabled={!nextOk} testID="cal-next">
              <MaterialIcon name="chevron-right" size={26} color={nextOk ? colors.onSurface : colors.border} />
            </Pressable>
          </View>
          <View style={styles.grid}>
            {WEEK.map((w) => (
              <Text key={w} style={styles.week}>{w}</Text>
            ))}
            {days.map((d, i) => {
              if (!d) return <View key={`x${i}`} style={styles.cell} />;
              const off = !!max && d > max;
              const on = d === value;
              return (
                <Pressable
                  key={d}
                  style={[styles.cell, on && styles.cellOn, !on && d === today && styles.cellToday]}
                  disabled={off}
                  onPress={() => pick(d)}
                  testID={`cal-${d}`}
                >
                  <Text style={[styles.day, off && { color: colors.border }, on && { color: colors.onBrandPrimary }]}>{parseInt(d.slice(8), 10)}</Text>
                </Pressable>
              );
            })}
          </View>
          <Pressable style={styles.todayBtn} onPress={() => pick(today)} testID="cal-today">
            <Text style={styles.todayText}>आज</Text>
          </Pressable>
        </RNPressable>
      </RNPressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center", padding: spacing.lg },
  card: { width: "100%", maxWidth: 360, backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.md },
  title: { fontSize: 17, fontWeight: "800", color: colors.onSurface },
  heading: { fontSize: 13, fontWeight: "700", color: colors.brandPrimary, textAlign: "center", marginBottom: spacing.sm },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  week: { width: "14.2857%", textAlign: "center", fontSize: 12, fontWeight: "700", color: colors.muted, paddingVertical: 6 },
  cell: { width: "14.2857%", aspectRatio: 1, alignItems: "center", justifyContent: "center", borderRadius: 999 },
  cellOn: { backgroundColor: colors.brandPrimary },
  cellToday: { borderWidth: 1.5, borderColor: colors.brandPrimary },
  day: { fontSize: 15, fontWeight: "600", color: colors.onSurface },
  todayBtn: { alignSelf: "center", marginTop: spacing.md, paddingHorizontal: spacing.xl, paddingVertical: spacing.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.brandPrimary },
  todayText: { fontSize: 14, fontWeight: "700", color: colors.brandPrimary },
});
