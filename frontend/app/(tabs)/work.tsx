import { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, FlatList, ScrollView, ActivityIndicator } from "react-native";
import { useLocalSearchParams } from "expo-router";
import MaterialIcon from "@react-native-vector-icons/material-design-icons";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, spacing, radius } from "@/src/theme";
import { useCustomers, useJobs, useEntries, type Entry, type Job } from "@/src/lib/data";
import { formatDate, formatINR, todayISO } from "@/src/lib/format";
import { buildAllLedgers, workForJob, type WorkStatus } from "@/src/lib/records";
import { store } from "@/src/lib/store";
import { AddJobSheet, CompleteJobSheet, EditRecordSheet, SettleSheet } from "@/src/components/sheets";
import { Pressable } from "@/src/components/tap";
import { SlowServerHint } from "@/src/components/slow-server-hint";
type Filter = "open" | "late" | "today" | "unpaid" | "done" | "all";
const FILTERS: Filter[] = ["open", "late", "today", "unpaid", "done", "all"];
const CHIPS: Filter[] = ["open", "done"];
const FILTER_LABEL: Record<Filter, string> = { open: "काम बाकी", late: "देर", today: "आज", unpaid: "लेने हैं", done: "पूरा", all: "सभी" };

function matches(j: Job, f: Filter, today: string, pay?: WorkStatus) {
  if (f === "open") return j.status !== "done";
  if (f === "late") return j.status !== "done" && j.dueDate < today;
  if (f === "today") return j.status !== "done" && j.dueDate === today;
  if (f === "unpaid") return j.status === "done" && !!pay && pay.remaining > 0;
  if (f === "done") return j.status === "done";
  return true;
}

export default function WorkScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ filter?: Filter; t?: string }>();
  const customersQ = useCustomers();
  const jobsQ = useJobs();
  const entriesQ = useEntries();
  const customers = customersQ.data ?? [];
  const jobs = jobsQ.data ?? [];
  const entries = entriesQ.data ?? [];
  const [filter, setFilter] = useState<Filter>("open");
  const [open, setOpen] = useState(false);
  const [completing, setCompleting] = useState<Job | null>(null);
  const [editing, setEditing] = useState<Job | null>(null);
  const [settling, setSettling] = useState<Entry | null>(null);
  const today = todayISO();

  const ledger = useMemo(() => buildAllLedgers(entries), [entries]);
  const workOf = useMemo(() => {
    const m = new Map<string, Entry>();
    jobs.forEach((j) => {
      if (j.status !== "done") return;
      const w = workForJob(j, entries);
      if (w) m.set(j.id, w);
    });
    return m;
  }, [jobs, entries]);
  const payOf = (j: Job) => {
    const w = workOf.get(j.id);
    return w ? ledger.get(w.id) : undefined;
  };

  useEffect(() => {
    if (params.filter && FILTERS.includes(params.filter)) setFilter(params.filter);
  }, [params.filter, params.t]);

  const nameOf = (id: string) => (id ? customers.find((c) => c.id === id)?.name ?? "ग्राहक" : "खुद का काम");
  // Own tasks have no money side, so finishing one is a single tap.
  const complete = (j: Job) => (j.customerId ? setCompleting(j) : store.updateJob(j.id, { status: "done", dueDate: today }));

  const counts = useMemo(() => {
    const c = {} as Record<Filter, number>;
    FILTERS.forEach((f) => { c[f] = jobs.filter((j) => matches(j, f, today, payOf(j))).length; });
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs, today, ledger, workOf]);

  const unpaidTotal = useMemo(
    () => jobs.reduce((s, j) => s + (j.status === "done" ? payOf(j)?.remaining ?? 0 : 0), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [jobs, ledger, workOf],
  );

  const rows = useMemo(() => {
    return jobs
      .filter((j) => matches(j, filter, today, payOf(j)))
      .sort((a, b) => {
        if (a.status === "done" && b.status !== "done") return 1;
        if (a.status !== "done" && b.status === "done") return -1;
        return a.status === "done" ? b.dueDate.localeCompare(a.dueDate) : a.dueDate.localeCompare(b.dueDate);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs, filter, today, ledger, workOf]);

  const openValue = useMemo(() => jobs.filter((j) => j.status !== "done").reduce((s, j) => s + (j.estimatedAmount || 0), 0), [jobs]);

  const loading = jobsQ.isLoading;

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={{ paddingTop: insets.top + spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.md }}>
        <Text style={styles.h1}>काम</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingTop: spacing.md }}>
          {CHIPS.map((f) => {
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
        {!loading && (filter === "open" || filter === "late" || filter === "today") ? (
          <Text style={styles.summary} testID="work-summary">
            <Text onPress={() => setFilter("open")} style={filter === "open" ? styles.summaryOn : undefined}>{counts.open} काम बाकी</Text>
            {" · "}
            <Text onPress={() => setFilter("today")} style={filter === "today" ? styles.summaryOn : undefined}>आज {counts.today}</Text>
            {counts.late > 0 ? <Text onPress={() => setFilter("late")} style={{ color: colors.error, fontWeight: "700" }}> · {counts.late} देर से</Text> : null}
            {openValue > 0 ? ` · अनुमानित ${formatINR(openValue)}` : ""}
          </Text>
        ) : null}
        {!loading && filter === "unpaid" && unpaidTotal > 0 ? (
          <Text style={styles.summary} testID="work-unpaid-summary">
            पूरे हो चुके काम पर <Text style={{ color: colors.error, fontWeight: "800" }}>{formatINR(unpaidTotal)}</Text> लेने हैं
          </Text>
        ) : null}
      </View>

      {loading ? (
        <View style={{ marginTop: spacing.xxl, alignItems: "center" }}><ActivityIndicator color={colors.brandPrimary} /><SlowServerHint /></View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(j) => j.id}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl * 2, gap: spacing.sm }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <MaterialIcon name="briefcase-outline" size={32} color={colors.muted} />
              <Text style={styles.emptyTitle}>{filter === "late" ? "कोई काम देर से नहीं" : "कोई काम सूची में नहीं"}</Text>
              {filter !== "late" ? <Text style={styles.emptySub}>नीचे + दबाकर काम जोड़ें</Text> : null}
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
                    <Text style={[styles.jobTitle, { flex: 1 }]} numberOfLines={2}>{j.title}</Text>
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
    cash: { bg: colors.successSoft, fg: colors.success, label: "नकद" },
    settled: { bg: colors.successSoft, fg: colors.success, label: "✔ चुकता" },
    partial: { bg: "#FEF3E2", fg: colors.warning, label: `${formatINR(pay.remaining)} लेने हैं` },
    pending: { bg: colors.errorSoft, fg: colors.error, label: "लेने हैं" },
  } as const;
  const s = map[pay.state];
  return (
    <View style={{ paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: s.bg }}>
      <Text style={{ fontSize: 11, fontWeight: "800", color: s.fg }}>{s.label}</Text>
    </View>
  );
}

function StatusPill({ status, free }: { status: Job["status"]; free?: boolean }) {
  const map = {
    pending: { bg: colors.surfaceTertiary, fg: colors.onSurfaceTertiary, label: "काम बाकी" },
    doing: { bg: colors.errorSoft, fg: colors.error, label: "चल रहा" },
    done: { bg: colors.successSoft, fg: colors.success, label: free ? "मुफ़्त" : "पूरा" },
  } as const;
  const s = map[status];
  return (
    <View style={{ paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: s.bg }}>
      <Text style={{ fontSize: 11, fontWeight: "700", color: s.fg }}>{s.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  h1: { fontSize: 30, fontWeight: "700", color: colors.onSurface },
  sub: { fontSize: 13, color: colors.muted, marginTop: 2 },
  chip: { height: 36, paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { fontSize: 13, color: colors.onSurface, fontWeight: "600" },
  summary: { fontSize: 13, color: colors.onSurfaceSecondary, marginTop: spacing.md },
  summaryOn: { fontWeight: "800", color: colors.onSurface },
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
