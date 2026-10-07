import { StyleSheet, Text, View } from "react-native";
import MaterialIcon from "@react-native-vector-icons/material-design-icons";
import { colors, radius, semantic, spacing } from "@/src/theme";
import { Pressable } from "@/src/components/tap";
import { isBackdated } from "@/src/lib/format";
import { AEPS_META } from "@/src/lib/aeps";
import type { Persona } from "@/src/lib/persona";
import { accountLabel, isInflow, isInternal, personaOfEntry, walletTxns, type Move, type Pocket, type WalletSource, type WalletTxn } from "@/src/lib/wallet";
import type { AepsTxn, Customer, Entry } from "@/src/lib/data";
import { expensePersona, type Expense } from "@/src/lib/expenses";
import { flowLabel, pocketTitle } from "@/src/components/pocket-card";

/** Title, detail line and icon of one money movement, in the In / Out words. */
export function describeTxn(t: WalletTxn, persona: Persona, pocket: Pocket, nameOf: (id: string) => string): { title: string; sub: string; icon: string } {
  const s = t.src;
  if (s.kind === "entry") {
    const e = s.entry;
    const what =
      t.key === "fee"
        ? "बाहर का खर्च"
        : t.key === "work"
          ? "काम"
          : t.key === "received"
            ? "पैसे आए"
            : t.key === "purchase"
              ? e.type === "purchase" ? "सामान / सेवा" : "सामान / सेवा · चुकाया"
              : "पैसे गए";
    return { title: nameOf(e.customerId), sub: [what, e.description].filter(Boolean).join(" · "), icon: t.key === "fee" ? "receipt" : "account-outline" };
  }
  if (s.kind === "expense") {
    return { title: s.expense.title, sub: ["खर्च", s.expense.notes].filter(Boolean).join(" · "), icon: "coffee-outline" };
  }
  if (s.kind === "move") {
    const m = s.move;
    const title = t.key === "moveIn" ? (m.from ? `${accountLabel(m.from)} से आए` : "बाहर से जोड़े") : m.to ? `${accountLabel(m.to)} में गए` : "बाहर निकाले";
    return { title, sub: m.note || (t.key === "moveIn" ? "जोड़े" : "निकाले"), icon: m.from && m.to ? "swap-horizontal" : t.key === "moveIn" ? "plus-circle-outline" : "minus-circle-outline" };
  }
  const x = s.txn;
  return { title: x.customerName || "AEPS ग्राहक", sub: `${AEPS_META[x.type]?.hi ?? "AEPS"} · ${flowLabel(t.key, persona, pocket)}`, icon: "fingerprint" };
}

export type Tone = "in" | "out" | "neutral";
export type Activity = { id: string; date: string; createdAt: string; tone: Tone; amount: number; title: string; sub: string; icon: string; src: WalletSource };
type Book = { entries: Entry[]; customers: Customer[]; aeps: AepsTxn[]; expenses: Expense[]; moves: Move[] };

/**
 * Everything that happened in this book, newest first: every rupee in and out, transfers between its own
 * accounts as one neutral row, and khata rows that moved no money (taken on credit, old history).
 */
export function activityFeed(book: Book, persona: Persona, nameOf: (id: string) => string, limit: number): Activity[] {
  // Rows are sorted first and only the ones shown get their titles and names built.
  const rows: { date: string; createdAt: string; make: () => Activity }[] = [];
  const shownMoves = new Set<string>();
  for (const t of walletTxns(book, persona, () => true)) {
    if (t.src.kind === "move" && isInternal(t, persona)) {
      // One neutral row per transfer (a move to / from the shop has only one leg in this book).
      const m = t.src.move;
      if (shownMoves.has(m.id)) continue;
      shownMoves.add(m.id);
      const src = t.src;
      rows.push({ date: t.date, createdAt: t.createdAt, make: () => ({ id: m.id, date: t.date, createdAt: t.createdAt, tone: "neutral", amount: t.amount, title: `${accountLabel(m.from)} → ${accountLabel(m.to)}`, sub: m.note || "ट्रांसफर", icon: "swap-horizontal", src }) });
      continue;
    }
    rows.push({
      date: t.date,
      createdAt: t.createdAt,
      make: () => {
        const d = describeTxn(t, persona, t.pocket, nameOf);
        return { id: t.id, date: t.date, createdAt: t.createdAt, tone: isInflow(t.key) ? "in" : "out", amount: t.amount, title: d.title, sub: `${d.sub} · ${pocketTitle(persona, t.pocket)}`, icon: d.icon, src: t.src };
      },
    });
  }
  const byId = new Map(book.customers.map((c) => [c.id, c]));
  for (const e of book.entries) {
    if (e.type === "aeps" || personaOfEntry(e, byId) !== persona) continue;
    const old = isBackdated(e.date, e.createdAt);
    const onCredit = e.type === "purchase" && !((e.paid ?? 0) > 0);
    if (!old && !onCredit) continue;
    rows.push({
      date: e.date,
      createdAt: e.createdAt,
      make: () => ({
        id: `${e.id}:khata`,
        date: e.date,
        createdAt: e.createdAt,
        tone: "neutral",
        amount: e.amount,
        title: nameOf(e.customerId),
        sub: [onCredit ? "उधार पर लिया" : "पुराना हिसाब", e.description].filter(Boolean).join(" · "),
        icon: onCredit ? "cart-outline" : "history",
        src: { kind: "entry", entry: e },
      }),
    });
  }
  // Old expenses written in later never touch cash / bank, but they were still spent; list them so none goes missing.
  for (const x of book.expenses) {
    if (expensePersona(x) !== persona || !isBackdated(x.date, x.createdAt)) continue;
    rows.push({
      date: x.date,
      createdAt: x.createdAt,
      make: () => ({ id: `${x.id}:old`, date: x.date, createdAt: x.createdAt, tone: "neutral", amount: x.amount, title: x.title, sub: ["पुराना खर्च", x.notes].filter(Boolean).join(" · "), icon: "history", src: { kind: "expense", expense: x } }),
    });
  }
  rows.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  return rows.slice(0, limit).map((r) => r.make());
}

const TONE: Record<Tone, { fg: string; bg: string; sign: string }> = {
  in: { fg: semantic.received, bg: semantic.receivedSoft, sign: "+" },
  out: { fg: semantic.due, bg: semantic.dueSoft, sign: "−" },
  neutral: { fg: colors.muted, bg: colors.surfaceSecondary, sign: "" },
};

export function ActivityRow({ a, money, onPress }: { a: Activity; money: (n: number) => string; onPress: () => void }) {
  const t = TONE[a.tone];
  return (
    <Pressable style={styles.row} onPress={onPress} testID={`activity-${a.id}`}>
      <View style={[styles.icon, { backgroundColor: t.bg }]}>
        <MaterialIcon name={a.icon as never} size={18} color={t.fg} />
        <View style={[styles.dot, { backgroundColor: t.fg }]} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.title} numberOfLines={1}>{a.title}</Text>
        <Text style={styles.sub} numberOfLines={1}>{a.sub}</Text>
      </View>
      <Text style={[styles.amount, { color: a.tone === "neutral" ? colors.onSurfaceSecondary : t.fg }]}>{t.sign}{money(a.amount)}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm + 2, paddingHorizontal: spacing.md },
  icon: { width: 38, height: 38, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  dot: { position: "absolute", right: 0, bottom: 0, width: 10, height: 10, borderRadius: 5, borderWidth: 2, borderColor: colors.surface },
  title: { fontSize: 15, fontWeight: "700", color: colors.onSurface },
  sub: { fontSize: 12, color: colors.muted, marginTop: 2 },
  amount: { fontSize: 15, fontWeight: "800", fontVariant: ["tabular-nums"] },
});
