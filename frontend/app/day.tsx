import { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, FlatList, TextInput, ScrollView } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import MaterialIcon from "@react-native-vector-icons/material-design-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { colors, spacing, radius } from "@/src/theme";
import { isRepayment, useCustomers, type Entry } from "@/src/lib/data";
import { cleanAmountInput, formatDateShort, formatINR, formatMonth, formatWeekdayDate, isBackdated, monthRange, parseAmount, roundMoney, shiftISO, todayISO, weekRange } from "@/src/lib/format";
import { Pressable } from "@/src/components/tap";
import { EditRecordSheet } from "@/src/components/sheets";
import { AEPS_META, bankLegDate, cashLegDate, moneyLines } from "@/src/lib/aeps";
import { expensePersona, type Expense } from "@/src/lib/expenses";
import { CalendarModal } from "@/src/components/calendar-modal";
import { AddExpenseSheet } from "@/src/components/expense-sheet";
import { confirmAction } from "@/src/lib/confirm";
import { MoneyMoveSheet, type MoveKind } from "@/src/components/money-move-sheet";
import { PocketCard } from "@/src/components/pocket-card";
import { DayCloseModal } from "@/src/components/day-close-modal";
import { useAuth } from "@/src/context/AuthContext";
import { usePersona } from "@/src/lib/persona";
import { accountKey, accountLabel, addMove, computeFlows, pocketNet, useMoneyBook, type Move } from "@/src/lib/wallet";
import type { DaySummaryData } from "@/src/lib/day-close";

// drawer: the day's summary (cash + bank) · work / payment: shop only · txns: every personal entry of the day.
type Kind = "drawer" | "work" | "payment" | "txns" | "expense";
type Period = "day" | "week" | "month";
const PERIOD_LABEL: Record<Period, string> = { day: "दिन", week: "हफ़्ता", month: "महीना" };
const SHORT_DAY = ["रवि", "सोम", "मंगल", "बुध", "गुरु", "शुक्र", "शनि"];

export default function DayScreen() {
  const params = useLocalSearchParams<{ type?: Kind; date?: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { persona, isPersonal, labels } = usePersona();
  const customers = useCustomers().data ?? [];
  const book = useMoneyBook();
  const today = todayISO();
  const [pickedKind, setKind] = useState<Kind>(params.type || "drawer");
  // A link meant for the other book lands on the nearest tab of this one.
  const kind: Kind = isPersonal
    ? pickedKind === "work" || pickedKind === "payment" ? "txns" : pickedKind
    : pickedKind === "txns" ? "work" : pickedKind;
  const [date, setDate] = useState(params.date || today);
  const [editing, setEditing] = useState<Entry | null>(null);

  const [expenseSheet, setExpenseSheet] = useState(false);
  const [moveSheet, setMoveSheet] = useState<MoveKind | null>(null);
  const [dayCloseOpen, setDayCloseOpen] = useState(false);
  const [countedCash, setCountedCash] = useState<string>("");
  const [period, setPeriod] = useState<Period>("day");
  const [calendar, setCalendar] = useState(false);
  const [editExpense, setEditExpense] = useState<Expense | null>(null);
  const [editMove, setEditMove] = useState<Move | null>(null);
  const range = period === "week" ? weekRange(date) : period === "month" ? monthRange(date) : { from: date, to: date };
  const step = (n: number) => {
    const next = period === "week" ? shiftISO(date, 7 * n) : period === "month" ? monthRange(date, n).from : shiftISO(date, n);
    setDate(next > today ? today : next);
  };

  useEffect(() => {
    AsyncStorage.getItem(`hisab_counted_cash_${persona}_${date}`).then((v) => setCountedCash(v || "")).catch(() => {});
  }, [date, persona]);

  const handleSaveCounted = (val: string) => {
    const clean = cleanAmountInput(val);
    setCountedCash(clean);
    AsyncStorage.setItem(`hisab_counted_cash_${persona}_${date}`, clean).catch(() => {});
  };

  const nameOf = (id: string) => customers.find((c) => c.id === id)?.name ?? labels.customer;

  const mineIds = useMemo(
    () => new Set(customers.filter((c) => (isPersonal ? c.persona === "personal" : c.persona !== "personal")).map((c) => c.id)),
    [customers, isPersonal]
  );
  const dayEntries = useMemo(() => book.entries.filter((e) => e.date === date && mineIds.has(e.customerId)), [book.entries, date, mineIds]);

  type ListKind = "work" | "payment" | "txns";
  const inKind = (e: Entry, k: ListKind) =>
    k === "txns" ? e.type !== "aeps" : k === "work" ? e.type === "work" : e.type === "payment" || (e.type === "work" && (e.paid ?? 0) > 0);
  const amountFor = (e: Entry, k: ListKind) => (k === "payment" && e.type === "work" ? e.paid ?? 0 : e.amount);
  const rows = useMemo(
    () => (kind === "drawer" || kind === "expense" ? [] : dayEntries.filter((e) => inKind(e, kind)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dayEntries, kind]
  );
  const sum = (k: ListKind) => dayEntries.filter((e) => inKind(e, k)).reduce((s, e) => s + amountFor(e, k), 0);

  // Personal day, by what actually happened.
  const personalDay = useMemo(() => {
    const t = { given: 0, got: 0, goods: 0, goodsPaid: 0, repaid: 0, count: 0 };
    for (const e of dayEntries) {
      if (e.type === "aeps") continue;
      t.count++;
      if (e.type === "payment") t.got += e.amount;
      else if (e.type === "purchase") {
        t.goods += e.amount;
        t.goodsPaid += e.paid ?? 0;
      } else if (isRepayment(e)) t.repaid += e.amount;
      else if (e.type === "given") t.given += e.amount;
    }
    return t;
  }, [dayEntries]);

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
  const expenseCashTotal = dayExpenses.filter((x) => x.mode !== "online").reduce((s, x) => s + x.amount, 0);
  const expenseByTitle = useMemo(() => {
    const m = new Map<string, number>();
    dayExpenses.forEach((x) => m.set(x.title, (m.get(x.title) ?? 0) + x.amount));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [dayExpenses]);
  const dayAeps = useMemo(
    () =>
      isPersonal
        ? []
        : book.aeps.filter((t) => t.status !== "failed" && (t.date === date || cashLegDate(t) === date || bankLegDate(t) === date)),
    [book.aeps, date, isPersonal]
  );

  const countedNum = countedCash ? parseAmount(countedCash) : null;
  const diff = countedNum !== null ? roundMoney(countedNum - expectedCash) : null;

  const dateLabel = date === today ? "आज" : date === todayISO(-1) ? "कल" : formatWeekdayDate(date);
  const signedINR = (n: number) => `${n < 0 ? "−" : "+"}${formatINR(Math.abs(n))}`;
  const dayNet = pocketNet(flows.cash) + pocketNet(flows.bank);

  const segments: { id: Kind; label: string; value?: string }[] = isPersonal
    ? [
        { id: "drawer", label: "सारांश", value: signedINR(dayNet) },
        { id: "txns", label: "लेन-देन", value: String(personalDay.count) },
        { id: "expense", label: "खर्च", value: formatINR(expenseTotal) },
      ]
    : [
        { id: "drawer", label: "सारांश", value: signedINR(dayNet) },
        { id: "work", label: "काम", value: formatINR(sum("work")) },
        { id: "payment", label: "मिले", value: formatINR(sum("payment")) },
        { id: "expense", label: "खर्च", value: formatINR(expenseTotal) },
      ];
  const openPocket = (p: "cash" | "bank") => router.push({ pathname: "/pocket" as never, params: { p, date } });

  const cashKey = accountKey(persona, "cash");
  const bankKey = accountKey(persona, "bank");
  const dayMoves = book.moves.filter((m) => m.date === date);
  const myMoves = dayMoves.filter((m) => [m.from, m.to].some((k) => k === cashKey || k === bankKey));

  // A correction move makes the app's galla equal to the counted cash from this day on.
  const matchCounted = () => {
    if (diff === null || diff === 0) return;
    // Galla leaves out rows typed long after their day; a deliberate match of an old day must still count there.
    const stamp = isBackdated(date, new Date().toISOString()) ? new Date(`${date}T12:00:00`).toISOString() : undefined;
    confirmAction(
      `${labels.cash} ${formatINR(countedNum ?? 0)} कर दें?`,
      diff > 0 ? `हिसाब में ${formatINR(diff)} "बाहर से जोड़े" लिखे जाएँगे।` : `हिसाब में ${formatINR(-diff)} "बाहर निकाले" लिखे जाएँगे।`,
      "हाँ, बराबर करें",
      () => void addMove(diff > 0 ? { date, from: "", to: cashKey, amount: diff, note: `${labels.cash} मिलान` } : { date, from: cashKey, to: "", amount: -diff, note: `${labels.cash} मिलान` }, stamp),
    );
  };
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
    // Same totals as the expense tab (old-dated rows included); the galla figures below leave those out.
    expenseCash: expenseCashTotal,
    expenseOnline: roundMoney(expenseTotal - expenseCashTotal),
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
    cashFlow: flows.cash,
    bankFlow: flows.bank,
    // Same basis as the week / month view: the day's work, fees and expenses by their date.
    netProfitEstimate: workProfit + flows.cash.commission + flows.bank.commission - expenseTotal,
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
        <View style={styles.periodRow}>
          {(["day", "week", "month"] as Period[]).map((p) => (
            <Pressable key={p} onPress={() => setPeriod(p)} style={[styles.periodChip, period === p && styles.periodOn]} testID={`day-period-${p}`}>
              <Text style={[styles.periodText, period === p && { color: colors.onBrandPrimary }]}>{PERIOD_LABEL[p]}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.dateRow}>
          <Pressable style={styles.arrow} onPress={() => step(-1)} testID="day-prev">
            <MaterialIcon name="chevron-left" size={24} color={colors.onSurface} />
          </Pressable>
          <Pressable style={{ flex: 1, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 6 }} onPress={() => setCalendar(true)} testID="day-today">
            <MaterialIcon name="calendar-month-outline" size={18} color={colors.brandPrimary} />
            <Text style={styles.dateText}>{period === "day" ? dateLabel : period === "week" ? `${formatDateShort(range.from)} – ${formatDateShort(range.to)}` : formatMonth(date)}</Text>
          </Pressable>
          <Pressable
            style={[styles.arrow, range.to >= today && { opacity: 0.3 }]}
            disabled={range.to >= today}
            onPress={() => step(1)}
            testID="day-next"
          >
            <MaterialIcon name="chevron-right" size={24} color={colors.onSurface} />
          </Pressable>
        </View>
        <CalendarModal visible={calendar} value={date} onPick={setDate} onClose={() => setCalendar(false)} max={today} />

        {period === "day" ? (
        <>
        <View style={styles.segment}>
          {segments.map((s) => (
            <Pressable key={s.id} onPress={() => setKind(s.id)} style={[styles.segmentBtn, kind === s.id && styles.segmentActive]} testID={`day-kind-${s.id}`}>
              <Text style={[styles.segmentText, kind === s.id && { color: colors.onBrandPrimary }]} numberOfLines={1} adjustsFontSizeToFit>
                {s.label}
              </Text>
              {s.value ? (
                <Text style={[styles.segmentValue, kind === s.id && { color: colors.onBrandPrimary }]} numberOfLines={1} adjustsFontSizeToFit>
                  {s.value}
                </Text>
              ) : null}
            </Pressable>
          ))}
        </View>

        {kind === "txns" ? (
          <View style={styles.workSummaryCard}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
              <Text style={styles.totalLabel}>{dateLabel} के लेन-देन</Text>
              <Text style={[styles.totalValue, { fontSize: 20, marginTop: 0 }]}>{personalDay.count}</Text>
            </View>
            <View style={styles.workPillsRow}>
              {personalDay.got > 0 ? <Pill color={colors.success} soft={colors.successSoft} text={`मिले ${formatINR(personalDay.got)}`} /> : null}
              {personalDay.given > 0 ? <Pill color={colors.error} soft={colors.errorSoft} text={`दिए ${formatINR(personalDay.given)}`} /> : null}
              {personalDay.goods > 0 ? (
                <Pill
                  color={colors.warning}
                  soft="#FFFBEB"
                  text={`सामान लिया ${formatINR(personalDay.goods)}${personalDay.goodsPaid > 0 ? ` (${formatINR(personalDay.goodsPaid)} चुकाए)` : ""}`}
                />
              ) : null}
              {personalDay.repaid > 0 ? <Pill color={colors.error} soft={colors.errorSoft} text={`बकाया चुकाया ${formatINR(personalDay.repaid)}`} /> : null}
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
        </>
        ) : null}
      </View>

      {period !== "day" ? (
        <RangeView
          from={range.from}
          to={range.to < today ? range.to : today}
          book={book}
          persona={persona}
          isPersonal={isPersonal}
          mineIds={mineIds}
          cashLabel={labels.cash}
          onPickDay={(d) => { setDate(d); setPeriod("day"); }}
        />
      ) : kind === "expense" ? (
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
              <Pressable key={exp.id} style={styles.expenseRow} onPress={() => setEditExpense(exp)} testID={`day-expense-${exp.id}`}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.expenseTitle}>{exp.title}</Text>
                  <Text style={styles.expenseSub}>
                    {exp.mode === "cash" ? labels.cash : "बैंक"}
                    {exp.notes ? ` · ${exp.notes}` : ""}
                  </Text>
                </View>
                <Text style={[styles.expenseAmt, { color: colors.error }]}>-{formatINR(exp.amount)}</Text>
                <MaterialIcon name="pencil-outline" size={16} color={colors.muted} />
              </Pressable>
            ))
          )}
        </ScrollView>
      ) : kind === "drawer" ? (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl * 2 }}>
          <View style={styles.dayHero}>
            <Text style={styles.dayHeroLabel}>{dateLabel} {labels.cash} + बैंक में बदलाव</Text>
            <Text style={styles.dayHeroValue}>{signedINR(dayNet)}</Text>
            <View style={styles.dayHeroRow}>
              <View style={styles.dayHeroCell}>
                <Text style={styles.dayHeroCellLabel}>दिन की शुरुआत</Text>
                <Text style={styles.dayHeroCellValue}>{formatINR(openingCash + openingBank)}</Text>
              </View>
              <View style={styles.dayHeroCell}>
                <Text style={styles.dayHeroCellLabel}>{date === today ? "अब" : "दिन के अंत में"}</Text>
                <Text style={styles.dayHeroCellValue}>{formatINR(expectedCash + expectedBank)}</Text>
              </View>
            </View>
          </View>

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

          <PocketCard persona={persona} pocket="cash" opening={openingCash} flow={flows.cash} dayLabel={dateLabel} onOpen={() => openPocket("cash")}>
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
            {diff !== null && diff !== 0 ? (
              <Pressable style={styles.matchBtn} onPress={matchCounted} testID="day-match-cash">
                <MaterialIcon name="scale-balance" size={16} color={colors.brandPrimary} />
                <Text style={styles.matchText}>हिसाब को गिने हुए {formatINR(countedNum ?? 0)} के बराबर करें</Text>
              </Pressable>
            ) : null}
          </PocketCard>

          <PocketCard persona={persona} pocket="bank" opening={openingBank} flow={flows.bank} dayLabel={dateLabel} onOpen={() => openPocket("bank")} />

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
                <Pressable key={exp.id} style={styles.expenseRow} onPress={() => setEditExpense(exp)}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.expenseTitle}>{exp.title}</Text>
                    <Text style={styles.expenseSub}>
                      {exp.mode === "cash" ? labels.cash : "बैंक"}
                      {exp.notes ? ` · ${exp.notes}` : ""}
                    </Text>
                  </View>
                  <Text style={[styles.expenseAmt, { color: colors.error }]}>-{formatINR(exp.amount)}</Text>
                  <MaterialIcon name="pencil-outline" size={16} color={colors.muted} />
                </Pressable>
              ))}
            </View>
          ) : null}

          {myMoves.length > 0 ? (
            <View style={{ marginTop: spacing.lg }}>
              <Text style={styles.sectionTitle}>जोड़े / निकाले ({myMoves.length})</Text>
              {myMoves.map((m) => {
                const inn = m.to === cashKey || m.to === bankKey;
                const swap = inn && (m.from === cashKey || m.from === bankKey);
                return (
                  <Pressable key={m.id} style={styles.expenseRow} onPress={() => setEditMove(m)} testID={`day-move-${m.id}`}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.expenseTitle}>{accountLabel(m.from)} → {accountLabel(m.to)}</Text>
                      {m.note ? <Text style={styles.expenseSub}>{m.note}</Text> : null}
                    </View>
                    <Text style={[styles.expenseAmt, { color: swap ? colors.onSurface : inn ? colors.success : colors.error }]}>
                      {swap ? "" : inn ? "+" : "-"}{formatINR(m.amount)}
                    </Text>
                    <MaterialIcon name="pencil-outline" size={16} color={colors.muted} />
                  </Pressable>
                );
              })}
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
                {kind === "txns" ? "इस दिन कोई लेन-देन नहीं" : kind === "work" ? "इस दिन कोई काम नहीं" : "इस दिन कुछ नहीं मिला"}
              </Text>
            </View>
          }
          renderItem={({ item: e }) => (
            <Pressable style={styles.row} onPress={() => setEditing(e)} testID={`day-row-${e.id}`}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Pressable onPress={() => router.push(`/customer/${e.customerId}`)} hitSlop={4} style={{ flexShrink: 1, minWidth: 0 }}>
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
                {kind === "txns" ? (
                  <Text style={[styles.kindTag, { color: personalKind(e).color }]}>{personalKind(e).label}</Text>
                ) : null}
                {e.description || kind !== "txns" ? (
                  <Text style={styles.desc} numberOfLines={2}>{e.description || (e.type === "work" ? "काम" : "मिले")}</Text>
                ) : null}
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
                        ? `${formatINR(e.paid ?? 0)} मिले · ${formatINR(e.amount - (e.paid ?? 0))} बाकी`
                        : "पैसे बाकी"}
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
              <Text style={[styles.amount, { color: kind === "txns" ? personalKind(e).color : kind === "payment" ? colors.success : colors.onSurface }]}>
                {kind === "txns" ? personalKind(e).sign : ""}{formatINR(amountFor(e, kind))}
              </Text>
              <MaterialIcon name="pencil-outline" size={16} color={colors.muted} />
            </Pressable>
          )}
        />
      )}

      <EditRecordSheet entry={editing} onClose={() => setEditing(null)} />
      <AddExpenseSheet visible={expenseSheet} onClose={() => setExpenseSheet(false)} initialDate={date} />
      <MoneyMoveSheet kind={moveSheet} onClose={() => setMoveSheet(null)} initialDate={date} />
      <AddExpenseSheet visible={!!editExpense} initial={editExpense} onClose={() => setEditExpense(null)} />
      <MoneyMoveSheet kind={null} initial={editMove} onClose={() => setEditMove(null)} />
      <DayCloseModal visible={dayCloseOpen} onClose={() => setDayCloseOpen(false)} data={daySummary} />
    </View>
  );
}

/** Week / month at a glance: totals, expense by category, and one line per day (tap to open that day). */
function RangeView({
  from,
  to,
  book,
  persona,
  isPersonal,
  mineIds,
  cashLabel,
  onPickDay,
}: {
  from: string;
  to: string;
  book: ReturnType<typeof useMoneyBook>;
  persona: "business" | "personal";
  isPersonal: boolean;
  mineIds: Set<string>;
  cashLabel: string;
  onPickDay: (d: string) => void;
}) {
  const data = useMemo(() => {
    const inRange = (d: string) => d >= from && d <= to;
    const flows = computeFlows(book, persona, inRange);
    const entries = book.entries.filter((e) => inRange(e.date) && mineIds.has(e.customerId));
    const expenses = book.expenses.filter((x) => inRange(x.date) && expensePersona(x) === persona);
    // Personal: money lent out (not paying back goods); shop: work done.
    const out = (e: Entry) => (isPersonal ? (e.type === "given" && !isRepayment(e) ? e.amount : 0) : e.type === "work" ? e.amount : 0);
    const got = (e: Entry) => (e.type === "payment" ? e.amount : e.type === "work" ? e.paid ?? 0 : 0);
    const days: { d: string; work: number; got: number; exp: number }[] = [];
    for (let d = to; d >= from; d = shiftISO(d, -1)) {
      const de = entries.filter((e) => e.date === d);
      const dx = expenses.filter((x) => x.date === d);
      const row = { d, work: de.reduce((s, e) => s + out(e), 0), got: de.reduce((s, e) => s + got(e), 0), exp: dx.reduce((s, x) => s + x.amount, 0) };
      if (row.work || row.got || row.exp || de.length) days.push(row);
    }
    const byTitle = new Map<string, number>();
    expenses.forEach((x) => byTitle.set(x.title, (byTitle.get(x.title) ?? 0) + x.amount));
    const work = entries.reduce((s, e) => s + out(e), 0);
    const fees = isPersonal ? 0 : entries.reduce((s, e) => s + (e.type === "work" ? e.fee ?? 0 : 0), 0);
    const exp = expenses.reduce((s, x) => s + x.amount, 0);
    const commission = flows.cash.commission + flows.bank.commission;
    return {
      days,
      work,
      goods: entries.reduce((s, e) => s + (e.type === "purchase" ? e.amount : 0), 0),
      got: entries.reduce((s, e) => s + got(e), 0),
      exp,
      commission,
      profit: work - fees + commission - exp,
      cashNet: pocketNet(flows.cash),
      bankNet: pocketNet(flows.bank),
      byTitle: [...byTitle.entries()].sort((a, b) => b[1] - a[1]),
    };
  }, [from, to, book, persona, isPersonal, mineIds]);
  const signed = (n: number) => `${n < 0 ? "−" : "+"}${formatINR(Math.abs(n))}`;

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl * 2 }}>
      <View style={styles.rangeGrid}>
        <RangeCell label={isPersonal ? "दिए" : "काम"} value={formatINR(data.work)} color={isPersonal ? colors.error : colors.onSurface} />
        <RangeCell label="मिले" value={formatINR(data.got)} color={colors.success} />
        {isPersonal ? <RangeCell label="सामान / सेवा ली" value={formatINR(data.goods)} color={colors.warning} /> : null}
        <RangeCell label="खर्च" value={formatINR(data.exp)} color={colors.error} />
        {isPersonal ? null : <RangeCell label="कमीशन" value={formatINR(data.commission)} color={colors.brandPrimary} />}
        {isPersonal ? null : <RangeCell label="अनुमानित बचत" value={formatINR(data.profit)} color={data.profit < 0 ? colors.error : colors.brandPrimary} />}
        <RangeCell label={`${cashLabel} / बैंक बदलाव`} value={`${signed(data.cashNet)} / ${signed(data.bankNet)}`} color={colors.onSurface} small />
      </View>

      {data.byTitle.length > 0 ? (
        <View style={[styles.breakdown, { marginTop: spacing.lg }]}>
          <Text style={styles.sectionTitle}>खर्च किस पर</Text>
          {data.byTitle.map(([title, amt]) => (
            <View key={title} style={styles.breakdownRow}>
              <Text style={styles.breakdownLabel} numberOfLines={1}>{title}</Text>
              <View style={styles.breakdownBarWrap}>
                <View style={[styles.breakdownBar, { width: `${Math.max(4, (amt / data.exp) * 100)}%` }]} />
              </View>
              <Text style={styles.breakdownAmt}>{formatINR(amt)}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <Text style={[styles.sectionTitle, { marginTop: spacing.lg }]}>दिन के हिसाब से</Text>
      {data.days.length === 0 ? (
        <View style={styles.empty}>
          <MaterialIcon name="calendar-blank-outline" size={32} color={colors.muted} />
          <Text style={styles.emptyTitle}>इस दौरान कुछ नहीं लिखा</Text>
        </View>
      ) : (
        data.days.map((r) => (
          <Pressable key={r.d} style={styles.expenseRow} onPress={() => onPickDay(r.d)} testID={`range-day-${r.d}`}>
            <Text style={[styles.expenseTitle, { width: 96 }]} numberOfLines={1}>{formatDateShort(r.d)} · {SHORT_DAY[new Date(`${r.d}T12:00:00`).getDay()]}</Text>
            <Text style={[styles.rangeDayVal, { color: isPersonal ? colors.error : colors.onSurface }]}>{r.work ? formatINR(r.work) : "—"}</Text>
            <Text style={[styles.rangeDayVal, { color: colors.success }]}>{r.got ? formatINR(r.got) : "—"}</Text>
            <Text style={[styles.rangeDayVal, { color: colors.error }]}>{r.exp ? formatINR(r.exp) : "—"}</Text>
            <MaterialIcon name="chevron-right" size={16} color={colors.muted} />
          </Pressable>
        ))
      )}
      {data.days.length > 0 ? (
        <Text style={styles.rangeLegend}>{isPersonal ? "दिए" : "काम"} · मिले · खर्च</Text>
      ) : null}
    </ScrollView>
  );
}

/** What a personal entry was, in one word, with the way it moved the person's balance. */
function personalKind(e: Entry): { label: string; color: string; sign: string } {
  if (e.type === "payment") return { label: "मिले", color: colors.success, sign: "+" };
  if (e.type === "purchase") return { label: "सामान / सेवा ली", color: colors.warning, sign: "" };
  if (isRepayment(e)) return { label: "बकाया चुकाया", color: colors.error, sign: "−" };
  return { label: "दिए", color: colors.error, sign: "−" };
}

function Pill({ text, color, soft }: { text: string; color: string; soft: string }) {
  return (
    <View style={[styles.miniPill, { backgroundColor: soft }]}>
      <Text style={[styles.miniPillText, { color }]}>{text}</Text>
    </View>
  );
}

function RangeCell({ label, value, color, small }: { label: string; value: string; color: string; small?: boolean }) {
  return (
    <View style={styles.rangeCell}>
      <Text style={styles.totalLabel}>{label}</Text>
      <Text style={[styles.rangeVal, { color }, small && { fontSize: 14 }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  periodRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs },
  periodChip: { flex: 1, alignItems: "center", paddingVertical: 7, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary },
  periodOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  periodText: { fontSize: 13, fontWeight: "700", color: colors.onSurface },
  matchBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: spacing.sm, paddingVertical: 10, borderRadius: radius.md, borderWidth: 1, borderColor: colors.brandPrimary, borderStyle: "dashed" },
  matchText: { fontSize: 13, fontWeight: "700", color: colors.brandPrimary },
  rangeGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  rangeCell: { flexBasis: "48%", flexGrow: 1, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  rangeVal: { fontSize: 20, fontWeight: "800", marginTop: 2 },
  rangeDayVal: { flex: 1, textAlign: "right", fontSize: 13, fontWeight: "700" },
  rangeLegend: { fontSize: 11, color: colors.muted, textAlign: "right", marginTop: spacing.xs },
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
  segmentValue: { fontSize: 11, fontWeight: "600", color: colors.muted, marginTop: 1, paddingHorizontal: 2 },
  dayHero: { padding: spacing.lg, borderRadius: radius.md, backgroundColor: colors.brandPrimary, marginBottom: spacing.md },
  dayHeroLabel: { fontSize: 13, fontWeight: "600", color: colors.onBrandPrimary, opacity: 0.85 },
  dayHeroValue: { fontSize: 28, fontWeight: "800", color: colors.onBrandPrimary, marginTop: 2 },
  dayHeroRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  dayHeroCell: { flex: 1, padding: spacing.sm, borderRadius: radius.sm, backgroundColor: "rgba(255,255,255,0.15)" },
  dayHeroCellLabel: { fontSize: 11, color: colors.onBrandPrimary, opacity: 0.85 },
  dayHeroCellValue: { fontSize: 15, fontWeight: "800", color: colors.onBrandPrimary, marginTop: 2 },
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
  kindTag: { fontSize: 12, fontWeight: "800", marginTop: 2 },
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
