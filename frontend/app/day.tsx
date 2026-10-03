import { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, FlatList, TextInput, ScrollView } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import MaterialIcon from "@react-native-vector-icons/material-design-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { colors, spacing, radius } from "@/src/theme";
import { useCustomers, type Entry } from "@/src/lib/data";
import { formatINR, formatWeekdayDate, todayISO } from "@/src/lib/format";
import { Pressable } from "@/src/components/tap";
import { EditRecordSheet } from "@/src/components/sheets";
import { AEPS_META, bankLegDate, cashLegDate, moneyLines } from "@/src/lib/aeps";
import { deleteExpense, expensePersona } from "@/src/lib/expenses";
import { AddExpenseSheet } from "@/src/components/expense-sheet";
import { confirmAction } from "@/src/lib/confirm";
import { MoneyMoveSheet, type MoveKind } from "@/src/components/money-move-sheet";
import { PocketCard } from "@/src/components/pocket-card";
import { DayCloseModal } from "@/src/components/day-close-modal";
import { useAuth } from "@/src/context/AuthContext";
import { usePersona } from "@/src/lib/persona";
import { accountKey, computeFlows, pocketNet, useMoneyBook } from "@/src/lib/wallet";
import type { DaySummaryData } from "@/src/lib/day-close";

type Kind = "work" | "payment" | "expense" | "drawer";

function shiftDay(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function DayScreen() {
  const params = useLocalSearchParams<{ type?: Kind; date?: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { persona, isPersonal, labels } = usePersona();
  const customers = useCustomers().data ?? [];
  const book = useMoneyBook();
  const today = todayISO();
  const [kind, setKind] = useState<Kind>(params.type || "work");
  const [date, setDate] = useState(params.date || today);
  const [editing, setEditing] = useState<Entry | null>(null);

  const [expenseSheet, setExpenseSheet] = useState(false);
  const [moveSheet, setMoveSheet] = useState<MoveKind | null>(null);
  const [dayCloseOpen, setDayCloseOpen] = useState(false);
  const [countedCash, setCountedCash] = useState<string>("");

  useEffect(() => {
    AsyncStorage.getItem(`hisab_counted_cash_${persona}_${date}`).then((v) => setCountedCash(v || "")).catch(() => {});
  }, [date, persona]);

  const handleSaveCounted = (val: string) => {
    const clean = val.replace(/[^0-9]/g, "");
    setCountedCash(clean);
    AsyncStorage.setItem(`hisab_counted_cash_${persona}_${date}`, clean).catch(() => {});
  };

  const nameOf = (id: string) => customers.find((c) => c.id === id)?.name ?? labels.customer;

  const mineIds = useMemo(
    () => new Set(customers.filter((c) => (isPersonal ? c.persona === "personal" : c.persona !== "personal")).map((c) => c.id)),
    [customers, isPersonal]
  );
  const dayEntries = useMemo(() => book.entries.filter((e) => e.date === date && mineIds.has(e.customerId)), [book.entries, date, mineIds]);

  // In the personal book the first tab is money handed out; in the shop it is work done.
  const inKind = (e: Entry, k: "work" | "payment") =>
    k === "work"
      ? isPersonal ? e.type === "given" || e.type === "purchase" : e.type === "work"
      : e.type === "payment" || (e.type === "work" && (e.paid ?? 0) > 0);
  const amountFor = (e: Entry, k: "work" | "payment") => (k === "work" || e.type === "payment" ? e.amount : e.paid ?? 0);
  const rows = useMemo(
    () => (kind === "drawer" || kind === "expense" ? [] : dayEntries.filter((e) => inKind(e, kind)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dayEntries, kind, isPersonal]
  );
  const sum = (k: "work" | "payment") => dayEntries.filter((e) => inKind(e, k)).reduce((s, e) => s + amountFor(e, k), 0);

  const flows = useMemo(() => computeFlows(book, persona, (d) => d === date), [book, persona, date]);
  const before = useMemo(() => computeFlows(book, persona, (d) => d < date), [book, persona, date]);
  const openingCash = pocketNet(before.cash);
  const openingBank = pocketNet(before.bank);
  const expectedCash = openingCash + pocketNet(flows.cash);
  const expectedBank = openingBank + pocketNet(flows.bank);

  const workEntries = useMemo(() => dayEntries.filter((e) => e.type === "work"), [dayEntries]);
  const workTotal = workEntries.reduce((s, e) => s + e.amount, 0);
  const workFees = workEntries.reduce((s, e) => s + (e.fee ?? 0), 0);
  const workProfit = workTotal - workFees;
  // Khata totals include old (backdated) rows; only the galla / bank cards leave them out.
  const workCash = workEntries.filter((e) => e.mode !== "online").reduce((s, e) => s + (e.paid ?? 0), 0);
  const workOnline = workEntries.filter((e) => e.mode === "online").reduce((s, e) => s + (e.paid ?? 0), 0);
  const workUdhaar = workTotal - (workCash + workOnline);
  const dayPayments = dayEntries.filter((e) => e.type === "payment");
  const paymentCash = dayPayments.filter((e) => e.mode !== "online").reduce((s, e) => s + e.amount, 0);
  const paymentOnline = dayPayments.filter((e) => e.mode === "online").reduce((s, e) => s + e.amount, 0);

  const dayExpenses = useMemo(
    () => book.expenses.filter((x) => x.date === date && expensePersona(x) === persona).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [book.expenses, date, persona],
  );
  const expenseTotal = dayExpenses.reduce((s, x) => s + x.amount, 0);
  const expenseCashTotal = dayExpenses.filter((x) => x.mode === "cash").reduce((s, x) => s + x.amount, 0);
  const expenseByTitle = useMemo(() => {
    const m = new Map<string, number>();
    dayExpenses.forEach((x) => m.set(x.title, (m.get(x.title) ?? 0) + x.amount));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [dayExpenses]);
  const removeExpense = (id: string, title: string, amount: number) =>
    confirmAction("खर्च हटाएँ?", `${title} · ${formatINR(amount)}`, "हटा दें", () => deleteExpense(id));
  const dayAeps = useMemo(
    () =>
      isPersonal
        ? []
        : book.aeps.filter((t) => t.status !== "failed" && (t.date === date || cashLegDate(t) === date || bankLegDate(t) === date)),
    [book.aeps, date, isPersonal]
  );

  const countedNum = countedCash ? parseInt(countedCash, 10) || 0 : null;
  const diff = countedNum !== null ? countedNum - expectedCash : null;

  const dateLabel = date === today ? "आज" : date === todayISO(-1) ? "कल" : formatWeekdayDate(date);

  const cashKey = accountKey(persona, "cash");
  const bankKey = accountKey(persona, "bank");
  const dayMoves = book.moves.filter((m) => m.date === date);
  const daySummary: DaySummaryData = {
    date,
    shop: user || {},
    workTotal,
    workFees,
    workProfit,
    workCash,
    workOnline,
    workUdhaar,
    feePaidOnline: flows.bank.fee,
    feePaidCash: flows.cash.fee,
    paymentCash,
    paymentOnline,
    expenseCash: flows.cash.expense,
    expenseOnline: flows.bank.expense,
    bankToCash: dayMoves.filter((m) => m.from === bankKey && m.to === cashKey).reduce((s, m) => s + m.amount, 0),
    cashToBank: dayMoves.filter((m) => m.from === cashKey && m.to === bankKey).reduce((s, m) => s + m.amount, 0),
    openingCash,
    expectedCash,
    countedCash: countedNum,
    cashDiff: diff,
    openingBank,
    expectedBank,
    actualBank: null,
    bankDiff: null,
    netProfitEstimate: workProfit - (flows.cash.expense + flows.bank.expense),
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={[styles.topBar, { paddingTop: insets.top + spacing.md }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} testID="day-back">
          <MaterialIcon name="arrow-left" size={26} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.topTitle}>दिन का हिसाब</Text>
      </View>

      <View style={{ paddingHorizontal: spacing.lg }}>
        <View style={styles.dateRow}>
          <Pressable style={styles.arrow} onPress={() => setDate(shiftDay(date, -1))} testID="day-prev">
            <MaterialIcon name="chevron-left" size={24} color={colors.onSurface} />
          </Pressable>
          <Pressable style={{ flex: 1, alignItems: "center" }} onPress={() => setDate(today)} testID="day-today">
            <Text style={styles.dateText}>{dateLabel}</Text>
          </Pressable>
          <Pressable
            style={[styles.arrow, date >= today && { opacity: 0.3 }]}
            disabled={date >= today}
            onPress={() => setDate(shiftDay(date, 1))}
            testID="day-next"
          >
            <MaterialIcon name="chevron-right" size={24} color={colors.onSurface} />
          </Pressable>
        </View>

        <View style={styles.segment}>
          <Pressable
            onPress={() => setKind("work")}
            style={[styles.segmentBtn, kind === "work" && styles.segmentActive]}
            testID="day-kind-work"
          >
            <Text style={[styles.segmentText, kind === "work" && { color: colors.onBrandPrimary }]} numberOfLines={1} adjustsFontSizeToFit>
              {isPersonal ? "दिए" : "काम"} · {formatINR(sum("work"))}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setKind("payment")}
            style={[styles.segmentBtn, kind === "payment" && styles.segmentActive]}
            testID="day-kind-payment"
          >
            <Text style={[styles.segmentText, kind === "payment" && { color: colors.onBrandPrimary }]} numberOfLines={1} adjustsFontSizeToFit>
              मिले · {formatINR(sum("payment"))}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setKind("expense")}
            style={[styles.segmentBtn, kind === "expense" && styles.segmentActive]}
            testID="day-kind-expense"
          >
            <Text style={[styles.segmentText, kind === "expense" && { color: colors.onBrandPrimary }]} numberOfLines={1} adjustsFontSizeToFit>
              खर्च · {formatINR(expenseTotal)}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setKind("drawer")}
            style={[styles.segmentBtn, kind === "drawer" && styles.segmentActive]}
            testID="day-kind-drawer"
          >
            <Text style={[styles.segmentText, kind === "drawer" && { color: colors.onBrandPrimary }]} numberOfLines={1} adjustsFontSizeToFit>
              {labels.cash} व बैंक
            </Text>
          </Pressable>
        </View>

        {kind === "work" && isPersonal ? (
          <View style={styles.totalCard}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", width: "100%" }}>
              <Text style={styles.totalLabel}>दिए व सामान ({rows.length})</Text>
              <Text style={[styles.totalValue, { color: colors.error, fontSize: 24, marginTop: 0 }]}>{formatINR(sum("work"))}</Text>
            </View>
            <View style={styles.workPillsRow}>
              <View style={[styles.miniPill, { backgroundColor: colors.successSoft }]}>
                <Text style={[styles.miniPillText, { color: colors.success }]}>कैश: {formatINR(flows.cash.given + flows.cash.purchase)}</Text>
              </View>
              {flows.bank.given + flows.bank.purchase > 0 ? (
                <View style={[styles.miniPill, { backgroundColor: colors.infoSoft }]}>
                  <Text style={[styles.miniPillText, { color: colors.info }]}>बैंक: {formatINR(flows.bank.given + flows.bank.purchase)}</Text>
                </View>
              ) : null}
            </View>
          </View>
        ) : kind === "work" ? (
          <View style={styles.workSummaryCard}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
              <Text style={styles.totalLabel}>कुल काम ({rows.length})</Text>
              <Text style={[styles.totalValue, { fontSize: 24, marginTop: 0 }]}>{formatINR(workTotal)}</Text>
            </View>
            {workFees > 0 ? (
              <View style={styles.workFeeRow}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <MaterialIcon name="receipt" size={14} color={colors.error} />
                  <Text style={styles.feeLabel}>फीस</Text>
                </View>
                <Text style={styles.feeValue}>-{formatINR(workFees)}</Text>
              </View>
            ) : null}
            {workFees > 0 ? (
              <View style={styles.workProfitRow}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <MaterialIcon name="star-outline" size={15} color={colors.brandPrimary} />
                  <Text style={styles.profitLabel}>बचत</Text>
                </View>
                <Text style={styles.profitValue}>{formatINR(workProfit)}</Text>
              </View>
            ) : null}
            <View style={styles.workPillsRow}>
              <View style={[styles.miniPill, { backgroundColor: colors.successSoft }]}>
                <Text style={[styles.miniPillText, { color: colors.success }]}>💵 नकद: {formatINR(workCash)}</Text>
              </View>
              {workOnline > 0 ? (
                <View style={[styles.miniPill, { backgroundColor: colors.infoSoft }]}>
                  <Text style={[styles.miniPillText, { color: colors.info }]}>📱 UPI: {formatINR(workOnline)}</Text>
                </View>
              ) : null}
              {workUdhaar > 0 ? (
                <View style={[styles.miniPill, { backgroundColor: colors.errorSoft }]}>
                  <Text style={[styles.miniPillText, { color: colors.error }]}>उधारी: {formatINR(workUdhaar)}</Text>
                </View>
              ) : null}
            </View>
          </View>
        ) : kind === "payment" ? (
          <View style={styles.totalCard}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", width: "100%" }}>
              <Text style={styles.totalLabel}>कुल मिले ({rows.length})</Text>
              <Text style={[styles.totalValue, { color: colors.success, fontSize: 24, marginTop: 0 }]}>
                {formatINR(sum("payment"))}
              </Text>
            </View>
            <View style={styles.workPillsRow}>
              <View style={[styles.miniPill, { backgroundColor: colors.successSoft }]}>
                <Text style={[styles.miniPillText, { color: colors.success }]}>{labels.cash}: {formatINR(paymentCash + workCash)}</Text>
              </View>
              {paymentOnline + workOnline > 0 ? (
                <View style={[styles.miniPill, { backgroundColor: colors.infoSoft }]}>
                  <Text style={[styles.miniPillText, { color: colors.info }]}>बैंक: {formatINR(paymentOnline + workOnline)}</Text>
                </View>
              ) : null}
            </View>
          </View>
        ) : kind === "expense" ? (
          <View style={styles.totalCard}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", width: "100%" }}>
              <Text style={styles.totalLabel}>कुल खर्च ({dayExpenses.length})</Text>
              <Text style={[styles.totalValue, { color: colors.error, fontSize: 24, marginTop: 0 }]}>{formatINR(expenseTotal)}</Text>
            </View>
            {expenseTotal > 0 ? (
              <View style={[styles.workPillsRow, { alignSelf: "flex-start" }]}>
                {expenseCashTotal > 0 ? (
                  <View style={[styles.miniPill, { backgroundColor: colors.successSoft }]}>
                    <Text style={[styles.miniPillText, { color: colors.success }]}>{labels.cash}: {formatINR(expenseCashTotal)}</Text>
                  </View>
                ) : null}
                {expenseTotal - expenseCashTotal > 0 ? (
                  <View style={[styles.miniPill, { backgroundColor: colors.infoSoft }]}>
                    <Text style={[styles.miniPillText, { color: colors.info }]}>बैंक: {formatINR(expenseTotal - expenseCashTotal)}</Text>
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>
        ) : null}
      </View>

      {kind === "expense" ? (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl * 2 }}>
          <Pressable style={[styles.gallaActionBtn, { marginBottom: spacing.lg }]} onPress={() => setExpenseSheet(true)} testID="day-add-expense">
            <MaterialIcon name="plus" size={18} color={colors.warning} />
            <Text style={styles.gallaActionText}>खर्च जोड़ें</Text>
          </Pressable>

          {expenseByTitle.length > 1 ? (
            <View style={styles.breakdown}>
              {expenseByTitle.map(([title, amt]) => (
                <View key={title} style={styles.breakdownRow}>
                  <Text style={styles.breakdownLabel} numberOfLines={1}>{title}</Text>
                  <View style={styles.breakdownBarWrap}>
                    <View style={[styles.breakdownBar, { width: `${Math.max(4, (amt / expenseTotal) * 100)}%` }]} />
                  </View>
                  <Text style={styles.breakdownAmt}>{formatINR(amt)}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {dayExpenses.length === 0 ? (
            <View style={styles.empty}>
              <MaterialIcon name="coffee-outline" size={32} color={colors.muted} />
              <Text style={styles.emptyTitle}>इस दिन कोई खर्च नहीं</Text>
            </View>
          ) : (
            dayExpenses.map((exp) => (
              <View key={exp.id} style={styles.expenseRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.expenseTitle}>{exp.title}</Text>
                  <Text style={styles.expenseSub}>
                    {exp.mode === "cash" ? labels.cash : "बैंक"}
                    {exp.notes ? ` · ${exp.notes}` : ""}
                  </Text>
                </View>
                <Text style={[styles.expenseAmt, { color: colors.error }]}>-{formatINR(exp.amount)}</Text>
                <Pressable onPress={() => removeExpense(exp.id, exp.title, exp.amount)} hitSlop={8} testID={`day-expense-del-${exp.id}`}>
                  <MaterialIcon name="delete-outline" size={18} color={colors.muted} />
                </Pressable>
              </View>
            ))
          )}
        </ScrollView>
      ) : kind === "drawer" ? (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl * 2 }}>
          <View style={styles.quickGallaRow}>
            <Pressable style={styles.gallaActionBtn} onPress={() => setExpenseSheet(true)} testID="open-expense-btn">
              <MaterialIcon name="coffee-outline" size={18} color={colors.warning} />
              <Text style={styles.gallaActionText}>खर्च</Text>
            </Pressable>
            <Pressable style={styles.gallaActionBtn} onPress={() => setMoveSheet("in")} testID="open-move-in-btn">
              <MaterialIcon name="plus-circle-outline" size={18} color={colors.success} />
              <Text style={styles.gallaActionText}>जोड़ें</Text>
            </Pressable>
            <Pressable style={styles.gallaActionBtn} onPress={() => setMoveSheet("out")} testID="open-move-out-btn">
              <MaterialIcon name="minus-circle-outline" size={18} color={colors.error} />
              <Text style={styles.gallaActionText}>निकालें</Text>
            </Pressable>
            <Pressable style={styles.gallaActionBtn} onPress={() => setMoveSheet("swap")} testID="open-contra-btn">
              <MaterialIcon name="bank-transfer" size={18} color={colors.brandPrimary} />
              <Text style={styles.gallaActionText}>ट्रांसफर</Text>
            </Pressable>
          </View>

          <PocketCard persona={persona} pocket="cash" opening={openingCash} flow={flows.cash} dayLabel={dateLabel}>
            <View style={[styles.drawerRow, { marginTop: spacing.md }]}>
              <Text style={styles.drawerLabel}>गिने हुए</Text>
              <View style={[styles.inputWrap, { borderColor: colors.brandPrimary, borderWidth: 1.5 }]}>
                <Text style={styles.currencyPrefix}>₹</Text>
                <TextInput
                  style={styles.drawerInput}
                  keyboardType="numeric"
                  value={countedCash}
                  onChangeText={handleSaveCounted}
                  placeholder="0"
                  testID="day-counted-cash"
                />
              </View>
            </View>
            {diff !== null ? (
              <View
                style={[
                  styles.statusBox,
                  {
                    backgroundColor: diff === 0 ? colors.successSoft : diff > 0 ? "#FFFBEB" : colors.errorSoft,
                    borderColor: diff === 0 ? colors.success : diff > 0 ? colors.warning : colors.error,
                  },
                ]}
              >
                <MaterialIcon
                  name={diff === 0 ? "check-circle" : diff > 0 ? "alert-circle" : "close-circle"}
                  size={20}
                  color={diff === 0 ? colors.success : diff > 0 ? colors.warning : colors.error}
                />
                <Text style={[styles.statusText, { color: diff === 0 ? colors.success : diff > 0 ? colors.warning : colors.error }]}>
                  {diff === 0 ? "बराबर है" : diff > 0 ? `${formatINR(diff)} ज़्यादा` : `${formatINR(-diff)} कम`}
                </Text>
              </View>
            ) : null}
          </PocketCard>

          <PocketCard persona={persona} pocket="bank" opening={openingBank} flow={flows.bank} dayLabel={dateLabel} />

          {isPersonal ? null : (
            <Pressable style={[styles.gallaActionBtn, { backgroundColor: "#128C7E", borderColor: "#128C7E", marginBottom: spacing.lg }]} onPress={() => setDayCloseOpen(true)} testID="open-day-close-btn">
              <MaterialIcon name="check-all" size={18} color="#FFFFFF" />
              <Text style={[styles.gallaActionText, { color: "#FFFFFF" }]}>दुकान बंद रिपोर्ट</Text>
            </Pressable>
          )}

          {dayExpenses.length > 0 ? (
            <View style={{ marginTop: spacing.sm }}>
              <Text style={styles.sectionTitle}>खर्च ({dayExpenses.length})</Text>
              {dayExpenses.map((exp) => (
                <View key={exp.id} style={styles.expenseRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.expenseTitle}>{exp.title}</Text>
                    <Text style={styles.expenseSub}>
                      {exp.mode === "cash" ? labels.cash : "बैंक"}
                      {exp.notes ? ` · ${exp.notes}` : ""}
                    </Text>
                  </View>
                  <Text style={[styles.expenseAmt, { color: colors.error }]}>-{formatINR(exp.amount)}</Text>
                  <Pressable onPress={() => removeExpense(exp.id, exp.title, exp.amount)} hitSlop={8}>
                    <MaterialIcon name="delete-outline" size={18} color={colors.muted} />
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}

          {dayAeps.length > 0 ? (
            <View style={{ marginTop: spacing.lg }}>
              <Text style={styles.sectionTitle}>काउंटर ({dayAeps.length})</Text>
              {dayAeps.map((t) => (
                <View key={t.id} style={styles.aepsRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.aepsName}>{t.customerName || "काउंटर ग्राहक"} · {AEPS_META[t.type].short} {formatINR(t.amount)}</Text>
                    <Text style={styles.aepsDesc}>
                      {moneyLines(t).map((r) => `${r.label} ${r.value}`).join("  ·  ")}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          ) : null}
        </ScrollView>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(e) => e.id}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl * 2, gap: spacing.sm }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <MaterialIcon name="calendar-blank-outline" size={32} color={colors.muted} />
              <Text style={styles.emptyTitle}>
                {kind === "work" ? (isPersonal ? "इस दिन कुछ नहीं दिया" : "इस दिन कोई काम नहीं") : "इस दिन कुछ नहीं मिला"}
              </Text>
            </View>
          }
          renderItem={({ item: e }) => (
            <Pressable style={styles.row} onPress={() => setEditing(e)} testID={`day-row-${e.id}`}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <Pressable onPress={() => router.push(`/customer/${e.customerId}`)} hitSlop={4}>
                    <Text style={styles.name} numberOfLines={1}>{nameOf(e.customerId)}</Text>
                  </Pressable>
                  {e.mode === "online" ? (
                    <View style={styles.modeBadgeOnline}>
                      <MaterialIcon name="cellphone" size={10} color={colors.info} />
                      <Text style={styles.modeBadgeTextOnline}>ऑनलाइन</Text>
                    </View>
                  ) : (
                    <View style={styles.modeBadgeCash}>
                      <MaterialIcon name="cash" size={10} color={colors.success} />
                      <Text style={styles.modeBadgeTextCash}>नकद</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.desc} numberOfLines={2}>{e.description || (e.type === "work" ? "काम" : e.type === "given" ? "दिए" : e.type === "purchase" ? "सामान / सेवा" : "मिले")}</Text>
                {e.type === "purchase" ? (
                  <Text style={[styles.notes, { color: (e.paid ?? 0) >= e.amount ? colors.success : colors.warning }]}>
                    {(e.paid ?? 0) >= e.amount
                      ? "पूरे चुकाए"
                      : (e.paid ?? 0) > 0
                      ? `${formatINR(e.paid ?? 0)} चुकाए · ${formatINR(e.amount - (e.paid ?? 0))} देने हैं`
                      : "देने हैं"}
                  </Text>
                ) : null}
                {e.type === "work" ? (
                  <View style={{ marginTop: 2 }}>
                    <Text style={[styles.notes, { color: (e.paid ?? 0) >= e.amount ? colors.success : colors.error }]}>
                      {(e.paid ?? 0) >= e.amount
                        ? "पूरे मिले"
                        : (e.paid ?? 0) > 0
                        ? `${formatINR(e.paid ?? 0)} मिले · ${formatINR(e.amount - (e.paid ?? 0))} लेने हैं`
                        : "लेने हैं"}
                    </Text>
                    {e.fee && e.fee > 0 ? (
                      <Text style={styles.feeInfoText}>
                        फीस {formatINR(e.fee)} ({e.feeMode === "cash" ? "गल्ला" : "बैंक"}) · बचत {formatINR(e.amount - e.fee)}
                      </Text>
                    ) : null}
                  </View>
                ) : null}
                {e.notes ? <Text style={styles.notes} numberOfLines={1}>{e.notes}</Text> : null}
              </View>
              <Text style={[styles.amount, { color: kind === "payment" ? colors.success : isPersonal ? colors.error : colors.onSurface }]}>
                {formatINR(amountFor(e, kind))}
              </Text>
              <MaterialIcon name="pencil-outline" size={16} color={colors.muted} />
            </Pressable>
          )}
        />
      )}

      <EditRecordSheet entry={editing} onClose={() => setEditing(null)} />
      <AddExpenseSheet visible={expenseSheet} onClose={() => setExpenseSheet(false)} initialDate={date} />
      <MoneyMoveSheet kind={moveSheet} onClose={() => setMoveSheet(null)} initialDate={date} />
      <DayCloseModal visible={dayCloseOpen} onClose={() => setDayCloseOpen(false)} data={daySummary} />
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: "row", alignItems: "center", gap: spacing.lg, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  topTitle: { flex: 1, fontSize: 18, fontWeight: "700", color: colors.onSurface },
  dateRow: { flexDirection: "row", alignItems: "center", marginTop: spacing.sm },
  arrow: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  dateText: { fontSize: 17, fontWeight: "700", color: colors.onSurface },
  dateHint: { fontSize: 11, color: colors.muted, marginTop: 2 },
  segment: { flexDirection: "row", backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: 4, marginTop: spacing.lg, borderWidth: 1, borderColor: colors.border },
  segmentBtn: { flex: 1, alignItems: "center", paddingVertical: 10, borderRadius: radius.sm },
  segmentActive: { backgroundColor: colors.brandPrimary },
  segmentText: { fontSize: 12, fontWeight: "700", color: colors.onSurface, paddingHorizontal: 2 },
  breakdown: { marginBottom: spacing.lg, padding: spacing.md, gap: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  breakdownRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  breakdownLabel: { width: 92, fontSize: 12, fontWeight: "600", color: colors.onSurface },
  breakdownBarWrap: { flex: 1, height: 8, borderRadius: 4, backgroundColor: colors.border, overflow: "hidden" },
  breakdownBar: { height: 8, borderRadius: 4, backgroundColor: colors.warning },
  breakdownAmt: { minWidth: 64, textAlign: "right", fontSize: 12, fontWeight: "800", color: colors.onSurface },
  totalCard: { marginTop: spacing.md, padding: spacing.lg, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, alignItems: "center" },
  totalLabel: { fontSize: 12, color: colors.muted, fontWeight: "600" },
  totalValue: { fontSize: 28, fontWeight: "800", marginTop: 2 },
  workSummaryCard: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  workFeeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: spacing.xs,
    paddingVertical: 2,
  },
  feeLabel: { fontSize: 13, color: colors.error, fontWeight: "600" },
  feeValue: { fontSize: 13, color: colors.error, fontWeight: "700" },
  workProfitRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 2,
    paddingVertical: 2,
  },
  profitLabel: { fontSize: 13, color: colors.brandPrimary, fontWeight: "700" },
  profitValue: { fontSize: 14, color: colors.brandPrimary, fontWeight: "800" },
  workPillsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  miniPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  miniPillText: { fontSize: 11, fontWeight: "700" },
  modeBadgeOnline: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.infoSoft,
  },
  modeBadgeTextOnline: { fontSize: 10, fontWeight: "700", color: colors.info },
  modeBadgeCash: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.successSoft,
  },
  modeBadgeTextCash: { fontSize: 10, fontWeight: "700", color: colors.success },
  feeInfoText: { fontSize: 11, color: colors.muted, marginTop: 2, fontWeight: "500" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  name: { fontSize: 15, fontWeight: "700", color: colors.onSurface },
  desc: { fontSize: 13, color: colors.onSurfaceSecondary, marginTop: 2 },
  notes: { fontSize: 12, color: colors.muted, marginTop: 2 },
  amount: { fontSize: 16, fontWeight: "800" },
  empty: { alignItems: "center", padding: spacing.xxl, gap: spacing.sm },
  emptyTitle: { fontSize: 15, fontWeight: "600", color: colors.onSurface },

  // Galla Styles
  quickGallaRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  gallaActionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    backgroundColor: colors.surfaceSecondary,
    paddingVertical: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  gallaActionText: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.onSurface,
  },
  drawerCard: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  drawerHeading: {
    fontSize: 16,
    fontWeight: "800",
    color: colors.onSurface,
  },
  drawerSub: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 2,
    marginBottom: spacing.md,
  },
  drawerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginVertical: 4,
  },
  drawerLabel: {
    fontSize: 13,
    color: colors.onSurface,
    fontWeight: "600",
  },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 8,
    width: 120,
  },
  currencyPrefix: {
    fontSize: 14,
    color: colors.muted,
    marginRight: 4,
  },
  drawerInput: {
    flex: 1,
    fontSize: 15,
    fontWeight: "700",
    color: colors.onSurface,
    paddingVertical: 6,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.md,
  },
  flowRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 4,
  },
  flowLabel: {
    fontSize: 12,
    color: colors.onSurfaceSecondary,
  },
  flowVal: {
    fontSize: 13,
    fontWeight: "700",
  },
  expectedRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 4,
  },
  expectedLabel: {
    fontSize: 14,
    fontWeight: "800",
    color: colors.onSurface,
  },
  expectedValue: {
    fontSize: 22,
    fontWeight: "800",
    color: colors.brandPrimary,
  },
  statusBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    marginTop: spacing.md,
  },
  statusText: {
    fontSize: 12,
    fontWeight: "700",
    flex: 1,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.onSurface,
    marginBottom: spacing.sm,
  },
  expenseRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    padding: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.sm,
    marginBottom: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
  },
  expenseTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.onSurface,
  },
  expenseSub: {
    fontSize: 11,
    color: colors.muted,
    marginTop: 2,
  },
  expenseAmt: {
    fontSize: 14,
    fontWeight: "800",
  },
  aepsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.sm,
    marginBottom: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
  },
  aepsName: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.onSurface,
  },
  aepsDesc: {
    fontSize: 11,
    color: colors.muted,
    marginTop: 2,
  },
  aepsAmount: {
    fontSize: 14,
    fontWeight: "800",
  },
});
