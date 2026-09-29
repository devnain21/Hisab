import React, { useState, useEffect, useMemo } from "react";
import { Modal, View, Text, StyleSheet, Pressable, TextInput, ScrollView, Platform, KeyboardAvoidingView, ActivityIndicator } from "react-native";
import MaterialIcon from "@react-native-vector-icons/material-design-icons";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/src/lib/api";
import { useCustomers } from "@/src/lib/data";
import { colors, spacing, radius } from "@/src/theme";
import { todayISO } from "@/src/lib/format";

function SheetShell({ visible, onClose, title, children, testID }: any) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={styles.sheet} testID={testID}>
          <View style={styles.grabber} />
          <View style={styles.headerRow}>
            <Text style={styles.title}>{title}</Text>
            <Pressable onPress={onClose} testID="sheet-close" hitSlop={12}>
              <MaterialIcon name="close" size={22} color={colors.muted} />
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled">{children}</ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Field({ label, children }: any) {
  return (
    <View style={{ marginBottom: spacing.md }}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

const inputStyle = {
  borderWidth: 1,
  borderColor: colors.border,
  backgroundColor: colors.surface,
  borderRadius: radius.md,
  padding: spacing.md,
  fontSize: 15,
  color: colors.onSurface,
  minHeight: 48,
};

export function AddCustomerSheet({ visible, onClose, initial }: { visible: boolean; onClose: () => void; initial?: any }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      setName(initial?.name ?? "");
      setPhone(initial?.phone ?? "");
      setAddress(initial?.address ?? "");
      setNotes(initial?.notes ?? "");
    }
  }, [visible, initial]);

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const body = { name: name.trim(), phone: phone.trim(), address: address.trim(), notes: notes.trim() };
      if (initial?.id) await api.updateCustomer(initial.id, body);
      else await api.createCustomer(body);
      qc.invalidateQueries({ queryKey: ["customers"] });
      onClose();
    } finally { setSaving(false); }
  };

  return (
    <SheetShell visible={visible} onClose={onClose} title={initial ? "ग्राहक बदलें" : "नया ग्राहक"} testID="sheet-customer">
      <Field label="नाम">
        <TextInput style={inputStyle} value={name} onChangeText={setName} placeholder="जैसे रामलाल शर्मा" placeholderTextColor={colors.muted} testID="input-cust-name" />
      </Field>
      <Field label="फ़ोन (वैकल्पिक)">
        <TextInput style={inputStyle} value={phone} onChangeText={setPhone} placeholder="10 अंक" placeholderTextColor={colors.muted} keyboardType="phone-pad" testID="input-cust-phone" />
      </Field>
      <Field label="पता (वैकल्पिक)">
        <TextInput style={inputStyle} value={address} onChangeText={setAddress} placeholder="मोहल्ला, गली" placeholderTextColor={colors.muted} testID="input-cust-address" />
      </Field>
      <Field label="नोट (वैकल्पिक)">
        <TextInput style={[inputStyle, { minHeight: 72 }]} value={notes} onChangeText={setNotes} multiline placeholderTextColor={colors.muted} testID="input-cust-notes" />
      </Field>
      <Pressable style={[styles.primaryBtn, (!name.trim() || saving) && { opacity: 0.5 }]} disabled={!name.trim() || saving} onPress={save} testID="save-customer-btn">
        {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>{initial ? "बदलाव सेव करें" : "ग्राहक जोड़ें"}</Text>}
      </Pressable>
    </SheetShell>
  );
}

export function AddEntrySheet({ visible, type, onClose, customerId: fixedCustomerId }: { visible: boolean; type: "work" | "payment"; onClose: () => void; customerId?: string }) {
  const qc = useQueryClient();
  const customersQ = useCustomers();
  const customers = customersQ.data ?? [];
  const [customerId, setCustomerId] = useState<string>("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayISO());
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      setCustomerId(fixedCustomerId ?? customers[0]?.id ?? "");
      setDescription("");
      setAmount("");
      setDate(todayISO());
      setNotes("");
    }
  }, [visible, fixedCustomerId, customers.length]);

  const save = async () => {
    const amt = parseFloat(amount);
    if (!customerId || !description.trim() || !isFinite(amt) || amt <= 0) return;
    setSaving(true);
    try {
      await api.createEntry({ customerId, type, date, description: description.trim(), amount: amt, notes: notes.trim() });
      qc.invalidateQueries({ queryKey: ["entries"] });
      onClose();
    } finally { setSaving(false); }
  };

  const title = type === "work" ? "उधार काम जोड़ें" : "जमा लिखें";

  return (
    <SheetShell visible={visible} onClose={onClose} title={title} testID={`sheet-entry-${type}`}>
      {!fixedCustomerId && (
        <Field label="ग्राहक">
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingRight: spacing.md }}>
            {customers.map((c) => (
              <Pressable key={c.id} onPress={() => setCustomerId(c.id)} style={[styles.chip, customerId === c.id && styles.chipActive]} testID={`chip-cust-${c.id}`}>
                <Text style={[styles.chipText, customerId === c.id && { color: colors.onBrandPrimary }]} numberOfLines={1}>{c.name}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </Field>
      )}
      <Field label="विवरण">
        <TextInput style={inputStyle} value={description} onChangeText={setDescription} placeholder={type === "work" ? "जैसे पासपोर्ट फोटो 8 प्रति" : "आंशिक जमा"} placeholderTextColor={colors.muted} testID="input-entry-desc" />
      </Field>
      <Field label="रकम (₹)">
        <TextInput style={inputStyle} value={amount} onChangeText={setAmount} placeholder="0" placeholderTextColor={colors.muted} keyboardType="numeric" testID="input-entry-amount" />
      </Field>
      <Field label="तारीख (YYYY-MM-DD)">
        <TextInput style={inputStyle} value={date} onChangeText={setDate} placeholderTextColor={colors.muted} testID="input-entry-date" />
      </Field>
      <Field label="नोट (वैकल्पिक)">
        <TextInput style={inputStyle} value={notes} onChangeText={setNotes} placeholderTextColor={colors.muted} testID="input-entry-notes" />
      </Field>
      <Pressable
        style={[styles.primaryBtn, { backgroundColor: type === "work" ? colors.error : colors.success }, saving && { opacity: 0.5 }]}
        disabled={saving}
        onPress={save}
        testID="save-entry-btn"
      >
        {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>{type === "work" ? "उधार जोड़ें" : "जमा जोड़ें"}</Text>}
      </Pressable>
    </SheetShell>
  );
}

export function AddJobSheet({ visible, onClose, customerId: fixedCustomerId }: { visible: boolean; onClose: () => void; customerId?: string }) {
  const qc = useQueryClient();
  const customersQ = useCustomers();
  const customers = customersQ.data ?? [];
  const [customerId, setCustomerId] = useState("");
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState(todayISO());
  const [estimatedAmount, setEstimatedAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      setCustomerId(fixedCustomerId ?? customers[0]?.id ?? "");
      setTitle("");
      setDueDate(todayISO());
      setEstimatedAmount("");
      setNotes("");
    }
  }, [visible, fixedCustomerId, customers.length]);

  const save = async () => {
    if (!customerId || !title.trim()) return;
    setSaving(true);
    try {
      await api.createJob({ customerId, title: title.trim(), dueDate, estimatedAmount: parseFloat(estimatedAmount) || 0, notes: notes.trim() });
      qc.invalidateQueries({ queryKey: ["jobs"] });
      onClose();
    } finally { setSaving(false); }
  };

  return (
    <SheetShell visible={visible} onClose={onClose} title="आने वाला काम" testID="sheet-job">
      {!fixedCustomerId && (
        <Field label="ग्राहक">
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingRight: spacing.md }}>
            {customers.map((c) => (
              <Pressable key={c.id} onPress={() => setCustomerId(c.id)} style={[styles.chip, customerId === c.id && styles.chipActive]} testID={`chip-job-cust-${c.id}`}>
                <Text style={[styles.chipText, customerId === c.id && { color: colors.onBrandPrimary }]} numberOfLines={1}>{c.name}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </Field>
      )}
      <Field label="काम"><TextInput style={inputStyle} value={title} onChangeText={setTitle} placeholder="जैसे शादी एलबम" placeholderTextColor={colors.muted} testID="input-job-title" /></Field>
      <Field label="डिलीवरी तारीख (YYYY-MM-DD)"><TextInput style={inputStyle} value={dueDate} onChangeText={setDueDate} placeholderTextColor={colors.muted} testID="input-job-date" /></Field>
      <Field label="अनुमानित रकम (₹)"><TextInput style={inputStyle} value={estimatedAmount} onChangeText={setEstimatedAmount} placeholder="0" placeholderTextColor={colors.muted} keyboardType="numeric" testID="input-job-amount" /></Field>
      <Field label="नोट"><TextInput style={inputStyle} value={notes} onChangeText={setNotes} placeholderTextColor={colors.muted} testID="input-job-notes" /></Field>
      <Pressable style={[styles.primaryBtn, saving && { opacity: 0.5 }]} disabled={saving} onPress={save} testID="save-job-btn">
        {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>काम जोड़ें</Text>}
      </Pressable>
    </SheetShell>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: spacing.xl, paddingBottom: spacing.xxl, maxHeight: "88%" },
  grabber: { width: 40, height: 4, backgroundColor: colors.borderStrong, borderRadius: 2, alignSelf: "center", marginBottom: spacing.md },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.lg },
  title: { fontSize: 20, fontWeight: "700", color: colors.onSurface },
  label: { fontSize: 12, color: colors.muted, fontWeight: "600", marginBottom: spacing.xs, textTransform: "uppercase", letterSpacing: 0.5 },
  primaryBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 15, alignItems: "center", marginTop: spacing.md, minHeight: 52, justifyContent: "center" },
  primaryText: { color: colors.onBrandPrimary, fontSize: 16, fontWeight: "700" },
  chip: { paddingHorizontal: spacing.md, height: 36, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { fontSize: 13, color: colors.onSurface, fontWeight: "600" },
});
