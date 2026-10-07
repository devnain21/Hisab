import { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, FlatList, ScrollView, ActivityIndicator, TextInput } from "react-native";
import { useLocalSearchParams } from "expo-router";
import MaterialIcon from "@react-native-vector-icons/material-design-icons";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, spacing, radius, semantic, elevation } from "@/src/theme";
import { isPersonalTask, useCustomers, useJobs, useEntries, type Entry, type Job } from "@/src/lib/data";
import { formatDate, formatDateShort, formatINR, roundMoney, todayISO } from "@/src/lib/format";
import { jobAdvanceLeft, buildAllLedgers, workForJobs, type WorkStatus } from "@/src/lib/records";
import { store } from "@/src/lib/store";
import { AddEntrySheet, AddJobSheet, CompleteJobSheet, EditRecordSheet, SettleSheet } from "@/src/components/sheets";
import { Pressable } from "@/src/components/tap";
import { DataLoadError, SlowServerHint } from "@/src/components/slow-server-hint";
import { usePersona } from "@/src/lib/persona";
import { HIDDEN, usePrefs } from "@/src/lib/prefs";

type Filter = "open" | "done" | "all" | "today" | "late" | "unpaid" | "doneToday";
const FILTERS: Filter[] = ["open", "done", "all", "today", "late", "unpaid", "doneToday"];
/** The segmented control; today / late / unpaid are reached from the summary tiles. */
const TABS: { key: Filter; label: string }[] = [
  { key: "open", label: "बाकी" },
  { key: "done", label: "पूरे" },
  { key: "all", label: "सभी" },
];
const TILE_FILTER_LABEL: Partial<Record<Filter, string>> = { today: "आज देने हैं", late: "देर से", unpaid: "पैसे बाकी", doneToday: "आज पूरे" };

type JobInfo = {
  job: Job;
  /** Customer advance on a job still open. */
  advance: number;
  work?: Entry;
  pay?: WorkStatus;
};

type Row = { kind: "head"; key: string; label: string; count: number; tone: string } | { kind: "job"; key: string; info: JobInfo };

const daysFrom = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00`) - Date.parse(`${a}T12:00:00`)) / 86400000);

function matches(i: JobInfo, f: Filter, today: string) {
  const open = i.job.status !== "done";
  if (f === "open") return open;
  if (f === "done") return !open;
  if (f === "today") return open && i.job.dueDate === today;
  if (f === "late") return open && i.job.dueDate < today;
  if (f === "unpaid") return !open && !!i.pay && i.pay.remaining > 0;
  if (f === "doneToday") return !open && i.job.dueDate === today;
  return true;
}

export default function WorkScreen() {
  const { isPersonal } = usePersona();
  return isPersonal ? <PersonalTxns /> : <ShopWork />;
}

function ShopWork() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ filter?: Filter; t?: string }>();
  const customersQ = useCustomers();
  const jobsQ = useJobs();
  const entriesQ = useEntries();
  const { hideAmounts } = usePrefs();
  const money = (n: number) => (hideAmounts ? HIDDEN : formatINR(n));
  const allCustomers = customersQ.data;
  const customers = useMemo(() => (allCustomers ?? []).filter((c) => c.persona !== "personal"), [allCustomers]);
  const allJobs = jobsQ.data;
  const jobs = useMemo(() => {
    const mine = new Set(customers.map((c) => c.id));
    return (allJobs ?? []).filter((j) => (!j.customerId && !isPersonalTask(j)) || mine.has(j.customerId));
  }, [allJobs, customers]);
  const allEntries = entriesQ.data;
  const entries = useMemo(() => allEntries ?? [], [allEntries]);
  const [filter, setFilter] = useState<Filter>("open");
  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const [completing, setCompleting] = useState<Job | null>(null);
  const [editing, setEditing] = useState<Job | null>(null);
  const today = todayISO();

  useEffect(() => {
    if (params.filter && FILTERS.includes(params.filter)) setFilter(params.filter);
  }, [params.filter, params.t]);

  const nameById = useMemo(() => new Map(customers.map((c) => [c.id, c.name])), [customers]);
  const nameOf = (id: string) => (id ? nameById.get(id) ?? "ग्राहक" : "खुद का काम");

  // Everything a card shows, worked out once per data change.
  const infos = useMemo(() => {
    const ledger = buildAllLedgers(entries);
    const workOf = workForJobs(jobs.filter((j) => j.status === "done"), entries);
    return jobs.map((job): JobInfo => {
      if (job.status !== "done") return { job, advance: jobAdvanceLeft(job, entries) };
      const work = workOf.get(job.id);
      return { job, work, pay: work ? ledger.get(work.id) : undefined, advance: 0 };
    });
  }, [jobs, entries]);

  const stats = useMemo(() => {
    const open = infos.filter((i) => i.job.status !== "done");
    const doneToday = infos.filter((i) => i.job.status === "done" && i.job.dueDate === today);
    const unpaid = infos.filter((i) => matches(i, "unpaid", today));
    return {
      open: open.length,
      value: roundMoney(open.reduce((s, i) => s + (i.job.estimatedAmount || 0), 0)),
      advance: roundMoney(open.reduce((s, i) => s + i.advance, 0)),
      today: open.filter((i) => i.job.dueDate === today).length,
      late: open.filter((i) => i.job.dueDate < today).length,
      unpaid: unpaid.length,
      unpaidSum: roundMoney(unpaid.reduce((s, i) => s + (i.pay?.remaining ?? 0), 0)),
      doneToday: doneToday.length,
      doneTodaySum: roundMoney(doneToday.reduce((s, i) => s + (i.work?.amount ?? 0), 0)),
    };
  }, [infos, today]);

  const rows = useMemo((): Row[] => {
    const needle = q.trim().toLowerCase();
    const hit = (i: JobInfo) =>
      !needle ||
      i.job.title.toLowerCase().includes(needle) ||
      nameOf(i.job.customerId).toLowerCase().includes(needle) ||
      i.job.notes.toLowerCase().includes(needle);
    const list = infos.filter((i) => matches(i, filter, today) && hit(i));
    const openList = list.filter((i) => i.job.status !== "done").sort((a, b) => a.job.dueDate.localeCompare(b.job.dueDate));
    // Finished work: most recent first (day finished, then when it was written).
    const doneList = list
      .filter((i) => i.job.status === "done")
      .sort((a, b) => b.job.dueDate.localeCompare(a.job.dueDate) || (b.work?.createdAt ?? b.job.createdAt).localeCompare(a.work?.createdAt ?? a.job.createdAt));
    const out: Row[] = [];
    const group = (key: string, label: string, tone: string, items: JobInfo[]) => {
      if (!items.length) return;
      out.push({ kind: "head", key: `h-${key}`, label, count: items.length, tone });
      items.forEach((info) => out.push({ kind: "job", key: info.job.id, info }));
    };
    const tomorrow = todayISO(1);
    group("late", "देर से", colors.warning, openList.filter((i) => i.job.dueDate < today));
    group("today", "आज", colors.brandPrimary, openList.filter((i) => i.job.dueDate === today));
    group("tomorrow", "कल", colors.info, openList.filter((i) => i.job.dueDate === tomorrow));
    group("later", "आगे", colors.muted, openList.filter((i) => i.job.dueDate > tomorrow));
    group("done", "पूरे", colors.success, doneList);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [infos, filter, today, q, nameById]);

  // Own tasks have no money side, so finishing one is a single tap.
  const complete = (j: Job) => (j.customerId ? setCompleting(j) : store.updateJob(j.id, { status: "done", dueDate: today }));

  const loading = jobsQ.isLoading;
  const loadFailed = !loading && ((jobsQ.isError && jobsQ.data == null) || (customersQ.isError && customersQ.data == null) || (entriesQ.isError && entriesQ.data == null));
  const tileFilter = TILE_FILTER_LABEL[filter];

  const header = (
    <View>
      <View style={styles.hero} testID="work-summary">
        <Text style={styles.heroLabel}>बाकी काम</Text>
        <View style={{ flexDirection: "row", alignItems: "baseline", gap: spacing.sm }}>
          <Text style={styles.heroValue} numberOfLines={1} adjustsFontSizeToFit>{money(stats.value)}</Text>
          <Text style={styles.heroCount}>{stats.open} काम</Text>
        </View>
        {stats.advance > 0 ? <Text style={styles.heroSub} testID="work-summary-advance">एडवांस मिला {money(stats.advance)} · आना बाकी {money(Math.max(0, stats.value - stats.advance))}</Text> : null}
        <View style={styles.tiles}>
          <Tile icon="calendar-today" label="आज देने" value={String(stats.today)} active={filter === "today"} onPress={() => setFilter(filter === "today" ? "open" : "today")} testID="work-tile-today" />
          <Tile icon="alert-circle-outline" label="देर से" value={String(stats.late)} warn={stats.late > 0} active={filter === "late"} onPress={() => setFilter(filter === "late" ? "open" : "late")} testID="work-tile-late" />
          <Tile icon="cash-clock" label="पैसे बाकी" value={String(stats.unpaid)} sub={stats.unpaidSum > 0 ? money(stats.unpaidSum) : ""} warn={stats.unpaid > 0} active={filter === "unpaid"} onPress={() => setFilter(filter === "unpaid" ? "open" : "unpaid")} testID="work-tile-unpaid" />
          <Tile icon="check-circle-outline" label="आज पूरे" value={String(stats.doneToday)} sub={stats.doneTodaySum > 0 ? money(stats.doneTodaySum) : ""} active={filter === "doneToday"} onPress={() => setFilter(filter === "doneToday" ? "open" : "doneToday")} testID="work-tile-done-today" />
        </View>
      </View>

      <View style={styles.segment}>
        {TABS.map((t) => {
          const active = filter === t.key;
          return (
            <Pressable key={t.key} onPress={() => setFilter(t.key)} style={[styles.segBtn, active && styles.segBtnOn]} accessibilityRole="button" accessibilityState={{ selected: active }} testID={`work-filter-${t.key}`}>
              <Text style={[styles.segText, active && styles.segTextOn]} numberOfLines={1}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {tileFilter ? (
        <Pressable onPress={() => setFilter("open")} style={styles.activeFilter} testID="work-clear-filter">
          <Text style={styles.activeFilterText}>{tileFilter}</Text>
          <MaterialIcon name="close" size={14} color={colors.brandPrimary} />
        </Pressable>
      ) : null}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={[styles.topBar, { paddingTop: insets.top + spacing.md }]}>
        <Text style={styles.h1}>काम</Text>
        <Pressable onPress={() => { setSearching((s) => !s); if (searching) setQ(""); }} hitSlop={10} style={styles.iconBtn} accessibilityRole="button" testID="work-search-toggle">
          <MaterialIcon name={searching ? "close" : "magnify"} size={22} color={colors.onSurface} />
        </Pressable>
      </View>
      {searching ? (
        <View style={{ paddingHorizontal: spacing.lg }}>
          <SearchBox value={q} onChange={setQ} placeholder="काम या ग्राहक खोजें" testID="work-search" />
        </View>
      ) : null}

      {loading ? (
        <View style={{ marginTop: spacing.xxl, alignItems: "center" }}><ActivityIndicator color={colors.brandPrimary} /><SlowServerHint /></View>
      ) : loadFailed ? (
        <DataLoadError onRetry={() => { jobsQ.refetch(); customersQ.refetch(); entriesQ.refetch(); }} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.key}
          ListHeaderComponent={header}
          initialNumToRender={12}
          windowSize={7}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: Math.max(spacing.xxxl * 2, insets.bottom + 104) }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <View style={styles.emptyIcon}><MaterialIcon name="briefcase-check-outline" size={30} color={colors.brandPrimary} /></View>
              <Text style={styles.emptyTitle}>{q ? "कोई नहीं मिला" : filter === "open" ? "सारे काम पूरे" : "यहाँ कोई काम नहीं"}</Text>
              {!q && filter === "open" ? <Text style={styles.emptySub}>नीचे + दबाकर नया काम लिखें</Text> : null}
            </View>
          }
          renderItem={({ item: r, index }) =>
            r.kind === "head" ? (
              <View style={styles.groupHead}>
                <View style={[styles.groupDot, { backgroundColor: r.tone }]} />
                <Text style={styles.groupLabel}>{r.label}</Text>
                <Text style={styles.groupCount}>{r.count}</Text>
              </View>
            ) : (
              <Animated.View entering={FadeInDown.delay(Math.min(index, 8) * 30).duration(220)}>
                <JobCard
                  info={r.info}
                  today={today}
                  customer={nameOf(r.info.job.customerId)}
                  money={money}
                  onOpen={() => setEditing(r.info.job)}
                  onComplete={() => complete(r.info.job)}
                />
              </Animated.View>
            )
          }
        />
      )}

      <Pressable style={[styles.fab, { bottom: insets.bottom + 16 }]} onPress={() => setOpen(true)} testID="add-job-fab">
        <MaterialIcon name="plus" size={26} color={colors.onBrandPrimary} />
      </Pressable>

      <AddJobSheet visible={open} onClose={() => setOpen(false)} />
      <CompleteJobSheet job={completing} onClose={() => setCompleting(null)} />
      <EditRecordSheet job={editing} onClose={() => setEditing(null)} />
    </View>
  );
}

function Tile({ icon, label, value, sub, warn, active, onPress, testID }: { icon: string; label: string; value: string; sub?: string; warn?: boolean; active?: boolean; onPress: () => void; testID: string }) {
  return (
    <Pressable onPress={onPress} style={[styles.tile, active && styles.tileOn]} accessibilityRole="button" accessibilityState={{ selected: !!active }} testID={testID}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
        <MaterialIcon name={icon as never} size={14} color={active ? colors.brandSecondary : warn ? "#FFD8A8" : "rgba(255,255,255,0.8)"} />
        <Text style={[styles.tileLabel, active && { color: colors.brandSecondary }]} numberOfLines={1}>{label}</Text>
      </View>
      <Text style={[styles.tileValue, active && { color: colors.brandSecondary }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      {sub ? <Text style={[styles.tileSub, active && { color: colors.brandSecondary }]} numberOfLines={1}>{sub}</Text> : null}
    </Pressable>
  );
}

function dueText(j: Job, today: string): { text: string; tone: string } {
  if (j.status === "done") return { text: `पूरा · ${formatDateShort(j.dueDate)}`, tone: colors.muted };
  if (j.dueDate === today) return { text: "आज देना है", tone: colors.brandPrimary };
  if (j.dueDate < today) return { text: `${daysFrom(j.dueDate, today)} दिन देर`, tone: colors.warning };
  if (j.dueDate === todayISO(1)) return { text: "कल देना है", tone: colors.info };
  return { text: `${formatDate(j.dueDate)} तक`, tone: colors.onSurfaceSecondary };
}

function JobCard({ info, today, customer, money, onOpen, onComplete }: {
  info: JobInfo;
  today: string;
  customer: string;
  money: (n: number) => string;
  onOpen: () => void;
  onComplete: () => void;
}) {
  const { job: j, advance, pay, work } = info;
  const done = j.status === "done";
  const due = dueText(j, today);
  const late = !done && j.dueDate < today;
  const left = pay?.remaining ?? 0;
  const amount = done && work ? work.amount : j.estimatedAmount;
  const accent = done ? colors.success : late ? colors.warning : colors.brandPrimary;
  const fee = !done ? j.fee ?? 0 : 0;
  const notes = done ? stripPayNote(j.notes) : j.notes;
  return (
    <Pressable style={styles.card} onPress={onOpen} testID={`job-card-${j.id}`}>
      <View style={[styles.cardAccent, { backgroundColor: accent }]} />
      <View style={styles.cardBody}>
        <View style={styles.cardTop}>
          <Text style={styles.cardTitle} numberOfLines={2}>{j.title}</Text>
          {amount > 0 ? (
            <View style={{ alignItems: "flex-end" }}>
              <Text style={styles.cardAmount}>{money(amount)}</Text>
              {done && pay ? (
                left > 0 ? (
                  <View style={styles.udhaarMark} accessibilityLabel={`उधार ${formatINR(left)}`} testID={`job-udhaar-${j.id}`}>
                    <MaterialIcon name="clock-outline" size={11} color={semantic.due} />
                    <Text style={styles.udhaarText}>उधार</Text>
                  </View>
                ) : (
                  <MaterialIcon name="check-circle" size={14} color={semantic.received} style={{ marginTop: 3 }} accessibilityLabel="पूरे मिले" />
                )
              ) : null}
            </View>
          ) : null}
        </View>
        <View style={styles.cardMeta}>
          <View style={styles.avatar}><Text style={styles.avatarText}>{(customer.trim()[0] ?? "?").toUpperCase()}</Text></View>
          <Text style={styles.customer} numberOfLines={1}>{customer}</Text>
          <View style={[styles.dueChip, { borderColor: due.tone }]}>
            <Text style={[styles.dueText, { color: due.tone }]} numberOfLines={1}>{due.text}</Text>
          </View>
          {!done && j.status === "doing" ? <Text style={styles.doing}>चल रहा</Text> : null}
        </View>

        <View style={styles.moneyRow}>
          {!done && advance > 0 ? (
            <View style={[styles.moneyChip, { backgroundColor: semantic.receivedSoft }]} testID={`job-advance-${j.id}`}>
              <MaterialIcon name="check-circle" size={13} color={semantic.received} />
              <Text style={[styles.moneyChipText, { color: semantic.received }]}>एडवांस {money(advance)}</Text>
            </View>
          ) : null}
          {!done && advance > 0 && j.estimatedAmount > advance ? <Text style={styles.moneyHint}>बाकी {money(roundMoney(j.estimatedAmount - advance))}</Text> : null}
          {fee > 0 ? (
            <View style={[styles.moneyChip, { backgroundColor: j.feePaidOn ? semantic.dueSoft : semantic.pendingSoft }]} testID={`job-fee-${j.id}`}>
              <MaterialIcon name="receipt-text-outline" size={13} color={j.feePaidOn ? semantic.due : semantic.pending} />
              <Text style={[styles.moneyChipText, { color: j.feePaidOn ? semantic.due : semantic.pending }]}>
                फीस {money(fee)} · {j.feePaidOn ? "लग गई" : "अभी नहीं लगी"}
              </Text>
            </View>
          ) : null}
          {done && !work && j.customerId ? <Text style={styles.moneyHint}>मुफ़्त</Text> : null}
        </View>

        {notes ? <Text style={styles.notes} numberOfLines={2}>{notes}</Text> : null}

        {!done ? (
          <Pressable style={[styles.action, { backgroundColor: colors.brandPrimary }]} onPress={onComplete} testID={`complete-${j.id}`}>
            <MaterialIcon name="check" size={16} color="#fff" />
            <Text style={styles.actionText}>पूरा करें</Text>
          </Pressable>
        ) : null}
      </View>
    </Pressable>
  );
}

function SearchBox({ value, onChange, placeholder, testID }: { value: string; onChange: (v: string) => void; placeholder: string; testID: string }) {
  return (
    <View style={styles.searchWrap}>
      <MaterialIcon name="magnify" size={18} color={colors.muted} />
      <TextInput style={styles.search} value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={colors.muted} testID={testID} />
      {value ? (
        <Pressable onPress={() => onChange("")} hitSlop={8}>
          <MaterialIcon name="close-circle" size={18} color={colors.muted} />
        </Pressable>
      ) : null}
    </View>
  );
}

type TxnFilter = "all" | "given" | "payment" | "purchase" | "open";
const TXN_FILTERS: TxnFilter[] = ["all", "open", "given", "payment", "purchase"];
const TXN_LABEL: Record<TxnFilter, string> = { all: "सभी", open: "बाकी", given: "⬆ पैसे गए", payment: "⬇ पैसे आए", purchase: "सामान / सेवा" };

/** The personal book has no jobs: its tab is every rupee given, received and goods taken. */
function PersonalTxns() {
  const insets = useSafeAreaInsets();
  const customersQ = useCustomers();
  const entriesQ = useEntries();
  const allCustomers = customersQ.data;
  const allEntries = entriesQ.data;
  const names = useMemo(() => new Map((allCustomers ?? []).filter((c) => c.persona === "personal").map((c) => [c.id, c.name])), [allCustomers]);
  const entries = useMemo(() => (allEntries ?? []).filter((e) => names.has(e.customerId) && e.type !== "work" && e.type !== "aeps"), [allEntries, names]);
  const ledger = useMemo(() => buildAllLedgers(entries), [entries]);
  const [filter, setFilter] = useState<TxnFilter>("all");
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Entry | null>(null);
  const [settling, setSettling] = useState<Entry | null>(null);
  const today = todayISO();

  const left = (e: Entry) => ((e.type === "given" && !e.linkId) || e.type === "purchase" ? ledger.get(e.id)?.remaining ?? 0 : 0);
  const is = (e: Entry, f: TxnFilter) => (f === "all" ? true : f === "open" ? left(e) > 0 : e.type === f);
  const counts = useMemo(() => {
    const c = {} as Record<TxnFilter, number>;
    TXN_FILTERS.forEach((f) => { c[f] = entries.filter((e) => is(e, f)).length; });
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, ledger]);
  const needle = q.trim().toLowerCase();
  const rows = entries
    .filter((e) => is(e, filter))
    .filter((e) => !needle || (names.get(e.customerId) ?? "").toLowerCase().includes(needle) || e.description.toLowerCase().includes(needle) || e.notes.toLowerCase().includes(needle))
    .sort((a, b) => (a.date !== b.date ? b.date.localeCompare(a.date) : b.createdAt.localeCompare(a.createdAt)));

  const loading = customersQ.isLoading || entriesQ.isLoading;
  const loadFailed = !loading && ((customersQ.isError && customersQ.data == null) || (entriesQ.isError && entriesQ.data == null));
  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={{ paddingTop: insets.top + spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.md }}>
        <Text style={styles.h1}>लेन-देन</Text>
        <SearchBox value={q} onChange={setQ} placeholder="नाम या विवरण खोजें" testID="txn-search" />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingTop: spacing.md }}>
          {TXN_FILTERS.map((f) => {
            const active = filter === f;
            const warn = f === "open" && counts.open > 0;
            return (
              <Pressable hitSlop={{ top: 4, bottom: 4 }}
                key={f}
                onPress={() => setFilter(f)}
                style={[styles.chip, warn && !active && { borderColor: colors.error }, active && (warn ? { backgroundColor: colors.error, borderColor: colors.error } : styles.chipActive)]}
                testID={`txn-filter-${f}`}
              >
                <Text style={[styles.chipText, warn && !active && { color: colors.error }, active && { color: colors.onBrandPrimary }]}>
                  {TXN_LABEL[f]} ({counts[f] ?? 0})
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {loading ? (
        <View style={{ marginTop: spacing.xxl, alignItems: "center" }}><ActivityIndicator color={colors.brandPrimary} /><SlowServerHint /></View>
      ) : loadFailed ? (
        <DataLoadError onRetry={() => { customersQ.refetch(); entriesQ.refetch(); }} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(e) => e.id}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: Math.max(spacing.xxxl * 2, insets.bottom + 104), gap: spacing.sm }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <MaterialIcon name="swap-vertical" size={32} color={colors.muted} />
              <Text style={styles.emptyTitle}>{q ? "कोई नहीं मिला" : filter === "open" ? "कुछ बाकी नहीं" : "अभी कोई लेन-देन नहीं"}</Text>
              {!q && filter === "all" ? <Text style={styles.emptySub}>नीचे + दबाकर लिखें</Text> : null}
            </View>
          }
          renderItem={({ item: e }) => {
            const ui = TXN_UI[e.type as "given" | "payment" | "purchase"] ?? TXN_UI.given;
            const rest = left(e);
            const repay = e.type === "given" && !!e.linkId;
            return (
              <Pressable style={[styles.jobCard, rest > 0 && { borderLeftWidth: 4, borderLeftColor: e.type === "purchase" ? colors.warning : colors.error }]} onPress={() => setEditing(e)} testID={`txn-${e.id}`}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
                  <View style={[styles.txnIcon, { backgroundColor: ui.bg }]}>
                    <MaterialIcon name={ui.icon as any} size={18} color={ui.fg} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.jobTitle} numberOfLines={1}>{names.get(e.customerId) ?? "व्यक्ति"}</Text>
                    <Text style={styles.jobSub} numberOfLines={1}>
                      {[repay ? "⬆ पैसे गए · चुकाया" : e.type === "purchase" && !(e.paid ?? 0) ? "उधार पर लिया" : ui.label, e.description, e.date === today ? "आज" : formatDate(e.date), e.mode === "online" ? "ऑनलाइन" : ""].filter(Boolean).join(" · ")}
                    </Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    {e.type === "purchase" && !(e.paid ?? 0) ? (
                      <>
                        <Text style={[styles.txnAmt, { color: ui.fg }]}>{formatINR(e.amount)}</Text>
                        <Text style={styles.jobSub}>देने हैं</Text>
                      </>
                    ) : (
                      <>
                        <Text style={[styles.txnAmt, { color: ui.fg }]}>{e.type === "payment" ? "+" : "−"}{formatINR(e.type === "purchase" ? e.paid ?? 0 : e.amount)}</Text>
                        {e.type === "purchase" ? <Text style={styles.jobSub}>कुल {formatINR(e.amount)}</Text> : null}
                      </>
                    )}
                  </View>
                </View>
                {rest > 0 ? (
                  <Pressable
                    style={[styles.wideBtn, { backgroundColor: e.type === "purchase" ? colors.warning : colors.success, borderColor: e.type === "purchase" ? colors.warning : colors.success }]}
                    onPress={() => setSettling(e)}
                    testID={`txn-settle-${e.id}`}
                  >
                    <MaterialIcon name="cash-check" size={16} color="#fff" />
                    <Text style={[styles.smBtnText, { color: "#fff" }]}>{e.type === "purchase" ? `पैसे चुकाए · ${formatINR(rest)} देने हैं` : `वापस मिले · ${formatINR(rest)} लेने हैं`}</Text>
                  </Pressable>
                ) : null}
              </Pressable>
            );
          }}
        />
      )}

      <Pressable style={[styles.fab, { bottom: insets.bottom + 16 }]} onPress={() => setAdding(true)} testID="add-txn-fab">
        <MaterialIcon name="plus" size={26} color={colors.onBrandPrimary} />
      </Pressable>
      <AddEntrySheet visible={adding} type="given" kinds={["given", "payment", "purchase"]} onClose={() => setAdding(false)} />
      <EditRecordSheet entry={editing} onClose={() => setEditing(null)} />
      <SettleSheet work={settling} onClose={() => setSettling(null)} />
    </View>
  );
}

const TXN_UI = {
  given: { label: "⬆ पैसे गए", icon: "arrow-up-circle", fg: semantic.due, bg: semantic.dueSoft },
  payment: { label: "⬇ पैसे आए", icon: "arrow-down-circle", fg: semantic.received, bg: semantic.receivedSoft },
  purchase: { label: "सामान / सेवा", icon: "cart-outline", fg: colors.warning, bg: "#FEF3E2" },
} as const;

// Completion notes carry the payment split as it was on that day ("₹500 उधार"); the live
// status chip replaces it, so drop those parts to avoid showing stale money info.
function stripPayNote(notes: string) {
  return notes
    .split(" · ")
    .filter((p) => !/^₹[\d,.]+ (नकद मिला|उधार)$|^₹[\d,.]+ जमा, ₹[\d,.]+ उधार$/.test(p.trim()))
    .join(" · ");
}

const styles = StyleSheet.create({
  h1: { fontSize: 30, fontWeight: "700", color: colors.onSurface },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  iconBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },

  hero: { backgroundColor: colors.brandSecondary, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.md, ...elevation.mid },
  heroLabel: { fontSize: 13, fontWeight: "700", color: "rgba(255,255,255,0.75)", letterSpacing: 0.3 },
  heroValue: { fontSize: 32, fontWeight: "800", color: "#fff", fontVariant: ["tabular-nums"], flexShrink: 1 },
  heroCount: { fontSize: 14, fontWeight: "700", color: "rgba(255,255,255,0.8)" },
  heroSub: { fontSize: 12, color: "rgba(255,255,255,0.8)", marginTop: 2 },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.md },
  tile: { flexBasis: "47%", flexGrow: 1, padding: spacing.md, borderRadius: radius.md, backgroundColor: "rgba(255,255,255,0.12)", borderWidth: 1, borderColor: "rgba(255,255,255,0.14)" },
  tileOn: { backgroundColor: "#fff", borderColor: "#fff" },
  tileLabel: { fontSize: 12, fontWeight: "600", color: "rgba(255,255,255,0.85)", flexShrink: 1 },
  tileValue: { fontSize: 20, fontWeight: "800", color: "#fff", marginTop: 4, fontVariant: ["tabular-nums"] },
  tileSub: { fontSize: 11, color: "rgba(255,255,255,0.75)", marginTop: 1 },

  segment: { flexDirection: "row", backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: 4, borderWidth: 1, borderColor: colors.border },
  segBtn: { flex: 1, height: 38, borderRadius: radius.sm + 2, alignItems: "center", justifyContent: "center" },
  segBtnOn: { backgroundColor: colors.surface, ...elevation.low },
  segText: { fontSize: 13, fontWeight: "600", color: colors.muted },
  segTextOn: { color: colors.brandSecondary, fontWeight: "800" },
  activeFilter: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 4, marginTop: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.brandTertiary },
  activeFilterText: { fontSize: 12, fontWeight: "700", color: colors.brandPrimary },

  groupHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.lg, marginBottom: spacing.sm },
  groupDot: { width: 8, height: 8, borderRadius: 4 },
  groupLabel: { fontSize: 13, fontWeight: "800", color: colors.onSurfaceSecondary, letterSpacing: 0.3 },
  groupCount: { fontSize: 12, fontWeight: "700", color: colors.muted, backgroundColor: colors.surfaceTertiary, paddingHorizontal: 8, paddingVertical: 1, borderRadius: radius.pill, overflow: "hidden" },

  card: { flexDirection: "row", backgroundColor: "#fff", borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm, overflow: "hidden", ...elevation.low },
  cardAccent: { width: 4 },
  cardBody: { flex: 1, padding: spacing.md + 2 },
  cardTop: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  cardTitle: { flex: 1, minWidth: 0, fontSize: 16, fontWeight: "700", color: colors.onSurface, lineHeight: 22 },
  cardAmount: { fontSize: 16, fontWeight: "800", color: colors.onSurface, fontVariant: ["tabular-nums"] },
  udhaarMark: { flexDirection: "row", alignItems: "center", gap: 2, marginTop: 3, paddingHorizontal: 5, paddingVertical: 1, borderRadius: radius.pill, backgroundColor: semantic.dueSoft },
  udhaarText: { fontSize: 10, fontWeight: "800", color: semantic.due },
  cardMeta: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.sm },
  avatar: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 11, fontWeight: "800", color: colors.brandSecondary },
  customer: { flexShrink: 1, fontSize: 13, fontWeight: "600", color: colors.onSurfaceSecondary },
  dueChip: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  dueText: { fontSize: 11, fontWeight: "700" },
  doing: { fontSize: 11, fontWeight: "700", color: semantic.pending },
  moneyRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm, marginTop: spacing.sm },
  moneyChip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
  moneyChipText: { fontSize: 12, fontWeight: "700" },
  moneyHint: { fontSize: 12, color: colors.muted, fontWeight: "600" },
  action: { marginTop: spacing.md, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", paddingVertical: 10, borderRadius: radius.sm + 2 },
  actionText: { fontSize: 14, fontWeight: "700", color: "#fff" },

  chip: { height: 36, paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { fontSize: 13, color: colors.onSurface, fontWeight: "600" },
  searchWrap: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, paddingHorizontal: spacing.md, height: 44, borderWidth: 1, borderColor: colors.border },
  search: { flex: 1, color: colors.onSurface, fontSize: 15 },
  txnIcon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  txnAmt: { fontSize: 16, fontWeight: "800" },
  wideBtn: { marginTop: spacing.md, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", paddingVertical: 10, borderRadius: radius.md, borderWidth: 1 },
  jobCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.lg, borderWidth: 1, borderColor: colors.border },
  jobTitle: { fontSize: 15, fontWeight: "700", color: colors.onSurface },
  jobSub: { fontSize: 12, color: colors.muted, marginTop: 4 },
  notes: { fontSize: 13, color: colors.onSurfaceSecondary, marginTop: 6 },
  smBtnText: { fontSize: 13, fontWeight: "600", color: colors.onSurface },
  empty: { alignItems: "center", padding: spacing.xxl, gap: spacing.sm },
  emptyIcon: { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  emptyTitle: { fontSize: 15, fontWeight: "600", color: colors.onSurface },
  emptySub: { fontSize: 13, color: colors.muted },
  fab: { position: "absolute", right: 20, width: 56, height: 56, borderRadius: 28, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center", elevation: 4, shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
});
