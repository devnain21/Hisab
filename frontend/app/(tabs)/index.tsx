import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { Pressable } from "@/src/components/tap";
import { SlowServerHint } from "@/src/components/slow-server-hint";
import { useState, useMemo } from "react";
import { useRouter } from "expo-router";
import MaterialIcon from "@react-native-vector-icons/material-design-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, spacing, radius } from "@/src/theme";
import { useCustomers, useEntries, useJobs, computeBalance } from "@/src/lib/data";
import { formatDate, formatDateShort, formatINR, formatWeekdayDate, initials, todayISO } from "@/src/lib/format";
import { AddEntrySheet, AddCustomerSheet, AddJobSheet } from "@/src/components/sheets";
import { useAuth } from "@/src/context/AuthContext";
import { usePendingCount } from "@/src/lib/store";

export default function Home() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const customersQ = useCustomers();
  const entriesQ = useEntries();
  const jobsQ = useJobs();
  const [entrySheet, setEntrySheet] = useState<"work" | "payment" | null>(null);
  const [custSheet, setCustSheet] = useState(false);
  const [jobSheet, setJobSheet] = useState(false);
  const { user } = useAuth();
  const pending = usePendingCount();

  const today = todayISO();
  const customers = customersQ.data ?? [];
  const entries = entriesQ.data ?? [];
  const jobs = jobsQ.data ?? [];

  const stats = useMemo(() => {
    const totalDue = computeBalance(entries);
    const todayWork = entries.filter((e) => e.date === today && e.type === "work").reduce((n, e) => n + e.amount, 0);
    const todayPay = entries.filter((e) => e.date === today && e.type === "payment").reduce((n, e) => n + e.amount, 0);
    const openJobs = jobs.filter((j) => j.status !== "done").length;
    return { totalDue, todayWork, todayPay, openJobs };
  }, [entries, jobs, today]);

  const topDue = useMemo(
    () => customers
      .map((c) => ({ c, due: computeBalance(entries, c.id) }))
      .filter((x) => x.due > 0).sort((a, b) => b.due - a.due).slice(0, 5),
    [customers, entries]
  );
  const recent = useMemo(
    () => [...entries].sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : (a.createdAt < b.createdAt ? 1 : -1))).slice(0, 6),
    [entries]
  );
  const upcoming = useMemo(
    () => jobs.filter((j) => j.status !== "done").sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 3),
    [jobs]
  );

  const loading = customersQ.isLoading || entriesQ.isLoading || jobsQ.isLoading;
  const nameOf = (id: string) => customers.find((c) => c.id === id)?.name ?? "ग्राहक";

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingTop: insets.top + spacing.md, paddingBottom: spacing.xxl }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.eyebrow}>{formatWeekdayDate(today)}</Text>
        <Text style={styles.h1} numberOfLines={2} testID="shop-name">{user?.shop_name || "आज का खाता"}</Text>
        <Text style={styles.sub}>बही खाता — उधार, जमा और काम</Text>
        {pending > 0 ? (
          <View style={styles.pendingPill} testID="home-sync-pending">
            <MaterialIcon name="cloud-upload-outline" size={14} color={colors.warning} />
            <Text style={styles.pendingText}>{pending} बदलाव फ़ोन में सेव, इंटरनेट आने पर सिंक होंगे</Text>
          </View>
        ) : null}

        {loading ? (
          <View style={{ marginTop: spacing.xxl, alignItems: "center" }}>
            <ActivityIndicator color={colors.brandPrimary} />
            <SlowServerHint />
          </View>
        ) : (
          <Animated.View entering={FadeInDown.duration(300)}>
            <View style={styles.statsGrid}>
              <StatCard label="कुल बकाया" value={formatINR(Math.max(stats.totalDue, 0))} tone="due" testID="stat-total-due" />
              <StatCard label="पेंडिंग काम" value={String(stats.openJobs)} tone="neutral" testID="stat-pending-jobs" />
              <StatCard label="आज का काम" value={formatINR(stats.todayWork)} tone="neutral" testID="stat-today-work" />
              <StatCard label="आज की जमा" value={formatINR(stats.todayPay)} tone="ok" testID="stat-today-pay" />
            </View>

            <View style={styles.actionsRow}>
              <ActionBtn label="काम लिखें" icon="briefcase-plus-outline" tone="brand" onPress={() => setJobSheet(true)} testID="quick-work" />
              <ActionBtn label="जमा" icon="arrow-down-left" tone="ok" onPress={() => setEntrySheet("payment")} testID="quick-jama" />
              <ActionBtn label="ग्राहक" icon="account-plus-outline" tone="neutral" onPress={() => setCustSheet(true)} testID="quick-customer" />
            </View>

            <SectionHead title="जिनका पैसा बाकी है" />
            {topDue.length === 0 ? (
              <EmptyRow icon="wallet-outline" text="कोई बकाया नहीं" />
            ) : (
              <View style={styles.card}>
                {topDue.map(({ c, due }, i) => (
                  <Pressable
                    key={c.id}
                    onPress={() => router.push(`/customer/${c.id}`)}
                    style={[styles.row, i > 0 && styles.rowBorder]}
                    testID={`due-row-${c.id}`}
                  >
                    <Avatar name={c.name} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.rowTitle} numberOfLines={1}>{c.name}</Text>
                      <Text style={styles.rowSub} numberOfLines={1}>{c.phone || c.address || "—"}</Text>
                    </View>
                    <Text style={styles.dueAmt}>{formatINR(due)}</Text>
                  </Pressable>
                ))}
              </View>
            )}

            <SectionHead title="आने वाला काम" />
            {upcoming.length === 0 ? (
              <EmptyRow icon="briefcase-outline" text="कोई पेंडिंग काम नहीं" />
            ) : (
              <View style={{ gap: spacing.sm }}>
                {upcoming.map((j) => (
                  <View key={j.id} style={styles.jobCard}>
                    <Text style={styles.rowTitle}>{j.title}</Text>
                    <Text style={styles.rowSub}>{nameOf(j.customerId)} · {formatDateShort(j.dueDate)}{j.estimatedAmount > 0 ? ` · ${formatINR(j.estimatedAmount)}` : ""}</Text>
                  </View>
                ))}
              </View>
            )}

            <SectionHead title="हाल की एंट्री" />
            {recent.length === 0 ? (
              <EmptyRow icon="notebook-outline" text="अभी खाता खाली है" />
            ) : (
              <View style={styles.card}>
                {recent.map((e, i) => (
                  <View key={e.id} style={[styles.row, i > 0 && styles.rowBorder]}>
                    <View style={[styles.iconBadge, { backgroundColor: e.type === "work" ? colors.errorSoft : colors.successSoft }]}>
                      <MaterialIcon name={e.type === "work" ? "arrow-top-right" : "arrow-bottom-left"} size={16} color={e.type === "work" ? colors.error : colors.success} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.rowTitle} numberOfLines={1}>{e.description}</Text>
                      <Text style={styles.rowSub} numberOfLines={1}>{nameOf(e.customerId)} · {formatDate(e.date)}</Text>
                    </View>
                    <Text style={[styles.dueAmt, { color: e.type === "work" ? colors.error : colors.success }]}>
                      {e.type === "work" ? "+" : "−"}{formatINR(e.amount)}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </Animated.View>
        )}
      </ScrollView>

      <AddEntrySheet visible={entrySheet !== null} type={entrySheet ?? "work"} onClose={() => setEntrySheet(null)} />
      <AddCustomerSheet visible={custSheet} onClose={() => setCustSheet(false)} />
      <AddJobSheet visible={jobSheet} onClose={() => setJobSheet(false)} />
    </View>
  );
}

function StatCard({ label, value, tone, testID }: { label: string; value: string; tone: "due" | "ok" | "neutral"; testID: string }) {
  const c = tone === "due" ? colors.error : tone === "ok" ? colors.success : colors.onSurface;
  return (
    <View style={styles.statCard} testID={testID}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, { color: c }]}>{value}</Text>
    </View>
  );
}

function ActionBtn({ label, icon, tone, onPress, testID }: any) {
  const bg = tone === "brand" ? colors.brandPrimary : tone === "due" ? colors.error : tone === "ok" ? colors.success : colors.surfaceSecondary;
  const fg = tone === "neutral" ? colors.onSurface : "#fff";
  return (
    <Pressable onPress={onPress} testID={testID} style={[styles.actionBtn, { backgroundColor: bg }]}>
      <MaterialIcon name={icon} size={18} color={fg} />
      <Text style={[styles.actionText, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

function SectionHead({ title }: { title: string }) {
  return <Text style={styles.sectionHead}>{title}</Text>;
}

function EmptyRow({ icon, text }: { icon: string; text: string }) {
  return (
    <View style={styles.emptyRow}>
      <MaterialIcon name={icon as any} size={20} color={colors.muted} />
      <Text style={{ color: colors.muted, fontSize: 14 }}>{text}</Text>
    </View>
  );
}

export function Avatar({ name }: { name: string }) {
  return (
    <View style={styles.avatar}>
      <Text style={styles.avatarText}>{initials(name)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  eyebrow: { fontSize: 11, color: colors.brandSecondary, fontWeight: "700", textTransform: "uppercase" },
  h1: { fontSize: 30, fontWeight: "700", color: colors.onSurface, marginTop: spacing.xs },
  sub: { fontSize: 13, color: colors.muted, marginTop: spacing.xs },
  pendingPill: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", marginTop: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.errorSoft },
  pendingText: { fontSize: 12, fontWeight: "600", color: colors.warning },
  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.xl },
  statCard: { flexBasis: "48%", flexGrow: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.lg, borderWidth: 1, borderColor: colors.border },
  statLabel: { fontSize: 12, color: colors.muted, fontWeight: "500" },
  statValue: { fontSize: 22, fontWeight: "700", marginTop: spacing.xs },
  actionsRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg },
  actionBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, paddingVertical: 14, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  actionText: { fontSize: 13, fontWeight: "600" },
  sectionHead: { fontSize: 18, fontWeight: "700", color: colors.onSurface, marginTop: spacing.xl, marginBottom: spacing.md },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  rowTitle: { fontSize: 15, fontWeight: "600", color: colors.onSurface },
  rowSub: { fontSize: 12, color: colors.muted, marginTop: 2 },
  dueAmt: { fontSize: 15, fontWeight: "700", color: colors.error },
  iconBadge: { width: 34, height: 34, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  avatar: { width: 40, height: 40, borderRadius: radius.pill, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  avatarText: { color: colors.onBrandTertiary, fontWeight: "700", fontSize: 14 },
  emptyRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.lg, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  jobCard: { padding: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
});
