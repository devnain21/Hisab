import { useEffect, useState } from "react";
import { View, Text, StyleSheet, TextInput, Switch, Image, ActivityIndicator } from "react-native";
import MaterialIcon from "@react-native-vector-icons/material-design-icons";
import * as ImagePicker from "expo-image-picker";
import { showNotice } from "@/src/lib/confirm";
import { colors, radius, spacing } from "@/src/theme";
import { Pressable } from "@/src/components/tap";
import { Field, PrimaryButton, SheetShell, inputStyle } from "@/src/components/sheets";
import { DUE_NOTE_DEFAULT, PAID_NOTE_DEFAULT, REMINDER_PLACEHOLDERS, savePrefs, usePrefs } from "@/src/lib/prefs";
import { fillReminder } from "@/src/lib/receipt";
import { useAuth } from "@/src/context/AuthContext";
import { dataUriBytes, useImageShrink } from "@/src/components/image-shrink";

const LOGO_MAX = 100 * 1024;
const SIGN_MAX = 25 * 1024;

const NOTE_EXAMPLES = ["बिका हुआ माल वापस नहीं होगा", "सामान 7 दिन में बदला जा सकता है", "भुगतान 15 दिन में करें"];
const DUE_EXAMPLES = [DUE_NOTE_DEFAULT, "सुविधानुसार बकाया भुगतान कर दें 🙏", "अगली बार आने पर बकाया चुका दें।"];
const PAID_EXAMPLES = [PAID_NOTE_DEFAULT, "पूरा भुगतान मिला, धन्यवाद 🙏", "फिर पधारें 🙏"];

type Picked = "logo" | "sign";

/** Slip settings: logo and signature (kept on the server), footer note, share-text notes and GSTIN. */
export function ReceiptSettingsSheet({ visible, onClose, hasGst }: { visible: boolean; onClose: () => void; hasGst: boolean }) {
  const prefs = usePrefs();
  const { user, setShop } = useAuth();
  const img = useImageShrink();
  const [note, setNote] = useState("");
  const [dueNote, setDueNote] = useState("");
  const [paidNote, setPaidNote] = useState("");
  const [showGst, setShowGst] = useState(true);
  const [logo, setLogo] = useState("");
  const [sign, setSign] = useState("");
  const [busy, setBusy] = useState<Picked | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!visible) return;
    setNote(prefs.receiptNote);
    setDueNote(prefs.dueNote);
    setPaidNote(prefs.paidNote);
    setShowGst(prefs.showGst);
    // A logo saved on this phone by an older version moves to the server on the next save.
    setLogo(user?.shop_logo || prefs.logo);
    setSign(user?.shop_signature || "");
    // Only when the sheet opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const pick = async (kind: Picked) => {
    try {
      const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, ...(kind === "logo" ? { aspect: [1, 1] as [number, number] } : {}), quality: 0.9, base64: true });
      const a = r.canceled ? undefined : r.assets[0];
      if (!a) return;
      const mime = a.mimeType === "image/png" || a.mimeType === "image/webp" ? a.mimeType : "image/jpeg";
      const raw = a.base64 ? `data:${mime};base64,${a.base64}` : a.uri.startsWith("data:image/") ? a.uri : "";
      if (!raw) return;
      setBusy(kind);
      const uri = await img.shrink(raw, kind === "logo" ? { maxSide: 512, maxBytes: LOGO_MAX } : { maxSide: 600, maxBytes: SIGN_MAX, clearWhite: true });
      if (kind === "logo") setLogo(uri);
      else setSign(uri);
    } catch (e) {
      showNotice(
        (e as Error)?.message === "big" ? "फ़ोटो बहुत बड़ी है" : "फ़ोटो नहीं खुली",
        (e as Error)?.message === "big" ? `${kind === "logo" ? "लोगो 100 KB" : "हस्ताक्षर 25 KB"} तक ही रख सकते हैं। छोटी फ़ोटो चुनें।` : "दोबारा कोशिश करें।",
      );
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      void savePrefs({ receiptNote: note.trim(), dueNote: dueNote.trim(), paidNote: paidNote.trim(), showGst });
      const logoOk = !logo || dataUriBytes(logo) <= LOGO_MAX;
      if (user && (logo !== (user.shop_logo || "") || sign !== (user.shop_signature || ""))) {
        await setShop({
          shop_name: user.shop_name || "",
          shop_phone: user.shop_phone || "",
          shop_address: user.shop_address || "",
          shop_gst: user.shop_gst || "",
          shop_logo: logoOk ? logo : user.shop_logo || "",
          shop_signature: sign,
        });
      }
      if (logoOk && prefs.logo) void savePrefs({ logo: "" });
      if (!logoOk) showNotice("पुराना लोगो बड़ा है", "लोगो दोबारा चुनें — 100 KB तक ही सेव होगा।");
      onClose();
    } catch {
      showNotice("सेव नहीं हुआ", "इंटरनेट देखकर दोबारा कोशिश करें।");
    } finally {
      setSaving(false);
    }
  };

  const imageRow = (kind: Picked) => {
    const value = kind === "logo" ? logo : sign;
    return (
      <View style={styles.logoRow}>
        <View style={[styles.logoBox, kind === "sign" && styles.signBox]}>
          {busy === kind ? (
            <ActivityIndicator color={colors.brandPrimary} />
          ) : value ? (
            <Image source={{ uri: value }} style={kind === "sign" ? styles.signImg : styles.logoImg} resizeMode="contain" />
          ) : (
            <MaterialIcon name={kind === "logo" ? "image-outline" : "draw-pen"} size={26} color={colors.muted} />
          )}
        </View>
        <View style={{ flex: 1, gap: spacing.xs }}>
          <Pressable style={styles.logoBtn} onPress={() => void pick(kind)} disabled={!!busy} testID={`pick-${kind}`}>
            <Text style={styles.logoBtnText}>{kind === "logo" ? (logo ? "लोगो बदलें" : "लोगो चुनें") : sign ? "हस्ताक्षर बदलें" : "हस्ताक्षर जोड़ें"}</Text>
          </Pressable>
          {value ? (
            <Pressable onPress={() => (kind === "logo" ? setLogo("") : setSign(""))} hitSlop={6} testID={`remove-${kind}`}>
              <Text style={{ color: colors.error, fontWeight: "700", fontSize: 12 }}>हटाएँ</Text>
            </Pressable>
          ) : (
            <Text style={styles.sub}>{kind === "logo" ? "PNG · JPG · WebP · 100 KB" : "सफ़ेद काग़ज़ पर · 25 KB"}</Text>
          )}
        </View>
      </View>
    );
  };

  const chips = (list: string[], set: (t: string) => void) => (
    <View style={styles.chips}>
      {list.map((t) => (
        <Pressable key={t} style={styles.chip} onPress={() => set(t)}>
          <Text style={styles.chipText}>{t}</Text>
        </Pressable>
      ))}
    </View>
  );

  return (
    <SheetShell visible={visible} onClose={onClose} title="बिल / रसीद सेटिंग" testID="sheet-receipt-settings">
      <Field label="दुकान का लोगो (वैकल्पिक)">{imageRow("logo")}</Field>
      <Field label="हस्ताक्षर (वैकल्पिक)">{imageRow("sign")}</Field>
      <Field label="रसीद के नीचे लिखा जाए (वैकल्पिक)">
        <TextInput style={[inputStyle, styles.multi]} value={note} onChangeText={setNote} placeholder="जैसे: बिका हुआ माल वापस नहीं होगा" placeholderTextColor={colors.muted} multiline maxLength={200} testID="input-receipt-note" />
      </Field>
      {chips(NOTE_EXAMPLES, setNote)}
      <Field label="बकाया होने पर संदेश">
        <TextInput style={[inputStyle, styles.multi]} value={dueNote} onChangeText={setDueNote} placeholder={DUE_NOTE_DEFAULT} placeholderTextColor={colors.muted} multiline maxLength={200} testID="input-due-note" />
      </Field>
      {chips(DUE_EXAMPLES, setDueNote)}
      <Field label="पूरा भुगतान होने पर संदेश">
        <TextInput style={[inputStyle, styles.multi]} value={paidNote} onChangeText={setPaidNote} placeholder={PAID_NOTE_DEFAULT} placeholderTextColor={colors.muted} multiline maxLength={200} testID="input-paid-note" />
      </Field>
      {chips(PAID_EXAMPLES, setPaidNote)}
      {hasGst ? (
        <View style={styles.switchRow}>
          <Text style={[styles.switchTitle, { flex: 1 }]}>रसीद पर GSTIN छापें</Text>
          <Switch value={showGst} onValueChange={setShowGst} trackColor={{ true: colors.brandPrimary }} testID="toggle-show-gst" />
        </View>
      ) : null}
      <PrimaryButton label="सेव करें" onPress={() => void save()} saving={saving} disabled={!!busy} testID="save-receipt-settings" />
      {img.element}
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
  logoRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  logoBox: { width: 64, height: 64, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  logoImg: { width: 64, height: 64 },
  signBox: { width: 128 },
  signImg: { width: 120, height: 56 },
  multi: { minHeight: 64, textAlignVertical: "top" },
  logoBtn: { alignSelf: "flex-start", paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.md, backgroundColor: colors.brandTertiary },
  logoBtnText: { fontSize: 13, fontWeight: "700", color: colors.brandPrimary },
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
