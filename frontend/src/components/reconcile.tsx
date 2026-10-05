import { useEffect, useState } from "react";
import { View, Text, StyleSheet, TextInput } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { colors, spacing, radius } from "@/src/theme";
import { cleanAmountInput, formatDateShort, formatINR, localDay, parseAmount, roundMoney, todayISO } from "@/src/lib/format";
import { addMove } from "@/src/lib/wallet";
import { confirmAction } from "@/src/lib/confirm";
import { Pressable } from "@/src/components/tap";
import { IconLabel } from "@/src/components/ui";

/**
 * Typed real balance (portal / bank app, or counted notes) against the app's balance for one pocket.
 * The figure is kept for the day so it survives leaving the screen; a match is remembered with its time.
 */
export function Reconcile({ label, pocketKey, app, hint, testID }: { label: string; pocketKey: "business:bank" | "business:cash"; app: number; hint?: string; testID: string }) {
  const today = todayISO();
  const valueKey = `hisab_reconcile_${pocketKey}_${today}`;
  const lastKey = `hisab_reconcile_last_${pocketKey}`;
  const [value, setValue] = useState("");
  const [last, setLast] = useState("");
  useEffect(() => {
    AsyncStorage.getItem(valueKey).then((v) => setValue(v || "")).catch(() => {});
    AsyncStorage.getItem(lastKey).then((v) => setLast(v || "")).catch(() => {});
  }, [valueKey, lastKey]);
  const save = (v: string) => {
    const clean = cleanAmountInput(v);
    setValue(clean);
    AsyncStorage.setItem(valueKey, clean).catch(() => {});
  };
  const typed = value ? parseAmount(value) : null;
  const diff = typed !== null ? roundMoney(typed - app) : null;
  const stamp = () => {
    const at = new Date().toISOString();
    setLast(at);
    AsyncStorage.setItem(lastKey, at).catch(() => {});
  };
  useEffect(() => {
    if (diff === 0) stamp();
    // Only when the figures come to match.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diff]);
  const pocketName = pocketKey === "business:bank" ? "दुकान बैंक" : "गल्ला";
  const match = () => {
    if (!diff || typed === null) return;
    confirmAction(
      `${pocketName} ${formatINR(typed)} कर दें?`,
      diff > 0 ? `हिसाब में ${formatINR(diff)} "बाहर से जोड़े" लिखे जाएँगे।` : `हिसाब में ${formatINR(-diff)} "बाहर निकाले" लिखे जाएँगे।`,
      "हाँ, बराबर करें",
      () => {
        void addMove(
          diff > 0
            ? { date: today, from: "", to: pocketKey, amount: diff, note: `${pocketName} मिलान` }
            : { date: today, from: pocketKey, to: "", amount: -diff, note: `${pocketName} मिलान` },
        );
        stamp();
      },
    );
  };
  const lastText = last ? `आख़िरी मिलान: ${formatDateShort(localDay(last) ?? last.slice(0, 10))} ${new Date(last).toTimeString().slice(0, 5)}` : "अभी तक मिलान नहीं किया";
  return (
    <View style={styles.row} testID={testID}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>{label}</Text>
          <Text style={styles.meta}>हिसाब में: {formatINR(app)}</Text>
        </View>
        <TextInput style={styles.input} value={value} onChangeText={save} keyboardType="decimal-pad" placeholder="₹ असल" placeholderTextColor={colors.muted} testID={`${testID}-input`} />
      </View>
      {diff === null ? (
        <Text style={styles.meta}>{lastText}</Text>
      ) : diff === 0 ? (
        <IconLabel icon="check-circle" color={colors.success} label={`बिल्कुल मिल गया · ${lastText}`} style={styles.result} />
      ) : (
        <>
          <Text style={[styles.result, { color: colors.error }]}>
            {diff > 0 ? `असल में ${formatINR(diff)} ज़्यादा` : `असल में ${formatINR(-diff)} कम`} — कोई एंट्री छूटी या गलत है
          </Text>
          {hint ? <Text style={styles.meta}>{hint}</Text> : null}
          <Pressable style={styles.btn} onPress={match} testID={`${testID}-match`}>
            <Text style={styles.btnText}>हिसाब को असल के बराबर करें</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { gap: 6, marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  label: { fontSize: 13, fontWeight: "700", color: colors.onSurface },
  meta: { fontSize: 12, color: colors.muted, marginTop: 2 },
  input: { width: 120, height: 44, borderRadius: radius.sm, borderWidth: 1.5, borderColor: colors.brandPrimary, backgroundColor: colors.surface, paddingHorizontal: spacing.sm, fontSize: 16, fontWeight: "700", color: colors.onSurface, textAlign: "right" },
  result: { fontSize: 12, fontWeight: "700" },
  btn: { alignSelf: "flex-start", paddingHorizontal: spacing.md, minHeight: 36, justifyContent: "center", borderRadius: radius.pill, borderWidth: 1, borderColor: colors.brandPrimary },
  btnText: { fontSize: 12, fontWeight: "700", color: colors.brandPrimary },
});
