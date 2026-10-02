import { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, FlatList, TextInput, ScrollView } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import MaterialIcon from "@react-native-vector-icons/material-design-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { colors, spacing, radius } from "@/src/theme";
import { cashIn, useAeps, useCustomers, useEntries, type Entry } from "@/src/lib/data";
import { formatINR, formatWeekdayDate, todayISO } from "@/src/lib/format";
import { Pressable } from "@/src/components/tap";
import { EditRecordSheet } from "@/src/components/sheets";
import { aepsTotals, drawerSentence, cashOf } from "@/src/lib/aeps";
import { useExpenses, deleteExpense } from "@/src/lib/expenses";
import { useContraTransfers } from "@/src/lib/contra";
import { AddExpenseSheet } from "@/src/components/expense-sheet";
import { ContraSheet } from "@/src/components/contra-sheet";
import { DayCloseModal } from "@/src/components/day-close-modal";
import { useAuth } from "@/src/context/AuthContext";
import type { DaySummaryData } from "@/src/lib/day-close";

type Kind = "work" | "payment" | "drawer";

function shiftDay(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function DayScreen() {
  const params = useLocalSearchParams<{ type?: "work" | "payment" | "drawer"; date?: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const customers = useCustomers().data ?? [];
  const entries = useEntries().data ?? [];
  const aepsList = useAeps().data ?? [];
  const today = todayISO();
  const [kind, setKind] = useState<Kind>(params.type || "work");
  const [date, setDate] = useState(params.date || today);
  const [editing, setEditing] = useState<Entry | null>(null);

  // Sheets & Modals
  const [expenseSheet, setExpenseSheet] = useState(false);
  const [contraSheet, setContraSheet] = useState(false);
  const [dayCloseOpen, setDayCloseOpen] = useState(false);

  // Dual Galla: Cash Drawer + Bank Account
  const [openingCash, setOpeningCash] = useState<string>("0");
  const [countedCash, setCountedCash] = useState<string>("");
  const [openingBank, setOpeningBank] = useState<string>("0");

  const expensesData = useExpenses(date);
  const contraData = useContraTransfers(date);

  useEffect(() => {
    AsyncStorage.getItem(`hisab_opening_cash_${date}`).then((v) => {
      setOpeningCash(v || "0");
    }).catch(() => {});
    AsyncStorage.getItem(`hisab_counted_cash_${date}`).then((v) => {
      setCountedCash(v || "");
    }).catch(() => {});
    AsyncStorage.getItem(`hisab_opening_bank_${date}`).then((v) => {
      setOpeningBank(v || "0");
    }).catch(() => {});
  }, [date]);

  const handleSaveOpening = (val: string) => {
    const clean = val.replace(/[^0-9]/g, "");
    setOpeningCash(clean);
    AsyncStorage.setItem(`hisab_opening_cash_${date}`, clean).catch(() => {});
  };

  const handleSaveCounted = (val: string) => {
    const clean = val.replace(/[^0-9]/g, "");
    setCountedCash(clean);
    AsyncStorage.setItem(`hisab_counted_cash_${date}`, clean).catch(() => {});
  };

  const handleSaveOpeningBank = (val: string) => {
    const clean = val.replace(/[^0-9]/g, "");
    setOpeningBank(clean);
    AsyncStorage.setItem(`hisab_opening_bank_${date}`, clean).catch(() => {});
  };

  const nameOf = (id: string) => customers.find((c) => c.id === id)?.name ?? "ग्राहक";

  const dayEntries = useMemo(() => entries.filter((e) => e.date === date), [entries, date]);
  const inKind = (e: Entry, k: "work" | "payment") => (k === "work" ? e.type === "work" : cashIn(e) > 0);
  const amountFor = (e: Entry, k: "work" | "payment") => (k === "work" ? e.amount : cashIn(e));
  const rows = useMemo(
    () => (kind === "drawer" ? [] : dayEntries.filter((e) => inKind(e, kind)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))),
    [dayEntries, kind]
  );
  const sum = (k: "work" | "payment") => dayEntries.filter((e) => inKind(e, k)).reduce((s, e) => s + amountFor(e, k), 0);

  // Cash In & Work Breakdown
  const workTotal = useMemo(() => dayEntries.filter((e) => e.type === "work").reduce((s, e) => s + e.amount, 0), [dayEntries]);
  const workCash = useMemo(() => dayEntries.filter((e) => e.type === "work").reduce((s, e) => s + (e.paid ?? 0), 0), [dayEntries]);
  const workUdhaar = workTotal - workCash;

  const paymentCash = useMemo(() => dayEntries.filter((e) => e.type === "payment").reduce((s, e) => s + e.amount, 0), [dayEntries]);

  const dayAeps = useMemo(() => aepsList.filter((t) => t.date === date && t.status === "success"), [aepsList, date]);
  const aepsTot = useMemo(() => aepsTotals(dayAeps), [dayAeps]);

  // Cash Drawer Total Math
  const cashInTotal = workCash + paymentCash + aepsTot.cashIn + contraData.bankToCash;
  const cashOutTotal = aepsTot.cashOut + expensesData.totalCash + contraData.cashToBank;
  const openingNum = parseInt(openingCash, 10) || 0;
  const expectedCash = openingNum + cashInTotal - cashOutTotal;

  const countedNum = countedCash ? parseInt(countedCash, 10) || 0 : null;
  const diff = countedNum !== null ? countedNum - expectedCash : null;

  // Online Bank Total Math
  const openingBankNum = parseInt(openingBank, 10) || 0;
  const onlineInTotal = aepsTot.commission + contraData.cashToBank;
  const onlineOutTotal = expensesData.totalOnline + contraData.bankToCash;
  const expectedBank = openingBankNum + onlineInTotal - onlineOutTotal;

  const dateLabel = date === today ? "आज" : date === todayISO(-1) ? "कल" : formatWeekdayDate(date);

  // Day Close Summary Object
  const daySummary: DaySummaryData = {
    date,
    shop: user || {},
    workTotal,
    workCash,
    workOnline: 0,
    workUdhaar,
    paymentCash,
    paymentOnline: 0,
    expenseCash: expensesData.totalCash,
    expenseOnline: expensesData.totalOnline,
    bankToCash: contraData.bankToCash,
    cashToBank: contraData.cashToBank,
    openingCash: openingNum,
    expectedCash,
    countedCash: countedNum,
    cashDiff: diff,
    openingBank: openingBankNum,
    expectedBank,
    actualBank: null,
    bankDiff: null,
    netProfitEstimate: workTotal - expensesData.totalAll,
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
            {date !== today ? <Text style={styles.dateHint}>आज पर जाने के लिए दबाएँ</Text> : null}
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
            <Text style={[styles.segmentText, kind === "work" && { color: colors.onBrandPrimary }]}>
              काम · {formatINR(sum("work"))}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setKind("payment")}
            style={[styles.segmentBtn, kind === "payment" && styles.segmentActive]}
            testID="day-kind-payment"
          >
            <Text style={[styles.segmentText, kind === "payment" && { color: colors.onBrandPrimary }]}>
              मिले · {formatINR(sum("payment"))}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setKind("drawer")}
            style={[styles.segmentBtn, kind === "drawer" && styles.segmentActive]}
            testID="day-kind-drawer"
          >
            <Text style={[styles.segmentText, kind === "drawer" && { color: colors.onBrandPrimary }]}>
              गल्ला व बैंक
            </Text>
          </Pressable>
        </View>

        {kind !== "drawer" ? (
          <View style={styles.totalCard}>
            <Text style={styles.totalLabel}>
              {kind === "work" ? "कुल काम" : "कुल मिले"} ({rows.length} एंट्री)
            </Text>
            <Text style={[styles.totalValue, { color: kind === "work" ? colors.onSurface : colors.success }]}>
              {formatINR(sum(kind))}
            </Text>
          </View>
        ) : null}
      </View>

      {kind === "drawer" ? (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl * 2 }}>
          {/* Quick Actions in Galla */}
          <View style={styles.quickGallaRow}>
            <Pressable
              style={styles.gallaActionBtn}
              onPress={() => setExpenseSheet(true)}
              testID="open-expense-btn"
            >
              <MaterialIcon name="coffee-outline" size={18} color={colors.warning} />
              <Text style={styles.gallaActionText}>खर्च लिखें</Text>
            </Pressable>
            <Pressable
              style={styles.gallaActionBtn}
              onPress={() => setContraSheet(true)}
              testID="open-contra-btn"
            >
              <MaterialIcon name="bank-transfer" size={18} color={colors.brandPrimary} />
              <Text style={styles.gallaActionText}>आपसी ट्रांसफर</Text>
            </Pressable>
            <Pressable
              style={[styles.gallaActionBtn, { backgroundColor: "#128C7E", borderColor: "#128C7E" }]}
              onPress={() => setDayCloseOpen(true)}
              testID="open-day-close-btn"
            >
              <MaterialIcon name="check-all" size={18} color="#FFFFFF" />
              <Text style={[styles.gallaActionText, { color: "#FFFFFF" }]}>दुकान बंद रिपोर्ट</Text>
            </Pressable>
          </View>

          {/* 1. Cash Drawer Card */}
          <View style={styles.drawerCard}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <MaterialIcon name="cash-multiple" size={20} color={colors.brandPrimary} />
              <Text style={styles.drawerHeading}>नकद गल्ला (Cash Drawer)</Text>
            </View>
            <Text style={styles.drawerSub}>दुकान की नकद दराज़ में रखे नोट और सिक्के</Text>

            <View style={styles.drawerRow}>
              <Text style={styles.drawerLabel}>सुबह का गल्ला (शुरुआती नकद):</Text>
              <View style={styles.inputWrap}>
                <Text style={styles.currencyPrefix}>₹</Text>
                <TextInput
                  style={styles.drawerInput}
                  keyboardType="numeric"
                  value={openingCash}
                  onChangeText={handleSaveOpening}
                  placeholder="0"
                  testID="day-opening-cash"
                />
              </View>
            </View>

            <View style={styles.divider} />

            <View style={styles.flowRow}>
              <Text style={styles.flowLabel}>+ काम से नकद मिले</Text>
              <Text style={[styles.flowVal, { color: colors.success }]}>+{formatINR(workCash)}</Text>
            </View>
            <View style={styles.flowRow}>
              <Text style={styles.flowLabel}>+ उधारी वापसी (भुगतान)</Text>
              <Text style={[styles.flowVal, { color: colors.success }]}>+{formatINR(paymentCash)}</Text>
            </View>
            {aepsTot.cashIn > 0 ? (
              <View style={styles.flowRow}>
                <Text style={styles.flowLabel}>+ काउंटर में आए नकद</Text>
                <Text style={[styles.flowVal, { color: colors.success }]}>+{formatINR(aepsTot.cashIn)}</Text>
              </View>
            ) : null}
            {contraData.bankToCash > 0 ? (
              <View style={styles.flowRow}>
                <Text style={styles.flowLabel}>+ ATM / बैंक से निकाले (गल्ले में आए)</Text>
                <Text style={[styles.flowVal, { color: colors.success }]}>+{formatINR(contraData.bankToCash)}</Text>
              </View>
            ) : null}

            {aepsTot.cashOut > 0 ? (
              <View style={styles.flowRow}>
                <Text style={styles.flowLabel}>- काउंटर से दिए गए नकद (AEPS निकासी)</Text>
                <Text style={[styles.flowVal, { color: colors.error }]}>-{formatINR(aepsTot.cashOut)}</Text>
              </View>
            ) : null}
            {expensesData.totalCash > 0 ? (
              <View style={styles.flowRow}>
                <Text style={styles.flowLabel}>- दुकान का नकद खर्च (चाय, सामान आदि)</Text>
                <Text style={[styles.flowVal, { color: colors.error }]}>-{formatINR(expensesData.totalCash)}</Text>
              </View>
            ) : null}
            {contraData.cashToBank > 0 ? (
              <View style={styles.flowRow}>
                <Text style={styles.flowLabel}>- गल्ले से बैंक में जमा किए</Text>
                <Text style={[styles.flowVal, { color: colors.error }]}>-{formatINR(contraData.cashToBank)}</Text>
              </View>
            ) : null}

            <View style={styles.divider} />

            <View style={styles.expectedRow}>
              <Text style={styles.expectedLabel}>गल्ले में होने चाहिए (अपेक्षित):</Text>
              <Text style={styles.expectedValue}>{formatINR(expectedCash)}</Text>
            </View>

            <View style={[styles.drawerRow, { marginTop: spacing.md }]}>
              <Text style={styles.drawerLabel}>गल्ले में गिने हुए रुपये (Actual):</Text>
              <View style={[styles.inputWrap, { borderColor: colors.brandPrimary, borderWidth: 1.5 }]}>
                <Text style={styles.currencyPrefix}>₹</Text>
                <TextInput
                  style={styles.drawerInput}
                  keyboardType="numeric"
                  value={countedCash}
                  onChangeText={handleSaveCounted}
                  placeholder="गिने हुए नोट"
                  testID="day-counted-cash"
                />
              </View>
            </View>

            {diff !== null ? (
              <View
                style={[
                  styles.statusBox,
                  {
                    backgroundColor:
                      diff === 0 ? colors.successSoft : diff > 0 ? "#FFFBEB" : colors.errorSoft,
                    borderColor: diff === 0 ? colors.success : diff > 0 ? colors.warning : colors.error,
                  },
                ]}
              >
                <MaterialIcon
                  name={diff === 0 ? "check-circle" : diff > 0 ? "alert-circle" : "close-circle"}
                  size={20}
                  color={diff === 0 ? colors.success : diff > 0 ? colors.warning : colors.error}
                />
                <Text
                  style={[
                    styles.statusText,
                    { color: diff === 0 ? colors.success : diff > 0 ? colors.warning : colors.error },
                  ]}
                >
                  {diff === 0
                    ? "गल्ला बिल्कुल सही है! कोई अंतर नहीं है ✅"
                    : diff > 0
                    ? `गल्ले में ₹${diff} ज़्यादा हैं (Extra)`
                    : `गल्ले में ₹${-diff} कम हैं (Shortage)`}
                </Text>
              </View>
            ) : null}
          </View>

          {/* 2. Online Bank & UPI Card */}
          <View style={[styles.drawerCard, { marginTop: spacing.lg }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <MaterialIcon name="bank-outline" size={20} color={colors.info} />
              <Text style={styles.drawerHeading}>ऑनलाइन बैंक / UPI खाता</Text>
            </View>
            <Text style={styles.drawerSub}>Google Pay, PhonePe, Paytm व बैंक बैलेंस</Text>

            <View style={styles.drawerRow}>
              <Text style={styles.drawerLabel}>सुबह का बैंक बैलेंस:</Text>
              <View style={styles.inputWrap}>
                <Text style={styles.currencyPrefix}>₹</Text>
                <TextInput
                  style={styles.drawerInput}
                  keyboardType="numeric"
                  value={openingBank}
                  onChangeText={handleSaveOpeningBank}
                  placeholder="0"
                  testID="day-opening-bank"
                />
              </View>
            </View>

            <View style={styles.divider} />

            {aepsTot.commission > 0 ? (
              <View style={styles.flowRow}>
                <Text style={styles.flowLabel}>+ काउंटर / AEPS कमीशन बैंक में</Text>
                <Text style={[styles.flowVal, { color: colors.success }]}>+{formatINR(aepsTot.commission)}</Text>
              </View>
            ) : null}
            {contraData.cashToBank > 0 ? (
              <View style={styles.flowRow}>
                <Text style={styles.flowLabel}>+ गल्ले से बैंक में जमा (कैश डिपॉजिट)</Text>
                <Text style={[styles.flowVal, { color: colors.success }]}>+{formatINR(contraData.cashToBank)}</Text>
              </View>
            ) : null}

            {contraData.bankToCash > 0 ? (
              <View style={styles.flowRow}>
                <Text style={styles.flowLabel}>- ATM / बैंक से निकाले (नकद बदला)</Text>
                <Text style={[styles.flowVal, { color: colors.error }]}>-{formatINR(contraData.bankToCash)}</Text>
              </View>
            ) : null}
            {expensesData.totalOnline > 0 ? (
              <View style={styles.flowRow}>
                <Text style={styles.flowLabel}>- ऑनलाइन/UPI से दिया गया खर्च</Text>
                <Text style={[styles.flowVal, { color: colors.error }]}>-{formatINR(expensesData.totalOnline)}</Text>
              </View>
            ) : null}

            <View style={styles.divider} />

            <View style={styles.expectedRow}>
              <Text style={styles.expectedLabel}>बैंक में होने चाहिए (अपेक्षित):</Text>
              <Text style={[styles.expectedValue, { color: colors.info }]}>{formatINR(expectedBank)}</Text>
            </View>
          </View>

          {/* 3. Today's Expenses List */}
          {expensesData.expenses.length > 0 ? (
            <View style={{ marginTop: spacing.lg }}>
              <Text style={styles.sectionTitle}>
                आज का दुकान खर्च ({expensesData.expenses.length} एंट्री · {formatINR(expensesData.totalAll)})
              </Text>
              {expensesData.expenses.map((exp) => (
                <View key={exp.id} style={styles.expenseRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.expenseTitle}>{exp.title}</Text>
                    <Text style={styles.expenseSub}>
                      {exp.mode === "cash" ? "गल्ले से नकद" : "बैंक / UPI से"}
                      {exp.notes ? ` · ${exp.notes}` : ""}
                    </Text>
                  </View>
                  <Text style={[styles.expenseAmt, { color: colors.error }]}>-{formatINR(exp.amount)}</Text>
                  <Pressable onPress={() => deleteExpense(exp.id)} hitSlop={8}>
                    <MaterialIcon name="delete-outline" size={18} color={colors.muted} />
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}

          {/* 4. Today's Counter Transactions summary */}
          {dayAeps.length > 0 ? (
            <View style={{ marginTop: spacing.lg }}>
              <Text style={styles.sectionTitle}>आज की काउंटर सेवाएं ({dayAeps.length})</Text>
              {dayAeps.map((t) => {
                const dir = cashOf(t);
                return (
                  <View key={t.id} style={styles.aepsRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.aepsName}>{t.customerName || "काउंटर ग्राहक"}</Text>
                      <Text style={styles.aepsDesc}>{drawerSentence(t.type, t.amount, dir, t.status)}</Text>
                    </View>
                    <Text
                      style={[
                        styles.aepsAmount,
                        { color: dir === "in" ? colors.success : dir === "out" ? colors.error : colors.muted },
                      ]}
                    >
                      {dir === "in" ? `+${formatINR(t.amount)}` : dir === "out" ? `-${formatINR(t.amount)}` : formatINR(t.amount)}
                    </Text>
                  </View>
                );
              })}
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
                {kind === "work" ? "इस दिन कोई काम नहीं लिखा" : "इस दिन कुछ नहीं मिला"}
              </Text>
            </View>
          }
          renderItem={({ item: e }) => (
            <Pressable style={styles.row} onPress={() => setEditing(e)} testID={`day-row-${e.id}`}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Pressable onPress={() => router.push(`/customer/${e.customerId}`)} hitSlop={4}>
                  <Text style={styles.name} numberOfLines={1}>{nameOf(e.customerId)}</Text>
                </Pressable>
                <Text style={styles.desc} numberOfLines={2}>{e.description || (e.type === "work" ? "काम" : "मिले")}</Text>
                {e.type === "work" ? (
                  <Text style={[styles.notes, { color: (e.paid ?? 0) >= e.amount ? colors.success : colors.error }]}>
                    {(e.paid ?? 0) >= e.amount
                      ? "पूरे मिले"
                      : (e.paid ?? 0) > 0
                      ? `${formatINR(e.paid ?? 0)} मिले · ${formatINR(e.amount - (e.paid ?? 0))} लेने हैं`
                      : "लेने हैं"}
                  </Text>
                ) : null}
                {e.notes ? <Text style={styles.notes} numberOfLines={1}>{e.notes}</Text> : null}
              </View>
              <Text style={[styles.amount, { color: kind === "work" ? colors.onSurface : colors.success }]}>
                {formatINR(amountFor(e, kind))}
              </Text>
              <MaterialIcon name="pencil-outline" size={16} color={colors.muted} />
            </Pressable>
          )}
        />
      )}

      <EditRecordSheet entry={editing} onClose={() => setEditing(null)} />
      <AddExpenseSheet visible={expenseSheet} onClose={() => setExpenseSheet(false)} initialDate={date} />
      <ContraSheet visible={contraSheet} onClose={() => setContraSheet(false)} initialDate={date} />
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
  segmentText: { fontSize: 13, fontWeight: "700", color: colors.onSurface },
  totalCard: { marginTop: spacing.md, padding: spacing.lg, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, alignItems: "center" },
  totalLabel: { fontSize: 12, color: colors.muted, fontWeight: "600" },
  totalValue: { fontSize: 28, fontWeight: "800", marginTop: 2 },
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
