import { View, Text, StyleSheet } from "react-native";
import MaterialIcon from "@react-native-vector-icons/material-design-icons";
import { colors, radius, spacing } from "@/src/theme";
import { Pressable } from "@/src/components/tap";
import { taskGroup, whenLabel } from "@/src/lib/tasks";
import type { Job } from "@/src/lib/data";

export function TaskRow({ task: t, today, onToggle, onOpen, compact }: { task: Job; today: string; onToggle: () => void; onOpen: () => void; compact?: boolean }) {
  const g = taskGroup(t, today);
  const done = g === "done";
  const when = whenLabel(t, today);
  const high = t.priority === "high" && !done;
  const tone = g === "late" ? colors.error : g === "today" ? colors.success : colors.muted;
  return (
    <Pressable style={[styles.card, high && styles.cardHigh]} onPress={onOpen} testID={`task-${t.id}`}>
      <Pressable onPress={onToggle} hitSlop={10} style={styles.check} testID={`task-check-${t.id}`}>
        <MaterialIcon name={done ? "check-circle" : "checkbox-blank-circle-outline"} size={26} color={done ? colors.success : g === "late" ? colors.error : colors.muted} />
      </Pressable>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.title, done && styles.titleDone]} numberOfLines={compact ? 1 : 2}>{t.title}</Text>
        {t.notes && !compact ? <Text style={styles.notes} numberOfLines={2}>{t.notes}</Text> : null}
        {when || high ? (
          <View style={styles.metaRow}>
            {when ? (
              <View style={[styles.metaPill, g === "late" && { backgroundColor: colors.errorSoft }, g === "today" && { backgroundColor: colors.successSoft }]}>
                <MaterialIcon name={t.time ? "clock-outline" : "calendar-blank-outline"} size={12} color={tone} />
                <Text style={[styles.metaText, { color: tone }]}>{g === "late" ? `${when} · देर` : when}</Text>
              </View>
            ) : null}
            {high ? (
              <View style={[styles.metaPill, { backgroundColor: colors.errorSoft }]}>
                <MaterialIcon name="flag" size={12} color={colors.error} />
                <Text style={[styles.metaText, { color: colors.error }]}>ज़रूरी</Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md, padding: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  cardHigh: { borderLeftWidth: 4, borderLeftColor: colors.error },
  check: { paddingTop: 1 },
  title: { fontSize: 15, fontWeight: "700", color: colors.onSurface },
  titleDone: { color: colors.muted, textDecorationLine: "line-through", fontWeight: "600" },
  notes: { fontSize: 13, color: colors.onSurfaceSecondary, marginTop: 4 },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  metaPill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: colors.surface },
  metaText: { fontSize: 12, fontWeight: "700", color: colors.muted },
});
