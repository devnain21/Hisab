import { useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import MaterialIcon from "@react-native-vector-icons/material-design-icons";
import { Pressable } from "@/src/components/tap";
import { api } from "@/src/lib/api";
import { formatDateShort, formatINR, localDay } from "@/src/lib/format";
import { colors, radius, spacing } from "@/src/theme";

type Coll = "customers" | "entries" | "jobs" | "aeps" | "expenses" | "moves";
type Change = { at: string; changes: Record<string, [unknown, unknown]> };

const LABELS: Record<string, string> = {
  amount: "रकम",
  paid: "मिले",
  fee: "फीस",
  feeMode: "फीस का तरीका",
  description: "विवरण",
  notes: "नोट",
  note: "नोट",
  date: "तारीख",
  payMode: "तरीका",
  type: "प्रकार",
  customerId: "खाता",
  linkId: "जुड़ा हुआ",
  title: "काम",
  estimatedAmount: "अनुमानित रकम",
  dueDate: "तारीख",
  status: "स्थिति",
  name: "नाम",
  phone: "फ़ोन",
  address: "पता",
  creditLimit: "उधार सीमा",
  commission: "कमीशन",
  commissionDate: "कमीशन की तारीख",
  service: "सेवा",
  category: "श्रेणी",
  src: "से",
  dst: "में",
};
const MONEY = new Set(["amount", "paid", "fee", "estimatedAmount", "creditLimit", "commission"]);

function show(key: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (MONEY.has(key) && typeof v === "number") return formatINR(v);
  if (typeof v === "boolean") return v ? "हाँ" : "नहीं";
  if (typeof v === "object") return "बदला";
  if (key.toLowerCase().includes("date") && typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return formatDateShort(v);
  return String(v);
}

function when(iso: string): string {
  const d = new Date(iso);
  const hm = d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
  return `${formatDateShort(localDay(iso) ?? iso.slice(0, 10))} · ${hm}`;
}

/** Who-changed-what for one record, loaded from the server only when opened. */
export function EditHistory({ coll, id }: { coll: Coll; id: string }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Change[] | null>(null);
  const [failed, setFailed] = useState(false);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (!next || rows) return;
    setFailed(false);
    try {
      setRows(await api.getHistory(coll, id));
    } catch {
      setFailed(true);
    }
  };

  return (
    <View style={styles.box}>
      <Pressable onPress={toggle} style={styles.head} accessibilityRole="button" testID={`history-${id}`}>
        <MaterialIcon name="history" size={18} color={colors.muted} />
        <Text style={styles.headText}>बदलाव का इतिहास</Text>
        <MaterialIcon name={open ? "chevron-up" : "chevron-down"} size={18} color={colors.muted} />
      </Pressable>
      {!open ? null : failed ? (
        <Text style={styles.empty}>सर्वर से जुड़ नहीं पाए</Text>
      ) : rows === null ? (
        <ActivityIndicator color={colors.brandPrimary} style={{ marginVertical: spacing.sm }} />
      ) : rows.length === 0 ? (
        <Text style={styles.empty}>लिखने के बाद कोई बदलाव नहीं हुआ</Text>
      ) : (
        rows.map((r, i) => (
          <View key={`${r.at}-${i}`} style={styles.row}>
            <Text style={styles.when}>{when(r.at)}</Text>
            {Object.entries(r.changes).map(([k, [from, to]]) => (
              <Text key={k} style={styles.change}>
                <Text style={styles.key}>{LABELS[k] ?? k}: </Text>
                <Text style={styles.from}>{show(k, from)}</Text>
                {"  →  "}
                <Text style={styles.to}>{show(k, to)}</Text>
              </Text>
            ))}
          </View>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { marginTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm },
  head: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 40 },
  headText: { flex: 1, fontSize: 14, fontWeight: "600", color: colors.muted },
  empty: { fontSize: 13, color: colors.muted, paddingVertical: spacing.sm },
  row: { paddingVertical: spacing.sm, paddingHorizontal: spacing.sm, marginTop: spacing.xs, borderRadius: radius.sm, backgroundColor: colors.surfaceSecondary },
  when: { fontSize: 12, fontWeight: "700", color: colors.muted, marginBottom: 2 },
  change: { fontSize: 13, color: colors.onSurface, lineHeight: 19 },
  key: { fontWeight: "600" },
  from: { color: colors.muted, textDecorationLine: "line-through" },
  to: { fontWeight: "700" },
});
