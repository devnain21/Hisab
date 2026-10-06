import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TextInput, Alert, BackHandler, Platform } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { Pressable } from "@/src/components/tap";
import { DataLoadError, SlowServerHint } from "@/src/components/slow-server-hint";
import { useState, useMemo, useCallback } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import MaterialIcon from "@react-native-vector-icons/material-design-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, spacing, radius, semantic, type, elevation } from "@/src/theme";
import { useAeps, useCustomers, useEntries, useJobs, computeBalance, isPersonalTask, isVendor, type Entry, type Job } from "@/src/lib/data";
import { buildAllLedgers, workForJob } from "@/src/lib/records";
import { receiptDoc, type ShareDoc } from "@/src/lib/receipt";
import { ReceiptSheet } from "@/src/components/receipt-sheet";
import * as Updates from "expo-updates";
import { formatDateShort, formatINR, formatPhone, formatWeekdayDate, todayISO } from "@/src/lib/format";
import { AddEntrySheet, AddJobSheet, EditRecordSheet, SettleSheet, SheetShell } from "@/src/components/sheets";
import { useAuth } from "@/src/context/AuthContext";
import { clearRejected, flush, rejectedChanges, retryRejected, retryableRejectedCount, usePendingCount, useRejectedCount } from "@/src/lib/store";
import { cashTotals, computeFlows, pocketNet, useMoneyBook, type Move } from "@/src/lib/wallet";
import { FlowTile, NetRow } from "@/src/components/money-flow";
import { useCounterMode } from "@/src/lib/counter";
import { accountName, usePersona } from "@/src/lib/persona";
import { TERMS, balanceTerm } from "@/src/lib/terms";
import { HIDDEN, savePrefs, usePrefs } from "@/src/lib/prefs";
import { useRecentCustomerIds } from "@/src/lib/recent";
import { TaskSheet } from "@/src/components/task-sheet";
import { taskGroup, usePersonalTasks } from "@/src/lib/tasks";
import { AddExpenseSheet } from "@/src/components/expense-sheet";
import { BudgetTile } from "@/src/components/budget-card";
import { ActivityRow, activityFeed, type Activity } from "@/src/components/activity-feed";
import { MoneyMoveSheet, type MoveKind } from "@/src/components/money-move-sheet";
import type { Expense } from "@/src/lib/expenses";
/** Switching shop / personal remounts Home, so no search text, open sheet or filter carries over. */
export default function Home() {
  const { persona } = usePersona();
  return <HomeBody key={persona} />;
}

function HomeBody() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const customersQ = useCustomers();
  const entriesQ = useEntries();
  const jobsQ = useJobs();
  const aeps = useAeps().data ?? [];
  const [jobSheet, setJobSheet] = useState(false);
  const [moneySheet, setMoneySheet] = useState(false);
  const [editingJob, setEditingJob] = useState<Job | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [taskSheet, setTaskSheet] = useState<{ initial?: Job } | null>(null);
  const [expenseSheet, setExpenseSheet] = useState(false);
  const [shareDoc, setShareDoc] = useState<ShareDoc | null>(null);
  const [moveSheet, setMoveSheet] = useState<MoveKind | null>(null);
  const [editEntry, setEditEntry] = useState<Entry | null>(null);
  const [editExpense, setEditExpense] = useState<Expense | null>(null);
  const [editMove, setEditMove] = useState<Move | null>(null);
  const [vendorMenu, setVendorMenu] = useState(false);
  const [vendorOrder, setVendorOrder] = useState(false);
  const [settling, setSettling] = useState<Entry | null>(null);
  const { user } = useAuth();
  const { isUpdatePending } = Updates.useUpdates();
  const pending = usePendingCount();
  const rejectedCount = useRejectedCount();
  const showRejected = () => {
    const canRetry = retryableRejectedCount() > 0;
    Alert.alert(
      "ये बदलाव सेव नहीं हुए",
      `${rejectedChanges().map((r) => `• ${r.label}`).join("\n")}\n\n${canRetry ? "दोबारा भेज कर देखें। फिर भी न हों तो इन्हें दोबारा लिख दें।" : "इन्हें दोबारा लिख दें।"}`,
      [
        { text: "बाद में" },
        ...(canRetry ? [{ text: "दोबारा भेजें", onPress: () => void retryRejected() }] : []),
        { text: "हटाएँ", style: "destructive" as const, onPress: () => void clearRejected() },
      ],
    );
  };
  // Back on Home would close the app; ask first instead of exiting straight away.
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== "android") return;
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        Alert.alert("ऐप बंद करें?", "क्या आप ऐप से बाहर निकलना चाहते हैं?", [
          { text: "नहीं", style: "cancel" },
          { text: "हाँ", style: "destructive", onPress: () => BackHandler.exitApp() },
        ]);
        return true;
      });
      return () => sub.remove();
    }, []),
  );
  const book = useMoneyBook();
  const counter = useCounterMode();
  const { isPersonal, labels } = usePersona();
  const recentIds = useRecentCustomerIds();

  const today = todayISO();
  const allCustomers = customersQ.data ?? [];
  const entries = entriesQ.data ?? [];
  const customers = useMemo(() => {
    return allCustomers.filter((c) => (isPersonal ? c.persona === "personal" : c.persona !== "personal"));
  }, [allCustomers, isPersonal]);

  const personaCustIds = useMemo(() => new Set(customers.map((c) => c.id)), [customers]);
  const allJobs = jobsQ.data;
  // Own tasks (no customer) belong to the shop book only.
  const jobs = useMemo(
    () => (allJobs ?? []).filter((j) => (j.customerId ? personaCustIds.has(j.customerId) : !isPersonal && !isPersonalTask(j))),
    [allJobs, personaCustIds, isPersonal],
  );
  const recentCustomers = useMemo(() => {
    return recentIds
      .map((id) => customers.find((c) => c.id === id))
      .filter((c): c is (typeof customers)[0] => Boolean(c));
  }, [recentIds, customers]);

  const nameOf = (id: string) => (id ? customers.find((c) => c.id === id)?.name ?? labels.customer : "खुद का काम");
  const feed = useMemo(
    () => (isPersonal ? activityFeed(book, "personal", (id) => customers.find((c) => c.id === id)?.name ?? "व्यक्ति", 12) : []),
    [book, customers, isPersonal],
  );
  const openActivity = (a: Activity) => {
    const s = a.src;
    if (s.kind === "entry") setEditEntry(s.entry);
    else if (s.kind === "expense") setEditExpense(s.expense);
    else if (s.kind === "move") setEditMove(s.move);
    else router.push(`/aeps/${s.txn.id}`);
  };

  const searchResults = useMemo(() => {
    const needle = searchQuery.trim().toLowerCase();
    if (!needle) return { customers: [], jobs: [] };
    const nameOf = (id: string) => (id ? customers.find((c) => c.id === id)?.name ?? "" : "");
    const matchedCusts = customers
      .filter((c) => c.name.toLowerCase().includes(needle) || c.phone.includes(needle))
      .slice(0, 5)
      .map((c) => ({
        customer: c,
        balance: computeBalance(entries, c.id),
      }));
    const matchedJobs = jobs
      .filter((j) => j.title.toLowerCase().includes(needle) || (j.customerId && nameOf(j.customerId).toLowerCase().includes(needle)))
      .slice(0, 5);
    return { customers: matchedCusts, jobs: matchedJobs };
  }, [searchQuery, customers, jobs, entries]);

  const stats = useMemo(() => {
    const bals = customers.filter((c) => !isVendor(c)).map((c) => computeBalance(entries, c.id));
    const dues = bals.filter((d) => d > 0);
    const owes = bals.filter((d) => d < 0);
    const payables = isPersonal ? [] : customers.filter(isVendor).map((c) => computeBalance(entries, c.id)).filter((d) => d < 0);
    const open = jobs.filter((j) => j.status !== "done");
    return {
      totalDue: dues.reduce((s, d) => s + d, 0),
      dueCustomers: dues.length,
      totalOwe: -owes.reduce((s, d) => s + d, 0),
      oweCount: owes.length,
      vendorPayable: -payables.reduce((s, d) => s + d, 0),
      vendorCount: payables.length,
      openJobs: open.length,
      overdue: open.filter((j) => j.dueDate < today).length,
    };
  }, [customers, entries, jobs, today, isPersonal]);

  // Vendor orders: still to arrive (by promised date), and any with money still to pay.
  const vendorOrders = useMemo(() => {
    if (isPersonal) return { pending: [], unpaid: [], late: 0, remaining: new Map<string, number>() };
    const ids = new Set(customers.filter(isVendor).map((c) => c.id));
    const orders = entries.filter((e) => e.type === "purchase" && ids.has(e.customerId));
    const ledger = buildAllLedgers(orders.length ? entries.filter((e) => ids.has(e.customerId)) : []);
    const remaining = new Map(orders.map((o) => [o.id, ledger.get(o.id)?.remaining ?? 0]));
    const pending = orders.filter((o) => o.status === "ordered").sort((a, b) => (a.dueDate || "9").localeCompare(b.dueDate || "9"));
    const unpaid = orders.filter((o) => (remaining.get(o.id) ?? 0) > 0).sort((a, b) => (a.dueDate || a.date).localeCompare(b.dueDate || b.date));
    return { pending, unpaid, late: pending.filter((o) => !!o.dueDate && o.dueDate < today).length, remaining };
  }, [customers, entries, isPersonal, today]);

  const persona = isPersonal ? "personal" : "business";
  const pockets = useMemo(() => computeFlows(book, persona, (d) => d <= today), [book, persona, today]);
  const cashBal = pocketNet(pockets.cash);
  const bankBal = pocketNet(pockets.bank);
  const todayTotals = useMemo(() => cashTotals(book, persona, (d) => d === today), [book, persona, today]);
  const todaySpend = todayTotals.byKey.get("expense") ?? 0;
  const openToday = (dir: "in" | "out") => router.push({ pathname: "/pocket" as never, params: { p: "all", dir, period: "day", date: today } });

  const aepsDue = useMemo(() => aeps.filter((t) => t.status === "pending" && (t.dueDate || t.date) <= today).length, [aeps, today]);
  const { hideAmounts } = usePrefs();
  const money = (n: number) => (hideAmounts ? HIDDEN : formatINR(n));
  const upcoming = useMemo(
    () => jobs.filter((j) => j.status !== "done").sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 8),
    [jobs]
  );

  const { tasks: personalTasks } = usePersonalTasks();
  const taskStats = useMemo(() => {
    let open = 0;
    let late = 0;
    let due = 0;
    for (const t of personalTasks) {
      if (t.status === "done") continue;
      open++;
      const g = taskGroup(t, today);
      if (g === "late") late++;
      else if (g === "today") due++;
    }
    return { open, late, today: due };
  }, [personalTasks, today]);

  // A finished job's dueDate is its completion day, so the newest few are found without scanning every job's entry.
  const recentDone = useMemo(() => {
    if (isPersonal) return [];
    const out: { job: Job; work: Entry }[] = [];
    const done = jobs.filter((j) => j.status === "done" && j.customerId).sort((a, b) => b.dueDate.localeCompare(a.dueDate) || b.createdAt.localeCompare(a.createdAt));
    for (const j of done) {
      const w = workForJob(j, entries);
      if (w) out.push({ job: j, work: w });
      if (out.length === 5) break;
    }
    return out;
  }, [jobs, entries, isPersonal]);
  const sendReceipt = (work: Entry) => {
    const c = customers.find((x) => x.id === work.customerId);
    if (!c) return;
    setShareDoc(receiptDoc(work, buildAllLedgers(entries).get(work.id), c, computeBalance(entries, c.id), true, user ?? {}));
  };

  const loading = customersQ.isLoading || entriesQ.isLoading || jobsQ.isLoading;
  const loadFailed =
    !loading &&
    ((customersQ.isError && customersQ.data == null) || (entriesQ.isError && entriesQ.data == null) || (jobsQ.isError && jobsQ.data == null));
  // The nonce makes the target tab re-apply the filter even if it was already open with it.
  const go = (pathname: string, params: Record<string, string>) =>
    router.navigate({ pathname: pathname as any, params: { ...params, t: String(Date.now()) } });

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingTop: insets.top + spacing.md, paddingBottom: 96 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topRow}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.eyebrow}>{formatWeekdayDate(today)}</Text>
            <Text style={styles.h1} numberOfLines={2} testID="shop-name">{accountName(user) || "आज का खाता"}</Text>
          </View>
          <Pressable onPress={() => void savePrefs({ hideAmounts: !hideAmounts })} hitSlop={8} accessibilityRole="button" accessibilityLabel={hideAmounts ? "रकम दिखाएँ" : "रकम छिपाएँ"} testID="toggle-hide-amounts" style={styles.accountBtn}>
            <MaterialIcon name={hideAmounts ? "eye-off-outline" : "eye-outline"} size={24} color={colors.onSurface} />
          </Pressable>
          <Pressable onPress={() => router.push("/(tabs)/profile")} hitSlop={8} accessibilityRole="button" accessibilityLabel="प्रोफ़ाइल और सेटिंग" testID="open-profile" style={styles.accountBtn}>
            <MaterialIcon name="account-circle-outline" size={28} color={colors.onSurface} />
          </Pressable>
        </View>

        {/* Global Spotlight Search Bar */}
        <View style={styles.searchBar}>
          <MaterialIcon name="magnify" size={20} color={colors.muted} />
          <TextInput
            style={styles.searchInput}
            placeholder={isPersonal ? "नाम या फ़ोन खोजें" : "ग्राहक, फ़ोन या काम खोजें"}
            placeholderTextColor={colors.muted}
            value={searchQuery}
            onChangeText={setSearchQuery}
            testID="home-global-search"
          />
          {searchQuery ? (
            <Pressable onPress={() => setSearchQuery("")} hitSlop={8}>
              <MaterialIcon name="close-circle" size={18} color={colors.muted} />
            </Pressable>
          ) : null}
        </View>

        {/* Live Search Results Dropdown */}
        {searchQuery.trim().length > 0 ? (
          <View style={styles.searchDropdown}>
            {searchResults.customers.length === 0 && searchResults.jobs.length === 0 ? (
              <Text style={styles.searchEmpty}>कोई परिणाम नहीं मिला</Text>
            ) : (
              <>
                {searchResults.customers.map(({ customer: c, balance: b }) => (
                  <Pressable
                    key={c.id}
                    style={styles.searchResultRow}
                    onPress={() => {
                      setSearchQuery("");
                      router.push(`/customer/${c.id}`);
                    }}
                  >
                    <MaterialIcon name="account" size={18} color={colors.brandPrimary} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.resultTitle}>{c.name}</Text>
                      {c.phone ? <Text style={styles.resultSub}>{formatPhone(c.phone)}</Text> : null}
                    </View>
                    {isVendor(c) ? (
                      <Text style={[styles.resultDue, { color: b < 0 ? colors.error : colors.success }]}>
                        {b === 0 ? TERMS.settled : `${money(Math.abs(b))} ${b < 0 ? "देने हैं" : "एडवांस दिया"}`}
                      </Text>
                    ) : (
                      <Text style={[styles.resultDue, { color: b > 0 ? colors.error : b < 0 && c.persona === "personal" ? colors.warning : colors.success }]}>
                        {b === 0 ? TERMS.settled : `${money(Math.abs(b))} ${balanceTerm(b, c.persona === "personal", true)}`}
                      </Text>
                    )}
                  </Pressable>
                ))}
                {searchResults.jobs.map((j) => (
                  <Pressable
                    key={j.id}
                    style={styles.searchResultRow}
                    onPress={() => {
                      setSearchQuery("");
                      setEditingJob(j);
                    }}
                  >
                    <MaterialIcon name="briefcase-outline" size={18} color={colors.warning} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.resultTitle}>{j.title}</Text>
                      <Text style={styles.resultSub}>{nameOf(j.customerId)} · {formatDateShort(j.dueDate)}</Text>
                    </View>
                    <MaterialIcon name="chevron-right" size={16} color={colors.muted} />
                  </Pressable>
                ))}
              </>
            )}
          </View>
        ) : null}

        {/* Recently Viewed Customers Horizontal Chips */}
        {!searchQuery && recentCustomers.length > 0 ? (
          <View style={styles.recentWrap}>
            <Text style={styles.recentLabel}>हालिया:</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
              {recentCustomers.map((c) => {
                const bal = computeBalance(entries, c.id);
                return (
                  <Pressable
                    key={c.id}
                    style={styles.recentChip}
                    onPress={() => router.push(`/customer/${c.id}`)}
                  >
                    <MaterialIcon name={isVendor(c) ? "truck-outline" : "account-outline"} size={14} color={colors.brandPrimary} />
                    <Text style={styles.recentChipName} numberOfLines={1}>{c.name}</Text>
                    {bal > 0 && !hideAmounts && !isVendor(c) ? (
                      <Text style={styles.recentChipDue}>{formatINR(bal)}</Text>
                    ) : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        ) : null}

        {isUpdatePending && pending === 0 ? (
          <Pressable style={[styles.pendingPill, { backgroundColor: colors.successSoft }]} onPress={() => void Updates.reloadAsync().catch(() => {})} testID="home-update-ready">
            <MaterialIcon name="download-circle-outline" size={14} color={colors.success} />
            <Text style={[styles.pendingText, { color: colors.success }]}>नया अपडेट तैयार · अभी लगाएँ</Text>
          </Pressable>
        ) : null}
        {pending > 0 ? (
          <Pressable style={styles.pendingPill} onPress={() => void flush()} testID="home-sync-pending">
            <MaterialIcon name="cloud-upload-outline" size={14} color={colors.warning} />
            <Text style={styles.pendingText}>{pending} बदलाव फ़ोन में सेव · अभी भेजें</Text>
          </Pressable>
        ) : null}
        {rejectedCount > 0 ? (
          <Pressable style={[styles.pendingPill, { backgroundColor: colors.errorSoft }]} onPress={showRejected} testID="home-sync-rejected">
            <MaterialIcon name="alert-circle-outline" size={14} color={colors.error} />
            <Text style={[styles.pendingText, { color: colors.error }]}>{rejectedCount} बदलाव सर्वर ने नहीं लिए · देखें</Text>
          </Pressable>
        ) : null}

        {loadFailed ? (
          <DataLoadError onRetry={() => { customersQ.refetch(); entriesQ.refetch(); jobsQ.refetch(); }} />
        ) : loading ? (
          <View style={{ marginTop: spacing.xxl, alignItems: "center" }}>
            <ActivityIndicator color={colors.brandPrimary} />
            <SlowServerHint />
          </View>
        ) : (
          <Animated.View entering={FadeInDown.duration(300)}>
            <View style={styles.hero}>
              <Pressable style={styles.heroHead} onPress={() => router.push("/report" as never)} accessibilityRole="button" testID="home-snapshot">
                <Text style={styles.heroLabel}>Today&apos;s Snapshot</Text>
                <MaterialIcon name="chevron-right" size={20} color={colors.muted} />
              </Pressable>
              {isPersonal ? (
                <View style={styles.heroTiles}>
                  <Pressable
                    style={[styles.spendTile, { backgroundColor: semantic.dueSoft }]}
                    onPress={() => router.push({ pathname: "/pocket" as never, params: { p: "all", dir: "out", key: "expense", period: "day", date: today } })}
                    accessibilityRole="button"
                    testID="home-today-spend"
                  >
                    <View style={styles.spendHead}>
                      <MaterialIcon name="coffee-outline" size={16} color={semantic.due} />
                      <Text style={[styles.spendLabel, { color: semantic.due }]} numberOfLines={1}>आज खर्च</Text>
                    </View>
                    <Text style={[styles.spendValue, { color: semantic.due }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{money(todaySpend)}</Text>
                    <Text style={styles.spendSub} numberOfLines={1}>⬇ {money(todayTotals.ins)} · ⬆ {money(todayTotals.outs)}</Text>
                  </Pressable>
                  <BudgetTile money={money} />
                </View>
              ) : (
                <View style={styles.heroTiles}>
                  <FlowTile dir="in" value={money(todayTotals.ins)} onPress={() => openToday("in")} testID="home-cash-in" />
                  <FlowTile dir="out" value={money(todayTotals.outs)} onPress={() => openToday("out")} testID="home-cash-out" />
                </View>
              )}
              <View style={styles.heroNet}>
                <NetRow value={todayTotals.net} label="Net today" fmt={money} onPress={() => router.push({ pathname: "/day", params: { type: "drawer" } })} testID="stat-today-money" />
              </View>

              <View style={styles.walletLine}>
                <Pressable style={styles.walletCell} onPress={() => router.push({ pathname: "/pocket" as never, params: { p: "cash" } })} testID="home-wallet-cash">
                  <MaterialIcon name="cash" size={16} color={semantic.cash} />
                  <Text style={styles.walletLabel}>{labels.cash}</Text>
                  <Text style={[styles.walletValue, cashBal < 0 && { color: semantic.due }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{money(cashBal)}</Text>
                </Pressable>
                <View style={styles.walletDivider} />
                <Pressable style={styles.walletCell} onPress={() => router.push({ pathname: "/pocket" as never, params: { p: "bank" } })} testID="home-wallet-bank">
                  <MaterialIcon name="bank-outline" size={16} color={semantic.bank} />
                  <Text style={styles.walletLabel}>बैंक</Text>
                  <Text style={[styles.walletValue, bankBal < 0 && { color: semantic.due }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{money(bankBal)}</Text>
                </Pressable>
              </View>
            </View>

            {!isPersonal && (stats.totalDue > 0 || stats.vendorPayable > 0) ? (
              <View style={styles.duesStrip}>
                <Pressable style={styles.duesCell} onPress={() => go("/(tabs)/customers", { filter: "due", book: "customer" })} accessibilityRole="button" testID="stat-total-due">
                  <Text style={styles.duesLabel} numberOfLines={1}>⬇ ग्राहकों से मिलेंगे</Text>
                  <Text style={[styles.duesValue, { color: stats.totalDue > 0 ? semantic.received : colors.muted }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{money(stats.totalDue)}</Text>
                  <Text style={styles.duesSub} numberOfLines={1}>{stats.dueCustomers} ग्राहक</Text>
                </Pressable>
                <View style={styles.walletDivider} />
                <Pressable style={styles.duesCell} onPress={() => go("/(tabs)/customers", { filter: "owe", book: "vendor" })} accessibilityRole="button" testID="stat-vendor-payable">
                  <Text style={styles.duesLabel} numberOfLines={1}>⬆ Vendor को देने हैं</Text>
                  <Text style={[styles.duesValue, { color: stats.vendorPayable > 0 ? semantic.due : colors.muted }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{money(stats.vendorPayable)}</Text>
                  <Text style={styles.duesSub} numberOfLines={1}>{stats.vendorCount} Vendor</Text>
                </Pressable>
              </View>
            ) : null}

            <View style={styles.chipRow}>
              {isPersonal && stats.totalDue > 0 ? (
                <Pressable style={styles.chip} onPress={() => go("/(tabs)/customers", { filter: "due" })} testID="stat-total-get">
                  <Text style={styles.chipText} numberOfLines={1}>{TERMS.get} {money(stats.totalDue)} · {stats.dueCustomers}</Text>
                  <MaterialIcon name="chevron-right" size={16} color={colors.muted} />
                </Pressable>
              ) : null}
              {vendorOrders.late > 0 ? (
                <Pressable style={[styles.chip, { borderColor: semantic.due }]} onPress={() => setVendorMenu(true)} testID="home-vendor-late">
                  <MaterialIcon name="truck-alert-outline" size={14} color={semantic.due} />
                  <Text style={[styles.chipText, { color: semantic.due }]} numberOfLines={1}>{vendorOrders.late} Vendor डिलीवरी देर से</Text>
                  <MaterialIcon name="chevron-right" size={16} color={colors.muted} />
                </Pressable>
              ) : null}
              {isPersonal && stats.totalOwe > 0 ? (
                <Pressable style={styles.chip} onPress={() => go("/(tabs)/customers", { filter: "owe" })} testID="stat-total-owe">
                  <Text style={styles.chipText} numberOfLines={1}>{TERMS.give} {money(stats.totalOwe)} · {stats.oweCount}</Text>
                  <MaterialIcon name="chevron-right" size={16} color={colors.muted} />
                </Pressable>
              ) : null}
              {counter.on && aepsDue > 0 ? (
                <Pressable style={styles.chip} onPress={() => go("/(tabs)/aeps", { range: "today" })} testID="home-aeps-card">
                  <MaterialIcon name="fingerprint" size={14} color={semantic.pending} />
                  <Text style={styles.chipText} numberOfLines={1}>{aepsDue} काउंटर पेंडिंग</Text>
                  <MaterialIcon name="chevron-right" size={16} color={colors.muted} />
                </Pressable>
              ) : null}
            </View>

            {isPersonal ? (
              <>
                <Pressable
                  style={styles.taskLine}
                  onPress={() => (taskStats.open > 0 ? router.navigate("/(tabs)/tasks" as never) : setTaskSheet({}))}
                  accessibilityRole="button"
                  testID="stat-pending-tasks"
                >
                  <MaterialIcon name="clipboard-check-outline" size={18} color={colors.brandPrimary} />
                  <Text style={styles.taskLineText} numberOfLines={1}>
                    {taskStats.open > 0 ? `मेरे काम (${taskStats.open})` : "कोई काम बाकी नहीं · नया लिखें"}
                    {taskStats.late > 0 ? <Text style={styles.lateTag}>  · {taskStats.late} देर से</Text> : null}
                    {taskStats.today > 0 ? <Text style={styles.todayTag}>  · {taskStats.today} आज</Text> : null}
                  </Text>
                  <MaterialIcon name={taskStats.open > 0 ? "chevron-right" : "plus"} size={18} color={taskStats.open > 0 ? colors.muted : colors.brandPrimary} />
                </Pressable>

                <View style={styles.sectionRow}>
                  <Text style={styles.sectionHead}>Live Activity</Text>
                  {feed.length > 0 ? (
                    <Pressable onPress={() => router.push({ pathname: "/pocket" as never, params: { p: "all", period: "month" } })} hitSlop={8} testID="home-activity-all">
                      <Text style={styles.link}>सभी देखें</Text>
                    </Pressable>
                  ) : null}
                </View>
                {feed.length === 0 ? (
                  <View style={styles.emptyRow}>
                    <MaterialIcon name="swap-vertical" size={20} color={colors.muted} />
                    <Text style={{ color: colors.muted, fontSize: 14 }}>अभी कोई लेन-देन नहीं</Text>
                  </View>
                ) : (
                  <View style={styles.feedCard}>
                    {feed.map((a, i) => (
                      <View key={a.id}>
                        {i === 0 || feed[i - 1].date !== a.date ? (
                          <Text style={[styles.feedDay, i > 0 && styles.feedDayGap]}>{a.date === today ? "आज" : a.date === todayISO(-1) ? "कल" : formatWeekdayDate(a.date)}</Text>
                        ) : null}
                        <ActivityRow a={a} money={money} onPress={() => openActivity(a)} />
                      </View>
                    ))}
                  </View>
                )}
              </>
            ) : null}

            {isPersonal ? null : (
            <>
            <View style={styles.sectionRow}>
              <Text style={styles.sectionHead} testID="stat-pending-jobs">
                आने वाला काम{stats.openJobs > 0 ? ` (${stats.openJobs})` : ""}
                {stats.overdue > 0 ? <Text style={styles.lateTag}>  {stats.overdue} देर से</Text> : null}
              </Text>
              {stats.openJobs > upcoming.length ? (
                <Pressable onPress={() => go("/(tabs)/work", { filter: "open" })} hitSlop={8}>
                  <Text style={styles.link}>सभी देखें</Text>
                </Pressable>
              ) : null}
            </View>
            {upcoming.length === 0 ? (
              <View style={styles.emptyRow}>
                <MaterialIcon name="briefcase-outline" size={20} color={colors.muted} />
                <Text style={{ color: colors.muted, fontSize: 14 }}>कोई काम बाकी नहीं</Text>
              </View>
            ) : (
              <View style={{ gap: spacing.sm }}>
                {upcoming.map((j) => {
                  const late = j.dueDate < today;
                  return (
                    <Pressable key={j.id} style={styles.jobCard} onPress={() => setEditingJob(j)} testID={`home-job-${j.id}`}>
                      <View style={[styles.dateBadge, late && { backgroundColor: colors.errorSoft }]}>
                        <Text style={[styles.dateBadgeText, late && { color: colors.error }]}>{j.dueDate === today ? "आज" : formatDateShort(j.dueDate)}</Text>
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.rowTitle} numberOfLines={1}>{j.title}</Text>
                        <Text style={styles.rowSub} numberOfLines={1}>
                          {nameOf(j.customerId)}{j.estimatedAmount > 0 ? ` · ${money(j.estimatedAmount)}` : ""}{late ? " · देर" : ""}
                        </Text>
                      </View>
                      <MaterialIcon name="pencil-outline" size={18} color={colors.muted} />
                    </Pressable>
                  );
                })}
              </View>
            )}
            {vendorOrders.pending.length > 0 ? (
              <>
                <View style={styles.sectionRow}>
                  <Text style={styles.sectionHead}>
                    Vendor ऑर्डर ({vendorOrders.pending.length})
                    {vendorOrders.late > 0 ? <Text style={styles.lateTag}>  {vendorOrders.late} देर से</Text> : null}
                  </Text>
                  <Pressable onPress={() => go("/(tabs)/customers", { filter: "all", book: "vendor" })} hitSlop={8} testID="home-vendor-all">
                    <Text style={styles.link}>सभी Vendor</Text>
                  </Pressable>
                </View>
                <View style={{ gap: spacing.sm }}>
                  {vendorOrders.pending.slice(0, 5).map((o) => {
                    const late = !!o.dueDate && o.dueDate < today;
                    const left = vendorOrders.remaining.get(o.id) ?? 0;
                    return (
                      <Pressable key={o.id} style={styles.jobCard} onPress={() => setEditEntry(o)} testID={`home-vorder-${o.id}`}>
                        <View style={[styles.dateBadge, late && { backgroundColor: colors.errorSoft }]}>
                          <Text style={[styles.dateBadgeText, late && { color: colors.error }]}>{!o.dueDate ? "—" : o.dueDate === today ? "आज" : formatDateShort(o.dueDate)}</Text>
                        </View>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={styles.rowTitle} numberOfLines={1}>{o.description || "Vendor ऑर्डर"}</Text>
                          <Text style={styles.rowSub} numberOfLines={1}>
                            {nameOf(o.customerId)} · {left > 0 ? `${money(left)} देने हैं` : "पूरा भुगतान"}{late ? " · देर" : ""}
                          </Text>
                        </View>
                        {left > 0 ? (
                          <Pressable style={styles.receiptBtn} onPress={() => setSettling(o)} hitSlop={6} accessibilityRole="button" accessibilityLabel="Vendor को भुगतान" testID={`home-vpay-${o.id}`}>
                            <MaterialIcon name="cash-fast" size={16} color={colors.brandPrimary} />
                            <Text style={styles.receiptBtnText}>भुगतान</Text>
                          </Pressable>
                        ) : (
                          <MaterialIcon name="pencil-outline" size={18} color={colors.muted} />
                        )}
                      </Pressable>
                    );
                  })}
                </View>
              </>
            ) : null}
            </>
            )}

            {recentDone.length > 0 ? (
              <>
                <View style={styles.sectionRow}>
                  <Text style={styles.sectionHead}>हाल में पूरा हुआ काम</Text>
                  <Pressable onPress={() => go("/(tabs)/work", { filter: "all" })} hitSlop={8} testID="home-done-more">
                    <Text style={styles.link}>सभी देखें</Text>
                  </Pressable>
                </View>
                <View style={{ gap: spacing.sm }}>
                  {recentDone.map(({ job: j, work: w }) => (
                    <Pressable key={j.id} style={styles.jobCard} onPress={() => setEditingJob(j)} testID={`home-done-${j.id}`}>
                      <MaterialIcon name="check-circle-outline" size={20} color={colors.success} />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.rowTitle} numberOfLines={1}>{j.title}</Text>
                        <Text style={styles.rowSub} numberOfLines={1}>
                          {nameOf(j.customerId)} · {w.date === today ? "आज" : formatDateShort(w.date)} · {money(w.amount)}
                        </Text>
                      </View>
                      <Pressable style={styles.receiptBtn} onPress={() => sendReceipt(w)} hitSlop={6} accessibilityRole="button" accessibilityLabel={`${j.title} की रसीद भेजें`} testID={`home-receipt-${j.id}`}>
                        <MaterialIcon name="file-document-outline" size={16} color={colors.brandPrimary} />
                        <Text style={styles.receiptBtnText}>रसीद</Text>
                      </Pressable>
                    </Pressable>
                  ))}
                </View>
              </>
            ) : null}
          </Animated.View>
        )}
      </ScrollView>

      {loading || loadFailed ? null : (
        isPersonal ? (
        <View style={styles.actionBar}>
          <Pressable style={styles.primaryAction} onPress={() => setExpenseSheet(true)} accessibilityRole="button" accessibilityLabel="खर्च लिखें" testID="quick-expense">
            <MaterialIcon name="arrow-up-circle" size={18} color={colors.onBrandPrimary} />
            <Text style={styles.primaryActionText} numberOfLines={1}>खर्च</Text>
          </Pressable>
          <Pressable style={styles.taskAction} onPress={() => setMoneySheet(true)} accessibilityRole="button" accessibilityLabel="लेन-देन लिखें" testID="quick-work">
            <MaterialIcon name="swap-vertical" size={18} color={colors.brandPrimary} />
            <Text style={styles.taskActionText} numberOfLines={1}>लेन-देन</Text>
          </Pressable>
          <Pressable style={styles.taskAction} onPress={() => setMoveSheet("swap")} accessibilityRole="button" accessibilityLabel="ट्रांसफर" testID="quick-transfer">
            <MaterialIcon name="swap-horizontal" size={18} color={colors.brandPrimary} />
            <Text style={styles.taskActionText} numberOfLines={1}>ट्रांसफर</Text>
          </Pressable>
        </View>
        ) : (
        <View style={styles.actionBar}>
          <Pressable style={styles.primaryAction} onPress={() => setJobSheet(true)} accessibilityRole="button" accessibilityLabel={labels.newWork} testID="quick-work">
            <MaterialIcon name="briefcase-plus-outline" size={18} color={colors.onBrandPrimary} />
            <Text style={styles.primaryActionText} numberOfLines={1}>{labels.newWork}</Text>
          </Pressable>
          <Pressable style={styles.expenseAction} onPress={() => setExpenseSheet(true)} accessibilityRole="button" accessibilityLabel="खर्च" testID="quick-expense">
            <MaterialIcon name="coffee-outline" size={18} color={semantic.pending} />
            <Text style={styles.expenseActionText} numberOfLines={1}>खर्च</Text>
          </Pressable>
          <Pressable style={styles.taskAction} onPress={() => setVendorMenu(true)} accessibilityRole="button" accessibilityLabel="Vendor" testID="quick-vendor">
            <MaterialIcon name="truck-outline" size={18} color={colors.brandPrimary} />
            <Text style={styles.taskActionText} numberOfLines={1}>Vendor</Text>
          </Pressable>
        </View>
        )
      )}

      <AddJobSheet visible={jobSheet} onClose={() => setJobSheet(false)} />
      <AddEntrySheet visible={moneySheet} type={isPersonal ? "given" : "payment"} kinds={isPersonal ? ["given", "payment", "purchase"] : ["payment", "given"]} onClose={() => setMoneySheet(false)} />
      <AddExpenseSheet visible={expenseSheet} onClose={() => setExpenseSheet(false)} />
      <EditRecordSheet job={editingJob} onClose={() => setEditingJob(null)} />
      <TaskSheet visible={taskSheet !== null} initial={taskSheet?.initial} onClose={() => setTaskSheet(null)} />
      <ReceiptSheet doc={shareDoc} onClose={() => setShareDoc(null)} />
      <MoneyMoveSheet kind={moveSheet} onClose={() => setMoveSheet(null)} />
      <MoneyMoveSheet kind={null} initial={editMove} onClose={() => setEditMove(null)} />
      <EditRecordSheet entry={editEntry} onClose={() => setEditEntry(null)} />
      <AddExpenseSheet visible={!!editExpense} initial={editExpense} onClose={() => setEditExpense(null)} />
      {isPersonal ? null : (
        <>
          <SheetShell visible={vendorMenu} onClose={() => setVendorMenu(false)} title="Vendor" testID="sheet-vendor-menu">
            <Pressable style={styles.vendorNew} onPress={() => { setVendorMenu(false); setTimeout(() => setVendorOrder(true), 300); }} accessibilityRole="button" testID="vendor-new-order">
              <MaterialIcon name="truck-plus-outline" size={22} color={colors.onBrandPrimary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.vendorNewTitle}>नया Vendor ऑर्डर</Text>
                <Text style={styles.vendorNewSub}>बाहर से काम करवाया या सामान मँगाया</Text>
              </View>
              <MaterialIcon name="chevron-right" size={20} color={colors.onBrandPrimary} />
            </Pressable>
            <Text style={styles.vendorHead}>Vendor को भुगतान{vendorOrders.unpaid.length ? ` (${vendorOrders.unpaid.length})` : ""}</Text>
            {vendorOrders.unpaid.length === 0 ? (
              <Text style={styles.vendorEmpty}>किसी Vendor का भुगतान बाकी नहीं</Text>
            ) : (
              vendorOrders.unpaid.slice(0, 12).map((o) => {
                const late = o.status === "ordered" && !!o.dueDate && o.dueDate < today;
                return (
                  <Pressable key={o.id} style={styles.vendorRow} onPress={() => { setVendorMenu(false); setTimeout(() => setSettling(o), 300); }} testID={`vendor-pay-${o.id}`}>
                    <View style={[styles.vendorIcon, late && { backgroundColor: colors.errorSoft }]}>
                      <MaterialIcon name={o.status === "ordered" ? "truck-fast-outline" : "package-variant-closed-check"} size={18} color={late ? colors.error : colors.info} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.rowTitle} numberOfLines={1}>{nameOf(o.customerId)}</Text>
                      <Text style={styles.rowSub} numberOfLines={1}>
                        {o.description || "Vendor ऑर्डर"}{o.status === "ordered" && o.dueDate ? ` · कब तक ${o.dueDate === today ? "आज" : formatDateShort(o.dueDate)}` : o.status === "delivered" ? " · डिलीवर" : ""}
                      </Text>
                    </View>
                    <Text style={[styles.resultDue, { color: semantic.due }]}>{money(vendorOrders.remaining.get(o.id) ?? 0)}</Text>
                  </Pressable>
                );
              })
            )}
            <Pressable style={styles.vendorAll} onPress={() => { setVendorMenu(false); go("/(tabs)/customers", { filter: "all", book: "vendor" }); }} testID="vendor-list">
              <Text style={styles.link}>सभी Vendor देखें</Text>
              <MaterialIcon name="chevron-right" size={16} color={colors.brandPrimary} />
            </Pressable>
          </SheetShell>
          <AddEntrySheet visible={vendorOrder} type="purchase" vendor onClose={() => setVendorOrder(false)} />
          <SettleSheet work={settling} onClose={() => setSettling(null)} />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  topRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  accountBtn: { marginTop: spacing.xs, width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  eyebrow: { ...type.caption, color: colors.brandSecondary, fontWeight: "700", textTransform: "uppercase" },
  h1: { fontSize: 30, fontWeight: "700", color: colors.onSurface, marginTop: spacing.xs },
  sub: { fontSize: 13, color: colors.muted, marginTop: spacing.xs },
  pendingPill: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", marginTop: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.errorSoft },
  pendingText: { fontSize: 12, fontWeight: "600", color: colors.warning },
  hero: { marginTop: spacing.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary, overflow: "hidden", ...elevation.low },
  heroHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm },
  heroTiles: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.md },
  heroNet: { paddingHorizontal: spacing.lg, paddingVertical: spacing.xs },
  spendTile: { flex: 1, minWidth: 0, padding: spacing.md, borderRadius: radius.md, gap: 4 },
  spendHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  spendLabel: { fontSize: 12, fontWeight: "800" },
  spendValue: { ...type.title, fontWeight: "800", fontVariant: ["tabular-nums"] },
  spendSub: { fontSize: 11, color: colors.muted, fontWeight: "600", fontVariant: ["tabular-nums"] },
  taskLine: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.md, paddingHorizontal: spacing.md, minHeight: 48, borderRadius: radius.md, backgroundColor: colors.brandTertiary },
  taskLineText: { flex: 1, fontSize: 14, fontWeight: "700", color: colors.onSurface },
  todayTag: { ...type.caption, color: colors.brandPrimary, fontWeight: "700" },
  feedCard: { borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingVertical: spacing.xs, overflow: "hidden" },
  feedDay: { ...type.caption, color: colors.muted, fontWeight: "800", paddingHorizontal: spacing.md, paddingTop: spacing.sm, textTransform: "uppercase" },
  feedDayGap: { marginTop: spacing.xs, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
  duesStrip: { flexDirection: "row", alignItems: "stretch", gap: spacing.sm, marginTop: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary },
  duesCell: { flex: 1, minWidth: 0, gap: 2 },
  duesLabel: { fontSize: 12, fontWeight: "700", color: colors.muted },
  duesValue: { fontSize: 20, fontWeight: "800", fontVariant: ["tabular-nums"] },
  duesSub: { fontSize: 11, color: colors.muted, fontWeight: "600" },
  vendorNew: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.brandPrimary },
  vendorNewTitle: { fontSize: 15, fontWeight: "800", color: colors.onBrandPrimary },
  vendorNewSub: { fontSize: 12, color: colors.onBrandPrimary, opacity: 0.85, marginTop: 2 },
  vendorHead: { ...type.caption, color: colors.muted, fontWeight: "800", textTransform: "uppercase", marginTop: spacing.lg, marginBottom: spacing.xs },
  vendorEmpty: { fontSize: 13, color: colors.muted, paddingVertical: spacing.md },
  vendorRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 56, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  vendorIcon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: colors.infoSoft },
  vendorAll: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 2, paddingVertical: spacing.md, marginTop: spacing.xs },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: spacing.md, paddingRight: spacing.sm, minHeight: 36, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  chipText: { fontSize: 13, fontWeight: "600", color: colors.onSurfaceSecondary },
  heroLabel: { ...type.caption, color: colors.muted, fontWeight: "700" },
  lateTag: { ...type.caption, color: semantic.due, fontWeight: "700" },
  actionBar: { position: "absolute", left: 0, right: 0, bottom: 0, flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
  walletLine: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.md, paddingHorizontal: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface },
  walletCell: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 6 },
  walletLabel: { fontSize: 13, color: colors.muted, fontWeight: "600" },
  walletValue: { fontSize: 16, fontWeight: "800", color: colors.onSurface, flexShrink: 1 },
  walletDivider: { width: 1, alignSelf: "stretch", backgroundColor: colors.border },
  primaryAction: { flex: 3, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xs, paddingVertical: 14, borderRadius: radius.md, backgroundColor: colors.brandPrimary },
  primaryActionText: { color: colors.onBrandPrimary, fontSize: 15, fontWeight: "700" },
  secondaryAction: { flex: 2.5, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xs, paddingVertical: 14, borderRadius: radius.md, borderWidth: 1, borderColor: colors.brandPrimary, backgroundColor: colors.surface },
  secondaryActionText: { color: colors.brandPrimary, fontSize: 14, fontWeight: "700" },
  gotAction: { flex: 2.5, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 3, paddingVertical: 14, borderRadius: radius.md, borderWidth: 1, borderColor: semantic.received, backgroundColor: semantic.receivedSoft },
  gotActionText: { color: semantic.received, fontSize: 14, fontWeight: "700" },
  expenseAction: { flex: 2, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 3, paddingVertical: 14, borderRadius: radius.md, borderWidth: 1, borderColor: colors.warning, backgroundColor: colors.surfaceSecondary },
  expenseActionText: { color: colors.warning, fontSize: 14, fontWeight: "700" },
  taskAction: { flex: 2, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xs, paddingVertical: 14, borderRadius: radius.md, backgroundColor: colors.brandTertiary, borderWidth: 1, borderColor: colors.brandPrimary },
  taskActionText: { color: colors.brandPrimary, fontSize: 14, fontWeight: "700" },

  // Search & Recent Styles
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: colors.onSurface,
    paddingVertical: 2,
  },
  searchDropdown: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginTop: 4,
    borderWidth: 1.5,
    borderColor: colors.brandPrimary,
    elevation: 4,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 8,
  },
  searchEmpty: {
    fontSize: 13,
    color: colors.muted,
    textAlign: "center",
    paddingVertical: spacing.md,
  },
  searchResultRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  resultTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.onSurface,
  },
  resultSub: {
    ...type.caption,
    color: colors.muted,
    marginTop: 1,
  },
  resultDue: {
    fontSize: 13,
    fontWeight: "700",
  },
  recentWrap: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: spacing.sm,
    gap: 6,
  },
  recentLabel: {
    ...type.caption,
    color: colors.muted,
    fontWeight: "700",
  },
  recentChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.surfaceSecondary,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  recentChipName: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.onSurface,
    maxWidth: 90,
  },
  recentChipDue: {
    ...type.caption,
    fontVariant: ["tabular-nums"],
    fontWeight: "700",
    color: colors.error,
  },
  aepsLine: { marginTop: spacing.sm, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 10, paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.brandTertiary },
  aepsLineText: { flex: 1, fontSize: 13, fontWeight: "600", color: colors.onSurface },
  sectionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.xl, marginBottom: spacing.md },
  sectionHead: { fontSize: 18, fontWeight: "700", color: colors.onSurface },
  link: { fontSize: 13, fontWeight: "700", color: colors.brandPrimary },
  receiptBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: spacing.md, minHeight: 40, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.brandPrimary },
  receiptBtnText: { fontSize: 12, fontWeight: "700", color: colors.brandPrimary },
  rowTitle: { fontSize: 15, fontWeight: "600", color: colors.onSurface },
  rowSub: { fontSize: 12, color: colors.muted, marginTop: 2 },
  emptyRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.lg, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  jobCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  dateBadge: { minWidth: 56, paddingVertical: 6, paddingHorizontal: spacing.sm, borderRadius: radius.sm, backgroundColor: colors.brandTertiary, alignItems: "center" },
  dateBadgeText: { fontSize: 12, fontWeight: "700", color: colors.brandSecondary },
});
