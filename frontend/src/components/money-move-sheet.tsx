import { useEffect, useRef, useState } from "react";
import { Text, TextInput, View, StyleSheet } from "react-native";
import { colors, spacing } from "@/src/theme";
import { formatINR, isValidISO, todayISO } from "@/src/lib/format";
import { usePersona, type Persona } from "@/src/lib/persona";
import { accountKey, accountLabel, addMove, balanceOf, deleteMove, pocketName, useMoneyBook, type AccountKey, type Move, type Pocket } from "@/src/lib/wallet";
import { Chip, DangerLink, DateField, Field, PrimaryButton, SheetShell, inputStyle } from "@/src/components/sheets";
import { store } from "@/src/lib/store";
import { confirmAction } from "@/src/lib/confirm";

export type MoveKind = "in" | "out" | "swap";

const TITLES: Record<MoveKind, string> = { in: "पैसे जोड़ें", out: "पैसे निकालें", swap: "ट्रांसफर" };

/** How a saved move looks from this persona's side, so the edit sheet opens on the same choices. */
function readMove(m: Move, persona: Persona): { kind: MoveKind; pocket: Pocket; other: boolean } {
  const side = (k: AccountKey) => (k ? (k.split(":") as [Persona, Pocket]) : null);
  const from = side(m.from);
  const to = side(m.to);
  if (!from) return { kind: "in", pocket: to![1], other: false };
  if (!to) return { kind: "out", pocket: from[1], other: false };
  if (from[0] === to[0]) return { kind: "swap", pocket: from[1], other: false };
  return to[0] === persona ? { kind: "in", pocket: to[1], other: true } : { kind: "out", pocket: from[1], other: true };
}

export function MoneyMoveSheet({ kind: newKind, onClose, initialDate, initial }: { kind: MoveKind | null; onClose: () => void; initialDate?: string; initial?: Move | null }) {
  const { persona, hasShop } = usePersona();
  const book = useMoneyBook();
  const kind = initial ? readMove(initial, persona).kind : newKind;
  const [pocket, setPocket] = useState<Pocket>("cash");
  const [other, setOther] = useState(false);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(todayISO());
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const amountRef = useRef<TextInput>(null);

  useEffect(() => {
    if (initial) {
      const r = readMove(initial, persona);
      setPocket(r.pocket);
      setOther(r.other);
      setAmount(String(initial.amount));
      setNote(initial.note ?? "");
      setDate(initial.date);
      setError("");
      return;
    }
    if (!newKind) return;
    setPocket("cash");
    setOther(false);
    setAmount("");
    setNote("");
    setDate(initialDate ?? todayISO());
    setError("");
    const t = setTimeout(() => amountRef.current?.focus(), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newKind, initialDate, initial?.id]);

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
  // While editing, the row's own old amount is still inside the balance; give it back first.
  const own0 = initial && from && initial.from === from ? initial.amount : 0;
  const available = from ? Math.min(balanceOf(book, from, date), balanceOf(book, from, date > todayISO() ? date : todayISO())) + own0 : Infinity;
  const short = !!from && amt > available;
  const valid = amt > 0 && isValidISO(date);

  const save = () => {
    if (!kind || !valid) return;
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
      const body = { date, from, to, amount: amt, note: other ? "" : note.trim() };
      if (initial) store.updateMove(initial.id, body);
      else await addMove(body);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const pocketLabel = (p: Pocket) => pocketName(persona, p);

  return (
    <SheetShell visible={!!kind} onClose={onClose} title={kind ? `${TITLES[kind]}${initial ? " — बदलें" : ""}` : ""} testID="sheet-money-move">
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
      <PrimaryButton label={initial ? "बदलाव सेव करें" : "सेव करें"} onPress={save} disabled={!valid} saving={saving} testID="move-save" />
      {initial ? (
        <DangerLink
          label="यह एंट्री हटाएँ"
          testID="move-delete"
          onPress={() =>
            confirmAction("हटाएँ?", `${accountLabel(initial.from)} → ${accountLabel(initial.to)} · ${formatINR(initial.amount)}`, "हटा दें", () => {
              void deleteMove(initial.id);
              onClose();
            })
          }
        />
      ) : null}
    </SheetShell>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  hint: { fontSize: 13, fontWeight: "600", color: colors.muted, marginBottom: spacing.md },
});
