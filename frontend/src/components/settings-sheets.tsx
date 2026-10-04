import { useEffect, useState } from "react";
import { View, Text, StyleSheet, TextInput, Switch } from "react-native";
import MaterialIcon from "@react-native-vector-icons/material-design-icons";
import { colors, radius, spacing } from "@/src/theme";
import { Pressable } from "@/src/components/tap";
import { Field, PrimaryButton, SheetShell, inputStyle } from "@/src/components/sheets";
import { REMINDER_PLACEHOLDERS, savePrefs, usePrefs } from "@/src/lib/prefs";
import { fillReminder } from "@/src/lib/receipt";

const NOTE_EXAMPLES = ["बिका हुआ माल वापस नहीं होगा", "सामान 7 दिन में बदला जा सकता है", "भुगतान 15 दिन में करें"];

/** What every slip carries besides the entry: a footer note, and whether the GSTIN is printed. */
export function ReceiptSettingsSheet({ visible, onClose, hasGst }: { visible: boolean; onClose: () => void; hasGst: boolean }) {
  const prefs = usePrefs();
  const [note, setNote] = useState("");
  const [showGst, setShowGst] = useState(true);
  useEffect(() => {
    if (!visible) return;
    setNote(prefs.receiptNote);
    setShowGst(prefs.showGst);
    // Only when the sheet opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const save = () => {
    void savePrefs({ receiptNote: note.trim(), showGst });
    onClose();
  };

  return (
    <SheetShell visible={visible} onClose={onClose} title="बिल / रसीद सेटिंग" testID="sheet-receipt-settings">
      <Field label="रसीद के नीचे लिखा जाए (वैकल्पिक)">
        <TextInput
          style={[inputStyle, { minHeight: 80, textAlignVertical: "top" }]}
          value={note}
          onChangeText={setNote}
          placeholder="जैसे: बिका हुआ माल वापस नहीं होगा"
          placeholderTextColor={colors.muted}
          multiline
          maxLength={200}
          testID="input-receipt-note"
        />
      </Field>
      <View style={styles.chips}>
        {NOTE_EXAMPLES.map((t) => (
          <Pressable key={t} style={styles.chip} onPress={() => setNote(t)}>
            <Text style={styles.chipText}>{t}</Text>
          </Pressable>
        ))}
      </View>
      {hasGst ? (
        <View style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.switchTitle}>रसीद पर GSTIN छापें</Text>
            <Text style={styles.sub}>बंद करने पर GST नंबर बिल पर नहीं दिखेगा</Text>
          </View>
          <Switch value={showGst} onValueChange={setShowGst} trackColor={{ true: colors.brandPrimary }} testID="toggle-show-gst" />
        </View>
      ) : null}
      <Text style={[styles.sub, { marginBottom: spacing.md }]}>यह नोट ग्राहक की रसीद, खाता विवरण और AEPS रसीद में दिखेगा। निजी खाते की पर्ची में नहीं।</Text>
      <PrimaryButton label="सेव करें" onPress={save} testID="save-receipt-settings" />
    </SheetShell>
  );
}

/** The owner's own WhatsApp reminder; empty keeps the built-in polite text. */
export function ReminderTextSheet({ visible, onClose, shopName }: { visible: boolean; onClose: () => void; shopName: string }) {
  const prefs = usePrefs();
  const [text, setText] = useState("");
  useEffect(() => {
    if (!visible) return;
    setText(prefs.reminderText);
    // Only when the sheet opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  const sample = "नमस्ते {नाम} जी 🙏\n{दुकान} में आपका {रकम} बकाया है। सुविधा अनुसार भुगतान कर दें।";
  const preview = fillReminder(text.trim() || sample, "राम कुमार", 1500, shopName || "मेरी दुकान");

  return (
    <SheetShell visible={visible} onClose={onClose} title="तगादा मैसेज" testID="sheet-reminder-text">
      <Field label="अपना मैसेज">
        <TextInput
          style={[inputStyle, { minHeight: 110, textAlignVertical: "top" }]}
          value={text}
          onChangeText={setText}
          placeholder={sample}
          placeholderTextColor={colors.muted}
          multiline
          maxLength={500}
          testID="input-reminder-text"
        />
      </Field>
      <Text style={styles.sub}>दबाकर जोड़ें — भेजते समय अपने आप भर जाएँगे:</Text>
      <View style={[styles.chips, { marginTop: spacing.xs }]}>
        {REMINDER_PLACEHOLDERS.map((p) => (
          <Pressable key={p} style={[styles.chip, { borderColor: colors.brandPrimary }]} onPress={() => setText((t) => `${t}${t && !t.endsWith(" ") ? " " : ""}${p}`)}>
            <Text style={[styles.chipText, { color: colors.brandPrimary }]}>{p}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={[styles.switchTitle, { marginTop: spacing.md }]}>ऐसा दिखेगा</Text>
      <View style={styles.preview}>
        <Text style={styles.previewText}>{preview}</Text>
      </View>
      <Text style={[styles.sub, { marginBottom: spacing.md }]}>UPI ID और पेमेंट लिंक नीचे अपने आप जुड़ जाएँगे।</Text>
      <PrimaryButton
        label="सेव करें"
        onPress={() => {
          void savePrefs({ reminderText: text.trim() });
          onClose();
        }}
        testID="save-reminder-text"
      />
      {prefs.reminderText ? (
        <Pressable
          onPress={() => {
            void savePrefs({ reminderText: "" });
            onClose();
          }}
          style={{ alignItems: "center", paddingVertical: spacing.md }}
          testID="reset-reminder-text"
        >
          <Text style={{ color: colors.error, fontWeight: "700" }}>पहले वाला मैसेज वापस लगाएँ</Text>
        </Pressable>
      ) : null}
    </SheetShell>
  );
}

const GUIDE: { icon: string; title: string; text: string }[] = [
  { icon: "account-plus-outline", title: "नया ग्राहक / व्यक्ति", text: "होम पर एंट्री लिखते समय नाम लिखें — नया हो तो अपने आप जुड़ जाएगा।" },
  { icon: "briefcase-plus-outline", title: "काम या बिक्री लिखें", text: "“काम लिखें” दबाएँ। पूरे पैसे मिले, कुछ मिले या उधार — तीनों वहीं चुनें।" },
  { icon: "cash-multiple", title: "पैसे मिले", text: "ग्राहक के खाते में “पैसे मिले” दबाएँ। नकद, ऑनलाइन या दोनों में बाँटकर लिख सकते हैं।" },
  { icon: "fingerprint", title: "AEPS / काउंटर", text: "काउंटर टैब में निकासी, जमा, बिल आदि लिखें। कम-ज़्यादा पैसे हों तो बाकी / जमा अपने आप बनते हैं।" },
  { icon: "wallet-outline", title: "गल्ला और बैंक", text: "होम पर गल्ला / बैंक दबाकर हर लेन-देन देखें, फ़िल्टर करें और PDF बनाएँ।" },
  { icon: "whatsapp", title: "तगादा और रसीद", text: "ग्राहक के खाते से रसीद, पूरा खाता विवरण या तगादा सीधे WhatsApp पर भेजें।" },
  { icon: "chart-box-outline", title: "महीने की रिपोर्ट", text: "प्रोफ़ाइल में रिपोर्ट खोलें — कमाई, खर्च, वसूली और सबसे ज़्यादा बकाया एक जगह।" },
  { icon: "cloud-check-outline", title: "बिना इंटरनेट भी", text: "एंट्री फ़ोन में सेव रहती हैं और इंटरनेट मिलते ही अपने आप सर्वर पर चली जाती हैं।" },
];

export function GuideSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return (
    <SheetShell visible={visible} onClose={onClose} title="ऐप कैसे चलाएँ" testID="sheet-guide">
      {GUIDE.map((g) => (
        <View key={g.title} style={styles.guideRow}>
          <View style={styles.guideIcon}>
            <MaterialIcon name={g.icon as any} size={20} color={colors.brandPrimary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.switchTitle}>{g.title}</Text>
            <Text style={styles.sub}>{g.text}</Text>
          </View>
        </View>
      ))}
      <PrimaryButton label="समझ गया" onPress={onClose} testID="guide-done" />
    </SheetShell>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.md },
  chip: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  chipText: { fontSize: 12, fontWeight: "600", color: colors.onSurface },
  switchRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginBottom: spacing.md },
  switchTitle: { fontSize: 14, fontWeight: "700", color: colors.onSurface },
  sub: { fontSize: 12, color: colors.muted, marginTop: 2, lineHeight: 17 },
  preview: { marginTop: spacing.xs, marginBottom: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: "#E7F6EC", borderWidth: 1, borderColor: "#C7E8D2" },
  previewText: { fontSize: 13, color: colors.onSurface, lineHeight: 19 },
  guideRow: { flexDirection: "row", gap: spacing.md, marginBottom: spacing.md },
  guideIcon: { width: 40, height: 40, borderRadius: radius.pill, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
});
