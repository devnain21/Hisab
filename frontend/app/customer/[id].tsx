import { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Linking } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useLocalSearchParams, useRouter } from "expo-router";
import MaterialIcon from "@react-native-vector-icons/material-design-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, spacing, radius } from "@/src/theme";
import { computeBalance, useCustomers, useEntries, useJobs, type Entry, type EntryType, type Job } from "@/src/lib/data";
import { formatDate, formatINR, formatPhone, initials } from "@/src/lib/format";
import { store } from "@/src/lib/store";
import { buildLedger, type WorkState, type WorkStatus } from "@/src/lib/records";
import { AddEntrySheet, AddJobSheet, AddCustomerSheet, CompleteJobSheet, EditRecordSheet, SettleSheet } from "@/src/components/sheets";
import { Pressable } from "@/src/components/tap";
import { useAuth } from "@/src/context/AuthContext";
import { ReceiptSheet } from "@/src/components/receipt-sheet";
import { receiptDoc, statementDoc, reminderDoc, type ShareDoc } from "@/src/lib/receipt";
import { UpiQrModal } from "@/src/components/upi-qr-sheet";
import { addRecentCustomer } from "@/src/lib/recent";

export default function CustomerDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const customersQ = useCustomers();
  const entriesQ = useEntries();
  const jobsQ = useJobs();
  const [entrySheet, setEntrySheet] = useState<EntryType | null>(null);
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
  const [shareDoc, setShareDoc] = useState<ShareDoc | null>(null);
  const [qrModal, setQrModal] = useState(false);

  useEffect(() => {
    if (id) void addRecentCustomer(id);
  }, [id]);

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
  const totals = useMemo(() => {
    let work = 0, given = 0, got = 0;
    for (const e of entries) {
      if (e.type === "work") { work += e.amount; got += e.paid ?? 0; }
      else if (e.type === "given") given += e.amount;
      else got += e.amount;
    }
    return { work, given, got, debt: work + given };
  }, [entries]);
  // Money left with us by a customer is an advance; with a personal contact it's money we owe back.
  const isCustomer = entries.some((e) => e.type === "work") || jobs.length > 0;
  const balanceLabel = due > 0 ? "लेने हैं" : due < 0 ? (isCustomer ? "एडवांस" : "देने हैं") : "हिसाब";
  const openJobs = jobs.filter((j) => j.status !== "done");
  const showMoreFilters = rows.length > 8;

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

  const openReceipt = (e: Entry) => setShareDoc(receiptDoc(e, ledger.work.get(e.id), customer, due, isCustomer, user ?? {}));
  const openStatement = () => setShareDoc(statementDoc(entries, ledger, customer, isCustomer, user ?? {}));
  const openReminder = () => setShareDoc(reminderDoc(customer, due, user ?? {}));
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
        {customer.phone ? (
          <>
            <Pressable onPress={() => Linking.openURL(`tel:${customer.phone}`)} hitSlop={8} testID="call-cust-btn">
              <MaterialIcon name="phone-outline" size={22} color={colors.onSurface} />
            </Pressable>
            <Pressable
              onPress={() => Linking.openURL(`https://wa.me/91${customer.phone.replace(/[^0-9]/g, "").slice(-10)}`)}
              hitSlop={8}
              testID="direct-wa-btn"
            >
              <MaterialIcon name="whatsapp" size={22} color="#128C7E" />
            </Pressable>
          </>
        ) : null}
        <Pressable onPress={openStatement} hitSlop={8} testID="share-whatsapp-btn">
          <MaterialIcon name="share-variant-outline" size={22} color={colors.brandPrimary} />
        </Pressable>
        <Pressable onPress={() => setEditSheet(true)} hitSlop={10} testID="edit-cust-btn">
          <MaterialIcon name="pencil-outline" size={22} color={colors.onSurface} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl * 2 }}>
        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>{balanceLabel}</Text>
          <Text style={[styles.balanceValue, { color: due > 0 ? colors.error : due < 0 ? (isCustomer ? colors.success : colors.warning) : colors.onSurface }]}>
            {due === 0 ? "क्लियर" : formatINR(Math.abs(due))}
          </Text>
          {totals.debt > 0 || totals.got > 0 ? (
            <Text style={styles.breakdown}>
              {[
                totals.work > 0 ? `काम ${formatINR(totals.work)}` : "",
                totals.given > 0 ? `दिए ${formatINR(totals.given)}` : "",
                `मिले ${formatINR(totals.got)}`,
              ].filter(Boolean).join(" · ")}
            </Text>
          ) : null}
          {customer.notes ? <Text style={styles.notes}>{customer.notes}</Text> : null}
          <View style={styles.actionsRow}>
            <Pressable style={[styles.actionBtn, { backgroundColor: colors.brandPrimary }]} onPress={() => setJobSheet("now")} testID="add-work-btn">
              <MaterialIcon name="plus" size={16} color="#fff" />
              <Text style={styles.actionText}>काम लिखें</Text>
            </Pressable>
            <Pressable style={[styles.actionBtn, { backgroundColor: colors.success }]} onPress={() => setEntrySheet("payment")} testID="add-jama-btn">
              <MaterialIcon name="arrow-bottom-left" size={16} color="#fff" />
              <Text style={styles.actionText}>मिले</Text>
            </Pressable>
            <Pressable style={[styles.actionBtn, { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.error }]} onPress={() => setEntrySheet("given")} testID="add-given-btn">
              <MaterialIcon name="arrow-top-right" size={16} color={colors.error} />
              <Text style={[styles.actionText, { color: colors.error }]}>दिए</Text>
            </Pressable>
          </View>
          {entries.length > 0 ? (
            <Pressable style={styles.statementBtn} onPress={openStatement} testID="share-statement-btn">
              <MaterialIcon name="file-document-outline" size={18} color={colors.brandPrimary} />
              <Text style={styles.statementText}>पूरा हिसाब भेजें</Text>
              <Text style={styles.statementHint}>PDF / WhatsApp</Text>
            </Pressable>
          ) : null}

          {due > 0 ? (
            <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm }}>
              <Pressable
                style={[styles.statementBtn, { flex: 1, backgroundColor: "#FFF8F0", borderColor: "#FDBA74", marginTop: 0 }]}
                onPress={openReminder}
                testID="share-reminder-btn"
              >
                <MaterialIcon name="message-alert-outline" size={18} color="#C2410C" />
                <Text style={[styles.statementText, { color: "#C2410C" }]}>तगादा भेजें</Text>
              </Pressable>
              <Pressable
                style={[styles.statementBtn, { flex: 1, backgroundColor: "#F0FDF4", borderColor: "#86EFAC", marginTop: 0 }]}
                onPress={() => setQrModal(true)}
                testID="open-qr-btn"
              >
                <MaterialIcon name="qrcode-scan" size={18} color={colors.success} />
                <Text style={[styles.statementText, { color: colors.success }]}>QR पेमेंट</Text>
              </Pressable>
            </View>
          ) : null}
        </View>

        {openJobs.length > 0 && (
          <>
            <View style={styles.sectionRow}>
              <Text style={[styles.sectionHead, { marginTop: 0, marginBottom: 0 }]}>आगे का काम / रिमार्क</Text>
              <Pressable onPress={() => setJobSheet("later")} hitSlop={8} testID="add-job-btn">
                <MaterialIcon name="plus-circle-outline" size={22} color={colors.brandPrimary} />
              </Pressable>
            </View>
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
            {LEDGER_FILTERS.filter((f) => {
              if (f === "all") return true;
              if (f === "due") return counts.due > 0;
              return showMoreFilters && counts[f] > 0;
            }).map((f) => {
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
                {e.type !== "payment" ? (
                  <WorkCard entry={e} status={ledger.work.get(e.id)!} onPress={() => setEditing(e)} onSettle={() => setSettling(e)} onReceipt={() => openReceipt(e)} />
                ) : (
                  <JamaCard entry={e} onPress={() => setEditing(e)} onReceipt={() => openReceipt(e)} />
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
      <AddCustomerSheet
        visible={editSheet}
        onClose={() => setEditSheet(false)}
        initial={customer}
        onDelete={() => { store.deleteCustomer(customer.id); router.back(); }}
      />
      <CompleteJobSheet job={completing} onClose={() => setCompleting(null)} />
      <ReceiptSheet doc={shareDoc} onClose={() => setShareDoc(null)} />
      <UpiQrModal
        visible={qrModal}
        onClose={() => setQrModal(false)}
        upiId={user?.shop_upi || ""}
        shopName={user?.shop_name || "खाता"}
        amount={due}
        customerName={customer.name}
      />
    </View>
  );
}

type LedgerFilter = "all" | "due" | "settled" | "cash" | "jama";
const LEDGER_FILTERS: LedgerFilter[] = ["all", "due", "settled", "cash", "jama"];
const LEDGER_FILTER_LABEL: Record<LedgerFilter, string> = { all: "सभी", due: "लेने हैं", settled: "चुकता", cash: "नकद", jama: "मिले" };

// Money handed over (personal loan): same settle flow as udhaar work, different wording.
const GIVEN_UI: Record<WorkState, { label: string; icon: string; fg: string; bg: string }> = {
  cash: { label: "वापस मिले", icon: "check-decagram", fg: colors.success, bg: colors.successSoft },
  pending: { label: "वापस लेने हैं", icon: "arrow-top-right", fg: colors.error, bg: colors.errorSoft },
  partial: { label: "कुछ लेने हैं", icon: "progress-clock", fg: colors.warning, bg: "#FEF3E2" },
  settled: { label: "वापस मिले", icon: "check-decagram", fg: colors.success, bg: colors.successSoft },
};

const STATE_UI: Record<WorkState, { label: string; icon: string; fg: string; bg: string }> = {
  cash: { label: "नकद", icon: "cash", fg: colors.success, bg: colors.successSoft },
  pending: { label: "लेने हैं", icon: "clock-alert-outline", fg: colors.error, bg: colors.errorSoft },
  partial: { label: "कुछ लेने हैं", icon: "progress-clock", fg: colors.warning, bg: "#FEF3E2" },
  settled: { label: "चुकता", icon: "check-decagram", fg: colors.success, bg: colors.successSoft },
};

function ReceiptButton({ entryId, onPress }: { entryId: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={10} style={styles.receiptBtn} testID={`receipt-${entryId}`}>
      <MaterialIcon name="receipt-text-outline" size={20} color={colors.brandPrimary} />
    </Pressable>
  );
}

function WorkCard({ entry, status, onPress, onSettle, onReceipt }: { entry: Entry; status: WorkStatus; onPress: () => void; onSettle: () => void; onReceipt: () => void }) {
  const given = entry.type === "given";
  const ui = (given ? GIVEN_UI : STATE_UI)[status.state];
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
          <Text style={styles.jobTitle} numberOfLines={2}>{entry.description || (given ? "पैसे दिए" : "काम")}</Text>
          <Text style={styles.sub}>{formatDate(entry.date)}{entry.notes ? ` · ${entry.notes}` : ""}</Text>
          {entry.fee && entry.fee > 0 ? (
            <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>
              पोर्टल फीस: {formatINR(entry.fee)} ({entry.feeMode === "cash" ? "नकद" : "बैंक"}) · बचत: {formatINR(entry.amount - entry.fee)}
            </Text>
          ) : null}
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={[styles.amount, open && { color: ui.fg }]}>{formatINR(entry.amount)}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 }}>
            {entry.mode === "online" ? (
              <View style={[styles.statePill, { backgroundColor: colors.infoSoft }]}>
                <Text style={[styles.stateText, { color: colors.info }]}>UPI</Text>
              </View>
            ) : null}
            <View style={[styles.statePill, { backgroundColor: ui.bg }]}>
              {status.state === "settled" ? <MaterialIcon name="check" size={12} color={ui.fg} /> : null}
              <Text style={[styles.stateText, { color: ui.fg }]}>{ui.label}</Text>
            </View>
          </View>
        </View>
        <ReceiptButton entryId={entry.id} onPress={onReceipt} />
      </View>

      {status.state !== "cash" ? (
        <View style={styles.moneyLine}>
          <Text style={styles.moneyText}>कुल {formatINR(entry.amount)}</Text>
          <Text style={styles.moneyText}>
            मिले {formatINR(status.received)}
            {status.paidAtBooking > 0 && laterPaid > 0 ? ` (उसी दिन ${formatINR(status.paidAtBooking)} + बाद में ${formatINR(laterPaid)})` : ""}
            {status.fromJama > 0 && status.settlements.length === 0 ? " (पहले के एडवांस से)" : ""}
          </Text>
          {status.state === "settled" ? (
            <Text style={[styles.moneyText, { color: colors.success, fontWeight: "700" }]}>✔ {status.settledOn ? `${formatDate(status.settledOn)} को ` : ""}चुकता</Text>
          ) : (
            <Text style={[styles.moneyText, { color: colors.error, fontWeight: "800" }]}>लेने हैं {formatINR(status.remaining)}</Text>
          )}
        </View>
      ) : null}

      {open ? (
        <Pressable style={styles.settleBtn} onPress={onSettle} testID={`settle-${entry.id}`}>
          <MaterialIcon name="cash-check" size={16} color="#fff" />
          <Text style={styles.settleText}>{given ? "पैसे वापस मिले" : "पैसे मिले"}{status.state === "partial" ? ` · ${formatINR(status.remaining)}` : ""}</Text>
        </Pressable>
      ) : null}
    </Pressable>
  );
}

function JamaCard({ entry, onPress, onReceipt }: { entry: Entry; onPress: () => void; onReceipt: () => void }) {
  return (
    <Pressable style={styles.card} onPress={onPress} testID={`entry-${entry.id}`}>
      <View style={styles.cardTop}>
        <View style={[styles.iconBadge, { backgroundColor: colors.successSoft }]}>
          <MaterialIcon name="arrow-bottom-left" size={18} color={colors.success} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.jobTitle} numberOfLines={2}>{entry.description || "पैसे मिले"}</Text>
          <Text style={styles.sub}>{formatDate(entry.date)}{entry.notes ? ` · ${entry.notes}` : ""}</Text>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={[styles.amount, { color: colors.success }]}>−{formatINR(entry.amount)}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 }}>
            {entry.mode === "online" ? (
              <View style={[styles.statePill, { backgroundColor: colors.infoSoft }]}>
                <Text style={[styles.stateText, { color: colors.info }]}>UPI</Text>
              </View>
            ) : (
              <View style={[styles.statePill, { backgroundColor: colors.successSoft }]}>
                <Text style={[styles.stateText, { color: colors.success }]}>नकद</Text>
              </View>
            )}
            <View style={[styles.statePill, { backgroundColor: colors.successSoft }]}>
              <Text style={[styles.stateText, { color: colors.success }]}>मिले</Text>
            </View>
          </View>
        </View>
        <ReceiptButton entryId={entry.id} onPress={onReceipt} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  avatar: { width: 44, height: 44, borderRadius: radius.pill, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  avatarText: { fontWeight: "700", color: colors.onBrandTertiary },
  name: { fontSize: 18, fontWeight: "700", color: colors.onSurface },
  sub: { fontSize: 12, color: colors.muted, marginTop: 2 },
  balanceCard: { padding: spacing.xl, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  balanceLabel: { fontSize: 12, color: colors.muted, fontWeight: "700", textTransform: "uppercase" },
  balanceValue: { fontSize: 36, fontWeight: "800", marginTop: spacing.xs },
  notes: { fontSize: 13, color: colors.onSurfaceSecondary, marginTop: spacing.sm },
  breakdown: { fontSize: 13, color: colors.onSurfaceSecondary, marginTop: spacing.xs, fontWeight: "600" },
  actionsRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg },
  actionBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xs, paddingVertical: 11, borderRadius: radius.md },
  actionText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  statementBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xs, marginTop: spacing.sm, paddingVertical: 10, borderRadius: radius.md, borderWidth: 1, borderColor: colors.brandPrimary, backgroundColor: colors.surface },
  statementText: { color: colors.brandPrimary, fontWeight: "700", fontSize: 13 },
  statementHint: { color: colors.muted, fontSize: 11 },
  sectionHead: { fontSize: 17, fontWeight: "700", color: colors.onSurface, marginTop: spacing.xl, marginBottom: spacing.md },
  sectionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.xl, marginBottom: spacing.md },  jobRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  jobTitle: { fontSize: 15, fontWeight: "600", color: colors.onSurface },
  pillBtn: { paddingHorizontal: spacing.md, paddingVertical: 7, backgroundColor: colors.brandPrimary, borderRadius: radius.pill },
  pillBtnText: { color: colors.onBrandPrimary, fontWeight: "700", fontSize: 12 },
  filterChip: { height: 32, paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  filterText: { fontSize: 12, fontWeight: "700", color: colors.onSurface },
  card: { padding: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  cardTop: { flexDirection: "row", gap: spacing.md, alignItems: "flex-start" },
  receiptBtn: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: colors.brandTertiary },
  iconBadge: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  amount: { fontSize: 16, fontWeight: "800", color: colors.onSurface },
  statePill: { flexDirection: "row", alignItems: "center", gap: 2, paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill, marginTop: 4 },
  stateText: { fontSize: 11, fontWeight: "800" },
  moneyLine: { flexDirection: "row", flexWrap: "wrap", columnGap: spacing.md, rowGap: 2, marginTop: spacing.sm, marginLeft: 48 },
  moneyText: { fontSize: 12, color: colors.onSurfaceSecondary },
  settleBtn: { marginTop: spacing.md, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, borderRadius: radius.md, backgroundColor: colors.success },
  settleText: { color: "#fff", fontWeight: "700", fontSize: 12 },
  empty: { alignItems: "center", padding: spacing.xl, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
});
