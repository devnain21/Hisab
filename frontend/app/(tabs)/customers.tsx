import { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, TextInput, FlatList, ScrollView, ActivityIndicator } from "react-native";
import { Pressable } from "@/src/components/tap";
import { DataLoadError, SlowServerHint } from "@/src/components/slow-server-hint";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import MaterialIcon from "@react-native-vector-icons/material-design-icons";
import Animated, { FadeInDown } from "react-native-reanimated";
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
const SORT_ICON: Record<Sort, string> = { recent: "clock-outline", amount: "sort-numeric-descending", oldest: "history", name: "sort-alphabetical-ascending" };
const phoneKey = (p: string) => p.replace(/\D/g, "").slice(-10);
/** Udhaar open this many days or more is flagged on the row. */
const OLD_DAYS = 30;

export default function CustomersScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { labels, isPersonal } = usePersona();
  const params = useLocalSearchParams<{ filter?: Filter; t?: string; book?: "vendor" | "customer" }>();
  const [book, setBook] = useState<"customer" | "vendor">("customer");
  const customersQ = useCustomers();
  const entriesQ = useEntries();
  const allCustomers = useMemo(() => customersQ.data ?? [], [customersQ.data]);
  // Vendors are no longer added; the list only stays for ones saved earlier.
  const vendorCount = useMemo(() => (isPersonal ? 0 : allCustomers.filter((c) => c.persona !== "personal" && isVendor(c)).length), [allCustomers, isPersonal]);
  const vendors = !isPersonal && book === "vendor" && vendorCount > 0;
  const entries = useMemo(() => entriesQ.data ?? [], [entriesQ.data]);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("due");
  const [sort, setSort] = useState<Sort>("recent");
  const [adding, setAdding] = useState(false);
  const [paying, setPaying] = useState<string | null>(null);
  const [shareDoc, setShareDoc] = useState<ShareDoc | null>(null);
  const { user } = useAuth();
  const { hideAmounts } = usePrefs();
  const money = (n: number) => (hideAmounts ? HIDDEN : formatINR(n));
  const today = todayISO();
  const daysSince = (d: string) => Math.round((new Date(today).getTime() - new Date(d).getTime()) / 86400000);

  const customers = useMemo(
    () => allCustomers.filter((c) => (isPersonal ? c.persona === "personal" : c.persona !== "personal" && isVendor(c) === vendors)),
    [allCustomers, isPersonal, vendors]
  );
  const customerCount = useMemo(() => (isPersonal ? 0 : allCustomers.filter((c) => c.persona !== "personal" && !isVendor(c)).length), [allCustomers, isPersonal]);

  // Shop and Personal are different books: a search or filter from one means nothing in the other.
  const [listBook, setListBook] = useState(isPersonal);
  if (listBook !== isPersonal) {
    setListBook(isPersonal);
    setQ("");
    setFilter("due");
    setBook("customer");
  }

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
  const pickFilter = (f: Filter) => {
    setFilter(f);
    if (f === "all") setSort("name");
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
  const totalDue = useMemo(() => roundMoney(all.reduce((s, r) => s + (r.due > 0 ? r.due : 0), 0)), [all]);
  const totalOwe = useMemo(() => roundMoney(all.reduce((s, r) => s + (r.due < 0 ? -r.due : 0), 0)), [all]);
  const oldDue = useMemo(() => all.filter((r) => r.due > 0 && r.since && daysSince(r.since) >= OLD_DAYS).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [all, today]);
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

  // Two sides of the book: what comes to us, and what is with us (advance) / what we owe.
  const dueSide = vendors
    ? { label: "एडवांस दिया", value: totalDue, count: counts.due, icon: "arrow-top-right" }
    : { label: totalTerm(true, isPersonal), value: totalDue, count: counts.due, icon: "arrow-bottom-left" };
  const oweSide = vendors
    ? { label: "देने हैं", value: totalOwe, count: counts.owe, icon: "arrow-top-right" }
    : { label: totalTerm(false, isPersonal), value: totalOwe, count: counts.owe, icon: isPersonal ? "arrow-top-right" : "wallet-outline" };

  const header = (
    <View>
      <View style={styles.hero} testID="customers-summary">
        <View style={styles.heroRow}>
          <Pressable style={[styles.heroHalf, filter === "due" && styles.heroHalfOn]} onPress={() => pickFilter("due")} accessibilityRole="button" testID="hero-due">
            <View style={styles.heroLabelRow}>
              <MaterialIcon name={dueSide.icon as never} size={14} color={filter === "due" ? colors.brandSecondary : "rgba(255,255,255,0.8)"} />
              <Text style={[styles.heroLabel, filter === "due" && { color: colors.brandSecondary }]} numberOfLines={1}>{dueSide.label}</Text>
            </View>
            <Text style={[styles.heroValue, filter === "due" && { color: vendors ? semantic.received : semantic.due }]} numberOfLines={1} adjustsFontSizeToFit>{money(dueSide.value)}</Text>
            <Text style={[styles.heroSub, filter === "due" && { color: colors.muted }]}>{dueSide.count} {listName}</Text>
          </Pressable>
          <Pressable style={[styles.heroHalf, filter === "owe" && styles.heroHalfOn]} onPress={() => pickFilter("owe")} accessibilityRole="button" testID="hero-owe">
            <View style={styles.heroLabelRow}>
              <MaterialIcon name={oweSide.icon as never} size={14} color={filter === "owe" ? colors.brandSecondary : "rgba(255,255,255,0.8)"} />
              <Text style={[styles.heroLabel, filter === "owe" && { color: colors.brandSecondary }]} numberOfLines={1}>{oweSide.label}</Text>
            </View>
            <Text style={[styles.heroValue, filter === "owe" && { color: vendors ? semantic.due : isPersonal ? semantic.pending : semantic.received }]} numberOfLines={1} adjustsFontSizeToFit>{money(oweSide.value)}</Text>
            <Text style={[styles.heroSub, filter === "owe" && { color: colors.muted }]}>{oweSide.count} {listName}</Text>
          </Pressable>
        </View>
        {!vendors && counts.due > 0 ? (
          <View style={styles.heroFoot}>
            <Text style={styles.heroFootText} numberOfLines={1}>
              {oldDue > 0 ? `${oldDue} का ${OLD_DAYS}+ दिन से बाकी` : `${counts.due} से पैसे आने हैं`}
            </Text>
            {counts.due > 1 ? (
              <Pressable style={styles.remindAll} onPress={() => router.push("/remind" as never)} accessibilityRole="button" accessibilityLabel="सबको तगादा भेजें" testID="open-bulk-remind">
                <MaterialIcon name="whatsapp" size={16} color={semantic.whatsapp} />
                <Text style={styles.remindAllText}>सबको तगादा</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>

      <View style={styles.segment}>
        {FILTERS.map((f) => {
          const active = filter === f;
          return (
            <Pressable key={f} onPress={() => pickFilter(f)} style={[styles.segBtn, active && styles.segBtnOn]} accessibilityRole="button" accessibilityState={{ selected: active }} testID={`filter-${f}`}>
              <Text style={[styles.segText, active && styles.segTextOn]} numberOfLines={1}>{filterLabel[f]}</Text>
              <Text style={[styles.segCount, active && styles.segCountOn]}>{counts[f]}</Text>
            </Pressable>
          );
        })}
      </View>

      {counts[filter] > 1 || q ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sortRow} keyboardShouldPersistTaps="handled">
          {SORTS.map((s) => {
            const active = sort === s;
            return (
              <Pressable key={s} onPress={() => setSort(s)} style={[styles.sortChip, active && styles.sortChipOn]} hitSlop={4} testID={`sort-${s}`}>
                <MaterialIcon name={SORT_ICON[s] as never} size={13} color={active ? colors.brandPrimary : colors.muted} />
                <Text style={[styles.sortText, active && styles.sortOn]}>{SORT_LABEL[s]}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}
      {q && rows.length ? <Text style={styles.searchNote}>सबमें खोजा · {rows.length} मिले</Text> : null}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={{ paddingTop: insets.top + spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm }}>
        <Text style={styles.h1}>{listName}</Text>
        {!isPersonal && vendorCount > 0 ? (
          <View style={styles.bookSeg}>
            {(["customer", "vendor"] as const).map((b) => {
              const on = book === b;
              const n = b === "vendor" ? vendorCount : customerCount;
              return (
                <Pressable hitSlop={{ top: 4, bottom: 4 }} key={b} onPress={() => switchBook(b)} style={[styles.bookBtn, on && styles.bookOn]} accessibilityRole="tab" accessibilityState={{ selected: on }} testID={`book-${b}`}>
                  <MaterialIcon name={b === "vendor" ? "truck-outline" : "account-group-outline"} size={16} color={on ? colors.onBrandPrimary : colors.onSurface} />
                  <Text style={[styles.bookText, on && { color: colors.onBrandPrimary }]}>{b === "vendor" ? "Vendor" : "ग्राहक"}{n ? ` · ${n}` : ""}</Text>
                </Pressable>
              );
            })}
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
          ListHeaderComponent={header}
          initialNumToRender={14}
          windowSize={7}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xxxl * 2 + insets.bottom }}
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
                message={!q && customers.length === 0 && !vendors ? "एंट्री लिखते ही यहाँ दिखेंगे, या अभी जोड़ें" : undefined}
                action={!q && customers.length === 0 && !vendors ? { label: labels.newCustomer, onPress: () => setAdding(true), testID: "customers-empty-add" } : undefined}
              />
            </View>
          }
          renderItem={({ item, index }) => {
            const due = item.due;
            const old = due > 0 && !!item.since && daysSince(item.since) >= OLD_DAYS;
            const tone: "due" | "received" | "pending" = vendors ? (due < 0 ? "due" : "received") : due > 0 ? "due" : isPersonal ? "pending" : "received";
            const toneColor = due === 0 ? colors.muted : tone === "due" ? semantic.due : tone === "pending" ? semantic.pending : semantic.received;
            const toneSoft = due === 0 ? colors.surfaceTertiary : tone === "due" ? semantic.dueSoft : tone === "pending" ? semantic.pendingSoft : semantic.receivedSoft;
            const tag = due === 0 ? TERMS.settled : vendors ? (due < 0 ? "देने हैं" : "एडवांस दिया") : balanceTerm(due, isPersonal, true);
            const dupe = dupePhones.has(phoneKey(item.c.phone || ""));
            return (
              <Animated.View entering={FadeInDown.delay(Math.min(index, 8) * 25).duration(200)}>
                <Pressable onPress={() => router.push(`/customer/${item.c.id}`)} style={styles.card} testID={`customer-row-${item.c.id}`}>
                  <View style={styles.cardMain}>
                    <View style={[styles.avatar, { backgroundColor: toneSoft }]}>
                      <Text style={[styles.avatarText, { color: due === 0 ? colors.onSurfaceSecondary : toneColor }]}>{initials(item.c.name)}</Text>
                      {old ? <View style={styles.avatarDot} /> : null}
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.name} numberOfLines={1}>{item.c.name}</Text>
                      <Text style={styles.sub} numberOfLines={1}>
                        {item.c.phone ? formatPhone(item.c.phone) : "फ़ोन नहीं"}{item.c.address ? ` · ${item.c.address}` : ""}
                      </Text>
                      <View style={styles.metaRow}>
                        {item.last ? (
                          <Text style={styles.last} numberOfLines={1}>
                            <MaterialIcon name="clock-outline" size={11} color={colors.muted} /> {item.last === today ? "आज" : formatDateShort(item.last)}
                          </Text>
                        ) : (
                          <Text style={styles.last}>कोई एंट्री नहीं</Text>
                        )}
                        {old ? (
                          <View style={styles.oldPill}>
                            <Text style={styles.oldText}>{daysSince(item.since)} दिन से बाकी</Text>
                          </View>
                        ) : null}
                      </View>
                    </View>
                    <View style={{ alignItems: "flex-end", gap: 2 }}>
                      {due === 0 ? (
                        <Text style={[styles.dueAmt, { color: colors.muted }]}>{TERMS.settled}</Text>
                      ) : (
                        <>
                          <Amount value={Math.abs(due)} tone={tone} size="bodyLg" style={{ textAlign: "right" }} />
                          <Text style={[styles.dueTag, { color: toneColor }]}>{tag}</Text>
                        </>
                      )}
                    </View>
                  </View>
                  {dupe ? (
                    <View style={styles.dupeRow}>
                      <MaterialIcon name="alert-outline" size={14} color={colors.warning} />
                      <Text style={styles.dupe} numberOfLines={1}>यही नंबर किसी और खाते में भी है</Text>
                    </View>
                  ) : null}
                  {!vendors && due > 0 ? (
                    <View style={styles.actRow}>
                      <Pressable
                        onPress={() => setShareDoc(reminderDoc(item.c, due, user ?? {}))}
                        hitSlop={4}
                        style={[styles.actBtn, { backgroundColor: semantic.pendingSoft }]}
                        accessibilityRole="button"
                        accessibilityLabel={`${item.c.name} को तगादा भेजें`}
                        testID={`row-remind-${item.c.id}`}
                      >
                        <MaterialIcon name="message-alert-outline" size={16} color={semantic.pending} />
                        <Text style={[styles.actText, { color: semantic.pending }]}>तगादा</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => setPaying(item.c.id)}
                        hitSlop={4}
                        style={[styles.actBtn, { backgroundColor: semantic.receivedSoft }]}
                        accessibilityRole="button"
                        accessibilityLabel={`${item.c.name} से पैसे मिले`}
                        testID={`row-got-${item.c.id}`}
                      >
                        <MaterialIcon name="arrow-bottom-left" size={16} color={semantic.received} />
                        <Text style={[styles.actText, { color: semantic.received }]}>पैसे मिले</Text>
                      </Pressable>
                    </View>
                  ) : null}
                </Pressable>
              </Animated.View>
            );
          }}
        />
      )}

      <Pressable
        style={[styles.fab, { bottom: insets.bottom + 16 }]}
        onPress={() => setAdding(true)}
        accessibilityRole="button"
        accessibilityLabel={labels.newCustomer}
        testID="add-customer-fab"
      >
        <MaterialIcon name="account-plus" size={26} color={colors.onBrandPrimary} />
      </Pressable>
      <AddCustomerSheet visible={adding} onClose={() => setAdding(false)} role="customer" />
      <AddEntrySheet visible={paying !== null} type="payment" onClose={() => setPaying(null)} customerId={paying ?? undefined} />
      <ReceiptSheet doc={shareDoc} onClose={() => setShareDoc(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  h1: { fontSize: 30, fontWeight: "700", color: colors.onSurface, marginBottom: spacing.sm },
  bookSeg: { flexDirection: "row", gap: 4, padding: 4, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md },
  bookBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 36, borderRadius: radius.pill },
  bookOn: { backgroundColor: colors.brandPrimary },
  bookText: { ...type.caption, fontWeight: "800", color: colors.onSurface },
  searchWrap: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, paddingHorizontal: spacing.md, height: 46, borderWidth: 1, borderColor: colors.border },
  search: { flex: 1, color: colors.onSurface, fontSize: 15 },

  hero: { backgroundColor: colors.brandSecondary, borderRadius: radius.lg, padding: spacing.sm, marginBottom: spacing.md, ...elevation.mid },
  heroRow: { flexDirection: "row", gap: spacing.sm },
  heroHalf: { flex: 1, padding: spacing.md, borderRadius: radius.md, backgroundColor: "rgba(255,255,255,0.1)" },
  heroHalfOn: { backgroundColor: "#fff" },
  heroLabelRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  heroLabel: { fontSize: 12, fontWeight: "700", color: "rgba(255,255,255,0.85)", flexShrink: 1 },
  heroValue: { fontSize: 24, fontWeight: "800", color: "#fff", marginTop: 4, fontVariant: ["tabular-nums"] },
  heroSub: { fontSize: 11, fontWeight: "600", color: "rgba(255,255,255,0.7)", marginTop: 1 },
  heroFoot: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm, paddingHorizontal: spacing.sm, paddingTop: spacing.sm, paddingBottom: 2 },
  heroFootText: { flex: 1, fontSize: 12, fontWeight: "600", color: "rgba(255,255,255,0.85)" },
  remindAll: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: "#fff" },
  remindAllText: { fontSize: 12, fontWeight: "800", color: semantic.whatsapp },

  segment: { flexDirection: "row", backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: 4, borderWidth: 1, borderColor: colors.border },
  segBtn: { flex: 1, flexDirection: "row", gap: 6, height: 38, borderRadius: radius.sm + 2, alignItems: "center", justifyContent: "center" },
  segBtnOn: { backgroundColor: colors.surface, ...elevation.low },
  segText: { fontSize: 13, fontWeight: "600", color: colors.muted, flexShrink: 1 },
  segTextOn: { color: colors.brandSecondary, fontWeight: "800" },
  segCount: { fontSize: 11, fontWeight: "700", color: colors.muted, backgroundColor: colors.surfaceTertiary, paddingHorizontal: 6, borderRadius: radius.pill, overflow: "hidden" },
  segCountOn: { color: colors.onBrandPrimary, backgroundColor: colors.brandPrimary },
  sortRow: { gap: spacing.sm, paddingTop: spacing.md, paddingBottom: spacing.xs },
  sortChip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  sortChipOn: { borderColor: colors.brandPrimary, backgroundColor: colors.brandTertiary },
  sortText: { fontSize: 12, color: colors.muted, fontWeight: "600" },
  sortOn: { color: colors.brandPrimary, fontWeight: "800" },
  searchNote: { fontSize: 12, color: colors.muted, marginTop: spacing.sm },

  card: { backgroundColor: "#fff", borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginTop: spacing.sm, ...elevation.low },
  cardMain: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  avatar: { width: 46, height: 46, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  avatarText: { fontWeight: "800", fontSize: 15 },
  avatarDot: { position: "absolute", right: 0, top: 0, width: 12, height: 12, borderRadius: 6, backgroundColor: semantic.due, borderWidth: 2, borderColor: "#fff" },
  name: { fontSize: 16, fontWeight: "700", color: colors.onSurface },
  sub: { ...type.caption, color: colors.muted, marginTop: 1 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: 3 },
  last: { fontSize: 11, color: colors.muted, fontWeight: "600" },
  oldPill: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: radius.pill, backgroundColor: semantic.dueSoft },
  oldText: { fontSize: 10, fontWeight: "800", color: semantic.due },
  dueAmt: { ...type.bodyLg, fontWeight: "700" },
  dueTag: { fontSize: 11, fontWeight: "700" },
  dupeRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  dupe: { ...type.caption, color: colors.warning, fontWeight: "700", flexShrink: 1 },
  actRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  actBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 38, borderRadius: radius.sm + 2 },
  actText: { fontSize: 13, fontWeight: "800" },
  fab: { position: "absolute", right: 20, width: 56, height: 56, borderRadius: 28, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center", ...elevation.high },
});
