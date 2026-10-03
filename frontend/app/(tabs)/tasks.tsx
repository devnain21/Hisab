import { useMemo, useState } from "react";
import { View, Text, StyleSheet, SectionList, TextInput, ScrollView, ActivityIndicator } from "react-native";
import MaterialIcon from "@react-native-vector-icons/material-design-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radius, spacing } from "@/src/theme";
import { Pressable } from "@/src/components/tap";
import { DataLoadError, SlowServerHint } from "@/src/components/slow-server-hint";
import { TaskSheet } from "@/src/components/task-sheet";
import { TaskRow } from "@/src/components/task-row";
import { store } from "@/src/lib/store";
import { confirmAction } from "@/src/lib/confirm";
import { todayISO } from "@/src/lib/format";
import { GROUP_LABEL, groupTasks, taskGroup, usePersonalTasks } from "@/src/lib/tasks";
import type { Job } from "@/src/lib/data";

type Filter = "open" | "today" | "high" | "done" | "all";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "open", label: "बाकी" },
  { key: "today", label: "आज" },
  { key: "high", label: "ज़रूरी" },
  { key: "done", label: "पूरे" },
  { key: "all", label: "सभी" },
];

export default function TasksScreen() {
  const insets = useSafeAreaInsets();
  const { tasks, query } = usePersonalTasks();
  const today = todayISO();
  const [filter, setFilter] = useState<Filter>("open");
  const [q, setQ] = useState("");
  const [quick, setQuick] = useState("");
  const [sheet, setSheet] = useState<{ initial?: Job; draft?: string } | null>(null);

  const is = (t: Job, f: Filter) => {
    const g = taskGroup(t, today);
    if (f === "open") return g !== "done";
    if (f === "today") return g === "today" || g === "late";
    if (f === "high") return g !== "done" && t.priority === "high";
    if (f === "done") return g === "done";
    return true;
  };

  const counts = useMemo(() => {
    const c = {} as Record<Filter, number>;
    FILTERS.forEach(({ key }) => { c[key] = tasks.filter((t) => is(t, key)).length; });
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, today]);
  const lateCount = useMemo(() => tasks.filter((t) => taskGroup(t, today) === "late").length, [tasks, today]);

  const sections = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = tasks.filter((t) => is(t, filter) && (!needle || t.title.toLowerCase().includes(needle) || t.notes.toLowerCase().includes(needle)));
    return groupTasks(list, today).map((s) => ({ ...s, title: GROUP_LABEL[s.group] }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, filter, q, today]);

  const addQuick = () => {
    const title = quick.trim();
    if (!title) return;
    store.createJob({ customerId: "", title, dueDate: "", estimatedAmount: 0, notes: "", persona: "personal", priority: "", time: "" });
    setQuick("");
  };

  const toggle = (t: Job) => store.updateJob(t.id, { status: t.status === "done" ? "pending" : "done" });

  const clearDone = () => {
    const done = tasks.filter((t) => t.status === "done");
    if (!done.length) return;
    confirmAction("पूरे हुए काम हटाएँ?", `${done.length} पूरे हुए काम सूची से हट जाएँगे।`, "हटाएँ", () => done.forEach((t) => store.deleteJob(t.id)));
  };

  const loading = query.isLoading;
  const failed = !loading && query.isError && query.data == null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={{ paddingTop: insets.top + spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm }}>
        <Text style={styles.h1}>मेरे काम</Text>
        <Text style={styles.sub}>
          {counts.open ? `${counts.open} बाकी` : "कोई काम बाकी नहीं"}
          {lateCount ? <Text style={{ color: colors.error, fontWeight: "700" }}> · {lateCount} देर से</Text> : null}
        </Text>

        <View style={styles.quickRow}>
          <TextInput
            style={styles.quickInput}
            value={quick}
            onChangeText={setQuick}
            placeholder="नया काम लिखें…"
            placeholderTextColor={colors.muted}
            returnKeyType="done"
            onSubmitEditing={addQuick}
            maxLength={200}
            testID="task-quick-input"
          />
          <Pressable style={styles.quickMore} onPress={() => setSheet({ draft: quick.trim() })} hitSlop={6} testID="task-quick-more">
            <MaterialIcon name="tune-variant" size={20} color={colors.brandPrimary} />
          </Pressable>
          <Pressable style={[styles.quickAdd, !quick.trim() && { opacity: 0.4 }]} onPress={addQuick} disabled={!quick.trim()} testID="task-quick-add">
            <MaterialIcon name="plus" size={22} color={colors.onBrandPrimary} />
          </Pressable>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingTop: spacing.md }}>
          {FILTERS.map(({ key, label }) => {
            const active = filter === key;
            return (
              <Pressable key={key} onPress={() => setFilter(key)} style={[styles.chip, active && styles.chipActive]} testID={`task-filter-${key}`}>
                <Text style={[styles.chipText, active && { color: colors.onBrandPrimary }]}>{label} ({counts[key] ?? 0})</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {tasks.length > 6 ? (
          <View style={styles.searchWrap}>
            <MaterialIcon name="magnify" size={18} color={colors.muted} />
            <TextInput style={styles.search} value={q} onChangeText={setQ} placeholder="काम खोजें" placeholderTextColor={colors.muted} testID="task-search" />
            {q ? (
              <Pressable onPress={() => setQ("")} hitSlop={8}><MaterialIcon name="close-circle" size={18} color={colors.muted} /></Pressable>
            ) : null}
          </View>
        ) : null}
      </View>

      {loading ? (
        <View style={{ marginTop: spacing.xxl, alignItems: "center" }}><ActivityIndicator color={colors.brandPrimary} /><SlowServerHint /></View>
      ) : failed ? (
        <DataLoadError onRetry={() => query.refetch()} />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(t) => t.id}
          keyboardShouldPersistTaps="handled"
          stickySectionHeadersEnabled={false}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: Math.max(spacing.xxxl * 2, insets.bottom + 104) }}
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHead}>
              <Text style={[styles.sectionTitle, section.group === "late" && { color: colors.error }]}>
                {section.title} · {section.data.length}
              </Text>
              {section.group === "done" ? (
                <Pressable onPress={clearDone} hitSlop={8} testID="task-clear-done">
                  <Text style={styles.clearText}>सब हटाएँ</Text>
                </Pressable>
              ) : null}
            </View>
          )}
          renderItem={({ item: t }) => (
            <View style={{ marginBottom: spacing.sm }}>
              <TaskRow task={t} today={today} onToggle={() => toggle(t)} onOpen={() => setSheet({ initial: t })} />
            </View>
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <MaterialIcon name="clipboard-check-outline" size={40} color={colors.muted} />
              <Text style={styles.emptyTitle}>
                {q ? "कुछ नहीं मिला" : filter === "done" ? "अभी कोई काम पूरा नहीं हुआ" : filter === "open" || filter === "all" ? "कोई काम बाकी नहीं" : "इस सूची में कुछ नहीं"}
              </Text>
              {!q && (filter === "open" || filter === "all") ? <Text style={styles.emptySub}>ऊपर लिखकर + दबाएँ, या नीचे के बटन से तारीख व समय के साथ जोड़ें</Text> : null}
            </View>
          }
        />
      )}

      <Pressable style={[styles.fab, { bottom: insets.bottom + 16 }]} onPress={() => setSheet({})} testID="add-task-fab">
        <MaterialIcon name="plus" size={26} color={colors.onBrandPrimary} />
      </Pressable>

      <TaskSheet visible={sheet !== null} initial={sheet?.initial} draft={sheet?.draft} onSaved={() => { if (sheet?.draft !== undefined) setQuick(""); }} onClose={() => setSheet(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  h1: { fontSize: 30, fontWeight: "700", color: colors.onSurface },
  sub: { fontSize: 13, color: colors.muted, marginTop: 2 },
  quickRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.md },
  quickInput: { flex: 1, height: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary, paddingHorizontal: spacing.md, fontSize: 15, color: colors.onSurface },
  quickMore: { width: 44, height: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceSecondary },
  quickAdd: { width: 48, height: 48, borderRadius: radius.md, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  chip: { height: 36, paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { fontSize: 13, color: colors.onSurface, fontWeight: "600" },
  searchWrap: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, paddingHorizontal: spacing.md, height: 42, borderWidth: 1, borderColor: colors.border },
  search: { flex: 1, color: colors.onSurface, fontSize: 15 },
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.md, marginBottom: spacing.sm },
  sectionTitle: { fontSize: 13, fontWeight: "800", color: colors.onSurfaceSecondary },
  clearText: { fontSize: 12, fontWeight: "700", color: colors.error },
  empty: { alignItems: "center", padding: spacing.xxl, gap: spacing.sm },
  emptyTitle: { fontSize: 15, fontWeight: "600", color: colors.onSurface, textAlign: "center" },
  emptySub: { fontSize: 13, color: colors.muted, textAlign: "center" },
  fab: { position: "absolute", right: 20, width: 56, height: 56, borderRadius: 28, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center", elevation: 4, shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
});
