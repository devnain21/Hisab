import { useEffect, useMemo, useState } from "react";
import { View, Text, TextInput, StyleSheet } from "react-native";
import MaterialIcon from "@react-native-vector-icons/material-design-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQueryClient } from "@tanstack/react-query";
import { colors, radius, spacing } from "@/src/theme";
import { Field, PrimaryButton, SheetShell, inputStyle } from "@/src/components/sheets";
import { Pressable } from "@/src/components/tap";
import { useAuth } from "@/src/context/AuthContext";
import { useAeps, useCustomers, useEntries, useJobs, isPersonalTask } from "@/src/lib/data";
import { useMoneyBook } from "@/src/lib/wallet";
import { flush, usePendingCount } from "@/src/lib/store";
import { exportBackupJson } from "@/src/lib/backup";
import { accountName } from "@/src/lib/persona";
import { api } from "@/src/lib/api";

const CONFIRM_WORD = "हटाएँ";

/** Deletes the whole shop book on the server; the personal book stays as it is. */
export function CloseShopSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { user, setShop } = useAuth();
  const queryClient = useQueryClient();
  const pending = usePendingCount();
  const customers = useCustomers().data ?? [];
  const entries = useEntries().data ?? [];
  const jobs = useJobs().data ?? [];
  const aeps = useAeps().data ?? [];
  const book = useMoneyBook();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setTyped("");
    setError(null);
  }, [visible]);

  const counts = useMemo(() => {
    const shopIds = new Set(customers.filter((c) => c.persona !== "personal").map((c) => c.id));
    return {
      customers: shopIds.size,
      entries: entries.filter((e) => shopIds.has(e.customerId)).length,
      jobs: jobs.filter((j) => (j.customerId ? shopIds.has(j.customerId) : !isPersonalTask(j))).length,
      aeps: aeps.length,
      expenses: book.expenses.filter((x) => x.persona !== "personal").length,
    };
  }, [customers, entries, jobs, aeps, book.expenses]);

  const lines = [
    { icon: "account-group-outline", label: "ग्राहक", n: counts.customers },
    { icon: "notebook-outline", label: "एंट्री", n: counts.entries },
    { icon: "briefcase-outline", label: "काम", n: counts.jobs },
    { icon: "bank-transfer", label: "काउंटर (AEPS)", n: counts.aeps },
    { icon: "cash-minus", label: "खर्च", n: counts.expenses },
  ] as const;

  const backup = async () => {
    setError(null);
    setBackingUp(true);
    try {
      await exportBackupJson(accountName(user) || "हिसाब");
    } catch {
      setError("बैकअप नहीं बन पाया, दोबारा कोशिश करें।");
    } finally {
      setBackingUp(false);
    }
  };

  const ready = typed.trim() === CONFIRM_WORD && pending === 0 && !busy;

  const closeShop = async () => {
    if (!ready || !user) return;
    setError(null);
    setBusy(true);
    try {
      await flush();
      await api.closeShop();
      await AsyncStorage.setItem("hisab_persona_v1", "personal").catch(() => {});
      await setShop({
        shop_name: "",
        shop_gst: "",
        shop_phone: user.shop_phone || "",
        shop_address: user.shop_address || "",
        shop_upi: user.shop_upi || "",
        owner_name: user.owner_name || "",
        persona: "personal",
      }).catch(() => {});
      await queryClient.refetchQueries().catch(() => {});
      onClose();
    } catch {
      setError("सर्वर से नहीं जुड़ पाया। इंटरनेट चालू करके दोबारा कोशिश करें।");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SheetShell visible={visible} onClose={busy ? () => {} : onClose} title="दुकान खाता हटाएँ" testID="sheet-close-shop">
      <View style={styles.warnBox}>
        <MaterialIcon name="alert-octagon-outline" size={22} color={colors.error} />
        <Text style={styles.warnText}>दुकान का सारा हिसाब हमेशा के लिए हट जाएगा। आपका व्यक्तिगत खाता वैसा ही रहेगा।</Text>
      </View>

      <View style={styles.countCard}>
        {lines.map((l, i) => (
          <View key={l.label} style={[styles.countRow, i > 0 && styles.countBorder]}>
            <MaterialIcon name={l.icon} size={18} color={colors.muted} />
            <Text style={styles.countLabel}>{l.label}</Text>
            <Text style={styles.countVal}>{l.n}</Text>
          </View>
        ))}
      </View>

      <Pressable style={styles.backupBtn} onPress={backup} disabled={backingUp || busy} testID="close-shop-backup">
        <MaterialIcon name="cloud-download-outline" size={18} color={colors.brandPrimary} />
        <Text style={styles.backupText}>{backingUp ? "बैकअप बन रहा है…" : "पहले बैकअप लें (.json)"}</Text>
      </Pressable>

      {pending > 0 ? (
        <Text style={styles.err}>{pending} बदलाव अभी सिंक होने बाकी हैं। इंटरनेट चालू करके पहले सिंक होने दें।</Text>
      ) : null}

      <Field label={`पक्का करने के लिए "${CONFIRM_WORD}" लिखें`}>
        <TextInput
          style={inputStyle}
          value={typed}
          onChangeText={setTyped}
          placeholder={CONFIRM_WORD}
          placeholderTextColor={colors.muted}
          autoCorrect={false}
          editable={!busy}
          testID="close-shop-confirm"
        />
      </Field>

      {error ? <Text style={styles.err}>{error}</Text> : null}

      <PrimaryButton label="दुकान खाता हमेशा के लिए हटाएँ" color={colors.error} onPress={closeShop} disabled={!ready} saving={busy} testID="close-shop-submit" />
    </SheetShell>
  );
}

const styles = StyleSheet.create({
  warnBox: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start", padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.errorSoft, marginBottom: spacing.md },
  warnText: { flex: 1, fontSize: 14, lineHeight: 20, color: colors.error, fontWeight: "600" },
  countCard: { borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, marginBottom: spacing.md },
  countRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: 10 },
  countBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  countLabel: { flex: 1, fontSize: 14, color: colors.onSurface },
  countVal: { fontSize: 15, fontWeight: "800", color: colors.onSurface },
  backupBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.brandPrimary, marginBottom: spacing.md },
  backupText: { fontSize: 14, fontWeight: "700", color: colors.brandPrimary },
  err: { fontSize: 13, color: colors.error, marginBottom: spacing.sm },
});
