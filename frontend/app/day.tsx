import { useMemo, useState } from "react";
import { View, Text, StyleSheet, FlatList } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import MaterialIcon from "@react-native-vector-icons/material-design-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, spacing, radius } from "@/src/theme";
import { cashIn, useCustomers, useEntries, type Entry } from "@/src/lib/data";
import { formatINR, formatWeekdayDate, todayISO } from "@/src/lib/format";
import { Pressable } from "@/src/components/tap";
import { EditRecordSheet } from "@/src/components/sheets";

type Kind = "work" | "payment";

function shiftDay(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Day book: every work or payment entry booked on one date, across all customers. */
export default function DayScreen() {
  const params = useLocalSearchParams<{ type?: Kind; date?: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const customers = useCustomers().data ?? [];
  const entries = useEntries().data ?? [];
  const today = todayISO();
  const [kind, setKind] = useState<Kind>(params.type === "payment" ? "payment" : "work");
  const [date, setDate] = useState(params.date || today);
  const [editing, setEditing] = useState<Entry | null>(null);

  const nameOf = (id: string) => customers.find((c) => c.id === id)?.name ?? "ग्राहक";

  const dayEntries = useMemo(() => entries.filter((e) => e.date === date), [entries, date]);
  // "जमा" = all cash that came in that day: jama rows plus cash taken with work.
  const inKind = (e: Entry, k: Kind) => (k === "work" ? e.type === "work" : cashIn(e) > 0);
  const amountFor = (e: Entry, k: Kind) => (k === "work" ? e.amount : cashIn(e));
  const rows = useMemo(() => dayEntries.filter((e) => inKind(e, kind)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [dayEntries, kind]);
  const sum = (k: Kind) => dayEntries.filter((e) => inKind(e, k)).reduce((s, e) => s + amountFor(e, k), 0);
  const total = sum(kind);

  const dateLabel = date === today ? "आज" : date === todayISO(-1) ? "कल" : formatWeekdayDate(date);

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={[styles.topBar, { paddingTop: insets.top + spacing.md }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} testID="day-back">
          <MaterialIcon name="arrow-left" size={26} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.topTitle}>दिन का हिसाब</Text>
      </View>

      <View style={{ paddingHorizontal: spacing.lg }}>
        <View style={styles.dateRow}>
          <Pressable style={styles.arrow} onPress={() => setDate(shiftDay(date, -1))} testID="day-prev">
            <MaterialIcon name="chevron-left" size={24} color={colors.onSurface} />
          </Pressable>
          <Pressable style={{ flex: 1, alignItems: "center" }} onPress={() => setDate(today)} testID="day-today">
            <Text style={styles.dateText}>{dateLabel}</Text>
            {date !== today ? <Text style={styles.dateHint}>आज पर जाने के लिए दबाएँ</Text> : null}
          </Pressable>
          <Pressable style={[styles.arrow, date >= today && { opacity: 0.3 }]} disabled={date >= today} onPress={() => setDate(shiftDay(date, 1))} testID="day-next">
            <MaterialIcon name="chevron-right" size={24} color={colors.onSurface} />
          </Pressable>
        </View>

        <View style={styles.segment}>
          {(["work", "payment"] as Kind[]).map((k) => (
            <Pressable key={k} onPress={() => setKind(k)} style={[styles.segmentBtn, kind === k && styles.segmentActive]} testID={`day-kind-${k}`}>
              <Text style={[styles.segmentText, kind === k && { color: colors.onBrandPrimary }]}>
                {k === "work" ? "काम" : "जमा"} · {formatINR(sum(k))}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.totalCard}>
          <Text style={styles.totalLabel}>{kind === "work" ? "कुल काम" : "कुल जमा"} ({rows.length} एंट्री)</Text>
          <Text style={[styles.totalValue, { color: kind === "work" ? colors.onSurface : colors.success }]}>{formatINR(total)}</Text>
        </View>
      </View>

      <FlatList
        data={rows}
        keyExtractor={(e) => e.id}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl * 2, gap: spacing.sm }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <MaterialIcon name="calendar-blank-outline" size={32} color={colors.muted} />
            <Text style={styles.emptyTitle}>{kind === "work" ? "इस दिन कोई काम नहीं लिखा" : "इस दिन कोई जमा नहीं"}</Text>
          </View>
        }
        renderItem={({ item: e }) => (
          <Pressable style={styles.row} onPress={() => setEditing(e)} testID={`day-row-${e.id}`}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Pressable onPress={() => router.push(`/customer/${e.customerId}`)} hitSlop={4}>
                <Text style={styles.name} numberOfLines={1}>{nameOf(e.customerId)}</Text>
              </Pressable>
              <Text style={styles.desc} numberOfLines={2}>{e.description || (e.type === "work" ? "काम" : "जमा")}</Text>
              {e.type === "work" ? (
                <Text style={[styles.notes, { color: (e.paid ?? 0) >= e.amount ? colors.success : colors.error }]}>
                  {(e.paid ?? 0) >= e.amount ? "नकद" : (e.paid ?? 0) > 0 ? `${formatINR(e.paid ?? 0)} नकद · ${formatINR(e.amount - (e.paid ?? 0))} उधार` : "उधार"}
                </Text>
              ) : null}
              {e.notes ? <Text style={styles.notes} numberOfLines={1}>{e.notes}</Text> : null}
            </View>
            <Text style={[styles.amount, { color: kind === "work" ? colors.onSurface : colors.success }]}>{formatINR(amountFor(e, kind))}</Text>
            <MaterialIcon name="pencil-outline" size={16} color={colors.muted} />
          </Pressable>
        )}
      />

      <EditRecordSheet entry={editing} onClose={() => setEditing(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: "row", alignItems: "center", gap: spacing.lg, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  topTitle: { flex: 1, fontSize: 18, fontWeight: "700", color: colors.onSurface },
  dateRow: { flexDirection: "row", alignItems: "center", marginTop: spacing.sm },
  arrow: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  dateText: { fontSize: 17, fontWeight: "700", color: colors.onSurface },
  dateHint: { fontSize: 11, color: colors.muted, marginTop: 2 },
  segment: { flexDirection: "row", backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: 4, marginTop: spacing.lg, borderWidth: 1, borderColor: colors.border },
  segmentBtn: { flex: 1, alignItems: "center", paddingVertical: 10, borderRadius: radius.sm },
  segmentActive: { backgroundColor: colors.brandPrimary },
  segmentText: { fontSize: 13, fontWeight: "700", color: colors.onSurface },
  totalCard: { marginTop: spacing.md, padding: spacing.lg, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, alignItems: "center" },
  totalLabel: { fontSize: 12, color: colors.muted, fontWeight: "600" },
  totalValue: { fontSize: 28, fontWeight: "800", marginTop: 2 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  name: { fontSize: 15, fontWeight: "700", color: colors.onSurface },
  desc: { fontSize: 13, color: colors.onSurfaceSecondary, marginTop: 2 },
  notes: { fontSize: 12, color: colors.muted, marginTop: 2 },
  amount: { fontSize: 16, fontWeight: "800" },
  empty: { alignItems: "center", padding: spacing.xxl, gap: spacing.sm },
  emptyTitle: { fontSize: 15, fontWeight: "600", color: colors.onSurface },
});
