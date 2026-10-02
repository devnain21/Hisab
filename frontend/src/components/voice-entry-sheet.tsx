import { useMemo, useState } from "react";
import { View, Text, StyleSheet, TextInput, Modal, Alert } from "react-native";
import MaterialIcon from "@react-native-vector-icons/material-design-icons";
import { colors, radius, spacing } from "@/src/theme";
import { Pressable } from "@/src/components/tap";
import { formatINR, todayISO } from "@/src/lib/format";
import { useCustomers, type Customer, type EntryType } from "@/src/lib/data";
import { parseQuickText } from "@/src/lib/quick-parser";
import { store } from "@/src/lib/store";

export function VoiceEntryModal({
  visible,
  onClose,
  onSuccess,
}: {
  visible: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}) {
  const [text, setText] = useState("");
  const customers = useCustomers().data ?? [];

  const parsed = useMemo(() => parseQuickText(text, customers), [text, customers]);
  const [overrideType, setOverrideType] = useState<EntryType | null>(null);

  const finalType = overrideType || parsed.type;

  const handleSave = () => {
    if (!parsed.amount || parsed.amount <= 0) {
      Alert.alert("रकम लिखें", "कृपया सही रकम (रुपये) लिखें या बोलें।");
      return;
    }
    if (!parsed.customerName) {
      Alert.alert("नाम लिखें", "कृपया ग्राहक का नाम लिखें या बोलें।");
      return;
    }

    let custId = parsed.customerId;
    if (parsed.isNewCustomer || !custId) {
      const created = store.createCustomer({
        name: parsed.customerName,
        phone: "",
        address: "",
        notes: "बोलकर/क्विक एंट्री से जोड़ा",
      });
      custId = created.id;
    }

    store.createEntry({
      customerId: custId,
      type: finalType,
      date: todayISO(),
      description: parsed.description,
      amount: parsed.amount,
      paid: finalType === "work" ? 0 : undefined,
      notes: "क्विक एंट्री",
    });

    setText("");
    setOverrideType(null);
    onClose();
    if (onSuccess) onSuccess();
  };

  const chips = ["राजू 500 मिले", "अमित 250 फोटोकॉपी", "सुनील 1000 दिए", "राहुल 150 प्रिंट"];

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>🎙️ बोलकर या लिखकर हिसाब जोड़ें</Text>
              <Text style={styles.subtitle}>कीबोर्ड के माइक बटन से बोलें या नीचे टाइप करें</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={12} testID="voice-close">
              <MaterialIcon name="close" size={24} color={colors.onSurface} />
            </Pressable>
          </View>

          <View style={styles.inputBox}>
            <MaterialIcon name="microphone" size={24} color={colors.brandPrimary} />
            <TextInput
              style={styles.textInput}
              placeholder="बोलें या लिखें (उदा. राजू 500 मिले)..."
              placeholderTextColor={colors.muted}
              value={text}
              onChangeText={(t) => {
                setText(t);
                setOverrideType(null);
              }}
              autoFocus
              testID="voice-input"
            />
            {text.length > 0 ? (
              <Pressable onPress={() => setText("")} hitSlop={8}>
                <MaterialIcon name="close-circle" size={20} color={colors.muted} />
              </Pressable>
            ) : null}
          </View>

          {/* Quick suggestion chips */}
          <View style={styles.chipsRow}>
            {chips.map((c) => (
              <Pressable
                key={c}
                style={styles.chip}
                onPress={() => {
                  setText(c);
                  setOverrideType(null);
                }}
              >
                <Text style={styles.chipText}>{c}</Text>
              </Pressable>
            ))}
          </View>

          {/* Parsed Live Preview Card */}
          {text.trim().length > 0 ? (
            <View style={styles.previewCard}>
              <Text style={styles.previewHeading}>पहचाना गया हिसाब:</Text>

              <View style={styles.previewRow}>
                <Text style={styles.previewLabel}>ग्राहक:</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text style={styles.previewValue}>{parsed.customerName || "—"}</Text>
                  {parsed.customerName ? (
                    <View style={[styles.badge, { backgroundColor: parsed.isNewCustomer ? colors.warning + "22" : colors.success + "22" }]}>
                      <Text style={[styles.badgeText, { color: parsed.isNewCustomer ? colors.warning : colors.success }]}>
                        {parsed.isNewCustomer ? "नया" : "मौजूदा"}
                      </Text>
                    </View>
                  ) : null}
                </View>
              </View>

              <View style={styles.previewRow}>
                <Text style={styles.previewLabel}>रकम:</Text>
                <Text style={[styles.previewValue, { fontSize: 18, color: colors.brandPrimary }]}>
                  {parsed.amount > 0 ? formatINR(parsed.amount) : "0"}
                </Text>
              </View>

              <View style={styles.previewRow}>
                <Text style={styles.previewLabel}>प्रकार:</Text>
                <View style={styles.typeSelector}>
                  {(["work", "payment", "given"] as EntryType[]).map((t) => {
                    const active = finalType === t;
                    const label = t === "work" ? "काम" : t === "payment" ? "मिले" : "दिए";
                    return (
                      <Pressable
                        key={t}
                        style={[styles.typeBtn, active && styles.typeBtnActive]}
                        onPress={() => setOverrideType(t)}
                      >
                        <Text style={[styles.typeBtnText, active && styles.typeBtnTextActive]}>
                          {label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <View style={styles.previewRow}>
                <Text style={styles.previewLabel}>विवरण:</Text>
                <Text style={styles.previewValue}>{parsed.description || "—"}</Text>
              </View>

              <Pressable
                style={[styles.saveBtn, (!parsed.amount || !parsed.customerName) && { opacity: 0.5 }]}
                disabled={!parsed.amount || !parsed.customerName}
                onPress={handleSave}
                testID="voice-save"
              >
                <MaterialIcon name="check" size={20} color={colors.onBrandPrimary} />
                <Text style={styles.saveBtnText}>खाते में दर्ज करें</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.tipBox}>
              <MaterialIcon name="lightbulb-on-outline" size={24} color={colors.brandPrimary} />
              <Text style={styles.tipText}>
                टिप: अपने मोबाइल कीबोर्ड के माइक आइकन पर टैप करें और बोलें, जैसे:{"\n"}
                "राकेश पांच सौ रुपये मिले"
              </Text>
            </View>
          )}
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
    maxHeight: "90%",
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
  inputBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: 8,
    borderWidth: 1.5,
    borderColor: colors.brandPrimary,
  },
  textInput: {
    flex: 1,
    fontSize: 16,
    color: colors.onSurface,
    paddingVertical: 4,
  },
  chipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: spacing.sm,
  },
  chip: {
    backgroundColor: colors.surfaceSecondary,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipText: {
    fontSize: 11,
    color: colors.onSurface,
  },
  previewCard: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  previewHeading: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.muted,
    marginBottom: spacing.sm,
  },
  previewRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 4,
  },
  previewLabel: {
    fontSize: 13,
    color: colors.muted,
  },
  previewValue: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.onSurface,
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: "700",
  },
  typeSelector: {
    flexDirection: "row",
    gap: 4,
  },
  typeBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  typeBtnActive: {
    backgroundColor: colors.brandPrimary,
    borderColor: colors.brandPrimary,
  },
  typeBtnText: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.onSurface,
  },
  typeBtnTextActive: {
    color: colors.onBrandPrimary,
  },
  saveBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.brandPrimary,
    paddingVertical: 12,
    borderRadius: radius.md,
    marginTop: spacing.md,
  },
  saveBtnText: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.onBrandPrimary,
  },
  tipBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.brandTertiary,
    padding: spacing.md,
    borderRadius: radius.md,
    marginTop: spacing.lg,
  },
  tipText: {
    flex: 1,
    fontSize: 12,
    color: colors.brandSecondary,
    lineHeight: 18,
  },
});
