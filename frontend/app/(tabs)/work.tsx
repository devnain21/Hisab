import { useMemo, useState } from "react";
import { View, Text, StyleSheet, FlatList, ScrollView, ActivityIndicator } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import MaterialIcon from "@react-native-vector-icons/material-design-icons";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, spacing, radius } from "@/src/theme";
import { useCustomers, useJobs, useEntries, type Job } from "@/src/lib/data";
import { api } from "@/src/lib/api";
import { formatDate, formatINR, todayISO } from "@/src/lib/format";
import { AddJobSheet, CompleteJobSheet } from "@/src/components/sheets";
import { Pressable } from "@/src/components/tap";
import { confirmAction } from "@/src/lib/confirm";

type Filter = "open" | "done" | "all";

export default function WorkScreen() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const customersQ = useCustomers();
  const jobsQ = useJobs();
  useEntries();
  const customers = customersQ.data ?? [];
  const jobs = jobsQ.data ?? [];
  const [filter, setFilter] = useState<Filter>("open");
  const [open, setOpen] = useState(false);
  const [completing, setCompleting] = useState<Job | null>(null);
  const today = todayISO();

  const nameOf = (id: string) => customers.find((c) => c.id === id)?.name ?? "ग्राहक";

  const rows = useMemo(() => {
    return jobs
      .filter((j) => filter === "open" ? j.status !== "done" : filter === "done" ? j.status === "done" : true)
      .sort((a, b) => {
        if (a.status === "done" && b.status !== "done") return 1;
        if (a.status !== "done" && b.status === "done") return -1;
        return a.status === "done" ? b.dueDate.localeCompare(a.dueDate) : a.dueDate.localeCompare(b.dueDate);
      });
  }, [jobs, filter]);

  const start = async (j: Job) => {
    await api.updateJob(j.id, { status: "doing" });
    qc.invalidateQueries({ queryKey: ["jobs"] });
  };

  const del = (j: Job) => {
    confirmAction("काम हटाएँ?", j.title, "हटा दें", async () => {
      await api.deleteJob(j.id);
      qc.invalidateQueries({ queryKey: ["jobs"] });
    });
  };

  const loading = jobsQ.isLoading;

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={{ paddingTop: insets.top + spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.md }}>
        <Text style={styles.h1}>काम</Text>
        <Text style={styles.sub}>अभी किया काम लिखें या आगे का काम याद रखें।</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingTop: spacing.md }}>
          {(["open", "done", "all"] as Filter[]).map((f) => (
            <Pressable key={f} onPress={() => setFilter(f)} style={[styles.chip, filter === f && styles.chipActive]} testID={`work-filter-${f}`}>
              <Text style={[styles.chipText, filter === f && { color: colors.onBrandPrimary }]}>
                {f === "open" ? "बाकी / आगे का" : f === "done" ? "पूरा" : "सभी"}
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
          keyExtractor={(j) => j.id}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl * 2, gap: spacing.sm }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <MaterialIcon name="briefcase-outline" size={32} color={colors.muted} />
              <Text style={styles.emptyTitle}>कोई काम सूची में नहीं</Text>
              <Text style={styles.emptySub}>नीचे + दबाकर काम जोड़ें</Text>
            </View>
          }
          renderItem={({ item: j, index }) => {
            const overdue = j.status !== "done" && j.dueDate < today;
            return (
              <Animated.View entering={FadeInDown.delay(Math.min(index, 8) * 40).duration(250)} style={styles.jobCard} testID={`job-card-${j.id}`}>
                <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "center", flexWrap: "wrap" }}>
                  <Text style={styles.jobTitle}>{j.title}</Text>
                  <StatusPill status={j.status} />
                </View>
                <Text style={[styles.jobSub, overdue && { color: colors.error }]}>
                  {nameOf(j.customerId)} · {j.dueDate === today ? "आज" : formatDate(j.dueDate)}{overdue ? " (देर)" : ""}
                  {j.estimatedAmount > 0 ? ` · ${formatINR(j.estimatedAmount)}` : ""}
                </Text>
                {j.notes ? <Text style={styles.notes}>{j.notes}</Text> : null}
                <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.md }}>
                  {j.status === "pending" && (
                    <Pressable style={styles.smBtn} onPress={() => start(j)} testID={`start-${j.id}`}>
                      <MaterialIcon name="play-outline" size={16} color={colors.onSurface} />
                      <Text style={styles.smBtnText}>शुरू करें</Text>
                    </Pressable>
                  )}
                  {j.status !== "done" && (
                    <Pressable style={[styles.smBtn, { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary }]} onPress={() => setCompleting(j)} testID={`complete-${j.id}`}>
                      <MaterialIcon name="check" size={16} color={colors.onBrandPrimary} />
                      <Text style={[styles.smBtnText, { color: colors.onBrandPrimary }]}>पूरा करें</Text>
                    </Pressable>
                  )}
                  <View style={{ flex: 1 }} />
                  <Pressable style={[styles.smBtn, { paddingHorizontal: 12 }]} onPress={() => del(j)} testID={`del-${j.id}`}>
                    <MaterialIcon name="trash-can-outline" size={18} color={colors.error} />
                  </Pressable>
                </View>
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
    </View>
  );
}

function StatusPill({ status }: { status: Job["status"] }) {
  const map = {
    pending: { bg: colors.surfaceTertiary, fg: colors.onSurfaceTertiary, label: "बाकी" },
    doing: { bg: colors.errorSoft, fg: colors.error, label: "चल रहा" },
    done: { bg: colors.successSoft, fg: colors.success, label: "पूरा" },
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
