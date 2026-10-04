import { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, TextInput } from "react-native";
import MaterialIcon from "@react-native-vector-icons/material-design-icons";
import { colors, radius, spacing } from "@/src/theme";
import { Pressable } from "@/src/components/tap";
import { addExpense, deleteExpense, expensePersona, EXPENSE_CATEGORIES, PERSONAL_EXPENSE_CATEGORIES, type Expense, type ExpenseMode } from "@/src/lib/expenses";
import { usePersona } from "@/src/lib/persona";
import { dateOnSave, formatDateShort, formatINR, isBackdated, isValidISO, parseAmount, todayISO } from "@/src/lib/format";
import { DangerLink, DateField, SheetShell } from "@/src/components/sheets";
import { store } from "@/src/lib/store";
import { confirmAction } from "@/src/lib/confirm";

export function AddExpenseSheet({
  visible,
  onClose,
  initialDate,
  initial,
  initialMode = "cash",
}: {
  visible: boolean;
  onClose: () => void;
  initialDate?: string;
  /** Opens the sheet on an existing expense to change or delete it. */
  initial?: Expense | null;
  initialMode?: ExpenseMode;
}) {
  const { persona, isPersonal, labels } = usePersona();
  const base = isPersonal ? PERSONAL_EXPENSE_CATEGORIES : EXPENSE_CATEGORIES;
  const categories = initial && !base.includes(initial.title) ? [...base, initial.title] : base;
  const [amount, setAmount] = useState("");
  const [title, setTitle] = useState(categories[0]);
  const [mode, setMode] = useState<ExpenseMode>("cash");
  const [notes, setNotes] = useState("");
  const [date, setDate] = useState(todayISO());
  const [openedOn, setOpenedOn] = useState(todayISO());
  const [saving, setSaving] = useState(false);

  const amountRef = useRef<TextInput>(null);
  useEffect(() => {
    if (!visible) return;
    if (initial) {
      setTitle(initial.title);
      setAmount(String(initial.amount));
      setNotes(initial.notes ?? "");
      setMode(initial.mode);
      setDate(initial.date);
      return;
    }
    setTitle(base[0]);
    setAmount("");
    setNotes("");
    setMode(initialMode);
    setDate(initialDate || todayISO());
    setOpenedOn(todayISO());
    const t = setTimeout(() => amountRef.current?.focus(), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, isPersonal, initial?.id]);

  const amtNum = parseAmount(amount);
  const valid = amtNum > 0 && isValidISO(date);
  // An edit that moves the row before the day it was typed takes it out of galla / bank.
  const nowOld = initial ? isBackdated(date, initial.createdAt) && !isBackdated(initial.date, initial.createdAt) : false;

  const handleSave = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      if (initial) {
        store.updateExpense(initial.id, {
          amount: amtNum,
          title: title.trim() || "खर्च",
          mode,
          date,
          notes: notes.trim(),
          persona: expensePersona(initial),
        });
      } else {
        await addExpense({ amount: amtNum, title: title.trim() || "खर्च", mode, date: dateOnSave(date, openedOn), notes, persona });
      }
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const remove = () => {
    if (!initial) return;
    confirmAction("खर्च हटाएँ?", `${initial.title} · ${formatINR(initial.amount)}`, "हटा दें", () => {
      void deleteExpense(initial.id);
      onClose();
    });
  };

  return (
    <SheetShell
      visible={visible}
      onClose={onClose}
      title={initial ? "खर्च बदलें" : `खर्च लिखें${date < todayISO() ? ` · ${formatDateShort(date)}` : ""}`}
      testID="sheet-expense"
    >
      <View>

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
                ref={amountRef}
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

          <DateField label="तारीख" value={date} onChange={setDate} money={!initial} testID="expense-date" />
          {nowOld ? <Text style={styles.oldNote}>पुरानी तारीख — अब {labels.cash} / बैंक में नहीं गिना जाएगा</Text> : null}

          {/* Save Button */}
          <Pressable
            style={[styles.saveBtn, !valid && { opacity: 0.5 }]}
            disabled={!valid || saving}
            onPress={handleSave}
            testID="expense-save-btn"
          >
            <MaterialIcon name="check" size={20} color={colors.onBrandPrimary} />
            <Text style={styles.saveBtnText}>
              {saving ? "सेव हो रहा है..." : initial ? "बदलाव सेव करें" : "खर्च जोड़ें"}
            </Text>
          </Pressable>
          {initial ? <DangerLink label="यह खर्च हटाएँ" onPress={remove} testID="expense-delete" /> : null}
      </View>
    </SheetShell>
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
