import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { Pressable } from "@/src/components/tap";
import { SlowServerHint } from "@/src/components/slow-server-hint";
import { useState, useMemo } from "react";
import { useRouter } from "expo-router";
import MaterialIcon from "@react-native-vector-icons/material-design-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, spacing, radius } from "@/src/theme";
import { cashIn, useAeps, useCustomers, useEntries, useJobs, computeBalance, type Job } from "@/src/lib/data";
import { aepsTotals } from "@/src/lib/aeps";
import { formatDateShort, formatINR, formatWeekdayDate, todayISO } from "@/src/lib/format";
import { AddEntrySheet, AddCustomerSheet, AddJobSheet, EditRecordSheet } from "@/src/components/sheets";
import { useAuth } from "@/src/context/AuthContext";
import { usePendingCount } from "@/src/lib/store";

export default function Home() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const customersQ = useCustomers();
  const entriesQ = useEntries();
  const jobsQ = useJobs();
  const aeps = useAeps().data ?? [];
  const [entrySheet, setEntrySheet] = useState<"work" | "payment" | null>(null);
  const [custSheet, setCustSheet] = useState(false);
  const [jobSheet, setJobSheet] = useState(false);
  const [editingJob, setEditingJob] = useState<Job | null>(null);
  const { user } = useAuth();
  const pending = usePendingCount();

  const today = todayISO();
  const customers = customersQ.data ?? [];
  const entries = entriesQ.data ?? [];
  const jobs = jobsQ.data ?? [];

  const stats = useMemo(() => {
    const dueCustomers = customers.filter((c) => computeBalance(entries, c.id) > 0).length;
    const totalDue = computeBalance(entries);
    const todayWork = entries.filter((e) => e.date === today && e.type === "work");
    const todayPay = entries.filter((e) => e.date === today && cashIn(e) > 0);
    const open = jobs.filter((j) => j.status !== "done");
    return {
      totalDue,
      dueCustomers,
      todayWork: todayWork.reduce((n, e) => n + e.amount, 0),
      todayWorkCount: todayWork.length,
      todayPay: todayPay.reduce((n, e) => n + cashIn(e), 0),
      todayPayCount: todayPay.length,
      openJobs: open.length,
      overdue: open.filter((j) => j.dueDate < today).length,
    };
  }, [customers, entries, jobs, today]);

  const aepsToday = useMemo(() => aepsTotals(aeps.filter((t) => t.date === today)), [aeps, today]);

  const upcoming = useMemo(
    () => jobs.filter((j) => j.status !== "done").sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 4),
    [jobs]
  );

  const loading = customersQ.isLoading || entriesQ.isLoading || jobsQ.isLoading;
  const nameOf = (id: string) => customers.find((c) => c.id === id)?.name ?? "ग्राहक";
  // The nonce makes the target tab re-apply the filter even if it was already open with it.
  const go = (pathname: string, params: Record<string, string>) =>
    router.navigate({ pathname: pathname as any, params: { ...params, t: String(Date.now()) } });

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingTop: insets.top + spacing.md, paddingBottom: spacing.xxl }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.eyebrow}>{formatWeekdayDate(today)}</Text>
        <Text style={styles.h1} numberOfLines={2} testID="shop-name">{user?.shop_name || "आज का खाता"}</Text>
        <Text style={styles.sub}>बही खाता — उधार, जमा और काम</Text>
        {!user?.shop_name ? (
          <Pressable onPress={() => router.push("/(tabs)/profile")} testID="set-shop-name-hint">
            <Text style={styles.sub}>खाता पेज पर अपनी दुकान का नाम लिखें। हर Google खाते का हिसाब अलग रहता है।</Text>
          </Pressable>
        ) : null}
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
              <StatCard
                label="कुल बकाया"
                value={formatINR(Math.max(stats.totalDue, 0))}
                hint={`${stats.dueCustomers} ग्राहक`}
                icon="account-cash-outline"
                tone="due"
                onPress={() => go("/(tabs)/customers", { filter: "due" })}
                testID="stat-total-due"
              />
              <StatCard
                label="पेंडिंग काम"
                value={String(stats.openJobs)}
                hint={stats.overdue > 0 ? `${stats.overdue} देर से` : "सब समय पर"}
                icon="briefcase-clock-outline"
                tone={stats.overdue > 0 ? "warn" : "neutral"}
                onPress={() => go("/(tabs)/work", { filter: stats.overdue > 0 ? "late" : "open" })}
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
              <StatCard
                label="आज की जमा"
                value={formatINR(stats.todayPay)}
                hint={`${stats.todayPayCount} एंट्री`}
                icon="cash-check"
                tone="ok"
                onPress={() => router.push({ pathname: "/day", params: { type: "payment" } })}
                testID="stat-today-pay"
              />
            </View>

            <View style={styles.actionsRow}>
              <ActionBtn label="काम लिखें" icon="briefcase-plus-outline" tone="brand" onPress={() => setJobSheet(true)} testID="quick-work" />
              <ActionBtn label="जमा" icon="arrow-down-left" tone="ok" onPress={() => setEntrySheet("payment")} testID="quick-jama" />
              <ActionBtn label="ग्राहक" icon="account-plus-outline" tone="neutral" onPress={() => setCustSheet(true)} testID="quick-customer" />
            </View>

            <Pressable style={styles.aepsCard} onPress={() => go("/(tabs)/aeps", { range: "today" })} testID="home-aeps-card">
              <View style={styles.aepsIcon}><MaterialIcon name="fingerprint" size={22} color={colors.brandPrimary} /></View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.rowTitle}>आज AEPS / मनी सर्विस</Text>
                <Text style={styles.rowSub} numberOfLines={1}>
                  {aepsToday.count === 0
                    ? "आज कोई लेन-देन नहीं"
                    : `${aepsToday.count} लेन-देन · कैश दिया ${formatINR(aepsToday.cashOut)} · लिया ${formatINR(aepsToday.cashIn)}`}
                </Text>
              </View>
              {aepsToday.commission > 0 ? <Text style={styles.commission}>+{formatINR(aepsToday.commission)}</Text> : null}
              <MaterialIcon name="chevron-right" size={20} color={colors.muted} />
            </Pressable>

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
                <Text style={{ color: colors.muted, fontSize: 14 }}>कोई पेंडिंग काम नहीं</Text>
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
          </Animated.View>
        )}
      </ScrollView>

      <AddEntrySheet visible={entrySheet !== null} type={entrySheet ?? "work"} onClose={() => setEntrySheet(null)} />
      <AddCustomerSheet visible={custSheet} onClose={() => setCustSheet(false)} />
      <AddJobSheet visible={jobSheet} onClose={() => setJobSheet(false)} />
      <EditRecordSheet job={editingJob} onClose={() => setEditingJob(null)} />
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

const styles = StyleSheet.create({
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
  actionsRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg },
  actionBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, paddingVertical: 14, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  actionText: { fontSize: 13, fontWeight: "600" },
  aepsCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginTop: spacing.lg, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.brandTertiary, borderWidth: 1, borderColor: colors.border },
  aepsIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  commission: { fontSize: 14, fontWeight: "700", color: colors.success },
  sectionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.xl, marginBottom: spacing.md },
  sectionHead: { fontSize: 18, fontWeight: "700", color: colors.onSurface },
  link: { fontSize: 13, fontWeight: "700", color: colors.brandPrimary },
  rowTitle: { fontSize: 15, fontWeight: "600", color: colors.onSurface },
  rowSub: { fontSize: 12, color: colors.muted, marginTop: 2 },
  emptyRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.lg, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  jobCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  dateBadge: { minWidth: 56, paddingVertical: 6, paddingHorizontal: spacing.sm, borderRadius: radius.sm, backgroundColor: colors.brandTertiary, alignItems: "center" },
  dateBadgeText: { fontSize: 12, fontWeight: "700", color: colors.brandSecondary },
});
