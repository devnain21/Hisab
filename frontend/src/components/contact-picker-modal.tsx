import { useEffect, useState } from "react";
import { View, Text, StyleSheet, TextInput, Modal, Platform } from "react-native";
import MaterialIcon from "@react-native-vector-icons/material-design-icons";
import { colors, radius, spacing } from "@/src/theme";
import { Pressable } from "@/src/components/tap";
import { formatPhone } from "@/src/lib/format";

export function ContactPickerModal({
  visible,
  onClose,
  onSelect,
}: {
  visible: boolean;
  onClose: () => void;
  onSelect: (name: string, phone: string) => void;
}) {
  const [inputText, setInputText] = useState("");
  const [clipboardSnippet, setClipboardSnippet] = useState<{ name: string; phone: string } | null>(null);

  const parseRawContact = (text: string) => {
    if (!text.trim()) return null;
    const digitsOnly = text.replace(/[^0-9]/g, "");
    const cleanPhone = digitsOnly.length >= 10 ? digitsOnly.slice(-10) : "";
    // Remove the phone number and common prefixes to extract the name
    const cleanName = text
      .replace(/(\+91|91)?\s*[\d\s-]{10,15}/g, "")
      .replace(/[0-9]/g, "")
      .replace(/[^\w\s\u0900-\u097F]/gi, "")
      .trim();

    return {
      name: cleanName,
      phone: cleanPhone,
    };
  };

  useEffect(() => {
    if (visible && Platform.OS === "web" && typeof navigator !== "undefined" && navigator.clipboard?.readText) {
      navigator.clipboard.readText().then((txt) => {
        const parsed = parseRawContact(txt);
        if (parsed && (parsed.phone || parsed.name)) {
          setClipboardSnippet(parsed);
        }
      }).catch(() => {});
    }
  }, [visible]);

  // Try Web / Android Contacts API if available
  const handlePickFromNative = async () => {
    if (Platform.OS === "web" && "contacts" in navigator && "ContactsManager" in window) {
      try {
        const contacts = await (navigator as any).contacts.select(["name", "tel"], { multiple: false });
        if (contacts && contacts[0]) {
          const first = contacts[0];
          const name = first.name?.[0] || "";
          const rawTel = first.tel?.[0] || "";
          const parsed = parseRawContact(`${name} ${rawTel}`);
          if (parsed) {
            onSelect(parsed.name, parsed.phone);
            onClose();
            return;
          }
        }
      } catch {}
    }
  };

  const handleApply = () => {
    const parsed = parseRawContact(inputText);
    if (parsed) {
      onSelect(parsed.name, parsed.phone);
      setInputText("");
      onClose();
    }
  };

  const currentParsed = parseRawContact(inputText);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>📱 फ़ोन बुक से चुनें / पेस्ट करें</Text>
              <Text style={styles.subtitle}>Truecaller, WhatsApp या Contacts से कॉपी किया गया विवरण</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={12} testID="contact-picker-close">
              <MaterialIcon name="close" size={24} color={colors.onSurface} />
            </Pressable>
          </View>

          {/* Clipboard detected card */}
          {clipboardSnippet && clipboardSnippet.phone ? (
            <View style={styles.clipboardBox}>
              <View style={{ flex: 1 }}>
                <Text style={styles.clipLabel}>📋 क्लिपबोर्ड पर मिला:</Text>
                <Text style={styles.clipVal}>
                  {clipboardSnippet.name ? `${clipboardSnippet.name} · ` : ""}
                  {formatPhone(clipboardSnippet.phone)}
                </Text>
              </View>
              <Pressable
                style={styles.clipUseBtn}
                onPress={() => {
                  onSelect(clipboardSnippet.name, clipboardSnippet.phone);
                  onClose();
                }}
                testID="use-clipboard-btn"
              >
                <Text style={styles.clipUseText}>सीधा भरें</Text>
              </Pressable>
            </View>
          ) : null}

          {/* Native Contacts Button if web browser supports it */}
          {Platform.OS === "web" && "contacts" in (typeof navigator !== "undefined" ? navigator : {}) ? (
            <Pressable style={styles.nativeBtn} onPress={handlePickFromNative} testID="native-contacts-btn">
              <MaterialIcon name="contacts" size={20} color={colors.brandPrimary} />
              <Text style={styles.nativeBtnText}>फ़ोन की संपर्क सूची (Contacts) खोलें</Text>
            </Pressable>
          ) : null}

          {/* Quick Paste Input */}
          <View style={styles.field}>
            <Text style={styles.label}>कॉपी किया गया टेक्स्ट यहाँ पेस्ट करें:</Text>
            <TextInput
              style={styles.input}
              placeholder="उदा. 'राकेश शर्मा +91 98765 43210' या सिर्फ 10 अंक..."
              placeholderTextColor={colors.muted}
              value={inputText}
              onChangeText={setInputText}
              autoFocus
              testID="contact-paste-input"
            />
          </View>

          {/* Live Preview */}
          {currentParsed && (currentParsed.phone || currentParsed.name) ? (
            <View style={styles.previewBox}>
              <Text style={styles.previewHeading}>पहचाना गया संपर्क:</Text>
              <View style={styles.previewRow}>
                <Text style={styles.previewLabel}>नाम:</Text>
                <Text style={styles.previewVal}>{currentParsed.name || "—"}</Text>
              </View>
              <View style={styles.previewRow}>
                <Text style={styles.previewLabel}>मोबाइल (10 अंक):</Text>
                <Text style={[styles.previewVal, { color: colors.brandPrimary, fontWeight: "800" }]}>
                  {currentParsed.phone ? formatPhone(currentParsed.phone) : "—"}
                </Text>
              </View>

              <Pressable
                style={[styles.applyBtn, !currentParsed.phone && !currentParsed.name && { opacity: 0.5 }]}
                onPress={handleApply}
                testID="apply-contact-btn"
              >
                <MaterialIcon name="check" size={20} color={colors.onBrandPrimary} />
                <Text style={styles.applyBtnText}>यह जानकारी भरें</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
    maxHeight: "85%",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: spacing.md,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.onSurface,
  },
  subtitle: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 2,
  },
  clipboardBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.brandTertiary,
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.brandPrimary,
  },
  clipLabel: {
    fontSize: 11,
    color: colors.brandSecondary,
    fontWeight: "700",
  },
  clipVal: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.onSurface,
    marginTop: 2,
  },
  clipUseBtn: {
    backgroundColor: colors.brandPrimary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.sm,
  },
  clipUseText: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.onBrandPrimary,
  },
  nativeBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.surfaceSecondary,
    paddingVertical: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
  },
  nativeBtnText: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.brandPrimary,
  },
  field: {
    marginBottom: spacing.sm,
  },
  label: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.muted,
    marginBottom: 6,
  },
  input: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.onSurface,
  },
  previewBox: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  previewHeading: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.muted,
    marginBottom: 4,
  },
  previewRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 3,
  },
  previewLabel: {
    fontSize: 13,
    color: colors.muted,
  },
  previewVal: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.onSurface,
  },
  applyBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: colors.brandPrimary,
    paddingVertical: 10,
    borderRadius: radius.md,
    marginTop: spacing.md,
  },
  applyBtnText: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.onBrandPrimary,
  },
});
