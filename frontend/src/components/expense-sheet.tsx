import { useEffect, useState } from "react";
import { View, Text, StyleSheet, TextInput, Modal } from "react-native";
import MaterialIcon from "@react-native-vector-icons/material-design-icons";
import { colors, radius, spacing } from "@/src/theme";
import { Pressable } from "@/src/components/tap";
import { addExpense, EXPENSE_CATEGORIES, PERSONAL_EXPENSE_CATEGORIES, type ExpenseMode } from "@/src/lib/expenses";
import { usePersona } from "@/src/lib/persona";
import { formatDateShort, todayISO } from "@/src/lib/format";

export function AddExpenseSheet({
  visible,
  onClose,
  initialDate,
}: {
  visible: boolean;
  onClose: () => void;
  initialDate?: string;
}) {
  const { persona, isPersonal, labels } = usePersona();
  const categories = isPersonal ? PERSONAL_EXPENSE_CATEGORIES : EXPENSE_CATEGORIES;
  const [amount, setAmount] = useState("");
  const [title, setTitle] = useState(categories[0]);

  useEffect(() => {
    if (visible) setTitle(categories[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, isPersonal]);
  const [mode, setMode] = useState<ExpenseMode>("cash");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const amtNum = parseFloat(amount) || 0;

  const handleSave = async () => {
    if (amtNum <= 0) return;
    setSaving(true);
    try {
      await addExpense({
        amount: amtNum,
        title: title.trim() || "खर्च",
        mode,
        date: initialDate || todayISO(),
        notes,
        persona,
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
            <Text style={styles.title}>
              खर्च लिखें{initialDate && initialDate < todayISO() ? ` · ${formatDateShort(initialDate)}` : ""}
            </Text>
            <Pressable onPress={onClose} hitSlop={12} testID="expense-close">
              <MaterialIcon name="close" size={24} color={colors.onSurface} />
            </Pressable>
          </View>

          {initialDate && initialDate < todayISO() ? (
            <Text style={styles.oldNote}>पुरानी तारीख — गल्ला / बैंक नहीं बदलेगा</Text>
          ) : null}

          {/* Amount Input */}
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
                testID="expense-amount-input"
              />
            </View>
          </View>

          {/* Source Mode: Cash Drawer vs Online/UPI */}
          <View style={styles.field}>
            <Text style={styles.label}>कहाँ से दिया</Text>
            <View style={styles.modeRow}>
              <Pressable
                style={[styles.modeBtn, mode === "cash" && styles.modeBtnActive]}
                onPress={() => setMode("cash")}
                testID="expense-mode-cash"
              >
                <MaterialIcon
                  name="cash"
                  size={18}
                  color={mode === "cash" ? colors.onBrandPrimary : colors.onSurface}
                />
                <Text style={[styles.modeText, mode === "cash" && styles.modeTextActive]}>
                  {labels.cash} से
                </Text>
              </Pressable>
              <Pressable
                style={[styles.modeBtn, mode === "online" && styles.modeBtnActive]}
                onPress={() => setMode("online")}
                testID="expense-mode-online"
              >
                <MaterialIcon
                  name="qrcode-scan"
                  size={18}
                  color={mode === "online" ? colors.onBrandPrimary : colors.onSurface}
                />
                <Text style={[styles.modeText, mode === "online" && styles.modeTextActive]}>
                  बैंक से
                </Text>
              </Pressable>
            </View>
          </View>

          {/* Category Chips */}
          <View style={styles.field}>
            <Text style={styles.label}>खर्च का प्रकार</Text>
            <View style={styles.chipsWrap}>
              {categories.map((cat) => {
                const active = title === cat;
                return (
                  <Pressable
                    key={cat}
                    style={[styles.chip, active && styles.chipActive]}
                    onPress={() => setTitle(cat)}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>{cat}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Optional Note */}
          <View style={styles.field}>
            <Text style={styles.label}>नोट (वैकल्पिक)</Text>
            <TextInput
              style={styles.textInput}
              placeholder=""
              placeholderTextColor={colors.muted}
              value={notes}
              onChangeText={setNotes}
              testID="expense-notes-input"
            />
          </View>

          {/* Save Button */}
          <Pressable
            style={[styles.saveBtn, amtNum <= 0 && { opacity: 0.5 }]}
            disabled={amtNum <= 0 || saving}
            onPress={handleSave}
            testID="expense-save-btn"
          >
            <MaterialIcon name="check" size={20} color={colors.onBrandPrimary} />
            <Text style={styles.saveBtnText}>
              {saving ? "सेव हो रहा है..." : "खर्च जोड़ें"}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  oldNote: { fontSize: 12, fontWeight: "600", color: colors.warning, marginBottom: spacing.md },
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
  modeRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  modeBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modeBtnActive: {
    backgroundColor: colors.brandPrimary,
    borderColor: colors.brandPrimary,
  },
  modeText: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.onSurface,
  },
  modeTextActive: {
    color: colors.onBrandPrimary,
  },
  chipsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  chip: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: {
    backgroundColor: colors.brandTertiary,
    borderColor: colors.brandPrimary,
  },
  chipText: {
    fontSize: 12,
    color: colors.onSurface,
    fontWeight: "600",
  },
  chipTextActive: {
    color: colors.brandPrimary,
    fontWeight: "700",
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
