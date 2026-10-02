import { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, TextInput, FlatList, ScrollView, ActivityIndicator } from "react-native";
import { Pressable } from "@/src/components/tap";
import { SlowServerHint } from "@/src/components/slow-server-hint";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import MaterialIcon from "@react-native-vector-icons/material-design-icons";
import { colors, spacing, radius } from "@/src/theme";
import { entryDelta, useCustomers, useEntries } from "@/src/lib/data";
import { formatDateShort, formatINR, formatPhone, initials, todayISO } from "@/src/lib/format";
import { AddCustomerSheet } from "@/src/components/sheets";
import { usePersona } from "@/src/lib/persona";

type Filter = "due" | "all" | "clear";
const FILTERS: Filter[] = ["due", "all", "clear"];
const FILTER_LABEL: Record<Filter, string> = { due: "लेने हैं", all: "सभी", clear: "लेने नहीं" };

export default function CustomersScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { labels, isPersonal } = usePersona();
  const params = useLocalSearchParams<{ filter?: Filter; t?: string }>();
  const customersQ = useCustomers();
  const entriesQ = useEntries();
  const customers = customersQ.data ?? [];
  const entries = entriesQ.data ?? [];
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("due");
  const [open, setOpen] = useState(false);
  const today = todayISO();

  useEffect(() => {
    if (params.filter && FILTERS.includes(params.filter)) {
      setFilter(params.filter);
      setQ("");
    }
  }, [params.filter, params.t]);

  const all = useMemo(() => {
    const stats = new Map<string, { due: number; last: string; work: boolean }>();
    for (const e of entries) {
      const s = stats.get(e.customerId) ?? { due: 0, last: "", work: false };
      s.due += entryDelta(e);
      if (e.date > s.last) s.last = e.date;
      if (e.type === "work") s.work = true;
      stats.set(e.customerId, s);
    }
    return customers.map((c) => ({ c, due: stats.get(c.id)?.due ?? 0, last: stats.get(c.id)?.last ?? "", work: stats.get(c.id)?.work ?? false }));
  }, [customers, entries]);

  const counts = useMemo(
    () => ({ due: all.filter((r) => r.due > 0).length, all: all.length, clear: all.filter((r) => r.due <= 0).length }),
    [all],
  );
  const totalDue = useMemo(() => all.reduce((s, r) => s + (r.due > 0 ? r.due : 0), 0), [all]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all
      .filter(({ c }) => !needle || c.name.toLowerCase().includes(needle) || c.phone.includes(needle) || c.address.toLowerCase().includes(needle))
      .filter(({ due }) => (filter === "due" ? due > 0 : filter === "clear" ? due <= 0 : true))
      .sort((a, b) => (filter === "due" ? b.due - a.due : a.c.name.localeCompare(b.c.name, "hi")));
  }, [all, q, filter]);

  const loading = customersQ.isLoading || entriesQ.isLoading;

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={{ paddingTop: insets.top + spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.md, backgroundColor: colors.surface }}>
        <Text style={styles.h1}>{labels.customers}</Text>
        <View style={styles.searchWrap}>
          <MaterialIcon name="magnify" size={18} color={colors.muted} />
          <TextInput
            style={styles.search}
            value={q}
            onChangeText={setQ}
            placeholder="नाम, फ़ोन या पता खोजें"
            placeholderTextColor={colors.muted}
            testID="customer-search"
          />
          {q ? (
            <Pressable onPress={() => setQ("")} hitSlop={8}><MaterialIcon name="close-circle" size={18} color={colors.muted} /></Pressable>
          ) : null}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingTop: spacing.md }}>
          {FILTERS.map((f) => (
            <Pressable key={f} onPress={() => setFilter(f)} style={[styles.chip, filter === f && styles.chipActive]} testID={`filter-${f}`}>
              <Text style={[styles.chipText, filter === f && { color: colors.onBrandPrimary }]}>
                {FILTER_LABEL[f]} ({counts[f]})
              </Text>
            </Pressable>
          ))}
        </ScrollView>
        {!loading && filter === "due" && totalDue > 0 ? (
          <Text style={styles.summary} testID="customers-summary">
            कुल लेने हैं <Text style={{ color: colors.error, fontWeight: "800" }}>{formatINR(totalDue)}</Text> · {counts.due} ग्राहक
          </Text>
        ) : null}
      </View>

      {loading ? (
        <View style={{ marginTop: spacing.xxl, alignItems: "center" }}><ActivityIndicator color={colors.brandPrimary} /><SlowServerHint /></View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.c.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl * 2 }}
          ListEmptyComponent={
            <View style={styles.empty} testID="customers-empty">
              <MaterialIcon name="account-group-outline" size={32} color={colors.muted} />
              <Text style={styles.emptyTitle}>
                {q ? "कोई ग्राहक नहीं मिला" : customers.length === 0 ? "अभी कोई ग्राहक नहीं" : filter === "due" ? "किसी से लेने नहीं हैं" : "इस सूची में कोई नहीं"}
              </Text>
              {!q && customers.length === 0 && <Text style={styles.emptySub}>पहला ग्राहक जोड़कर शुरू करें</Text>}
            </View>
          }
          renderItem={({ item, index }) => (
            <Pressable
              onPress={() => router.push(`/customer/${item.c.id}`)}
              style={[styles.row, index === 0 && styles.firstRow, index === rows.length - 1 && styles.lastRow]}
              testID={`customer-row-${item.c.id}`}
            >
              <View style={styles.avatar}><Text style={styles.avatarText}>{initials(item.c.name)}</Text></View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.name} numberOfLines={1}>{item.c.name}</Text>
                <Text style={styles.sub} numberOfLines={1}>
                  {item.c.phone ? formatPhone(item.c.phone) : "फ़ोन नहीं"}{item.c.address ? ` · ${item.c.address}` : ""}
                </Text>
                {item.last ? (
                  <Text style={styles.last} numberOfLines={1}>आख़िरी एंट्री: {item.last === today ? "आज" : formatDateShort(item.last)}</Text>
                ) : null}
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={[styles.dueAmt, { color: item.due > 0 ? colors.error : item.due < 0 ? (item.work ? colors.success : colors.warning) : colors.muted }]}>
                  {item.due === 0 ? "क्लियर" : formatINR(Math.abs(item.due))}
                </Text>
                {item.due !== 0 ? (
                  <Text style={styles.dueTag}>{item.due > 0 ? "लेने हैं" : item.work ? "एडवांस" : "देने हैं"}</Text>
                ) : null}
              </View>
            </Pressable>
          )}
          ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: colors.border }} />}
        />
      )}

      <Pressable style={[styles.fab, { bottom: insets.bottom + 16 }]} onPress={() => setOpen(true)} testID="add-customer-fab">
        <MaterialIcon name="plus" size={26} color={colors.onBrandPrimary} />
      </Pressable>

      <AddCustomerSheet visible={open} onClose={() => setOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  h1: { fontSize: 30, fontWeight: "700", color: colors.onSurface, marginBottom: spacing.md },
  searchWrap: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, paddingHorizontal: spacing.md, height: 46, borderWidth: 1, borderColor: colors.border },
  search: { flex: 1, color: colors.onSurface, fontSize: 15 },
  chip: { height: 36, paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { fontSize: 13, color: colors.onSurface, fontWeight: "600" },
  summary: { fontSize: 13, color: colors.onSurfaceSecondary, marginTop: spacing.md },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, backgroundColor: colors.surfaceSecondary, borderLeftWidth: 1, borderRightWidth: 1, borderColor: colors.border },
  firstRow: { borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, borderTopWidth: 1 },
  lastRow: { borderBottomLeftRadius: radius.md, borderBottomRightRadius: radius.md, borderBottomWidth: 1 },
  avatar: { width: 44, height: 44, borderRadius: radius.pill, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  avatarText: { fontWeight: "700", color: colors.onBrandTertiary, fontSize: 14 },
  name: { fontSize: 15, fontWeight: "600", color: colors.onSurface },
  sub: { fontSize: 12, color: colors.muted, marginTop: 2 },
  last: { fontSize: 11, color: colors.muted, marginTop: 2 },
  dueAmt: { fontSize: 15, fontWeight: "700" },
  dueTag: { fontSize: 11, color: colors.muted, marginTop: 2 },
  empty: { alignItems: "center", padding: spacing.xxl, gap: spacing.sm },
  emptyTitle: { fontSize: 15, fontWeight: "600", color: colors.onSurface },
  emptySub: { fontSize: 13, color: colors.muted },
  fab: { position: "absolute", right: 20, width: 56, height: 56, borderRadius: 28, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center", elevation: 4, shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
});
