import { useState } from "react";
import { View, Text, StyleSheet, Linking, Alert, ActivityIndicator } from "react-native";
import MaterialIcon from "@react-native-vector-icons/material-design-icons";
import { colors, spacing, radius } from "@/src/theme";
import { SheetShell } from "@/src/components/sheets";
import { Pressable } from "@/src/components/tap";
import { waNumber } from "@/src/lib/format";
import { pdfSupported, sharePdf, type ShareDoc } from "@/src/lib/receipt";

export function ReceiptSheet({ doc, onClose }: { doc: ShareDoc | null; onClose: () => void }) {
  const [making, setMaking] = useState(false);
  const wa = doc ? waNumber(doc.phone) : "";

  const sendText = () => {
    if (!doc) return;
    const text = encodeURIComponent(doc.message);
    Linking.openURL(wa ? `https://wa.me/${wa}?text=${text}` : `https://wa.me/?text=${text}`)
      .then(onClose)
      .catch(() => Alert.alert("WhatsApp नहीं खुला", "इस फ़ोन पर WhatsApp नहीं मिला।"));
  };

  const sendPdf = async () => {
    if (!doc) return;
    setMaking(true);
    try {
      await sharePdf(doc);
      onClose();
    } catch {
      Alert.alert("PDF नहीं बना", "दोबारा कोशिश करें।");
    } finally {
      setMaking(false);
    }
  };

  return (
    <SheetShell visible={doc !== null} onClose={onClose} title={`${doc?.heading ?? "रसीद"} भेजें`} testID="sheet-receipt">
      {doc ? (
        <View style={styles.preview}>
          <Text style={styles.previewTitle} numberOfLines={1}>{doc.title}</Text>
          <Text style={styles.previewSub}>{doc.sub}</Text>
          {doc.lines.map((l) => (
            <View key={l.label} style={styles.previewRow}>
              <Text style={styles.previewLabel}>{l.label}</Text>
              <Text style={[styles.previewValue, l.tone === "due" && { color: colors.error }, l.tone === "ok" && { color: colors.success }]}>{l.value}</Text>
            </View>
          ))}
          {doc.account ? (
            <View style={[styles.previewRow, styles.accountRow]}>
              <Text style={styles.previewLabel}>{doc.account.label}</Text>
              <Text style={[styles.previewValue, { color: doc.account.tone === "due" ? colors.error : colors.success }]}>{doc.account.value}</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      <Pressable style={[styles.option, { backgroundColor: "#128C7E" }]} onPress={sendText} testID="receipt-text-btn">
        <MaterialIcon name="whatsapp" size={24} color="#fff" />
        <View style={{ flex: 1 }}>
          <Text style={styles.optionTitle}>WhatsApp मैसेज</Text>
          <Text style={styles.optionSub}>{wa ? "सीधे ग्राहक की चैट में खुलेगा" : "फ़ोन नंबर नहीं है, WhatsApp में ग्राहक चुनें"}</Text>
        </View>
      </Pressable>

      <Pressable
        style={[styles.option, { backgroundColor: pdfSupported ? colors.brandPrimary : colors.muted }]}
        onPress={sendPdf}
        disabled={making || !pdfSupported}
        testID="receipt-pdf-btn"
      >
        {making ? <ActivityIndicator color="#fff" /> : <MaterialIcon name="file-pdf-box" size={24} color="#fff" />}
        <View style={{ flex: 1 }}>
          <Text style={styles.optionTitle}>PDF {doc?.heading ?? "रसीद"}</Text>
          <Text style={styles.optionSub}>{pdfSupported ? "WhatsApp चुनें, फिर ग्राहक चुनें" : "PDF के लिए ऐप का नया वर्ज़न इंस्टॉल करें"}</Text>
        </View>
      </Pressable>
    </SheetShell>
  );
}

const styles = StyleSheet.create({
  preview: { padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary, marginBottom: spacing.lg },
  previewTitle: { fontSize: 15, fontWeight: "700", color: colors.onSurface },
  previewSub: { fontSize: 12, color: colors.muted, marginTop: 2, marginBottom: spacing.sm },
  previewRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  previewLabel: { fontSize: 13, color: colors.onSurfaceSecondary },
  previewValue: { fontSize: 13, fontWeight: "700", color: colors.onSurface },
  accountRow: { marginTop: spacing.xs, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  option: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radius.md, marginBottom: spacing.sm },
  optionTitle: { color: "#fff", fontSize: 15, fontWeight: "700" },
  optionSub: { color: "rgba(255,255,255,0.85)", fontSize: 12, marginTop: 2 },
});
