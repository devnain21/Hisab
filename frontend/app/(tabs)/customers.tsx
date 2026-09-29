import { useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, FlatList, ScrollView, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import MaterialIcon from "@react-native-vector-icons/material-design-icons";
import { colors, spacing, radius } from "@/src/theme";
import { computeBalance, useCustomers, useEntries } from "@/src/lib/data";
import { formatINR, formatPhone, initials } from "@/src/lib/format";
import { AddCustomerSheet } from "@/src/components/sheets";

type Filter = "due" | "all" | "clear";

export default function CustomersScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const customersQ = useCustomers();
  const entriesQ = useEntries();
  const customers = customersQ.data ?? [];
  const entries = entriesQ.data ?? [];
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("due");
  const [open, setOpen] = useState(false);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return customers
      .map((c) => ({ c, due: computeBalance(entries, c.id) }))
      .filter(({ c }) => !needle || c.name.toLowerCase().includes(needle) || c.phone.includes(needle) || c.address.toLowerCase().includes(needle))
      .filter(({ due }) => (filter === "due" ? due > 0 : filter === "clear" ? due <= 0 : true))
      .sort((a, b) => (filter === "due" ? b.due - a.due : a.c.name.localeCompare(b.c.name, "hi")));
  }, [customers, entries, q, filter]);

  const loading = customersQ.isLoading || entriesQ.isLoading;

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={{ paddingTop: insets.top + spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.md, backgroundColor: colors.surface }}>
        <Text style={styles.h1}>ग्राहक</Text>
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
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingTop: spacing.md }}>
          {(["due", "all", "clear"] as Filter[]).map((f) => (
            <Pressable key={f} onPress={() => setFilter(f)} style={[styles.chip, filter === f && styles.chipActive]} testID={`filter-${f}`}>
              <Text style={[styles.chipText, filter === f && { color: colors.onBrandPrimary }]}>
                {f === "due" ? "बकाया" : f === "all" ? "सभी" : "क्लियर"}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {loading ? (
        <View style={{ marginTop: spacing.xxl, alignItems: "center" }}><ActivityIndicator color={colors.brandPrimary} /></View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.c.id}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl * 2 }}
          ListEmptyComponent={
            <View style={styles.empty} testID="customers-empty">
              <MaterialIcon name="account-group-outline" size={32} color={colors.muted} />
              <Text style={styles.emptyTitle}>{q ? "कोई ग्राहक नहीं मिला" : "अभी कोई ग्राहक नहीं"}</Text>
              {!q && <Text style={styles.emptySub}>पहला ग्राहक जोड़कर शुरू करें</Text>}
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
              </View>
              <Text style={[styles.dueAmt, { color: item.due > 0 ? colors.error : item.due < 0 ? colors.success : colors.muted }]}>
                {item.due === 0 ? "क्लियर" : formatINR(Math.abs(item.due))}
              </Text>
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
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, backgroundColor: colors.surfaceSecondary, borderLeftWidth: 1, borderRightWidth: 1, borderColor: colors.border },
  firstRow: { borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, borderTopWidth: 1 },
  lastRow: { borderBottomLeftRadius: radius.md, borderBottomRightRadius: radius.md, borderBottomWidth: 1 },
  avatar: { width: 44, height: 44, borderRadius: radius.pill, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  avatarText: { fontWeight: "700", color: colors.onBrandTertiary, fontSize: 14 },
  name: { fontSize: 15, fontWeight: "600", color: colors.onSurface },
  sub: { fontSize: 12, color: colors.muted, marginTop: 2 },
  dueAmt: { fontSize: 15, fontWeight: "700" },
  empty: { alignItems: "center", padding: spacing.xxl, gap: spacing.sm },
  emptyTitle: { fontSize: 15, fontWeight: "600", color: colors.onSurface },
  emptySub: { fontSize: 13, color: colors.muted },
  fab: { position: "absolute", right: 20, width: 56, height: 56, borderRadius: 28, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center", elevation: 4, shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
});
