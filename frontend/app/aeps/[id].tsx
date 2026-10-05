import { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Linking, Alert, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import MaterialIcon from "@react-native-vector-icons/material-design-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, spacing, radius } from "@/src/theme";
import { useAeps, useCustomers, useEntries, type AepsTxn } from "@/src/lib/data";
import { AEPS_META, STATUS_META, aepsBill, aepsDue, cashLegDate, cashOf, commissionModeLabel, defaultVia, fieldLabel, isLater, moneyLines, statusLabel, viaBill, type AepsField } from "@/src/lib/aeps";
import { formatDate, formatINR, formatPhone } from "@/src/lib/format";
import { shareMessage } from "@/src/lib/share-text";
import { confirmAction } from "@/src/lib/confirm";
import { useAuth } from "@/src/context/AuthContext";
import { Pressable } from "@/src/components/tap";
import { AepsSheet } from "@/src/components/aeps-sheet";
import { EditHistory } from "@/src/components/edit-history";
import { aepsReceiptDoc, sharePdf } from "@/src/lib/receipt";
import { aepsJamaEntry, cashSettledAeps, completeAeps, failAeps, jamaKindOf, khataPaid, removeAeps } from "@/src/lib/aeps-due";

const TONE = { in: colors.success, out: colors.error, wait: colors.warning, muted: colors.muted } as const;

const DETAIL_ORDER: AepsField[] = [
  "mobile", "aadhaarLast4", "beneficiaryName", "upiId", "bankName", "accountNumber", "ifsc",
  "operator", "rechargeNumber", "billerName", "billAccount", "reference",
];

function displayValue(t: AepsTxn, f: AepsField): string {
  const v = String(t[f] ?? "");
  if (!v) return "";
  if (f === "mobile") return formatPhone(v);
  if (f === "aadhaarLast4") return `XXXX XXXX ${v}`;
  return v;
}

export default function AepsDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const q = useAeps();
  const { user } = useAuth();
  const [editing, setEditing] = useState(false);
  const [sharingPdf, setSharingPdf] = useState(false);
  const customers = useCustomers().data ?? [];
  const entries = useEntries().data;
  const t = (q.data ?? []).find((x) => x.id === id);
  const jama = t ? aepsJamaEntry(t.id, entries ?? []) : undefined;

  if (!t) {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <MaterialIcon name="file-question-outline" size={40} color={colors.muted} />
        <Text style={{ marginTop: spacing.md, color: colors.onSurface }}>{q.isLoading ? "लोड हो रहा है…" : "एंट्री नहीं मिली"}</Text>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Text style={{ color: colors.onBrandPrimary, fontWeight: "600" }}>वापस</Text>
        </Pressable>
      </View>
    );
  }

  const meta = AEPS_META[t.type];
  const st = STATUS_META[t.status];
  const via = t.via || defaultVia(t.type);
  const bill = aepsBill(t);
  const due = aepsDue(t);
  const linked = t.customerId ? customers.find((c) => c.id === t.customerId) : undefined;
  const later = isLater(t);
  const cashPending = t.status === "pending" && cashOf(t) !== "none" && !cashLegDate(t);
  const markDone = () =>
    confirmAction("ट्रांज़ैक्शन हो गया?", `${t.customerName} · ${formatINR(t.amount)} · आज की तारीख में जुड़ेगा`, "हाँ, हो गया", () => completeAeps(t));
  const markCash = () => cashSettledAeps(t);
  const markFailed = () =>
    confirmAction("फेल मार्क करें?", cashLegDate(t) ? "लिया हुआ कैश वापस कर दें, गल्ले से हट जाएगा।" : "हिसाब में नहीं जुड़ेगा।", "फेल करें", () => failAeps(t));
  const details = DETAIL_ORDER.map((f) => ({ f, v: displayValue(t, f) })).filter((d) => d.v);

  const keptLabel = jama ? (jamaKindOf(jama) === "old" ? "पुरानी उधारी में कटे" : "खाते में जमा") : "";
  const share = async () => {
    try {
      const doc = aepsReceiptDoc(t, user || {}, jama?.amount ?? 0, keptLabel);
      const result = await shareMessage(doc.message);
      if (result === "copied") Alert.alert("मैसेज कॉपी हो गया", "जिसे भेजना है, वहाँ पेस्ट कर दें।");
    } catch {
      Alert.alert("शेयर नहीं खुला", "दोबारा कोशिश करें।");
    }
  };

  const handleSharePdf = async () => {
    try {
      setSharingPdf(true);
      const doc = aepsReceiptDoc(t, user || {}, jama?.amount ?? 0, keptLabel);
      await sharePdf(doc);
    } catch {
      Alert.alert("PDF नहीं बन पाई", "दोबारा कोशिश करें।");
    } finally {
      setSharingPdf(false);
    }
  };

  const remove = () => {
    const paidOnKhata = khataPaid(t.id);
    const note = paidOnKhata > 0 ? `\nग्राहक ने खाते में ${formatINR(paidOnKhata)} दिए हैं, वो उनके खाते में जमा रहेंगे।` : "";
    confirmAction("एंट्री हटाएँ?", `${t.customerName} · ${meta.hi}${t.amount > 0 ? ` · ${formatINR(t.amount)}` : ""}${note}`, "हटा दें", () => {
      removeAeps(t);
      router.back();
    });
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={[styles.topBar, { paddingTop: insets.top + spacing.md }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} testID="aeps-back">
          <MaterialIcon name="arrow-left" size={26} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.topTitle}>एंट्री की जानकारी</Text>
        <Pressable onPress={() => setEditing(true)} hitSlop={10} testID="aeps-edit-btn">
          <MaterialIcon name="pencil-outline" size={22} color={colors.onSurface} />
        </Pressable>
        <Pressable onPress={remove} hitSlop={10} testID="aeps-delete-btn">
          <MaterialIcon name="trash-can-outline" size={22} color={colors.error} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl * 2 }}>
        <View style={[styles.hero, { borderColor: meta.color }]}>
          <View style={[styles.heroIcon, { backgroundColor: meta.soft }]}>
            <MaterialIcon name={meta.icon as any} size={28} color={meta.color} />
          </View>
          <Text style={[styles.heroType, { color: meta.color }]}>{t.type === "other" && t.billerName ? t.billerName : meta.hiLabel}</Text>
          {via ? <Text style={styles.heroVia}>via {viaBill(via)}</Text> : null}
          {t.amount > 0 ? <Text style={styles.heroAmount}>{formatINR(t.amount)}</Text> : bill.total > 0 ? <Text style={styles.heroAmount}>{formatINR(bill.total)}</Text> : null}
          <View style={[styles.statusPill, { backgroundColor: later ? colors.infoSoft : st.soft }]}>
            <MaterialIcon name={(later ? "calendar-clock" : st.icon) as any} size={14} color={later ? colors.info : st.color} />
            <Text style={[styles.statusText, { color: later ? colors.info : st.color }]}>{statusLabel(t)}</Text>
          </View>
          <Text style={styles.heroDate}>{formatDate(t.date)}{t.time ? ` · ${t.time}` : ""}</Text>
          {t.doneDate && t.doneDate !== t.date ? <Text style={styles.cashNote}>पूरी हुई: {formatDate(t.doneDate)}</Text> : null}
        </View>

        <View style={[styles.card, { marginTop: spacing.lg }]}>
          {moneyLines(t).map((r) => (
            <View key={r.label} style={styles.row}>
              <Text style={styles.rowLabel}>{r.label}</Text>
              <Text style={[styles.rowValue, { color: TONE[r.tone] }]}>{r.value}</Text>
            </View>
          ))}
          {jama ? (
            <View style={styles.row}>
              <Text style={styles.rowLabel}>{cashOf(t) === "out" ? "गल्ले में रखे (ग्राहक के)" : "ज़्यादा मिले"}</Text>
              <Text style={[styles.rowValue, { color: TONE.in }]}>+{formatINR(jama.amount)}</Text>
            </View>
          ) : null}
          {jama ? (
            <View style={styles.row}>
              <Text style={styles.rowLabel}>ग्राहक का खाता</Text>
              <Text style={[styles.rowValue, { color: colors.info }]}>{jamaKindOf(jama) === "old" ? "पुरानी उधारी में कटे" : "जमा"} {formatINR(jama.amount)}</Text>
            </View>
          ) : null}
        </View>

        {bill.flow !== "out" && bill.total > 0 && t.status !== "failed" ? (
          <View style={styles.billBox}>
            <View style={styles.billCell}>
              <Text style={styles.billLabel}>कुल</Text>
              <Text style={styles.billValue}>{formatINR(bill.total)}</Text>
            </View>
            <View style={[styles.billCell, styles.billMid]}>
              <Text style={styles.billLabel}>जमा</Text>
              <Text style={[styles.billValue, { color: colors.success }]}>{formatINR(bill.settled)}</Text>
            </View>
            <View style={styles.billCell}>
              <Text style={styles.billLabel}>बाकी</Text>
              <Text style={[styles.billValue, { color: bill.due > 0 ? colors.error : colors.success }]}>{bill.due > 0 ? formatINR(bill.due) : "पूरा"}</Text>
            </View>
          </View>
        ) : null}
        {due > 0 && linked ? (
          <Pressable style={[styles.actBtn, { backgroundColor: colors.brandPrimary, marginTop: spacing.sm }]} onPress={() => router.push(`/customer/${linked.id}`)} testID="aeps-open-khata">
            <MaterialIcon name="notebook-outline" size={18} color="#fff" />
            <Text style={styles.actText}>बाकी {formatINR(due)} · खाते में पैसे लें</Text>
          </Pressable>
        ) : null}

        {t.status === "pending" ? (
          <View style={styles.actions}>
            <Pressable style={[styles.actBtn, { backgroundColor: colors.success }]} onPress={markDone} testID="aeps-mark-done">
              <MaterialIcon name="check-circle" size={18} color="#fff" />
              <Text style={styles.actText}>आज हो गया</Text>
            </Pressable>
            {cashPending ? (
              <Pressable style={[styles.actBtn, { backgroundColor: colors.brandPrimary }]} onPress={markCash} testID="aeps-mark-cash">
                <MaterialIcon name="cash-check" size={18} color="#fff" />
                <Text style={styles.actText}>{cashOf(t) === "in" ? "कैश मिल गया" : "कैश दे दिया"}</Text>
              </Pressable>
            ) : null}
            <Pressable style={[styles.actBtn, styles.actGhost]} onPress={markFailed} testID="aeps-mark-failed">
              <MaterialIcon name="close-circle-outline" size={18} color={colors.error} />
              <Text style={[styles.actText, { color: colors.error }]}>फेल</Text>
            </Pressable>
          </View>
        ) : null}

        <Text style={styles.sectionHead}>ग्राहक</Text>
        <View style={styles.card}>
          {linked ? (
            <Pressable style={styles.row} onPress={() => router.push(`/customer/${linked.id}`)} testID="aeps-open-customer">
              <Text style={styles.rowLabel}>नाम</Text>
              <Text style={[styles.rowValue, { color: colors.brandPrimary }]} numberOfLines={1}>{linked.name}</Text>
              <MaterialIcon name="chevron-right" size={18} color={colors.brandPrimary} />
            </Pressable>
          ) : (
            <Row label="नाम" value={t.customerName} />
          )}
          {details.map((d) => (
            <Row key={d.f} label={fieldLabel(t.type, via, d.f).replace(/ \(वैकल्पिक\)$/, "")} value={d.v} mono={d.f === "reference" || d.f === "accountNumber" || d.f === "ifsc" || d.f === "billAccount" || d.f === "upiId"} />
          ))}
        </View>

        {t.commission > 0 || t.notes ? (
          <>
            <Text style={styles.sectionHead}>और जानकारी</Text>
            <View style={styles.card}>
              {t.commission > 0 ? <Row label="कमीशन" value={`${formatINR(t.commission)} · ${commissionModeLabel(t.commissionMode)}`} /> : null}
              {t.notes ? <Row label="नोट" value={t.notes} /> : null}
            </View>
          </>
        ) : null}

        <Pressable
          style={styles.pdfBtn}
          onPress={handleSharePdf}
          disabled={sharingPdf}
          testID="aeps-pdf-btn"
        >
          {sharingPdf ? (
            <ActivityIndicator color={colors.onBrandPrimary} size="small" />
          ) : (
            <MaterialIcon name="file-pdf-box" size={20} color={colors.onBrandPrimary} />
          )}
          <Text style={styles.pdfText}>
            {sharingPdf ? "PDF बन रही है..." : "PDF रसीद (प्रिंट / शेयर)"}
          </Text>
        </Pressable>

        <Pressable style={styles.waBtn} onPress={share} testID="aeps-share-btn">
          <MaterialIcon name="whatsapp" size={20} color="#0B6B5C" />
          <Text style={styles.waText}>WhatsApp रसीद भेजें</Text>
        </Pressable>
        {t.mobile ? (
          <Pressable style={styles.callBtn} onPress={() => Linking.openURL(`tel:${t.mobile}`)} testID="aeps-call-btn">
            <MaterialIcon name="phone-outline" size={18} color={colors.onSurface} />
            <Text style={styles.callText}>कॉल करें</Text>
          </Pressable>
        ) : null}
        <EditHistory coll="aeps" id={t.id} />
      </ScrollView>

      <AepsSheet visible={editing} initial={t} onClose={() => setEditing(false)} />
    </View>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, mono && { fontVariant: ["tabular-nums"] }]} selectable>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  backBtn: { marginTop: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, backgroundColor: colors.brandPrimary, borderRadius: radius.md },
  topBar: { flexDirection: "row", alignItems: "center", gap: spacing.lg, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  topTitle: { flex: 1, fontSize: 18, fontWeight: "700", color: colors.onSurface },
  hero: { alignItems: "center", padding: spacing.xl, borderRadius: radius.lg, backgroundColor: colors.surfaceSecondary, borderTopWidth: 4, borderWidth: 1 },
  heroIcon: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center" },
  heroType: { fontSize: 15, fontWeight: "700", marginTop: spacing.md },
  heroVia: { fontSize: 12, color: colors.onSurfaceSecondary, marginTop: 2 },
  billBox: { flexDirection: "row", marginTop: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary },
  billCell: { flex: 1, alignItems: "center", paddingVertical: spacing.md },
  billMid: { borderLeftWidth: 1, borderRightWidth: 1, borderColor: colors.border },
  billLabel: { fontSize: 12, color: colors.muted, fontWeight: "600" },
  billValue: { fontSize: 17, fontWeight: "800", color: colors.onSurface, marginTop: 2 },
  heroAmount: { fontSize: 36, fontWeight: "800", color: colors.onSurface, marginTop: spacing.xs },
  statusPill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radius.pill, marginTop: spacing.sm },
  statusText: { fontSize: 12, fontWeight: "700" },
  heroDate: { fontSize: 13, color: colors.muted, marginTop: spacing.sm },
  cashNote: { fontSize: 12, color: colors.onSurfaceSecondary, marginTop: 2 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.md },
  actBtn: { flexGrow: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, paddingHorizontal: spacing.md, borderRadius: radius.md },
  actGhost: { borderWidth: 1, borderColor: colors.error, backgroundColor: colors.surface },
  actText: { color: "#fff", fontWeight: "800", fontSize: 14 },
  sectionHead: { fontSize: 16, fontWeight: "700", color: colors.onSurface, marginTop: spacing.xl, marginBottom: spacing.sm },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md },
  row: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  rowLabel: { fontSize: 13, color: colors.muted, flexShrink: 0, maxWidth: "45%" },
  rowValue: { fontSize: 14, fontWeight: "600", color: colors.onSurface, flex: 1, textAlign: "right" },
  pdfBtn: { marginTop: spacing.xl, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, paddingVertical: 14, borderRadius: radius.md, backgroundColor: colors.brandPrimary },
  pdfText: { color: colors.onBrandPrimary, fontWeight: "700", fontSize: 15 },
  waBtn: { marginTop: spacing.sm, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, paddingVertical: 14, borderRadius: radius.md, backgroundColor: "#E7F6F1", borderWidth: 1, borderColor: "#128C7E" },
  waText: { color: "#0B6B5C", fontWeight: "700", fontSize: 15 },
  callBtn: { marginTop: spacing.sm, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, paddingVertical: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  callText: { color: colors.onSurface, fontWeight: "600", fontSize: 14 },
});
