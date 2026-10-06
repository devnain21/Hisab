import { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, FlatList, ScrollView, ActivityIndicator, TextInput } from "react-native";
import { useLocalSearchParams } from "expo-router";
import MaterialIcon from "@react-native-vector-icons/material-design-icons";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, spacing, radius, semantic } from "@/src/theme";
import { Pill } from "@/src/components/ui";
import { isPersonalTask, useCustomers, useJobs, useEntries, type Entry, type Job } from "@/src/lib/data";
import { formatDate, formatINR, todayISO } from "@/src/lib/format";
import { buildAllLedgers, workForJobs, type WorkStatus } from "@/src/lib/records";
import { store } from "@/src/lib/store";
import { AddEntrySheet, AddJobSheet, CompleteJobSheet, EditRecordSheet, SettleSheet } from "@/src/components/sheets";
import { Pressable } from "@/src/components/tap";
import { DataLoadError, SlowServerHint } from "@/src/components/slow-server-hint";
import { usePersona } from "@/src/lib/persona";
type Filter = "open" | "late" | "unpaid" | "all";
const FILTERS: Filter[] = ["open", "late", "unpaid", "all"];
const FILTER_LABEL: Record<Filter, string> = { open: "काम बाकी", late: "देर", unpaid: "पैसे बाकी", all: "सभी" };

function matches(j: Job, f: Filter, today: string, pay?: WorkStatus) {
  if (f === "open") return j.status !== "done";
  if (f === "late") return j.status !== "done" && j.dueDate < today;
  if (f === "unpaid") return j.status === "done" && !!pay && pay.remaining > 0;
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
  const allCustomers = customersQ.data;
  const customers = useMemo(() => (allCustomers ?? []).filter((c) => c.persona !== "personal"), [allCustomers]);
  const allJobs = jobsQ.data;
  const jobs = useMemo(() => {
    const mine = new Set(customers.map((c) => c.id));
    return (allJobs ?? []).filter((j) => (!j.customerId && !isPersonalTask(j)) || mine.has(j.customerId));
  }, [allJobs, customers]);
  const entries = entriesQ.data ?? [];
  const [filter, setFilter] = useState<Filter>("open");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [completing, setCompleting] = useState<Job | null>(null);
  const [editing, setEditing] = useState<Job | null>(null);
  const [settling, setSettling] = useState<Entry | null>(null);
  const today = todayISO();

  const ledger = useMemo(() => buildAllLedgers(entries), [entries]);
  const workOf = useMemo(() => workForJobs(jobs.filter((j) => j.status === "done"), entries), [jobs, entries]);
  const payOf = (j: Job) => {
    const w = workOf.get(j.id);
    return w ? ledger.get(w.id) : undefined;
  };

  useEffect(() => {
    if (params.filter && FILTERS.includes(params.filter)) setFilter(params.filter);
  }, [params.filter, params.t]);

  const nameById = useMemo(() => new Map(customers.map((c) => [c.id, c.name])), [customers]);
  const nameOf = (id: string) => (id ? nameById.get(id) ?? "ग्राहक" : "खुद का काम");
  // Own tasks have no money side, so finishing one is a single tap.
  const complete = (j: Job) => (j.customerId ? setCompleting(j) : store.updateJob(j.id, { status: "done", dueDate: today }));

  const counts = useMemo(() => {
    const c = {} as Record<Filter, number>;
    FILTERS.forEach((f) => { c[f] = jobs.filter((j) => matches(j, f, today, payOf(j))).length; });
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs, today, ledger, workOf]);

  const todayCount = useMemo(() => jobs.filter((j) => j.status !== "done" && j.dueDate === today).length, [jobs, today]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return jobs
      .filter((j) => matches(j, filter, today, payOf(j)))
      .filter((j) => !needle || j.title.toLowerCase().includes(needle) || nameOf(j.customerId).toLowerCase().includes(needle) || j.notes.toLowerCase().includes(needle))
      .sort((a, b) => {
        if (a.status === "done" && b.status !== "done") return 1;
        if (a.status !== "done" && b.status === "done") return -1;
        return a.status === "done" ? b.dueDate.localeCompare(a.dueDate) : a.dueDate.localeCompare(b.dueDate);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs, filter, today, ledger, workOf, q, customers]);

  const openValue = useMemo(() => jobs.filter((j) => j.status !== "done").reduce((s, j) => s + (j.estimatedAmount || 0), 0), [jobs]);

  const loading = jobsQ.isLoading;
  const loadFailed = !loading && ((jobsQ.isError && jobsQ.data == null) || (customersQ.isError && customersQ.data == null) || (entriesQ.isError && entriesQ.data == null));

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={{ paddingTop: insets.top + spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.md }}>
        <Text style={styles.h1}>काम</Text>
        <SearchBox value={q} onChange={setQ} placeholder="काम या ग्राहक खोजें" testID="work-search" />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingTop: spacing.md }}>
          {FILTERS.filter((f) => f === "open" || f === "all" || counts[f] > 0 || filter === f).map((f) => {
            const active = filter === f;
            const warn = (f === "late" || f === "unpaid") && counts[f] > 0;
            return (
              <Pressable
                key={f}
                onPress={() => setFilter(f)}
                style={[styles.chip, warn && !active && { borderColor: colors.error }, active && (warn ? { backgroundColor: colors.error, borderColor: colors.error } : styles.chipActive)]}
                testID={`work-filter-${f}`}
              >
                <Text style={[styles.chipText, warn && !active && { color: colors.error }, active && { color: colors.onBrandPrimary }]}>
                  {FILTER_LABEL[f]} ({counts[f] ?? 0})
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
        {!loading && (filter === "open" || filter === "late") ? (
          <Text style={styles.summary} testID="work-summary">
            <Text onPress={() => setFilter("open")} style={filter === "open" ? styles.summaryOn : undefined}>{counts.open} काम बाकी</Text>
            {" · "}
            <Text>आज {todayCount}</Text>
            {counts.late > 0 ? <Text onPress={() => setFilter("late")} style={{ color: colors.error, fontWeight: "700" }}> · {counts.late} देर से</Text> : null}
            {openValue > 0 ? ` · अनुमानित ${formatINR(openValue)}` : ""}
          </Text>
        ) : null}
      </View>

      {loading ? (
        <View style={{ marginTop: spacing.xxl, alignItems: "center" }}><ActivityIndicator color={colors.brandPrimary} /><SlowServerHint /></View>
      ) : loadFailed ? (
        <DataLoadError onRetry={() => { jobsQ.refetch(); customersQ.refetch(); entriesQ.refetch(); }} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(j) => j.id}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: Math.max(spacing.xxxl * 2, insets.bottom + 104), gap: spacing.sm }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <MaterialIcon name="briefcase-outline" size={32} color={colors.muted} />
              <Text style={styles.emptyTitle}>{q ? "कोई नहीं मिला" : filter === "late" ? "कोई काम देर से नहीं" : "कोई काम सूची में नहीं"}</Text>
              {filter !== "late" && !q ? <Text style={styles.emptySub}>नीचे + दबाकर काम जोड़ें</Text> : null}
            </View>
          }
          renderItem={({ item: j, index }) => {
            const overdue = j.status !== "done" && j.dueDate < today;
            const pay = j.status === "done" ? payOf(j) : undefined;
            const work = workOf.get(j.id);
            const notes = pay ? stripPayNote(j.notes) : j.notes;
            return (
              <Animated.View entering={FadeInDown.delay(Math.min(index, 8) * 40).duration(250)}>
                <Pressable style={[styles.jobCard, overdue && { borderLeftWidth: 4, borderLeftColor: colors.error }]} onPress={() => setEditing(j)} testID={`job-card-${j.id}`}>
                  <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "center" }}>
                    <Text style={[styles.jobTitle, { flex: 1, minWidth: 0 }]} numberOfLines={2}>{j.title}</Text>
                    {pay ? <PayPill pay={pay} /> : <StatusPill status={j.status} free={j.status === "done" && !!j.customerId && !work} />}
                  </View>
                  <Text style={[styles.jobSub, overdue && { color: colors.error }]}>
                    {nameOf(j.customerId)} · {j.dueDate === today ? "आज" : formatDate(j.dueDate)}{overdue ? " (देर)" : ""}
                    {j.estimatedAmount > 0 ? ` · ${formatINR(j.estimatedAmount)}` : ""}
                  </Text>
                  {notes ? <Text style={styles.notes}>{notes}</Text> : null}
                  {pay && work && pay.remaining > 0 ? (
                    <Pressable style={[styles.wideBtn, { backgroundColor: colors.success, borderColor: colors.success }]} onPress={() => setSettling(work)} testID={`settle-job-${j.id}`}>
                      <MaterialIcon name="cash-check" size={16} color="#fff" />
                      <Text style={[styles.smBtnText, { color: "#fff" }]}>पैसे मिले · {formatINR(pay.remaining)}</Text>
                    </Pressable>
                  ) : j.status !== "done" ? (
                    <Pressable style={[styles.wideBtn, { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary }]} onPress={() => complete(j)} testID={`complete-${j.id}`}>
                      <MaterialIcon name="check" size={16} color={colors.onBrandPrimary} />
                      <Text style={[styles.smBtnText, { color: colors.onBrandPrimary }]}>पूरा करें</Text>
                    </Pressable>
                  ) : null}
                </Pressable>
              </Animated.View>
            );
          }}
        />
      )}

      <Pressable style={[styles.fab, { bottom: insets.bottom + 16 }]} onPress={() => setOpen(true)} testID="add-job-fab">
        <MaterialIcon name="plus" size={26} color={colors.onBrandPrimary} />
      </Pressable>

      <AddJobSheet visible={open} onClose={() => setOpen(false)} />
      <CompleteJobSheet job={completing} onClose={() => setCompleting(null)} />
      <EditRecordSheet job={editing} onClose={() => setEditing(null)} />
      <SettleSheet work={settling} onClose={() => setSettling(null)} />
    </View>
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
              <Pressable
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
// status pill replaces it, so drop those parts to avoid showing stale money info.
function stripPayNote(notes: string) {
  return notes
    .split(" · ")
    .filter((p) => !/^₹[\d,.]+ (नकद मिला|उधार)$|^₹[\d,.]+ जमा, ₹[\d,.]+ उधार$/.test(p.trim()))
    .join(" · ");
}

function PayPill({ pay }: { pay: WorkStatus }) {
  const map = {
    cash: { bg: semantic.receivedSoft, fg: semantic.received, label: "नकद", icon: undefined },
    settled: { bg: semantic.receivedSoft, fg: semantic.received, label: "चुकता", icon: "check" as const },
    partial: { bg: semantic.pendingSoft, fg: semantic.pending, label: "कुछ बाकी", icon: undefined },
    pending: { bg: semantic.dueSoft, fg: semantic.due, label: "पैसे बाकी", icon: undefined },
  } as const;
  const s = map[pay.state];
  return <Pill label={s.label} color={s.fg} background={s.bg} icon={s.icon} />;
}

function StatusPill({ status, free }: { status: Job["status"]; free?: boolean }) {
  const map = {
    pending: { bg: colors.surfaceTertiary, fg: colors.onSurfaceTertiary, label: "काम बाकी" },
    doing: { bg: semantic.pendingSoft, fg: semantic.pending, label: "चल रहा" },
    done: { bg: semantic.receivedSoft, fg: semantic.received, label: free ? "मुफ़्त" : "पूरा" },
  } as const;
  const s = map[status];
  return <Pill label={s.label} color={s.fg} background={s.bg} />;
}

const styles = StyleSheet.create({
  h1: { fontSize: 30, fontWeight: "700", color: colors.onSurface },
  sub: { fontSize: 13, color: colors.muted, marginTop: 2 },
  chip: { height: 36, paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { fontSize: 13, color: colors.onSurface, fontWeight: "600" },
  summary: { fontSize: 13, color: colors.onSurfaceSecondary, marginTop: spacing.md },
  summaryOn: { fontWeight: "800", color: colors.onSurface },
  searchWrap: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, paddingHorizontal: spacing.md, height: 44, borderWidth: 1, borderColor: colors.border },
  search: { flex: 1, color: colors.onSurface, fontSize: 15 },
  txnIcon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  txnAmt: { fontSize: 16, fontWeight: "800" },
  wideBtn: { marginTop: spacing.md, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", paddingVertical: 10, borderRadius: radius.md, borderWidth: 1 },
  jobCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.lg, borderWidth: 1, borderColor: colors.border },
  jobTitle: { fontSize: 15, fontWeight: "700", color: colors.onSurface },
  jobSub: { fontSize: 12, color: colors.muted, marginTop: 4 },
  notes: { fontSize: 13, color: colors.onSurfaceSecondary, marginTop: 6 },
  smBtn: { flexDirection: "row", gap: 4, paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  smBtnText: { fontSize: 13, fontWeight: "600", color: colors.onSurface },
  empty: { alignItems: "center", padding: spacing.xxl, gap: spacing.sm },
  emptyTitle: { fontSize: 15, fontWeight: "600", color: colors.onSurface },
  emptySub: { fontSize: 13, color: colors.muted },
  fab: { position: "absolute", right: 20, width: 56, height: 56, borderRadius: 28, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center", elevation: 4, shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
});
