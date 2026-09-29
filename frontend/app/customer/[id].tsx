import { useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, FlatList, Alert, ScrollView } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import MaterialIcon from "@react-native-vector-icons/material-design-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, spacing, radius } from "@/src/theme";
import { computeBalance, useCustomers, useEntries, useJobs, type Entry, type Job } from "@/src/lib/data";
import { formatDate, formatINR, formatPhone, initials } from "@/src/lib/format";
import { api } from "@/src/lib/api";
import { AddEntrySheet, AddJobSheet, AddCustomerSheet } from "@/src/components/sheets";

export default function CustomerDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const customersQ = useCustomers();
  const entriesQ = useEntries();
  const jobsQ = useJobs();
  const [entrySheet, setEntrySheet] = useState<"work" | "payment" | null>(null);
  const [jobSheet, setJobSheet] = useState(false);
  const [editSheet, setEditSheet] = useState(false);

  const customer = (customersQ.data ?? []).find((c) => c.id === id);
  const entries = useMemo(() => (entriesQ.data ?? []).filter((e) => e.customerId === id), [entriesQ.data, id]);
  const jobs = useMemo(() => (jobsQ.data ?? []).filter((j) => j.customerId === id), [jobsQ.data, id]);
  const timeline = useMemo(() => {
    const sorted = [...entries].sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : (a.createdAt < b.createdAt ? -1 : 1)));
    let running = 0;
    const t = sorted.map((e) => { running += e.type === "work" ? e.amount : -e.amount; return { e, running }; });
    return t.reverse();
  }, [entries]);

  const due = computeBalance(entries);
  const openJobs = jobs.filter((j) => j.status !== "done");

  if (!customer) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", padding: spacing.xl }}>
        <MaterialIcon name="account-question-outline" size={40} color={colors.muted} />
        <Text style={{ marginTop: spacing.md, color: colors.onSurface }}>ग्राहक नहीं मिला</Text>
        <Pressable onPress={() => router.back()} style={{ marginTop: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, backgroundColor: colors.brandPrimary, borderRadius: radius.md }}>
          <Text style={{ color: colors.onBrandPrimary, fontWeight: "600" }}>वापस</Text>
        </Pressable>
      </View>
    );
  }

  const removeEntry = async (eid: string) => {
    await api.deleteEntry(eid);
    qc.invalidateQueries({ queryKey: ["entries"] });
  };

  const completeJob = async (j: Job) => {
    await api.updateJob(j.id, { status: "done" });
    if (j.estimatedAmount > 0) {
      await api.createEntry({
        customerId: j.customerId, type: "work", date: j.dueDate, description: j.title, amount: j.estimatedAmount, notes: "काम पूरा — उधार में जोड़ा",
      });
    }
    qc.invalidateQueries({ queryKey: ["jobs"] });
    qc.invalidateQueries({ queryKey: ["entries"] });
  };

  const deleteCustomer = () => {
    Alert.alert(`${customer.name} को हटाएँ?`, "इनका पूरा खाता मिट जाएगा।", [
      { text: "रद्द", style: "cancel" },
      { text: "हटा दें", style: "destructive", onPress: async () => {
        await api.deleteCustomer(customer.id);
        qc.invalidateQueries({ queryKey: ["customers"] });
        qc.invalidateQueries({ queryKey: ["entries"] });
        qc.invalidateQueries({ queryKey: ["jobs"] });
        router.back();
      }},
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={{ paddingTop: insets.top + spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, flexDirection: "row", alignItems: "center", gap: spacing.md }}>
        <Pressable onPress={() => router.back()} hitSlop={12} testID="back-btn">
          <MaterialIcon name="arrow-left" size={26} color={colors.onSurface} />
        </Pressable>
        <View style={styles.avatar}><Text style={styles.avatarText}>{initials(customer.name)}</Text></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.name} numberOfLines={1}>{customer.name}</Text>
          <Text style={styles.sub} numberOfLines={1}>
            {customer.phone ? formatPhone(customer.phone) : "फ़ोन नहीं"}{customer.address ? ` · ${customer.address}` : ""}
          </Text>
        </View>
        <Pressable onPress={() => setEditSheet(true)} hitSlop={10} testID="edit-cust-btn">
          <MaterialIcon name="pencil-outline" size={22} color={colors.onSurface} />
        </Pressable>
        <Pressable onPress={deleteCustomer} hitSlop={10} testID="del-cust-btn">
          <MaterialIcon name="trash-can-outline" size={22} color={colors.error} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl * 2 }}>
        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>अभी बाकी</Text>
          <Text style={[styles.balanceValue, { color: due > 0 ? colors.error : due < 0 ? colors.success : colors.onSurface }]}>
            {due === 0 ? "क्लियर" : formatINR(Math.abs(due))}
          </Text>
          {customer.notes ? <Text style={styles.notes}>{customer.notes}</Text> : null}
          <View style={styles.actionsRow}>
            <Pressable style={[styles.actionBtn, { backgroundColor: colors.error }]} onPress={() => setEntrySheet("work")} testID="add-udhaar-btn">
              <MaterialIcon name="arrow-top-right" size={16} color="#fff" />
              <Text style={styles.actionText}>उधार काम</Text>
            </Pressable>
            <Pressable style={[styles.actionBtn, { backgroundColor: colors.success }]} onPress={() => setEntrySheet("payment")} testID="add-jama-btn">
              <MaterialIcon name="arrow-bottom-left" size={16} color="#fff" />
              <Text style={styles.actionText}>जमा</Text>
            </Pressable>
            <Pressable style={[styles.actionBtn, { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }]} onPress={() => setJobSheet(true)} testID="add-job-btn">
              <MaterialIcon name="briefcase-outline" size={16} color={colors.onSurface} />
              <Text style={[styles.actionText, { color: colors.onSurface }]}>काम</Text>
            </Pressable>
          </View>
        </View>

        {openJobs.length > 0 && (
          <>
            <Text style={styles.sectionHead}>पेंडिंग काम</Text>
            <View style={{ gap: spacing.sm }}>
              {openJobs.map((j) => (
                <View key={j.id} style={styles.jobRow} testID={`cust-job-${j.id}`}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.jobTitle}>{j.title}</Text>
                    <Text style={styles.sub}>{formatDate(j.dueDate)}{j.estimatedAmount > 0 ? ` · ${formatINR(j.estimatedAmount)}` : ""}</Text>
                  </View>
                  <Pressable style={styles.pillBtn} onPress={() => completeJob(j)} testID={`cust-complete-${j.id}`}>
                    <Text style={styles.pillBtnText}>पूरा</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          </>
        )}

        <Text style={styles.sectionHead}>खाता</Text>
        {timeline.length === 0 ? (
          <View style={styles.empty}>
            <MaterialIcon name="notebook-outline" size={28} color={colors.muted} />
            <Text style={{ color: colors.muted, marginTop: spacing.sm }}>अभी कोई एंट्री नहीं</Text>
          </View>
        ) : (
          <View style={{ gap: spacing.sm }}>
            {timeline.map(({ e, running }) => (
              <TimelineRow key={e.id} entry={e} running={running} onDelete={() => removeEntry(e.id)} />
            ))}
          </View>
        )}
      </ScrollView>

      <AddEntrySheet visible={entrySheet !== null} type={entrySheet ?? "work"} onClose={() => setEntrySheet(null)} customerId={customer.id} />
      <AddJobSheet visible={jobSheet} onClose={() => setJobSheet(false)} customerId={customer.id} />
      <AddCustomerSheet visible={editSheet} onClose={() => setEditSheet(false)} initial={customer} />
    </View>
  );
}

function TimelineRow({ entry, running, onDelete }: { entry: Entry; running: number; onDelete: () => void }) {
  const work = entry.type === "work";
  return (
    <View style={styles.timelineRow} testID={`entry-${entry.id}`}>
      <View style={[styles.iconBadge, { backgroundColor: work ? colors.errorSoft : colors.successSoft }]}>
        <MaterialIcon name={work ? "arrow-top-right" : "arrow-bottom-left"} size={16} color={work ? colors.error : colors.success} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.jobTitle} numberOfLines={1}>{entry.description}</Text>
        <Text style={styles.sub}>{formatDate(entry.date)}{entry.notes ? ` · ${entry.notes}` : ""}</Text>
        <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: 4, alignItems: "center", flexWrap: "wrap" }}>
          <Text style={{ fontWeight: "700", color: work ? colors.error : colors.success }}>
            {work ? "+" : "−"}{formatINR(entry.amount)}
          </Text>
          <Text style={styles.subFaint}>· बाद में {formatINR(Math.abs(running))}{running < 0 ? " (एडवांस)" : ""}</Text>
        </View>
      </View>
      <Pressable onPress={onDelete} hitSlop={8} testID={`del-entry-${entry.id}`}>
        <MaterialIcon name="close" size={18} color={colors.muted} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: { width: 44, height: 44, borderRadius: radius.pill, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  avatarText: { fontWeight: "700", color: colors.onBrandTertiary },
  name: { fontSize: 18, fontWeight: "700", color: colors.onSurface },
  sub: { fontSize: 12, color: colors.muted, marginTop: 2 },
  subFaint: { fontSize: 11, color: colors.muted },
  balanceCard: { padding: spacing.xl, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  balanceLabel: { fontSize: 12, color: colors.muted, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  balanceValue: { fontSize: 36, fontWeight: "800", marginTop: spacing.xs },
  notes: { fontSize: 13, color: colors.onSurfaceSecondary, marginTop: spacing.sm },
  actionsRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg },
  actionBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xs, paddingVertical: 11, borderRadius: radius.md },
  actionText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  sectionHead: { fontSize: 17, fontWeight: "700", color: colors.onSurface, marginTop: spacing.xl, marginBottom: spacing.md },
  jobRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  jobTitle: { fontSize: 15, fontWeight: "600", color: colors.onSurface },
  pillBtn: { paddingHorizontal: spacing.md, paddingVertical: 7, backgroundColor: colors.brandPrimary, borderRadius: radius.pill },
  pillBtnText: { color: colors.onBrandPrimary, fontWeight: "700", fontSize: 12 },
  timelineRow: { flexDirection: "row", gap: spacing.md, padding: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, alignItems: "flex-start" },
  iconBadge: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", marginTop: 2 },
  empty: { alignItems: "center", padding: spacing.xl, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
});
