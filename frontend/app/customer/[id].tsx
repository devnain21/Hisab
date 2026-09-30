import { useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Linking, Alert } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useLocalSearchParams, useRouter } from "expo-router";
import MaterialIcon from "@react-native-vector-icons/material-design-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, spacing, radius } from "@/src/theme";
import { cashIn, computeBalance, useCustomers, useEntries, useJobs, type Entry, type Job } from "@/src/lib/data";
import { formatDate, formatINR, formatPhone, initials, waNumber } from "@/src/lib/format";
import { store } from "@/src/lib/store";
import { buildLedger, removeEntryWithLinks, type WorkState, type WorkStatus } from "@/src/lib/records";
import { AddEntrySheet, AddJobSheet, AddCustomerSheet, CompleteJobSheet, EditRecordSheet, SettleSheet } from "@/src/components/sheets";
import { Pressable } from "@/src/components/tap";
import { confirmAction } from "@/src/lib/confirm";
import { useAuth } from "@/src/context/AuthContext";

export default function CustomerDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const customersQ = useCustomers();
  const entriesQ = useEntries();
  const jobsQ = useJobs();
  const [entrySheet, setEntrySheet] = useState<"work" | "payment" | null>(null);
  const [jobSheet, setJobSheet] = useState<"now" | "later" | null>(null);
  const [editSheet, setEditSheet] = useState(false);
  const [completing, setCompleting] = useState<Job | null>(null);
  const [editing, setEditing] = useState<Entry | null>(null);
  const [editingJob, setEditingJob] = useState<Job | null>(null);
  const { user } = useAuth();

  const customer = (customersQ.data ?? []).find((c) => c.id === id);
  const entries = useMemo(() => (entriesQ.data ?? []).filter((e) => e.customerId === id), [entriesQ.data, id]);
  const jobs = useMemo(() => (jobsQ.data ?? []).filter((j) => j.customerId === id), [jobsQ.data, id]);
  const ledger = useMemo(() => buildLedger(entries), [entries]);
  const [filter, setFilter] = useState<LedgerFilter>("all");
  const [settling, setSettling] = useState<Entry | null>(null);

  const rows = useMemo(
    () =>
      entries
        .filter((e) => !ledger.nested.has(e.id))
        .sort((a, b) => (a.date !== b.date ? b.date.localeCompare(a.date) : b.createdAt.localeCompare(a.createdAt))),
    [entries, ledger],
  );
  const stateOf = (e: Entry) => ledger.work.get(e.id)?.state;
  const counts = useMemo(() => {
    const c: Record<LedgerFilter, number> = { all: rows.length, due: 0, settled: 0, cash: 0, jama: 0 };
    rows.forEach((e) => {
      if (e.type === "payment") c.jama += 1;
      else {
        const s = ledger.work.get(e.id)?.state;
        if (s === "pending" || s === "partial") c.due += 1;
        else if (s === "settled") c.settled += 1;
        else if (s === "cash") c.cash += 1;
      }
    });
    return c;
  }, [rows, ledger]);
  const visible = rows.filter((e) => {
    if (filter === "all") return true;
    if (filter === "jama") return e.type === "payment";
    const s = stateOf(e);
    return filter === "due" ? s === "pending" || s === "partial" : s === filter;
  });

  const due = computeBalance(entries);
  const totalWork = entries.filter((e) => e.type === "work").reduce((s, e) => s + e.amount, 0);
  const totalIn = entries.reduce((s, e) => s + cashIn(e), 0);
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

  const removeEntry = (e: Entry) => {
    const extra = e.type === "work" ? "\nइसके साथ इसका भुगतान और काम कार्ड भी हटेंगे।" : "\nयह रकम फिर से बाकी में जुड़ जाएगी।";
    confirmAction("एंट्री हटाएँ?", `${e.description} · ${formatINR(e.amount)}${extra}`, "हटा दें", () => {
      removeEntryWithLinks(e, entriesQ.data ?? [], jobsQ.data ?? []);
    });
  };

  const shareWhatsApp = () => {
    const wa = waNumber(customer.phone);
    if (!wa) {
      Alert.alert("फ़ोन जोड़ें", "WhatsApp पर भेजने के लिए इस ग्राहक का फ़ोन नंबर चाहिए।");
      setEditSheet(true);
      return;
    }
    const shop = user?.shop_name || "बही खाता";
    const status = due > 0 ? `बाकी: ${formatINR(due)}` : due < 0 ? `एडवांस: ${formatINR(Math.abs(due))}` : "खाता क्लियर है";
    const pending = rows
      .filter((e) => e.type === "work" && (ledger.work.get(e.id)?.remaining ?? 0) > 0)
      .reverse()
      .map((e) => `• ${formatDate(e.date)}  ${e.description}  ${formatINR(ledger.work.get(e.id)!.remaining)}`);
    const text = [`*${shop}*`, customer.name, status, ...(pending.length ? ["", "बाकी काम:", ...pending] : []), "", "धन्यवाद 🙏"].join("\n");
    Linking.openURL(`https://wa.me/${wa}?text=${encodeURIComponent(text)}`).catch(() => {
      Alert.alert("WhatsApp नहीं खुला", "इस फ़ोन पर WhatsApp नहीं मिला।");
    });
  };

  const deleteCustomer = () => {
    confirmAction(`${customer.name} को हटाएँ?`, "इनका पूरा खाता मिट जाएगा।", "हटा दें", async () => {
      store.deleteCustomer(customer.id);
      router.back();
    });
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
          {totalWork > 0 ? (
            <Text style={styles.balanceSub}>कुल काम {formatINR(totalWork)} · मिले {formatINR(totalIn)}</Text>
          ) : null}
          {customer.notes ? <Text style={styles.notes}>{customer.notes}</Text> : null}
          <View style={styles.actionsRow}>
            <Pressable style={[styles.actionBtn, { backgroundColor: colors.brandPrimary }]} onPress={() => setJobSheet("now")} testID="add-work-btn">
              <MaterialIcon name="plus" size={16} color="#fff" />
              <Text style={styles.actionText}>काम लिखें</Text>
            </Pressable>
            <Pressable style={[styles.actionBtn, { backgroundColor: colors.success }]} onPress={() => setEntrySheet("payment")} testID="add-jama-btn">
              <MaterialIcon name="arrow-bottom-left" size={16} color="#fff" />
              <Text style={styles.actionText}>जमा</Text>
            </Pressable>
            <Pressable style={[styles.actionBtn, { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }]} onPress={() => setJobSheet("later")} testID="add-job-btn">
              <MaterialIcon name="calendar-clock" size={16} color={colors.onSurface} />
              <Text style={[styles.actionText, { color: colors.onSurface }]}>आगे का</Text>
            </Pressable>
          </View>
          <Pressable style={styles.waBtn} onPress={shareWhatsApp} testID="share-whatsapp-btn">
            <MaterialIcon name="whatsapp" size={18} color="#128C7E" />
            <Text style={styles.waText}>WhatsApp पर बाकी भेजें</Text>
          </Pressable>
        </View>

        {openJobs.length > 0 && (
          <>
            <Text style={styles.sectionHead}>आगे का काम / रिमार्क</Text>
            <View style={{ gap: spacing.sm }}>
              {openJobs.map((j) => (
                <Pressable key={j.id} style={styles.jobRow} onPress={() => setEditingJob(j)} testID={`cust-job-${j.id}`}>
                  <MaterialIcon name="calendar-clock" size={20} color={colors.brandPrimary} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.jobTitle}>{j.title}</Text>
                    <Text style={styles.sub}>{formatDate(j.dueDate)}{j.estimatedAmount > 0 ? ` · ${formatINR(j.estimatedAmount)}` : ""}</Text>
                    {j.notes ? <Text style={styles.sub}>{j.notes}</Text> : null}
                  </View>
                  <Pressable style={styles.pillBtn} onPress={() => setCompleting(j)} testID={`cust-complete-${j.id}`}>
                    <Text style={styles.pillBtnText}>पूरा</Text>
                  </Pressable>
                </Pressable>
              ))}
            </View>
          </>
        )}

        <Text style={styles.sectionHead}>खाता</Text>
        {rows.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingBottom: spacing.md }}>
            {LEDGER_FILTERS.filter((f) => f === "all" || counts[f] > 0).map((f) => {
              const active = filter === f;
              const tone = f === "due" ? colors.error : f === "all" ? colors.brandPrimary : colors.success;
              return (
                <Pressable key={f} onPress={() => setFilter(f)} style={[styles.filterChip, active && { backgroundColor: tone, borderColor: tone }]} testID={`ledger-filter-${f}`}>
                  <Text style={[styles.filterText, !active && f === "due" && { color: colors.error }, active && { color: "#fff" }]}>
                    {LEDGER_FILTER_LABEL[f]} ({counts[f]})
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}
        {rows.length === 0 ? (
          <View style={styles.empty}>
            <MaterialIcon name="notebook-outline" size={28} color={colors.muted} />
            <Text style={{ color: colors.muted, marginTop: spacing.sm }}>अभी कोई एंट्री नहीं</Text>
          </View>
        ) : visible.length === 0 ? (
          <View style={styles.empty}>
            <Text style={{ color: colors.muted }}>इस सूची में कुछ नहीं</Text>
          </View>
        ) : (
          <View style={{ gap: spacing.sm }}>
            {visible.map((e, i) => (
              <Animated.View key={e.id} entering={FadeInDown.delay(Math.min(i, 8) * 40).duration(250)}>
                {e.type === "work" ? (
                  <WorkCard entry={e} status={ledger.work.get(e.id)!} onPress={() => setEditing(e)} onSettle={() => setSettling(e)} onDelete={() => removeEntry(e)} />
                ) : (
                  <JamaCard entry={e} onPress={() => setEditing(e)} onDelete={() => removeEntry(e)} />
                )}
              </Animated.View>
            ))}
          </View>
        )}
      </ScrollView>

      <AddEntrySheet visible={entrySheet !== null} type={entrySheet ?? "work"} onClose={() => setEntrySheet(null)} customerId={customer.id} />
      <EditRecordSheet entry={editing} job={editingJob} onClose={() => { setEditing(null); setEditingJob(null); }} />
      <AddJobSheet visible={jobSheet !== null} initialMode={jobSheet ?? "now"} onClose={() => setJobSheet(null)} customerId={customer.id} />
      <SettleSheet work={settling} onClose={() => setSettling(null)} />
      <AddCustomerSheet visible={editSheet} onClose={() => setEditSheet(false)} initial={customer} />
      <CompleteJobSheet job={completing} onClose={() => setCompleting(null)} />
    </View>
  );
}

type LedgerFilter = "all" | "due" | "settled" | "cash" | "jama";
const LEDGER_FILTERS: LedgerFilter[] = ["all", "due", "settled", "cash", "jama"];
const LEDGER_FILTER_LABEL: Record<LedgerFilter, string> = { all: "सभी", due: "उधार बाकी", settled: "चुकता", cash: "नकद", jama: "जमा" };

const STATE_UI: Record<WorkState, { label: string; icon: string; fg: string; bg: string }> = {
  cash: { label: "नकद", icon: "cash", fg: colors.success, bg: colors.successSoft },
  pending: { label: "उधार बाकी", icon: "clock-alert-outline", fg: colors.error, bg: colors.errorSoft },
  partial: { label: "आंशिक", icon: "progress-clock", fg: colors.warning, bg: "#FEF3E2" },
  settled: { label: "चुकता", icon: "check-decagram", fg: colors.success, bg: colors.successSoft },
};

function WorkCard({ entry, status, onPress, onSettle, onDelete }: { entry: Entry; status: WorkStatus; onPress: () => void; onSettle: () => void; onDelete: () => void }) {
  const ui = STATE_UI[status.state];
  const open = status.state === "pending" || status.state === "partial";
  const laterPaid = status.received - status.paidAtBooking;
  return (
    <Pressable
      style={[styles.card, open && { borderLeftWidth: 4, borderLeftColor: ui.fg, backgroundColor: status.state === "pending" ? "#FFF7F6" : colors.surfaceSecondary }]}
      onPress={onPress}
      testID={`entry-${entry.id}`}
    >
      <View style={styles.cardTop}>
        <View style={[styles.iconBadge, { backgroundColor: ui.bg }]}>
          <MaterialIcon name={ui.icon as any} size={18} color={ui.fg} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.jobTitle} numberOfLines={2}>{entry.description}</Text>
          <Text style={styles.sub}>{formatDate(entry.date)}{entry.notes ? ` · ${entry.notes}` : ""}</Text>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={[styles.amount, open && { color: ui.fg }]}>{formatINR(entry.amount)}</Text>
          <View style={[styles.statePill, { backgroundColor: ui.bg }]}>
            {status.state === "settled" ? <MaterialIcon name="check" size={12} color={ui.fg} /> : null}
            <Text style={[styles.stateText, { color: ui.fg }]}>{ui.label}</Text>
          </View>
        </View>
      </View>

      {status.state === "partial" || status.state === "settled" ? (
        <View style={styles.moneyLine}>
          {status.paidAtBooking > 0 ? <Text style={styles.moneyText}>उसी दिन {formatINR(status.paidAtBooking)}</Text> : null}
          {laterPaid > 0 ? <Text style={styles.moneyText}>बाद में {formatINR(laterPaid)}{status.fromJama > 0 && status.settlements.length === 0 ? " (जमा से)" : ""}</Text> : null}
          {status.state === "settled" && status.settledOn ? <Text style={[styles.moneyText, { color: colors.success, fontWeight: "700" }]}>✔ {formatDate(status.settledOn)} को चुकता</Text> : null}
          {status.state === "partial" ? <Text style={[styles.moneyText, { color: colors.error, fontWeight: "700" }]}>बाकी {formatINR(status.remaining)}</Text> : null}
        </View>
      ) : null}

      <View style={styles.cardActions}>
        {open ? (
          <Pressable style={styles.settleBtn} onPress={onSettle} testID={`settle-${entry.id}`}>
            <MaterialIcon name="cash-check" size={16} color="#fff" />
            <Text style={styles.settleText}>पैसे मिले{status.state === "partial" ? ` · ${formatINR(status.remaining)}` : ""}</Text>
          </Pressable>
        ) : null}
        <View style={{ flex: 1 }} />
        <MaterialIcon name="pencil-outline" size={16} color={colors.muted} />
        <Pressable onPress={onDelete} hitSlop={8} style={{ marginLeft: spacing.md }} testID={`del-entry-${entry.id}`}>
          <MaterialIcon name="trash-can-outline" size={18} color={colors.muted} />
        </Pressable>
      </View>
    </Pressable>
  );
}

function JamaCard({ entry, onPress, onDelete }: { entry: Entry; onPress: () => void; onDelete: () => void }) {
  return (
    <Pressable style={styles.card} onPress={onPress} testID={`entry-${entry.id}`}>
      <View style={styles.cardTop}>
        <View style={[styles.iconBadge, { backgroundColor: colors.successSoft }]}>
          <MaterialIcon name="arrow-bottom-left" size={18} color={colors.success} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.jobTitle} numberOfLines={2}>{entry.description || "जमा"}</Text>
          <Text style={styles.sub}>{formatDate(entry.date)}{entry.notes ? ` · ${entry.notes}` : ""}</Text>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={[styles.amount, { color: colors.success }]}>−{formatINR(entry.amount)}</Text>
          <View style={[styles.statePill, { backgroundColor: colors.successSoft }]}>
            <Text style={[styles.stateText, { color: colors.success }]}>जमा</Text>
          </View>
        </View>
        <Pressable onPress={onDelete} hitSlop={8} style={{ marginLeft: spacing.sm }} testID={`del-entry-${entry.id}`}>
          <MaterialIcon name="close" size={18} color={colors.muted} />
        </Pressable>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  avatar: { width: 44, height: 44, borderRadius: radius.pill, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  avatarText: { fontWeight: "700", color: colors.onBrandTertiary },
  name: { fontSize: 18, fontWeight: "700", color: colors.onSurface },
  sub: { fontSize: 12, color: colors.muted, marginTop: 2 },
  subFaint: { fontSize: 11, color: colors.muted },
  balanceCard: { padding: spacing.xl, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  balanceLabel: { fontSize: 12, color: colors.muted, fontWeight: "700", textTransform: "uppercase" },
  balanceValue: { fontSize: 36, fontWeight: "800", marginTop: spacing.xs },
  notes: { fontSize: 13, color: colors.onSurfaceSecondary, marginTop: spacing.sm },
  actionsRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg },
  actionBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xs, paddingVertical: 11, borderRadius: radius.md },
  actionText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  waBtn: { marginTop: spacing.md, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, paddingVertical: 12, borderRadius: radius.md, backgroundColor: "#E7F6F1", borderWidth: 1, borderColor: "#128C7E" },
  waText: { color: "#0B6B5C", fontWeight: "700", fontSize: 14 },
  sectionHead: { fontSize: 17, fontWeight: "700", color: colors.onSurface, marginTop: spacing.xl, marginBottom: spacing.md },
  jobRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  jobTitle: { fontSize: 15, fontWeight: "600", color: colors.onSurface },
  pillBtn: { paddingHorizontal: spacing.md, paddingVertical: 7, backgroundColor: colors.brandPrimary, borderRadius: radius.pill },
  pillBtnText: { color: colors.onBrandPrimary, fontWeight: "700", fontSize: 12 },
  balanceSub: { fontSize: 12, color: colors.muted, marginTop: 2 },
  filterChip: { height: 32, paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  filterText: { fontSize: 12, fontWeight: "700", color: colors.onSurface },
  card: { padding: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  cardTop: { flexDirection: "row", gap: spacing.md, alignItems: "flex-start" },
  iconBadge: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  amount: { fontSize: 16, fontWeight: "800", color: colors.onSurface },
  statePill: { flexDirection: "row", alignItems: "center", gap: 2, paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill, marginTop: 4 },
  stateText: { fontSize: 11, fontWeight: "800" },
  moneyLine: { flexDirection: "row", flexWrap: "wrap", columnGap: spacing.md, rowGap: 2, marginTop: spacing.sm, marginLeft: 48 },
  moneyText: { fontSize: 12, color: colors.onSurfaceSecondary },
  cardActions: { flexDirection: "row", alignItems: "center", marginTop: spacing.sm, marginLeft: 48 },
  settleBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: colors.success },
  settleText: { color: "#fff", fontWeight: "700", fontSize: 12 },
  empty: { alignItems: "center", padding: spacing.xl, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
});
