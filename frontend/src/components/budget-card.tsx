import { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, TextInput } from "react-native";
import MaterialIcon from "@react-native-vector-icons/material-design-icons";
import { colors, radius, spacing } from "@/src/theme";
import { Pressable } from "@/src/components/tap";
import { Field, PrimaryButton, SheetShell, inputStyle } from "@/src/components/sheets";
import { expensePersona, PERSONAL_EXPENSE_CATEGORIES, useExpenses } from "@/src/lib/expenses";
import { saveBudget, useBudget, type Budget } from "@/src/lib/budget";
import { cleanAmountInput, formatINR, parseAmount, todayISO } from "@/src/lib/format";

const toneFor = (used: number) => (used >= 1 ? colors.error : used >= 0.8 ? colors.warning : colors.success);

function Bar({ used }: { used: number }) {
  return (
    <View style={styles.track}>
      <View style={[styles.fill, { width: `${Math.min(100, Math.max(2, used * 100))}%`, backgroundColor: toneFor(used) }]} />
    </View>
  );
}

/** Personal Home: this month's spending against the budget, with the categories that have a limit. */
export function BudgetCard() {
  const budget = useBudget();
  const { all } = useExpenses();
  const [editing, setEditing] = useState(false);
  const today = todayISO();
  const month = today.slice(0, 7);
  const spent = useMemo(() => {
    const by: Record<string, number> = {};
    let total = 0;
    for (const x of all) {
      if (expensePersona(x) !== "personal" || !x.date.startsWith(month)) continue;
      total += x.amount;
      by[x.title] = (by[x.title] ?? 0) + x.amount;
    }
    return { total, by };
  }, [all, month]);

  const daysInMonth = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
  const daysLeft = daysInMonth - Number(today.slice(8, 10)) + 1;
  const left = budget.total - spent.total;
  const used = budget.total > 0 ? spent.total / budget.total : 0;
  const cats = Object.entries(budget.byCat).filter(([, v]) => v > 0);

  return (
    <View style={styles.card} testID="budget-card">
      <View style={styles.head}>
        <MaterialIcon name="wallet-outline" size={18} color={colors.brandPrimary} />
        <Text style={styles.title}>इस महीने का बजट</Text>
        <Pressable onPress={() => setEditing(true)} hitSlop={8} testID="budget-edit">
          <Text style={styles.link}>{budget.total > 0 ? "बदलें" : "बजट बनाएँ"}</Text>
        </Pressable>
      </View>
      {budget.total > 0 ? (
        <>
          <View style={styles.row}>
            <Text style={styles.big}>{formatINR(spent.total)}</Text>
            <Text style={styles.of}> / {formatINR(budget.total)}</Text>
          </View>
          <Bar used={used} />
          <Text style={[styles.sub, { color: left < 0 ? colors.error : colors.onSurfaceSecondary }]}>
            {left < 0
              ? `बजट से ${formatINR(-left)} ज़्यादा खर्च हो गया`
              : `${formatINR(left)} बचे · ${daysLeft} दिन · रोज़ ${formatINR(Math.floor(left / Math.max(daysLeft, 1)))} तक`}
          </Text>
          {cats.map(([cat, limit]) => {
            const s = spent.by[cat] ?? 0;
            return (
              <View key={cat} style={styles.cat}>
                <View style={styles.catHead}>
                  <Text style={styles.catName}>{cat}</Text>
                  <Text style={[styles.catVal, { color: toneFor(s / limit) }]}>{formatINR(s)} / {formatINR(limit)}</Text>
                </View>
                <Bar used={s / limit} />
              </View>
            );
          })}
        </>
      ) : (
        <Text style={styles.sub}>
          {spent.total > 0 ? `इस महीने अब तक ${formatINR(spent.total)} खर्च। ` : ""}महीने की सीमा तय करें — ज़्यादा होने से पहले पता चलेगा।
        </Text>
      )}
      <BudgetSheet visible={editing} budget={budget} onClose={() => setEditing(false)} />
    </View>
  );
}

function BudgetSheet({ visible, budget, onClose }: { visible: boolean; budget: Budget; onClose: () => void }) {
  const [total, setTotal] = useState("");
  const [byCat, setByCat] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!visible) return;
    setTotal(budget.total > 0 ? String(budget.total) : "");
    setByCat(Object.fromEntries(Object.entries(budget.byCat).map(([k, v]) => [k, v > 0 ? String(v) : ""])));
    // Only when the sheet opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  const catSum = Object.values(byCat).reduce((s, v) => s + parseAmount(v || "0"), 0);
  const totalNum = parseAmount(total || "0");
  const save = () => {
    const cats: Record<string, number> = {};
    Object.entries(byCat).forEach(([k, v]) => {
      const n = parseAmount(v || "0");
      if (n > 0) cats[k] = n;
    });
    void saveBudget({ total: Math.max(totalNum, catSum), byCat: cats });
    onClose();
  };
  return (
    <SheetShell visible={visible} onClose={onClose} title="महीने का बजट" testID="sheet-budget">
      <Field label="पूरे महीने का खर्च (₹)">
        <TextInput style={[inputStyle, { fontSize: 20, fontWeight: "700" }]} value={total} onChangeText={(v) => setTotal(cleanAmountInput(v))} placeholder="जैसे 15000" placeholderTextColor={colors.muted} keyboardType="numeric" testID="input-budget-total" />
      </Field>
      <Text style={[styles.sub, { marginBottom: spacing.sm }]}>किस चीज़ पर कितना (वैकल्पिक)</Text>
      {PERSONAL_EXPENSE_CATEGORIES.map((c) => (
        <View key={c} style={styles.inputRow}>
          <Text style={styles.inputLabel}>{c}</Text>
          <TextInput
            style={[inputStyle, styles.smallInput]}
            value={byCat[c] ?? ""}
            onChangeText={(v) => setByCat((m) => ({ ...m, [c]: cleanAmountInput(v) }))}
            placeholder="₹"
            placeholderTextColor={colors.muted}
            keyboardType="numeric"
            testID={`input-budget-${c}`}
          />
        </View>
      ))}
      {catSum > totalNum && totalNum > 0 ? <Text style={[styles.sub, { color: colors.warning }]}>हिस्सों का जोड़ {formatINR(catSum)} है — बजट उतना माना जाएगा</Text> : null}
      <PrimaryButton label="बजट सेव करें" onPress={save} disabled={totalNum <= 0 && catSum <= 0} testID="save-budget-btn" />
      {budget.total > 0 ? (
        <Pressable
          onPress={() => {
            void saveBudget({ total: 0, byCat: {} });
            onClose();
          }}
          style={{ alignItems: "center", paddingVertical: spacing.md }}
          testID="clear-budget"
        >
          <Text style={{ color: colors.error, fontWeight: "700" }}>बजट हटाएँ</Text>
        </Pressable>
      ) : null}
    </SheetShell>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, gap: 6 },
  head: { flexDirection: "row", alignItems: "center", gap: 6 },
  title: { flex: 1, fontSize: 14, fontWeight: "800", color: colors.onSurface },
  link: { fontSize: 13, fontWeight: "700", color: colors.brandPrimary },
  row: { flexDirection: "row", alignItems: "baseline" },
  big: { fontSize: 22, fontWeight: "800", color: colors.onSurface },
  of: { fontSize: 14, color: colors.muted, fontWeight: "600" },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.border, overflow: "hidden" },
  fill: { height: 8, borderRadius: 4 },
  sub: { fontSize: 12, color: colors.onSurfaceSecondary },
  cat: { marginTop: 4, gap: 3 },
  catHead: { flexDirection: "row", justifyContent: "space-between" },
  catName: { fontSize: 12, fontWeight: "700", color: colors.onSurface },
  catVal: { fontSize: 12, fontWeight: "700" },
  inputRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm },
  inputLabel: { flex: 1, fontSize: 14, color: colors.onSurface },
  smallInput: { width: 120, textAlign: "right" },
});
