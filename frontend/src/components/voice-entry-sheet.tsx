import { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, TextInput, Alert } from "react-native";
import MaterialIcon from "@react-native-vector-icons/material-design-icons";
import { colors, radius, spacing } from "@/src/theme";
import { Pressable } from "@/src/components/tap";
import { formatINR, isValidISO, todayISO } from "@/src/lib/format";
import { useCustomers, type EntryType } from "@/src/lib/data";
import { parseQuickText } from "@/src/lib/quick-parser";
import { store } from "@/src/lib/store";
import { usePersona } from "@/src/lib/persona";
import { DateField, SheetShell } from "@/src/components/sheets";

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
  const { isPersonal } = usePersona();
  const allCustomers = useCustomers().data;
  const customers = useMemo(
    () => (allCustomers ?? []).filter((c) => (isPersonal ? c.persona === "personal" : c.persona !== "personal")),
    [allCustomers, isPersonal]
  );

  const parsed = useMemo(() => parseQuickText(text, customers), [text, customers]);
  const [overrideType, setOverrideType] = useState<EntryType | null>(null);
  const [mode, setMode] = useState<"cash" | "online">("cash");
  const [dateOverride, setDateOverride] = useState<string | null>(null);

  const busy = useRef(false);

  useEffect(() => {
    if (!visible) return;
    setText("");
    setOverrideType(null);
    setMode("cash");
    setDateOverride(null);
    busy.current = false;
  }, [visible]);

  // The shop book has no "goods taken" row; guessing "work" would flip who owes whom, so ask.
  const shopPurchase = !isPersonal && parsed.type === "purchase";
  const parsedType: EntryType | null = isPersonal ? (parsed.type === "work" ? "given" : parsed.type) : shopPurchase ? null : parsed.type;
  const finalType = overrideType || parsedType;
  const types: EntryType[] = isPersonal ? ["given", "payment", "purchase"] : ["work", "payment", "given"];
  const date = dateOverride ?? todayISO(parsed.dateOffset);
  const typeLabel = (t: EntryType) => (t === "work" ? "काम" : t === "payment" ? "मिले" : t === "purchase" ? "सामान लिया" : "दिए");

  const handleSave = () => {
    if (busy.current) return;
    if (!finalType) {
      Alert.alert("प्रकार चुनें", "काम, मिले या दिए में से एक चुनें।");
      return;
    }
    if (!parsed.amount || parsed.amount <= 0) {
      Alert.alert("रकम लिखें");
      return;
    }
    if (!parsed.customerName) {
      Alert.alert("नाम लिखें");
      return;
    }
    if (!isValidISO(date)) {
      Alert.alert("तारीख सही लिखें");
      return;
    }

    busy.current = true;
    const day = dateOverride ?? todayISO(parsed.dateOffset);
    let custId = parsed.customerId;
    if (parsed.isNewCustomer || !custId) {
      const created = store.createCustomer({
        name: parsed.customerName,
        phone: "",
        address: "",
        notes: "",
        persona: isPersonal ? "personal" : "business",
      });
      custId = created.id;
    }

    store.createEntry({
      customerId: custId,
      type: finalType,
      date: day,
      description: parsed.description,
      amount: parsed.amount,
      paid: finalType === "work" || finalType === "purchase" ? 0 : undefined,
      mode: finalType === "work" || finalType === "purchase" ? undefined : mode,
      notes: "",
    });

    onClose();
    if (onSuccess) onSuccess();
  };

  const chips = isPersonal ? ["राजू 500 मिले", "सुनील 1000 दिए"] : ["राजू 500 मिले", "अमित 250 फोटोकॉपी", "सुनील 1000 दिए"];

  return (
    <SheetShell visible={visible} onClose={onClose} title="बोलकर हिसाब" testID="sheet-voice">
      <View>

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
                setDateOverride(null);
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
                  setDateOverride(null);
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
                <Text style={styles.previewLabel}>{isPersonal ? "व्यक्ति:" : "ग्राहक:"}</Text>
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
                  {types.map((t) => {
                    const active = finalType === t;
                    const label = typeLabel(t);
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
              {shopPurchase && !overrideType ? (
                <Text style={styles.warnText}>दुकान खाते में &quot;सामान लिया&quot; नहीं लिखा जाता। सही प्रकार चुनें या निजी खाते में लिखें।</Text>
              ) : null}

              {finalType && finalType !== "work" && finalType !== "purchase" ? (
                <View style={styles.previewRow}>
                  <Text style={styles.previewLabel}>कैसे</Text>
                  <View style={styles.typeSelector}>
                    {(["cash", "online"] as const).map((m) => (
                      <Pressable key={m} style={[styles.typeBtn, mode === m && styles.typeBtnActive]} onPress={() => setMode(m)} testID={`voice-mode-${m}`}>
                        <Text style={[styles.typeBtnText, mode === m && styles.typeBtnTextActive]}>{m === "cash" ? "नकद" : "ऑनलाइन"}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ) : null}

              <View style={styles.previewRow}>
                <Text style={styles.previewLabel}>विवरण:</Text>
                <Text style={styles.previewValue}>{parsed.description || "—"}</Text>
              </View>

              <DateField label="तारीख" value={date} onChange={setDateOverride} money testID="voice-date" />

              <Pressable
                style={[styles.saveBtn, (!parsed.amount || !parsed.customerName || !finalType) && { opacity: 0.5 }]}
                disabled={!parsed.amount || !parsed.customerName || !finalType}
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
                कीबोर्ड का माइक दबाकर बोलें: &quot;राकेश 500 मिले&quot; या &quot;कल राजू 200 दिए&quot;
              </Text>
            </View>
          )}
      </View>
    </SheetShell>
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
    fontSize: 12,
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
    fontSize: 12,
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
    fontSize: 12,
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
  warnText: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.warning,
    marginTop: 2,
    marginBottom: 4,
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
