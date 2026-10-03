import { useEffect, useRef, useState } from "react";
import { Text, TextInput, View, StyleSheet } from "react-native";
import { colors, spacing } from "@/src/theme";
import { formatINR, todayISO } from "@/src/lib/format";
import { usePersona, type Persona } from "@/src/lib/persona";
import { accountKey, accountLabel, addMove, balanceOf, pocketName, useMoneyBook, type AccountKey, type Pocket } from "@/src/lib/wallet";
import { Chip, DateField, Field, PrimaryButton, SheetShell, inputStyle } from "@/src/components/sheets";
import { confirmAction } from "@/src/lib/confirm";

export type MoveKind = "in" | "out" | "swap";

const TITLES: Record<MoveKind, string> = { in: "पैसे जोड़ें", out: "पैसे निकालें", swap: "ट्रांसफर" };

export function MoneyMoveSheet({ kind, onClose, initialDate }: { kind: MoveKind | null; onClose: () => void; initialDate?: string }) {
  const { persona, hasShop } = usePersona();
  const book = useMoneyBook();
  const [pocket, setPocket] = useState<Pocket>("cash");
  const [other, setOther] = useState(false);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(todayISO());
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const amountRef = useRef<TextInput>(null);

  useEffect(() => {
    if (!kind) return;
    setPocket("cash");
    setOther(false);
    setAmount("");
    setNote("");
    setDate(initialDate ?? todayISO());
    setError("");
    const t = setTimeout(() => amountRef.current?.focus(), 350);
    return () => clearTimeout(t);
  }, [kind, initialDate]);

  const otherPersona: Persona = persona === "business" ? "personal" : "business";
  // Money can only cross to the shop when the shop exists; cash goes to cash, bank to bank.
  const canCross = persona === "business" || hasShop;
  const own = accountKey(persona, pocket);
  const across = accountKey(otherPersona, pocket);

  let from: AccountKey = "";
  let to: AccountKey = "";
  if (kind === "in") {
    to = own;
    from = other ? across : "";
  } else if (kind === "out") {
    from = own;
    to = other ? across : "";
  } else if (kind === "swap") {
    from = own;
    to = accountKey(persona, pocket === "cash" ? "bank" : "cash");
  }

  const amt = Math.max(parseFloat(amount) || 0, 0);
  // Taking money out on an earlier date must not leave a later day short either.
  const available = from ? Math.min(balanceOf(book, from, date), balanceOf(book, from, date > todayISO() ? date : todayISO())) : Infinity;
  const short = !!from && amt > available;

  const save = () => {
    if (!kind || amt <= 0) return;
    // The app's figure can lag the real drawer (an entry not written yet), so warn instead of blocking.
    if (short) {
      confirmAction(
        `हिसाब में सिर्फ ${formatINR(Math.max(available, 0))} हैं`,
        `${accountLabel(from)} से ${formatINR(amt)} निकालने पर हिसाब में ${formatINR(available - amt)} दिखेगा। फिर भी सेव करें?`,
        "हाँ, सेव करें",
        () => void commit(),
      );
      return;
    }
    void commit();
  };

  const commit = async () => {
    if (!kind) return;
    setSaving(true);
    try {
      await addMove({ date, from, to, amount: amt, note: note.trim() });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const pocketLabel = (p: Pocket) => pocketName(persona, p);

  return (
    <SheetShell visible={!!kind} onClose={onClose} title={kind ? TITLES[kind] : ""} testID="sheet-money-move">
      <Field label="रकम (₹)">
        <TextInput
          style={inputStyle}
          value={amount}
          onChangeText={(t) => { setAmount(t); setError(""); }}
          keyboardType="numeric"
          placeholder="0"
          placeholderTextColor={colors.muted}
          ref={amountRef}
          testID="move-amount"
        />
      </Field>

      <Field label={kind === "in" ? "किसमें" : "किससे"}>
        <View style={styles.row}>
          {(["cash", "bank"] as Pocket[]).map((p) => (
            <Chip
              key={p}
              label={kind === "swap" ? `${pocketLabel(p)} → ${pocketLabel(p === "cash" ? "bank" : "cash")}` : pocketLabel(p)}
              active={pocket === p}
              onPress={() => { setPocket(p); setError(""); }}
              testID={`move-pocket-${p}`}
            />
          ))}
        </View>
      </Field>

      {kind === "in" || kind === "out" ? (
        <Field label={kind === "in" ? "कहाँ से" : "कहाँ"}>
          <View style={styles.row}>
            <Chip label={kind === "in" ? "बाहर से" : "बाहर"} active={!other} onPress={() => { setOther(false); setError(""); }} testID="move-outside" />
            {canCross ? (
              <Chip
                label={`${accountLabel(across)} ${kind === "in" ? "से" : "में"}`}
                active={other}
                onPress={() => { setOther(true); setError(""); }}
                testID="move-across"
              />
            ) : null}
          </View>
          {!other ? (
            <TextInput
              style={[inputStyle, { marginTop: spacing.sm }]}
              value={note}
              onChangeText={setNote}
              placeholder={kind === "in" ? "जैसे घर से, उधार लिया" : "जैसे घर ले गए"}
              placeholderTextColor={colors.muted}
              testID="move-note"
            />
          ) : null}
        </Field>
      ) : null}

      {from ? (
        <Text style={[styles.hint, short && { color: colors.error }]}>
          {accountLabel(from)} में {formatINR(Math.max(available, 0))}
        </Text>
      ) : null}

      <DateField label="तारीख" value={date} onChange={setDate} testID="move-date" />

      {error ? <Text style={[styles.hint, { color: colors.error, marginBottom: spacing.sm }]}>{error}</Text> : null}
      <PrimaryButton label="सेव करें" onPress={save} disabled={amt <= 0} saving={saving} testID="move-save" />
    </SheetShell>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  hint: { fontSize: 13, fontWeight: "600", color: colors.muted, marginBottom: spacing.md },
});
