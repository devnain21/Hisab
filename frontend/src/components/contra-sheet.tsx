import { useState } from "react";
import { View, Text, StyleSheet, TextInput, Modal } from "react-native";
import MaterialIcon from "@react-native-vector-icons/material-design-icons";
import { colors, radius, spacing } from "@/src/theme";
import { Pressable } from "@/src/components/tap";
import { addContraTransfer, type ContraType } from "@/src/lib/contra";
import { todayISO } from "@/src/lib/format";

export function ContraSheet({
  visible,
  onClose,
  initialDate,
}: {
  visible: boolean;
  onClose: () => void;
  initialDate?: string;
}) {
  const [amount, setAmount] = useState("");
  const [type, setType] = useState<ContraType>("bank_to_cash");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const amtNum = parseFloat(amount) || 0;

  const handleSave = async () => {
    if (amtNum <= 0) return;
    setSaving(true);
    try {
      await addContraTransfer({
        type,
        amount: amtNum,
        date: initialDate || todayISO(),
        notes,
      });
      setAmount("");
      setNotes("");
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>🔁 नकद व बैंक आपसी ट्रांसफर</Text>
              <Text style={styles.subtitle}>ATM से निकासी या बैंक में जमा</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={12} testID="contra-close">
              <MaterialIcon name="close" size={24} color={colors.onSurface} />
            </Pressable>
          </View>

          {/* Amount */}
          <View style={styles.field}>
            <Text style={styles.label}>रकम (₹)</Text>
            <View style={styles.amountInputWrap}>
              <Text style={styles.currencyPrefix}>₹</Text>
              <TextInput
                style={styles.amountInput}
                keyboardType="numeric"
                placeholder="0"
                placeholderTextColor={colors.muted}
                value={amount}
                onChangeText={setAmount}
                autoFocus
                testID="contra-amount-input"
              />
            </View>
          </View>

          {/* Transfer Type */}
          <View style={styles.field}>
            <Text style={styles.label}>ट्रांसफर प्रकार</Text>
            <View style={styles.typeRow}>
              <Pressable
                style={[styles.typeBtn, type === "bank_to_cash" && styles.typeBtnActive]}
                onPress={() => setType("bank_to_cash")}
                testID="contra-bank-to-cash"
              >
                <MaterialIcon
                  name="bank-transfer-out"
                  size={20}
                  color={type === "bank_to_cash" ? colors.onBrandPrimary : colors.onSurface}
                />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.typeText, type === "bank_to_cash" && styles.typeTextActive]}>
                    ATM / बैंक से नकद निकाले
                  </Text>
                  <Text style={[styles.typeSub, type === "bank_to_cash" && { color: "#E0F2F1" }]}>
                    बैंक से घटेगा, गल्ले में बढ़ेगा
                  </Text>
                </View>
              </Pressable>

              <Pressable
                style={[styles.typeBtn, type === "cash_to_bank" && styles.typeBtnActive]}
                onPress={() => setType("cash_to_bank")}
                testID="contra-cash-to-bank"
              >
                <MaterialIcon
                  name="bank-transfer-in"
                  size={20}
                  color={type === "cash_to_bank" ? colors.onBrandPrimary : colors.onSurface}
                />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.typeText, type === "cash_to_bank" && styles.typeTextActive]}>
                    गल्ले से बैंक में जमा किए
                  </Text>
                  <Text style={[styles.typeSub, type === "cash_to_bank" && { color: "#E0F2F1" }]}>
                    गल्ले से घटेगा, बैंक में बढ़ेगा
                  </Text>
                </View>
              </Pressable>
            </View>
          </View>

          {/* Notes */}
          <View style={styles.field}>
            <Text style={styles.label}>रिमार्क (वैकल्पिक)</Text>
            <TextInput
              style={styles.textInput}
              placeholder="जैसे SBI ATM से निकाले"
              placeholderTextColor={colors.muted}
              value={notes}
              onChangeText={setNotes}
              testID="contra-notes-input"
            />
          </View>

          <Pressable
            style={[styles.saveBtn, amtNum <= 0 && { opacity: 0.5 }]}
            disabled={amtNum <= 0 || saving}
            onPress={handleSave}
            testID="contra-save-btn"
          >
            <MaterialIcon name="check" size={20} color={colors.onBrandPrimary} />
            <Text style={styles.saveBtnText}>
              {saving ? "सेव हो रहा है..." : "ट्रांसफर दर्ज करें"}
            </Text>
          </Pressable>
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
  field: {
    marginBottom: spacing.md,
  },
  label: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.muted,
    marginBottom: 6,
  },
  amountInputWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.brandPrimary,
    paddingHorizontal: spacing.md,
  },
  currencyPrefix: {
    fontSize: 22,
    fontWeight: "800",
    color: colors.brandPrimary,
    marginRight: 6,
  },
  amountInput: {
    flex: 1,
    fontSize: 24,
    fontWeight: "800",
    color: colors.onSurface,
    paddingVertical: 8,
  },
  typeRow: {
    gap: spacing.sm,
  },
  typeBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  typeBtnActive: {
    backgroundColor: colors.brandPrimary,
    borderColor: colors.brandPrimary,
  },
  typeText: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.onSurface,
  },
  typeTextActive: {
    color: colors.onBrandPrimary,
  },
  typeSub: {
    fontSize: 11,
    color: colors.muted,
    marginTop: 2,
  },
  textInput: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.onSurface,
  },
  saveBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.brandPrimary,
    paddingVertical: 14,
    borderRadius: radius.md,
    marginTop: spacing.sm,
  },
  saveBtnText: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.onBrandPrimary,
  },
});
