import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TextInput, Alert, BackHandler, Platform } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { Pressable } from "@/src/components/tap";
import { DataLoadError, SlowServerHint } from "@/src/components/slow-server-hint";
import { useState, useMemo, useCallback } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import MaterialIcon from "@react-native-vector-icons/material-design-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, spacing, radius } from "@/src/theme";
import { useAeps, useCustomers, useEntries, useJobs, computeBalance, isPersonalTask, isRepayment, type Entry, type Job } from "@/src/lib/data";
import { buildAllLedgers, workForJob } from "@/src/lib/records";
import { receiptDoc, type ShareDoc } from "@/src/lib/receipt";
import { ReceiptSheet } from "@/src/components/receipt-sheet";
import * as Updates from "expo-updates";
import { aepsTotals } from "@/src/lib/aeps";
import { formatDateShort, formatINR, formatPhone, formatWeekdayDate, todayISO } from "@/src/lib/format";
import { AddEntrySheet, AddJobSheet, EditRecordSheet } from "@/src/components/sheets";
import { useAuth } from "@/src/context/AuthContext";
import { clearRejected, flush, rejectedChanges, store, usePendingCount, useRejectedCount } from "@/src/lib/store";
import { computeFlows, pocketNet, useMoneyBook } from "@/src/lib/wallet";
import { useCounterMode } from "@/src/lib/counter";
import { accountName, usePersona } from "@/src/lib/persona";
import { useRecentCustomerIds } from "@/src/lib/recent";
import { TaskSheet } from "@/src/components/task-sheet";
import { TaskRow } from "@/src/components/task-row";
import { compareTasks, taskGroup, usePersonalTasks } from "@/src/lib/tasks";
import { AddExpenseSheet } from "@/src/components/expense-sheet";
export default function Home() {
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
  const { user } = useAuth();
  const { isUpdatePending } = Updates.useUpdates();
  const pending = usePendingCount();
  const rejectedCount = useRejectedCount();
  const showRejected = () =>
    Alert.alert(
      "ये बदलाव सेव नहीं हुए",
      `${rejectedChanges().map((r) => `• ${r.label}`).join("\n")}\n\nइन्हें दोबारा लिख दें।`,
      [{ text: "बाद में" }, { text: "ठीक है, हटाएँ", onPress: () => void clearRejected() }],
    );
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
  const recentTxns = useMemo(
    () =>
      isPersonal
        ? entries
            .filter((e) => personaCustIds.has(e.customerId) && (e.type === "payment" || e.type === "given" || e.type === "purchase"))
            .sort((a, b) => (a.date !== b.date ? b.date.localeCompare(a.date) : b.createdAt.localeCompare(a.createdAt)))
            .slice(0, 5)
        : [],
    [entries, personaCustIds, isPersonal],
  );

  const recentCustomers = useMemo(() => {
    return recentIds
      .map((id) => customers.find((c) => c.id === id))
      .filter((c): c is (typeof customers)[0] => Boolean(c));
  }, [recentIds, customers]);

  const nameOf = (id: string) => (id ? customers.find((c) => c.id === id)?.name ?? labels.customer : "खुद का काम");

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
    const balances = customers.map((c) => computeBalance(entries, c.id));
    const dues = balances.filter((d) => d > 0);
    const weOwe = balances.filter((d) => d < 0).map((d) => -d);
    const totalDue = dues.reduce((s, d) => s + d, 0);
    const totalWeOwe = weOwe.reduce((s, d) => s + d, 0);
    const todayWork = entries.filter((e) => e.date === today && e.type === "work" && personaCustIds.has(e.customerId));
    const open = jobs.filter((j) => j.status !== "done");
    return {
      totalDue,
      dueCustomers: dues.length,
      totalWeOwe,
      weOweCount: weOwe.length,
      todayWork: todayWork.reduce((n, e) => n + e.amount, 0),
      todayWorkCount: todayWork.length,
      openJobs: open.length,
      overdue: open.filter((j) => j.dueDate < today).length,
    };
  }, [customers, entries, jobs, today, personaCustIds]);

  const persona = isPersonal ? "personal" : "business";
  const pockets = useMemo(() => computeFlows(book, persona, (d) => d <= today), [book, persona, today]);
  const cashBal = pocketNet(pockets.cash);
  const bankBal = pocketNet(pockets.bank);
  const todayFlows = useMemo(() => computeFlows(book, persona, (d) => d === today), [book, persona, today]);
  const todayCash = pocketNet(todayFlows.cash);
  const todayBank = pocketNet(todayFlows.bank);
  const todayNet = todayCash + todayBank;

  const aepsToday = useMemo(() => aepsTotals(aeps, (d) => d === today), [aeps, today]);
  const aepsDue = useMemo(() => aeps.filter((t) => t.status === "pending" && (t.dueDate || t.date) <= today).length, [aeps, today]);
  const signedINR = (n: number) => `${n < 0 ? "−" : "+"}${formatINR(Math.abs(n))}`;
  // Today's change of cash + bank together; the day screen breaks it down.
  const todayMoneyCard = (
    <StatCard
      label="आज का हिसाब"
      value={signedINR(todayNet)}
      hint={`${labels.cash} ${signedINR(todayCash)} · बैंक ${signedINR(todayBank)}`}
      icon="scale-balance"
      tone={todayNet < 0 ? "due" : "ok"}
      onPress={() => router.push({ pathname: "/day", params: { type: "drawer" } })}
      testID="stat-today-money"
    />
  );

  const upcoming = useMemo(
    () => jobs.filter((j) => j.status !== "done").sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 8),
    [jobs]
  );

  const { tasks: personalTasks } = usePersonalTasks();
  const openTasks = useMemo(() => personalTasks.filter((t) => t.status !== "done").sort(compareTasks), [personalTasks]);
  const taskStats = useMemo(() => {
    let late = 0;
    let due = 0;
    for (const t of openTasks) {
      const g = taskGroup(t, today);
      if (g === "late") late++;
      else if (g === "today") due++;
    }
    return { open: openTasks.length, late, today: due };
  }, [openTasks, today]);
  // Late and today's first, then the rest in their usual order.
  const homeTasks = useMemo(() => {
    const rank = (t: Job) => ({ late: 0, today: 1, tomorrow: 2, later: 3, someday: 4, done: 5 })[taskGroup(t, today)];
    return [...openTasks].sort((a, b) => rank(a) - rank(b) || compareTasks(a, b)).slice(0, 5);
  }, [openTasks, today]);

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
        contentContainerStyle={{ padding: spacing.lg, paddingTop: insets.top + spacing.md, paddingBottom: spacing.xxl }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topRow}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.eyebrow}>{formatWeekdayDate(today)}</Text>
            <Text style={styles.h1} numberOfLines={2} testID="shop-name">{accountName(user) || "आज का खाता"}</Text>
          </View>
          <Pressable onPress={() => router.push("/(tabs)/profile")} hitSlop={8} testID="open-profile" style={styles.accountBtn}>
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
                    <Text style={[styles.resultDue, { color: b > 0 ? colors.error : colors.success }]}>
                      {b === 0 ? "क्लियर" : b > 0 ? `${formatINR(b)} लेने` : `${formatINR(-b)} ${labels.advance}`}
                    </Text>
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
                    <MaterialIcon name="account-outline" size={14} color={colors.brandPrimary} />
                    <Text style={styles.recentChipName} numberOfLines={1}>{c.name}</Text>
                    {bal > 0 ? (
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
            <View style={styles.statsGrid}>
              {isPersonal ? (
                <>
                  <StatCard
                    label="कुल लेने हैं"
                    value={formatINR(Math.max(stats.totalDue, 0))}
                    hint={`${stats.dueCustomers} लोग`}
                    icon="account-arrow-left-outline"
                    tone="due"
                    onPress={() => go("/(tabs)/customers", { filter: "due" })}
                    testID="stat-total-due"
                  />
                  <StatCard
                    label="कुल देने हैं"
                    value={formatINR(Math.max(stats.totalWeOwe, 0))}
                    hint={`${stats.weOweCount} लोग`}
                    icon="account-arrow-right-outline"
                    tone="warn"
                    onPress={() => go("/(tabs)/customers", { filter: "owe" })}
                    testID="stat-total-we-owe"
                  />
                  <StatCard
                    label="काम बाकी"
                    value={String(taskStats.open)}
                    hint={taskStats.late > 0 ? `${taskStats.late} देर से` : taskStats.today > 0 ? `${taskStats.today} आज` : "सब समय पर"}
                    icon="clipboard-check-outline"
                    tone={taskStats.late > 0 ? "warn" : "neutral"}
                    onPress={() => router.navigate("/(tabs)/tasks" as never)}
                    testID="stat-pending-tasks"
                  />
                  {todayMoneyCard}
                </>
              ) : (
                <>
                  <StatCard
                    label="कुल लेने हैं"
                    value={formatINR(Math.max(stats.totalDue, 0))}
                    hint={`${stats.dueCustomers} ग्राहक`}
                    icon="account-cash-outline"
                    tone="due"
                    onPress={() => go("/(tabs)/customers", { filter: "due" })}
                    testID="stat-total-due"
                  />
                  <StatCard
                    label="काम बाकी"
                    value={String(stats.openJobs)}
                    hint={stats.overdue > 0 ? `${stats.overdue} देर से` : "सब समय पर"}
                    icon="briefcase-clock-outline"
                    tone={stats.overdue > 0 ? "warn" : "neutral"}
                    onPress={() => go("/(tabs)/work", { filter: "open" })}
                    testID="stat-pending-jobs"
                  />
                  <StatCard
                    label="आज का काम"
                    value={formatINR(stats.todayWork)}
                    hint={`${stats.todayWorkCount} एंट्री`}
                    icon="clipboard-text-outline"
                    tone="neutral"
                    onPress={() => router.push({ pathname: "/day", params: { type: "work" } })}
                    testID="stat-today-work"
                  />
                  {todayMoneyCard}
                </>
              )}
            </View>

            <View style={styles.walletLine}>
              <Pressable style={styles.walletCell} onPress={() => router.push({ pathname: "/pocket" as never, params: { p: "cash" } })} testID="home-wallet-cash">
                <MaterialIcon name="cash" size={16} color={colors.success} />
                <Text style={styles.walletLabel}>{labels.cash}</Text>
                <Text style={[styles.walletValue, cashBal < 0 && { color: colors.error }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{formatINR(cashBal)}</Text>
              </Pressable>
              <View style={styles.walletDivider} />
              <Pressable style={styles.walletCell} onPress={() => router.push({ pathname: "/pocket" as never, params: { p: "bank" } })} testID="home-wallet-bank">
                <MaterialIcon name="bank-outline" size={16} color={colors.info} />
                <Text style={styles.walletLabel}>बैंक</Text>
                <Text style={[styles.walletValue, bankBal < 0 && { color: colors.error }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{formatINR(bankBal)}</Text>
              </Pressable>
              <Pressable onPress={() => router.push("/balance" as never)} hitSlop={10} style={styles.walletMore} testID="home-wallet">
                <Text style={styles.walletMoreText}>कुल</Text>
                <MaterialIcon name="chevron-right" size={18} color={colors.brandPrimary} />
              </Pressable>
            </View>

            <View style={styles.actionRow}>
              <Pressable style={styles.primaryAction} onPress={() => (isPersonal ? setMoneySheet(true) : setJobSheet(true))} testID="quick-work">
                <MaterialIcon name={isPersonal ? "swap-vertical" : "briefcase-plus-outline"} size={17} color={colors.onBrandPrimary} />
                <Text style={styles.primaryActionText}>{labels.newWork}</Text>
              </Pressable>
              <Pressable style={styles.expenseAction} onPress={() => setExpenseSheet(true)} testID="quick-expense">
                <MaterialIcon name="coffee-outline" size={17} color={colors.warning} />
                <Text style={styles.expenseActionText}>खर्च</Text>
              </Pressable>
              {isPersonal ? (
                <Pressable style={styles.taskAction} onPress={() => setTaskSheet({})} testID="quick-task">
                  <MaterialIcon name="clipboard-plus-outline" size={17} color={colors.brandPrimary} />
                  <Text style={styles.taskActionText}>काम लिखें</Text>
                </Pressable>
              ) : null}
            </View>

            {counter.on ? (
            <Pressable style={styles.aepsLine} onPress={() => go("/(tabs)/aeps", { range: "today" })} testID="home-aeps-card">
              <MaterialIcon name="fingerprint" size={16} color={colors.brandPrimary} />
              <Text style={styles.aepsLineText} numberOfLines={2}>
                {(aepsToday.count === 0
                  ? "काउंटर · आज कुछ नहीं"
                  : `काउंटर · गल्ला ${signedINR(aepsToday.cashNet)} · बैंक ${signedINR(aepsToday.bankNet)}${aepsToday.commission > 0 ? ` · कमीशन ${formatINR(aepsToday.commission)}` : ""}`) +
                  (aepsDue > 0 ? ` · ${aepsDue} भेजनी बाकी` : "")}
              </Text>
              <MaterialIcon name="chevron-right" size={18} color={colors.muted} />
            </Pressable>
            ) : null}

            {isPersonal ? (
              <>
                <View style={styles.sectionRow}>
                  <Text style={styles.sectionHead}>मेरे काम</Text>
                  {taskStats.open > 0 ? (
                    <Pressable onPress={() => router.navigate("/(tabs)/tasks" as never)} hitSlop={8} testID="home-tasks-more">
                      <Text style={styles.link}>सभी देखें</Text>
                    </Pressable>
                  ) : null}
                </View>
                {homeTasks.length === 0 ? (
                  <Pressable style={styles.emptyRow} onPress={() => setTaskSheet({})} testID="home-tasks-empty">
                    <MaterialIcon name="clipboard-check-outline" size={20} color={colors.muted} />
                    <Text style={{ color: colors.muted, fontSize: 14, flex: 1 }}>कोई काम बाकी नहीं · नया लिखें</Text>
                    <MaterialIcon name="plus" size={18} color={colors.brandPrimary} />
                  </Pressable>
                ) : (
                  <View style={{ gap: spacing.sm }}>
                    {homeTasks.map((t) => (
                      <TaskRow
                        key={t.id}
                        task={t}
                        today={today}
                        compact
                        onToggle={() => store.updateJob(t.id, { status: t.status === "done" ? "pending" : "done" })}
                        onOpen={() => setTaskSheet({ initial: t })}
                      />
                    ))}
                  </View>
                )}

                <View style={styles.sectionRow}>
                  <Text style={styles.sectionHead}>हाल के लेन-देन</Text>
                  {recentTxns.length > 0 ? (
                    <Pressable onPress={() => go("/(tabs)/work", {})} hitSlop={8}>
                      <Text style={styles.link}>सभी देखें</Text>
                    </Pressable>
                  ) : null}
                </View>
                {recentTxns.length === 0 ? (
                  <View style={styles.emptyRow}>
                    <MaterialIcon name="swap-vertical" size={20} color={colors.muted} />
                    <Text style={{ color: colors.muted, fontSize: 14 }}>अभी कोई लेन-देन नहीं</Text>
                  </View>
                ) : (
                  <View style={{ gap: spacing.sm }}>
                    {recentTxns.map((e) => {
                      const got = e.type === "payment";
                      const goods = e.type === "purchase";
                      const repay = isRepayment(e);
                      const label = got ? "मिले" : goods ? "सामान लिया" : repay ? "बकाया चुकाया" : "दिए";
                      const icon = got ? "arrow-bottom-left" : goods ? "cart-outline" : repay ? "check-circle-outline" : "arrow-top-right";
                      const tint = got ? colors.success : goods ? colors.warning : repay ? colors.info : colors.error;
                      return (
                        <Pressable key={e.id} style={styles.jobCard} onPress={() => router.push(`/customer/${e.customerId}`)} testID={`home-txn-${e.id}`}>
                          <MaterialIcon name={icon} size={20} color={tint} />
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text style={styles.rowTitle} numberOfLines={1}>{nameOf(e.customerId)}</Text>
                            <Text style={styles.rowSub} numberOfLines={1}>
                              {[label, e.description, e.date === today ? "आज" : formatDateShort(e.date)].filter(Boolean).join(" · ")}
                            </Text>
                          </View>
                          <Text style={{ fontSize: 15, fontWeight: "800", color: tint }}>{formatINR(e.amount)}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                )}
              </>
            ) : null}

            {isPersonal ? null : (
            <>
            <View style={styles.sectionRow}>
              <Text style={styles.sectionHead}>आने वाला काम</Text>
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
                          {nameOf(j.customerId)}{j.estimatedAmount > 0 ? ` · ${formatINR(j.estimatedAmount)}` : ""}{late ? " · देर" : ""}
                        </Text>
                      </View>
                      <MaterialIcon name="pencil-outline" size={18} color={colors.muted} />
                    </Pressable>
                  );
                })}
              </View>
            )}
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
                          {nameOf(j.customerId)} · {w.date === today ? "आज" : formatDateShort(w.date)} · {formatINR(w.amount)}
                        </Text>
                      </View>
                      <Pressable style={styles.receiptBtn} onPress={() => sendReceipt(w)} hitSlop={6} testID={`home-receipt-${j.id}`}>
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

      <AddJobSheet visible={jobSheet} onClose={() => setJobSheet(false)} />
      <AddEntrySheet visible={moneySheet} type={isPersonal ? "given" : "payment"} kinds={isPersonal ? ["given", "payment", "purchase"] : ["payment", "given"]} onClose={() => setMoneySheet(false)} />
      <AddExpenseSheet visible={expenseSheet} onClose={() => setExpenseSheet(false)} />
      <EditRecordSheet job={editingJob} onClose={() => setEditingJob(null)} />
      <TaskSheet visible={taskSheet !== null} initial={taskSheet?.initial} onClose={() => setTaskSheet(null)} />
      <ReceiptSheet doc={shareDoc} onClose={() => setShareDoc(null)} />
    </View>
  );
}

type Tone = "due" | "ok" | "neutral" | "warn";

function StatCard({ label, value, hint, icon, tone, onPress, testID }: { label: string; value: string; hint: string; icon: string; tone: Tone; onPress: () => void; testID: string }) {
  const c = tone === "due" ? colors.error : tone === "ok" ? colors.success : tone === "warn" ? colors.warning : colors.onSurface;
  return (
    <Pressable style={styles.statCard} onPress={onPress} testID={testID}>
      <View style={styles.statTop}>
        <Text style={styles.statLabel}>{label}</Text>
        <MaterialIcon name={icon as any} size={18} color={c} />
      </View>
      <Text style={[styles.statValue, { color: c }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      <View style={styles.statBottom}>
        <Text style={styles.statHint} numberOfLines={1}>{hint}</Text>
        <MaterialIcon name="chevron-right" size={16} color={colors.muted} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  topRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  accountBtn: { marginTop: spacing.sm, width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  eyebrow: { fontSize: 11, color: colors.brandSecondary, fontWeight: "700", textTransform: "uppercase" },
  h1: { fontSize: 30, fontWeight: "700", color: colors.onSurface, marginTop: spacing.xs },
  sub: { fontSize: 13, color: colors.muted, marginTop: spacing.xs },
  pendingPill: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", marginTop: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.errorSoft },
  pendingText: { fontSize: 12, fontWeight: "600", color: colors.warning },
  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.xl },
  statCard: { flexBasis: "48%", flexGrow: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.lg, borderWidth: 1, borderColor: colors.border },
  statTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  statLabel: { fontSize: 12, color: colors.muted, fontWeight: "600" },
  statValue: { fontSize: 22, fontWeight: "700", marginTop: spacing.xs },
  statBottom: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.xs },
  statHint: { fontSize: 12, color: colors.muted, flexShrink: 1 },
  actionRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg },
  walletLine: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.sm, paddingVertical: spacing.md, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary },
  walletCell: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 6 },
  walletLabel: { fontSize: 13, color: colors.muted, fontWeight: "600" },
  walletValue: { fontSize: 16, fontWeight: "800", color: colors.onSurface, flexShrink: 1 },
  walletDivider: { width: 1, alignSelf: "stretch", backgroundColor: colors.border },
  walletMore: { flexDirection: "row", alignItems: "center", paddingLeft: 4 },
  walletMoreText: { fontSize: 12, fontWeight: "700", color: colors.brandPrimary },
  primaryAction: { flex: 3, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xs, paddingVertical: 14, borderRadius: radius.md, backgroundColor: colors.brandPrimary },
  primaryActionText: { color: colors.onBrandPrimary, fontSize: 15, fontWeight: "700" },
  secondaryAction: { flex: 2.5, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xs, paddingVertical: 14, borderRadius: radius.md, borderWidth: 1, borderColor: colors.brandPrimary, backgroundColor: colors.surface },
  secondaryActionText: { color: colors.brandPrimary, fontSize: 14, fontWeight: "700" },
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
    fontSize: 11,
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
    fontSize: 11,
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
    fontSize: 11,
    fontWeight: "700",
    color: colors.error,
  },
  aepsLine: { marginTop: spacing.sm, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 10, paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.brandTertiary },
  aepsLineText: { flex: 1, fontSize: 13, fontWeight: "600", color: colors.onSurface },
  sectionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.xl, marginBottom: spacing.md },
  sectionHead: { fontSize: 18, fontWeight: "700", color: colors.onSurface },
  link: { fontSize: 13, fontWeight: "700", color: colors.brandPrimary },
  receiptBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.brandPrimary },
  receiptBtnText: { fontSize: 12, fontWeight: "700", color: colors.brandPrimary },
  rowTitle: { fontSize: 15, fontWeight: "600", color: colors.onSurface },
  rowSub: { fontSize: 12, color: colors.muted, marginTop: 2 },
  emptyRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.lg, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  jobCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  dateBadge: { minWidth: 56, paddingVertical: 6, paddingHorizontal: spacing.sm, borderRadius: radius.sm, backgroundColor: colors.brandTertiary, alignItems: "center" },
  dateBadgeText: { fontSize: 12, fontWeight: "700", color: colors.brandSecondary },
});
