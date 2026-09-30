import { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Linking, Alert } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import MaterialIcon from "@react-native-vector-icons/material-design-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, spacing, radius } from "@/src/theme";
import { useAeps, type AepsTxn } from "@/src/lib/data";
import { AEPS_META, FIELD_LABEL, STATUS_META, receiptText, type AepsField } from "@/src/lib/aeps";
import { formatDate, formatINR, formatPhone, waNumber } from "@/src/lib/format";
import { store } from "@/src/lib/store";
import { confirmAction } from "@/src/lib/confirm";
import { useAuth } from "@/src/context/AuthContext";
import { Pressable } from "@/src/components/tap";
import { AepsSheet } from "@/src/components/aeps-sheet";

const DETAIL_ORDER: AepsField[] = [
  "mobile", "aadhaarLast4", "beneficiaryName", "bankName", "accountNumber", "ifsc",
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
  const t = (q.data ?? []).find((x) => x.id === id);

  if (!t) {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <MaterialIcon name="file-question-outline" size={40} color={colors.muted} />
        <Text style={{ marginTop: spacing.md, color: colors.onSurface }}>{q.isLoading ? "लोड हो रहा है…" : "लेन-देन नहीं मिला"}</Text>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Text style={{ color: colors.onBrandPrimary, fontWeight: "600" }}>वापस</Text>
        </Pressable>
      </View>
    );
  }

  const meta = AEPS_META[t.type];
  const st = STATUS_META[t.status];
  const details = DETAIL_ORDER.map((f) => ({ f, v: displayValue(t, f) })).filter((d) => d.v);

  const share = () => {
    const wa = waNumber(t.mobile);
    const text = receiptText(t, user?.shop_name || "बही खाता");
    const url = wa ? `https://wa.me/${wa}?text=${encodeURIComponent(text)}` : `https://wa.me/?text=${encodeURIComponent(text)}`;
    Linking.openURL(url).catch(() => Alert.alert("WhatsApp नहीं खुला", "इस फ़ोन पर WhatsApp नहीं मिला।"));
  };

  const remove = () => {
    confirmAction("लेन-देन हटाएँ?", `${t.customerName} · ${meta.short}${t.amount > 0 ? ` · ${formatINR(t.amount)}` : ""}`, "हटा दें", () => {
      store.deleteAeps(t.id);
      router.back();
    });
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={[styles.topBar, { paddingTop: insets.top + spacing.md }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} testID="aeps-back">
          <MaterialIcon name="arrow-left" size={26} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.topTitle}>लेन-देन की जानकारी</Text>
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
          <Text style={[styles.heroType, { color: meta.color }]}>{meta.label}</Text>
          {t.amount > 0 ? <Text style={styles.heroAmount}>{formatINR(t.amount)}</Text> : null}
          <View style={[styles.statusPill, { backgroundColor: st.soft }]}>
            <MaterialIcon name={st.icon as any} size={14} color={st.color} />
            <Text style={[styles.statusText, { color: st.color }]}>{st.label}</Text>
          </View>
          <Text style={styles.heroDate}>{formatDate(t.date)}{t.time ? ` · ${t.time}` : ""}</Text>
          {meta.cash !== "none" && t.amount > 0 ? (
            <Text style={styles.cashNote}>{meta.cash === "out" ? "ग्राहक को कैश दिया" : "ग्राहक से कैश लिया"}</Text>
          ) : null}
        </View>

        <Text style={styles.sectionHead}>{t.type === "transfer" ? "भेजने वाला" : "ग्राहक"}</Text>
        <View style={styles.card}>
          <Row label="नाम" value={t.customerName} />
          {details.map((d) => (
            <Row key={d.f} label={FIELD_LABEL[d.f]} value={d.v} mono={d.f === "reference" || d.f === "accountNumber" || d.f === "ifsc" || d.f === "billAccount"} />
          ))}
        </View>

        {t.commission > 0 || t.notes ? (
          <>
            <Text style={styles.sectionHead}>और जानकारी</Text>
            <View style={styles.card}>
              {t.commission > 0 ? <Row label="मेरा कमीशन / चार्ज" value={formatINR(t.commission)} /> : null}
              {t.notes ? <Row label="नोट" value={t.notes} /> : null}
            </View>
          </>
        ) : null}

        <Pressable style={styles.waBtn} onPress={share} testID="aeps-share-btn">
          <MaterialIcon name="whatsapp" size={20} color="#128C7E" />
          <Text style={styles.waText}>{t.mobile ? "ग्राहक को WhatsApp पर रसीद भेजें" : "WhatsApp पर रसीद भेजें"}</Text>
        </Pressable>
        {t.mobile ? (
          <Pressable style={styles.callBtn} onPress={() => Linking.openURL(`tel:${t.mobile}`)} testID="aeps-call-btn">
            <MaterialIcon name="phone-outline" size={18} color={colors.onSurface} />
            <Text style={styles.callText}>कॉल करें</Text>
          </Pressable>
        ) : null}
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
  heroAmount: { fontSize: 36, fontWeight: "800", color: colors.onSurface, marginTop: spacing.xs },
  statusPill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radius.pill, marginTop: spacing.sm },
  statusText: { fontSize: 12, fontWeight: "700" },
  heroDate: { fontSize: 13, color: colors.muted, marginTop: spacing.sm },
  cashNote: { fontSize: 12, color: colors.onSurfaceSecondary, marginTop: 2 },
  sectionHead: { fontSize: 16, fontWeight: "700", color: colors.onSurface, marginTop: spacing.xl, marginBottom: spacing.sm },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md },
  row: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  rowLabel: { fontSize: 13, color: colors.muted, flexShrink: 0, maxWidth: "45%" },
  rowValue: { fontSize: 14, fontWeight: "600", color: colors.onSurface, flex: 1, textAlign: "right" },
  waBtn: { marginTop: spacing.xl, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, paddingVertical: 14, borderRadius: radius.md, backgroundColor: "#E7F6F1", borderWidth: 1, borderColor: "#128C7E" },
  waText: { color: "#0B6B5C", fontWeight: "700", fontSize: 15 },
  callBtn: { marginTop: spacing.sm, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, paddingVertical: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  callText: { color: colors.onSurface, fontWeight: "600", fontSize: 14 },
});
