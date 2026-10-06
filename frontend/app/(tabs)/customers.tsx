import { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, TextInput, FlatList, ScrollView, ActivityIndicator } from "react-native";
import { Pressable } from "@/src/components/tap";
import { DataLoadError, SlowServerHint } from "@/src/components/slow-server-hint";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import MaterialIcon from "@react-native-vector-icons/material-design-icons";
import { colors, spacing, radius, semantic, elevation, type } from "@/src/theme";
import { entryDelta, isVendor, useCustomers, useEntries } from "@/src/lib/data";
import { buildAllLedgers } from "@/src/lib/records";
import { formatDateShort, formatINR, formatPhone, initials, roundMoney, todayISO } from "@/src/lib/format";
import { HIDDEN, usePrefs } from "@/src/lib/prefs";
import { AddCustomerSheet, AddEntrySheet } from "@/src/components/sheets";
import { ReceiptSheet } from "@/src/components/receipt-sheet";
import { reminderDoc, type ShareDoc } from "@/src/lib/receipt";
import { useAuth } from "@/src/context/AuthContext";
import { Amount, EmptyState } from "@/src/components/ui";
import { usePersona } from "@/src/lib/persona";
import { TERMS, balanceTerm, totalTerm } from "@/src/lib/terms";

type Filter = "due" | "owe" | "all";
const FILTERS: Filter[] = ["due", "owe", "all"];
type Sort = "recent" | "amount" | "oldest" | "name";
const SORTS: Sort[] = ["recent", "amount", "oldest", "name"];
const SORT_LABEL: Record<Sort, string> = { recent: "नई एंट्री", amount: "ज़्यादा रकम", oldest: "पुराना बाकी", name: "नाम A-Z" };
const phoneKey = (p: string) => p.replace(/\D/g, "").slice(-10);

export default function CustomersScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { labels, isPersonal } = usePersona();
  const params = useLocalSearchParams<{ filter?: Filter; t?: string; book?: "vendor" | "customer" }>();
  const [book, setBook] = useState<"customer" | "vendor">("customer");
  const vendors = !isPersonal && book === "vendor";
  const customersQ = useCustomers();
  const entriesQ = useEntries();
  const allCustomers = customersQ.data ?? [];
  const entries = entriesQ.data ?? [];
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("due");
  const [sort, setSort] = useState<Sort>("recent");
  const [adding, setAdding] = useState(false);
  const [paying, setPaying] = useState<string | null>(null);
  const [shareDoc, setShareDoc] = useState<ShareDoc | null>(null);
  const { user } = useAuth();
  const { hideAmounts } = usePrefs();
  const today = todayISO();
  const daysSince = (d: string) => Math.round((new Date(today).getTime() - new Date(d).getTime()) / 86400000);

  const customers = useMemo(
    () => allCustomers.filter((c) => (isPersonal ? c.persona === "personal" : c.persona !== "personal" && isVendor(c) === vendors)),
    [allCustomers, isPersonal, vendors]
  );
  const vendorCount = useMemo(() => (isPersonal ? 0 : allCustomers.filter((c) => c.persona !== "personal" && isVendor(c)).length), [allCustomers, isPersonal]);

  useEffect(() => {
    if (params.book === "vendor" || params.book === "customer") setBook(params.book);
    if (params.filter && FILTERS.includes(params.filter)) {
      setFilter(params.filter);
      setQ("");
    } else if (params.book) setFilter(params.book === "vendor" ? "owe" : "due");
  }, [params.filter, params.t, params.book]);

  const switchBook = (b: "customer" | "vendor") => {
    setBook(b);
    setFilter(b === "vendor" ? "owe" : "due");
    setQ("");
  };

  const all = useMemo(() => {
    // `latest` orders by the newest entry: its date, then when it was typed.
    // `since` is the day of the oldest row still open (unpaid udhaar, or goods we still owe for).
    const stats = new Map<string, { due: number; last: string; latest: string; since: string }>();
    const open = buildAllLedgers(entries);
    for (const e of entries) {
      const s = stats.get(e.customerId) ?? { due: 0, last: "", latest: "", since: "" };
      s.due += entryDelta(e);
      if (e.date > s.last) s.last = e.date;
      const key = `${e.date}|${e.createdAt}`;
      if (key > s.latest) s.latest = key;
      if ((open.get(e.id)?.remaining ?? 0) > 0 && (!s.since || e.date < s.since)) s.since = e.date;
      stats.set(e.customerId, s);
    }
    return customers.map((c) => {
      const s = stats.get(c.id);
      return { c, due: roundMoney(s?.due ?? 0), last: s?.last ?? "", latest: s?.latest ?? "", since: s?.since ?? "" };
    });
  }, [customers, entries]);

  const counts = useMemo(
    () => ({ due: all.filter((r) => r.due > 0).length, owe: all.filter((r) => r.due < 0).length, all: all.length }),
    [all],
  );
  const totalDue = useMemo(() => all.reduce((s, r) => s + (r.due > 0 ? r.due : 0), 0), [all]);
  const totalOwe = useMemo(() => all.reduce((s, r) => s + (r.due < 0 ? -r.due : 0), 0), [all]);
  const filterLabel: Record<Filter, string> = vendors
    ? { due: "एडवांस दिया", owe: "देने हैं", all: "सभी" }
    : { due: balanceTerm(1, isPersonal, true), owe: balanceTerm(-1, isPersonal, true), all: "सभी" };
  const listName = vendors ? "Vendor" : labels.customers;

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all
      .filter(({ c }) => !needle || c.name.toLowerCase().includes(needle) || c.phone.includes(needle) || c.address.toLowerCase().includes(needle))
      // A search looks through everyone; the chips only narrow the browsing list.
      .filter(({ due }) => !!needle || (filter === "due" ? due > 0 : filter === "owe" ? due < 0 : true))
      .sort((a, b) => {
        if (sort === "name") return a.c.name.localeCompare(b.c.name, "hi");
        if (sort === "amount") return Math.abs(b.due) - Math.abs(a.due);
        if (sort === "oldest") return (a.since || a.last || "9").localeCompare(b.since || b.last || "9");
        return b.latest.localeCompare(a.latest);
      });
  }, [all, q, filter, sort]);

  const dupePhones = useMemo(() => {
    const seen = new Map<string, number>();
    for (const c of customers) {
      const k = phoneKey(c.phone || "");
      if (k.length === 10) seen.set(k, (seen.get(k) ?? 0) + 1);
    }
    return new Set([...seen].filter(([, n]) => n > 1).map(([k]) => k));
  }, [customers]);

  const loading = customersQ.isLoading || entriesQ.isLoading;
  const loadFailed = !loading && (customersQ.isError || entriesQ.isError) && (customersQ.data == null || entriesQ.data == null);

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={{ paddingTop: insets.top + spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.md, backgroundColor: colors.surface }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.sm }}>
          <Text style={styles.h1}>{listName}</Text>
          {counts.due > 1 && !vendors ? (
            <Pressable style={styles.bulkBtn} onPress={() => router.push("/remind" as never)} accessibilityRole="button" accessibilityLabel="सबको तगादा भेजें" testID="open-bulk-remind">
              <MaterialIcon name="whatsapp" size={18} color={semantic.whatsapp} />
              <Text style={styles.bulkText}>सबको तगादा</Text>
            </Pressable>
          ) : null}
        </View>
        {!isPersonal ? (
          <View style={styles.bookSeg}>
            {(["customer", "vendor"] as const).map((b) => (
              <Pressable key={b} onPress={() => switchBook(b)} style={[styles.bookBtn, book === b && styles.bookOn]} accessibilityRole="tab" accessibilityState={{ selected: book === b }} testID={`book-${b}`}>
                <MaterialIcon name={b === "vendor" ? "truck-outline" : "account-group-outline"} size={16} color={book === b ? colors.onBrandPrimary : colors.onSurface} />
                <Text style={[styles.bookText, book === b && { color: colors.onBrandPrimary }]}>{b === "vendor" ? `Vendor${vendorCount ? ` (${vendorCount})` : ""}` : "ग्राहक"}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

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
            <Pressable key={f} onPress={() => { setFilter(f); if (f === "all") setSort("name"); }} style={[styles.chip, filter === f && styles.chipActive]} testID={`filter-${f}`}>
              <Text style={[styles.chipText, filter === f && { color: colors.onBrandPrimary }]}>
                {filterLabel[f]} ({counts[f]})
              </Text>
            </Pressable>
          ))}
        </ScrollView>
        {!loading && filter !== "all" && (filter === "due" ? totalDue : totalOwe) > 0 ? (
          <Text style={styles.summary} testID="customers-summary">
            {vendors ? (filter === "due" ? "कुल एडवांस दिया" : "कुल देने हैं") : totalTerm(filter === "due", isPersonal)}{" "}
            <Text style={{ color: vendors ? (filter === "due" ? semantic.received : semantic.due) : filter === "due" ? semantic.due : isPersonal ? semantic.pending : semantic.received, fontWeight: "800" }}>
              {hideAmounts ? HIDDEN : formatINR(filter === "due" ? totalDue : totalOwe)}
            </Text>{" "}
            · {counts[filter]} {listName}
          </Text>
        ) : null}
        {!loading && counts[filter] > 1 ? (
          <View style={styles.sortRow}>
            <MaterialIcon name="sort" size={16} color={colors.muted} />
            {SORTS.map((s) => (
              <Pressable key={s} onPress={() => setSort(s)} hitSlop={6} testID={`sort-${s}`}>
                <Text style={[styles.sortText, sort === s && styles.sortOn]}>{SORT_LABEL[s]}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>

      {loadFailed ? (
        <DataLoadError onRetry={() => { customersQ.refetch(); entriesQ.refetch(); }} />
      ) : loading ? (
        <View style={{ marginTop: spacing.xxl, alignItems: "center" }}><ActivityIndicator color={colors.brandPrimary} /><SlowServerHint /></View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.c.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl * 2 }}
          ListEmptyComponent={
            <View testID="customers-empty">
              <EmptyState
                icon="account-group-outline"
                title={
                  q
                    ? "कोई नहीं मिला"
                    : vendors
                      ? customers.length === 0 ? "अभी कोई Vendor नहीं" : filter === "owe" ? "किसी Vendor को देने नहीं हैं" : filter === "due" ? "किसी Vendor को एडवांस नहीं दिया" : "इस सूची में कोई नहीं"
                      : customers.length === 0 ? (isPersonal ? "अभी कोई नहीं" : "अभी कोई ग्राहक नहीं") : filter === "due" ? "किसी से पैसे नहीं मिलने हैं" : filter === "owe" ? (isPersonal ? "किसी को देने नहीं हैं" : "किसी का एडवांस नहीं") : "इस सूची में कोई नहीं"
                }
                message={!q && customers.length === 0 ? (vendors ? "कारीगर, सप्लायर या जिनसे बाहर काम करवाते हैं — उन्हें यहाँ जोड़ें" : "एंट्री लिखते ही यहाँ दिखेंगे, या अभी जोड़ें") : undefined}
                action={!q && customers.length === 0 ? { label: vendors ? "नया Vendor" : labels.newCustomer, onPress: () => setAdding(true), testID: "customers-empty-add" } : undefined}
              />
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
                {dupePhones.has(phoneKey(item.c.phone || "")) ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 }}>
                    <MaterialIcon name="alert-outline" size={14} color={colors.warning} />
                    <Text style={styles.dupe} numberOfLines={1}>यही नंबर किसी और खाते में भी है</Text>
                  </View>
                ) : null}
                {item.last ? (
                  <Text style={styles.last} numberOfLines={1}>
                    आख़िरी एंट्री: {item.last === today ? "आज" : formatDateShort(item.last)}
                    {item.due > 0 && item.since && daysSince(item.since) >= 30 ? (
                      <Text style={{ color: colors.error, fontWeight: "700" }}> · {daysSince(item.since)} दिन से बाकी</Text>
                    ) : null}
                  </Text>
                ) : null}
              </View>
              <View style={{ alignItems: "flex-end" }}>
                {item.due === 0 ? (
                  <Text style={[styles.dueAmt, { color: colors.muted }]}>{TERMS.settled}</Text>
                ) : (
                  <Amount value={Math.abs(item.due)} tone={vendors ? (item.due < 0 ? "due" : "received") : item.due > 0 ? "due" : isPersonal ? "pending" : "received"} size="bodyLg" style={{ textAlign: "right" }} />
                )}
                {vendors ? (
                  item.due !== 0 ? <Text style={styles.dueTag}>{item.due < 0 ? "देने हैं" : "एडवांस दिया"}</Text> : null
                ) : item.due > 0 ? (
                  <View style={styles.rowActs}>
                    <Pressable
                      onPress={() => setShareDoc(reminderDoc(item.c, item.due, user ?? {}))}
                      hitSlop={6}
                      style={[styles.rowBtn, { backgroundColor: semantic.pendingSoft }]}
                      accessibilityRole="button"
                      accessibilityLabel={`${item.c.name} को तगादा भेजें`}
                      testID={`row-remind-${item.c.id}`}
                    >
                      <MaterialIcon name="message-alert-outline" size={18} color={semantic.pending} />
                    </Pressable>
                    <Pressable
                      onPress={() => setPaying(item.c.id)}
                      hitSlop={6}
                      style={[styles.rowBtn, styles.gotBtn]}
                      accessibilityRole="button"
                      accessibilityLabel={`${item.c.name} से पैसे मिले`}
                      testID={`row-got-${item.c.id}`}
                    >
                      <MaterialIcon name="arrow-bottom-left" size={16} color={semantic.received} />
                      <Text style={styles.gotText}>मिले</Text>
                    </Pressable>
                  </View>
                ) : item.due < 0 ? (
                  <Text style={styles.dueTag}>{balanceTerm(item.due, isPersonal, true)}</Text>
                ) : null}
              </View>
            </Pressable>
          )}
          ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: colors.border }} />}
        />
      )}

      <Pressable
        style={[styles.fab, { bottom: insets.bottom + 16 }]}
        onPress={() => setAdding(true)}
        accessibilityRole="button"
        accessibilityLabel={vendors ? "नया Vendor" : labels.newCustomer}
        testID="add-customer-fab"
      >
        <MaterialIcon name={vendors ? "truck-plus-outline" : "account-plus"} size={26} color={colors.onBrandPrimary} />
      </Pressable>
      <AddCustomerSheet visible={adding} onClose={() => setAdding(false)} role={vendors ? "vendor" : "customer"} />
      <AddEntrySheet visible={paying !== null} type="payment" onClose={() => setPaying(null)} customerId={paying ?? undefined} />
      <ReceiptSheet doc={shareDoc} onClose={() => setShareDoc(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  h1: { fontSize: 26, fontWeight: "700", color: colors.onSurface },
  searchWrap: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, paddingHorizontal: spacing.md, height: 46, borderWidth: 1, borderColor: colors.border },
  search: { flex: 1, color: colors.onSurface, fontSize: 15 },
  chip: { height: 36, paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  bookSeg: { flexDirection: "row", gap: 4, padding: 4, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md },
  bookBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 36, borderRadius: radius.pill },
  bookOn: { backgroundColor: colors.brandPrimary },
  bookText: { ...type.caption, fontWeight: "800", color: colors.onSurface },
  chipText: { fontSize: 13, color: colors.onSurface, fontWeight: "600" },
  summary: { fontSize: 13, color: colors.onSurfaceSecondary, marginTop: spacing.md },
  sortRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginTop: spacing.sm },
  sortText: { fontSize: 12, color: colors.muted, fontWeight: "600" },
  sortOn: { color: colors.brandPrimary, fontWeight: "800", textDecorationLine: "underline" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, backgroundColor: colors.surfaceSecondary, borderLeftWidth: 1, borderRightWidth: 1, borderColor: colors.border },
  firstRow: { borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, borderTopWidth: 1 },
  lastRow: { borderBottomLeftRadius: radius.md, borderBottomRightRadius: radius.md, borderBottomWidth: 1 },
  avatar: { width: 44, height: 44, borderRadius: radius.pill, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  avatarText: { fontWeight: "700", color: colors.onBrandTertiary, fontSize: 14 },
  name: { fontSize: 15, fontWeight: "600", color: colors.onSurface },
  sub: { ...type.caption, color: colors.muted, marginTop: 2 },
  last: { ...type.caption, color: colors.muted, marginTop: 2 },
  dupe: { ...type.caption, color: colors.warning, fontWeight: "700", flexShrink: 1 },
  dueAmt: { ...type.bodyLg, fontWeight: "700" },
  dueTag: { ...type.caption, color: colors.muted },
  bulkBtn: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 40, paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: semantic.whatsappSoft },
  bulkText: { ...type.caption, fontWeight: "800", color: semantic.whatsapp },
  rowActs: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs },
  rowBtn: { minHeight: 36, minWidth: 36, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  gotBtn: { flexDirection: "row", gap: 4, paddingHorizontal: spacing.md, backgroundColor: semantic.receivedSoft },
  gotText: { ...type.caption, color: semantic.received, fontWeight: "800" },
  fab: { position: "absolute", right: 20, width: 56, height: 56, borderRadius: 28, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center", ...elevation.high },
});
