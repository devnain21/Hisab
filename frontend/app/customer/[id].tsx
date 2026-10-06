import { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Linking, ActivityIndicator } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useLocalSearchParams, useRouter } from "expo-router";
import MaterialIcon from "@react-native-vector-icons/material-design-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, spacing, radius, semantic, elevation } from "@/src/theme";
import { computeBalance, isRepayment, isVendor, itemsOf, useAeps, useCustomers, useEntries, useJobs, type AepsTxn, type Entry, type EntryType, type Job } from "@/src/lib/data";
import { AEPS_META, STATUS_META, aepsBill, aepsDue, defaultVia, statusLabel, viaBill } from "@/src/lib/aeps";
import { formatDate, formatINR, formatPhone, monthRange, todayISO } from "@/src/lib/format";
import { store } from "@/src/lib/store";
import { buildLedger, vendorByJob, type WorkState, type WorkStatus } from "@/src/lib/records";
import { AddEntrySheet, AddJobSheet, AddCustomerSheet, Chip, CompleteJobSheet, EditRecordSheet, SettleSheet, SheetShell } from "@/src/components/sheets";
import { Pressable } from "@/src/components/tap";
import { Amount, Button, IconButton, IconLabel, type IconName } from "@/src/components/ui";
import { useAuth } from "@/src/context/AuthContext";
import { ReceiptSheet } from "@/src/components/receipt-sheet";
import { RemindDateSheet } from "@/src/components/remind-date-sheet";
import { LedgerLinkSheet } from "@/src/components/ledger-link-sheet";
import { aepsReceiptDoc, receiptDoc, statementDoc, reminderDoc, workOrderDoc, workOrderNo, type ShareDoc } from "@/src/lib/receipt";
import { DataLoadError } from "@/src/components/slow-server-hint";
import { UpiQrModal } from "@/src/components/upi-qr-sheet";
import { addRecentCustomer } from "@/src/lib/recent";
import { aepsJamaEntry, jamaKindOf } from "@/src/lib/aeps-due";
import { accountName } from "@/src/lib/persona";
import { TERMS, balanceTerm } from "@/src/lib/terms";

export default function CustomerDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const customersQ = useCustomers();
  const entriesQ = useEntries();
  const jobsQ = useJobs();
  const aepsQ = useAeps();
  const [allAeps, setAllAeps] = useState(false);
  const [entrySheet, setEntrySheet] = useState<EntryType | null>(null);
  const [jobSheet, setJobSheet] = useState<"now" | "later" | null>(null);
  const [editSheet, setEditSheet] = useState(false);
  const [completing, setCompleting] = useState<Job | null>(null);
  const [editing, setEditing] = useState<Entry | null>(null);
  const [editingJob, setEditingJob] = useState<Job | null>(null);
  const { user } = useAuth();

  const customer = (customersQ.data ?? []).find((c) => c.id === id);
  const entries = useMemo(() => (entriesQ.data ?? []).filter((e) => e.customerId === id), [entriesQ.data, id]);
  const jobs = useMemo(() => (jobsQ.data ?? []).filter((j) => j.customerId === id), [jobsQ.data, id]);
  const ledger = useMemo(() => buildLedger(entries), [entries]);
  const jobVendor = useMemo(() => vendorByJob(entriesQ.data ?? []), [entriesQ.data]);
  const vendorName = (vid: string) => (customersQ.data ?? []).find((c) => c.id === vid)?.name ?? "—";
  const phone10 = (customer?.phone ?? "").replace(/\D/g, "").slice(-10);
  // Counter rows belong to the shop book only.
  const aepsList = (customer?.persona === "personal" ? [] : aepsQ.data ?? [])
    .filter((t) => t.customerId === id || (!t.customerId && phone10.length === 10 && t.mobile.replace(/\D/g, "").slice(-10) === phone10))
    .sort((a, b) => (a.date !== b.date ? b.date.localeCompare(a.date) : (b.time || "").localeCompare(a.time || "") || b.createdAt.localeCompare(a.createdAt)));
  const [filter, setFilter] = useState<LedgerFilter>("all");
  // Rows are drawn a page at a time; a long-time customer can have hundreds.
  const [shown, setShown] = useState(PAGE);
  const [settling, setSettling] = useState<Entry | null>(null);
  const [shareDoc, setShareDoc] = useState<ShareDoc | null>(null);
  const [qrModal, setQrModal] = useState(false);
  const [stmt, setStmt] = useState<StmtRange | null>(null);
  const [more, setMore] = useState(false);
  const [remindSheet, setRemindSheet] = useState(false);
  const [ledgerSheet, setLedgerSheet] = useState(false);
  const [orderSheet, setOrderSheet] = useState(false);
  const [payPick, setPayPick] = useState(false);

  useEffect(() => {
    if (id) void addRecentCustomer(id);
  }, [id]);

  const rows = useMemo(
    () =>
      entries
        .filter((e) => !ledger.nested.has(e.id))
        .sort((a, b) => (a.date !== b.date ? b.date.localeCompare(a.date) : b.createdAt.localeCompare(a.createdAt))),
    [entries, ledger],
  );
  const stateOf = (e: Entry) => ledger.work.get(e.id)?.state;
  const counts = useMemo(() => {
    const c: Record<LedgerFilter, number> = { all: rows.length, due: 0, settled: 0, cash: 0, jama: 0 };
    rows.forEach((e) => {
      if (e.type === "payment") c.jama += 1;
      else {
        const s = ledger.work.get(e.id)?.state;
        if (s === "pending" || s === "partial") c.due += 1;
        else if (s === "settled") c.settled += 1;
        else if (s === "cash") c.cash += 1;
      }
    });
    return c;
  }, [rows, ledger]);
  const visible = rows.filter((e) => {
    if (filter === "all") return true;
    if (filter === "jama") return e.type === "payment";
    const s = stateOf(e);
    return filter === "due" ? s === "pending" || s === "partial" : s === filter;
  });

  const due = computeBalance(entries);
  const totals = useMemo(() => {
    let work = 0, given = 0, got = 0, bought = 0, paidOut = 0;
    for (const e of entries) {
      if (e.type === "work" || e.type === "aeps") { work += e.amount; got += e.paid ?? 0; }
      else if (e.type === "purchase") { bought += e.amount; paidOut += e.paid ?? 0; }
      else if (isRepayment(e)) paidOut += e.amount;
      else if (e.type === "given") given += e.amount;
      else got += e.amount;
    }
    return { work, given, got, bought, paidOut, any: work + given + got + bought + paidOut > 0 };
  }, [entries]);
  // Money left with us by a customer is an advance; with a personal contact it's money we owe back.
  const isCustomer = customer?.persona !== "personal";
  const vendor = isCustomer && isVendor(customer);
  const balanceLabel = due === 0 ? "हिसाब" : vendor ? (due < 0 ? "देने हैं" : "एडवांस दिया") : balanceTerm(due, !isCustomer);
  const openOrders = vendor ? rows.filter((e) => e.type === "purchase" && (ledger.work.get(e.id)?.remaining ?? 0) > 0) : [];
  const openJobs = jobs.filter((j) => j.status !== "done");
  const showMoreFilters = rows.length > 8;

  if (!customer && customersQ.isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={colors.brandPrimary} />
      </View>
    );
  }
  if (!customer && customersQ.isError) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.surface, justifyContent: "center" }}>
        <DataLoadError onRetry={() => { customersQ.refetch(); entriesQ.refetch(); }} />
      </View>
    );
  }
  if (!customer) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", padding: spacing.xl }}>
        <MaterialIcon name="account-question-outline" size={40} color={colors.muted} />
        <Text style={{ marginTop: spacing.md, color: colors.onSurface }}>खाता नहीं मिला</Text>
        <Pressable onPress={() => router.back()} style={{ marginTop: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, backgroundColor: colors.brandPrimary, borderRadius: radius.md }}>
          <Text style={{ color: colors.onBrandPrimary, fontWeight: "600" }}>वापस</Text>
        </Pressable>
      </View>
    );
  }

  const openReceipt = (e: Entry) => {
    if (vendor && e.type === "purchase") return setShareDoc(workOrderDoc(e, ledger.work.get(e.id), customer, user ?? {}, entries));
    const txn = e.type === "aeps" ? aepsList.find((t) => t.id === e.linkId) : undefined;
    const jama = txn ? aepsJamaEntry(txn.id, entries) : undefined;
    const keptLabel = jama ? (jamaKindOf(jama) === "old" ? "पुरानी उधारी में कटे" : "खाते में जमा") : "";
    setShareDoc(txn ? aepsReceiptDoc(txn, user ?? {}, jama?.amount ?? 0, keptLabel) : receiptDoc(e, ledger.work.get(e.id), customer, due, isCustomer, user ?? {}, { jobs: jobsQ.data ?? [], entries: entriesQ.data ?? [] }));
  };
  const openStatement = () => setStmt("all");
  const stmtDoc = stmt ? statementDoc(entries, ledger, customer, isCustomer, user ?? {}, stmtRange(stmt)) : null;
  const openReminder = () => setShareDoc(reminderDoc(customer, due, user ?? {}));

  type Action = { key: string; label: string; icon: IconName; color?: string; run: () => void };
  const actWork: Action = { key: "work", label: "काम लिखें", icon: "plus", run: () => setJobSheet("now") };
  const actGot: Action = { key: "got", label: "पैसे मिले", icon: "arrow-bottom-left", color: semantic.received, run: () => setEntrySheet("payment") };
  const actGiven: Action = { key: "given", label: "पैसे दिए", icon: "arrow-top-right", color: semantic.due, run: () => setEntrySheet("given") };
  const actReturn: Action = { key: "return", label: isCustomer ? "जमा लौटाएँ" : "पैसे चुकाएँ", icon: "cash-refund", run: () => setEntrySheet("given") };
  const actOrder: Action = { key: "order", label: "Vendor ऑर्डर", icon: "truck-outline", run: () => setOrderSheet(true) };
  const actPay: Action = {
    key: "pay",
    label: "भुगतान करें",
    icon: "cash-fast",
    color: semantic.due,
    run: () => (openOrders.length === 1 ? setSettling(openOrders[0]) : openOrders.length > 1 ? setPayPick(true) : setEntrySheet("given")),
  };
  const primary = vendor ? (openOrders.length > 0 ? actPay : actOrder) : due > 0 ? actGot : due < 0 ? actReturn : isCustomer ? actWork : actGiven;
  const secondary = vendor ? (primary === actPay ? actOrder : actPay) : isCustomer ? (primary === actWork ? actGot : actWork) : primary === actGot ? actGiven : actGot;
  const moreActions: Action[] = [];
  if (vendor) moreActions.push(actOrder, actPay, { key: "advance", label: "एडवांस", icon: "arrow-top-right", color: semantic.due, run: () => setEntrySheet("given") }, { key: "refund", label: "पैसे वापस मिले", icon: "arrow-bottom-left", color: semantic.received, run: () => setEntrySheet("payment") });
  else {
    if (isCustomer) moreActions.push(actWork);
    moreActions.push(actGot, actGiven);
  }
  if (!isCustomer) moreActions.push({ key: "purchase", label: "सामान / सेवा ली", icon: "cart-outline", color: semantic.pending, run: () => setEntrySheet("purchase") });
  if (due > 0 && !vendor) {
    moreActions.push(
      { key: "remind", label: "तगादा भेजें", icon: "message-alert-outline", color: semantic.pending, run: openReminder },
      { key: "qr", label: "QR से पेमेंट लें", icon: "qrcode-scan", run: () => setQrModal(true) },
      { key: "remindOn", label: customer.remindOn ? "वसूली की तारीख बदलें" : "वसूली की तारीख (याद दिलाएँ)", icon: "bell-ring-outline", run: () => setRemindSheet(true) },
    );
  }
  if (entries.length > 0) {
    moreActions.push(
      { key: "stmt", label: "पूरा हिसाब भेजें (PDF / WhatsApp)", icon: "file-document-outline", run: openStatement },
      ...(vendor ? [] : [{ key: "ledger", label: "हिसाब का लिंक (ग्राहक खुद देखे)", icon: "link-variant" as IconName, run: () => setLedgerSheet(true) }]),
    );
  }
  moreActions.push({ key: "edit", label: "नाम / फ़ोन बदलें", icon: "pencil-outline", run: () => setEditSheet(true) });
  // Opening the next sheet only after this one has slid away avoids two modals fighting on iOS.
  const pickMore = (a: Action) => {
    setMore(false);
    setTimeout(a.run, 300);
  };
  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={{ paddingTop: insets.top + spacing.sm, paddingHorizontal: spacing.sm, paddingBottom: spacing.sm, flexDirection: "row", alignItems: "center" }}>
        <IconButton icon="arrow-left" label="वापस" size={26} onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} testID="back-btn" />
        <View style={{ flex: 1, minWidth: 0, marginLeft: spacing.xs }}>
          <Text style={styles.name} numberOfLines={2}>{customer.name}</Text>
          <Text style={styles.sub} numberOfLines={1}>
            {customer.phone ? formatPhone(customer.phone) : "फ़ोन नहीं"}{customer.address ? ` · ${customer.address}` : ""}
          </Text>
        </View>
        {customer.phone ? (
          <>
            <IconButton icon="phone-outline" label="कॉल करें" onPress={() => Linking.openURL(`tel:${customer.phone}`)} testID="call-cust-btn" />
            <IconButton
              icon="whatsapp"
              label="WhatsApp खोलें"
              color={semantic.whatsapp}
              onPress={() => Linking.openURL(`https://wa.me/91${customer.phone.replace(/[^0-9]/g, "").slice(-10)}`)}
              testID="direct-wa-btn"
            />
          </>
        ) : null}
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 96 + insets.bottom }}>
        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>{balanceLabel}</Text>
          {due === 0 ? (
            <Text style={[styles.balanceValue, { color: colors.onSurface }]}>{TERMS.settled}</Text>
          ) : (
            <Amount value={Math.abs(due)} tone={vendor ? (due < 0 ? "due" : "received") : due > 0 ? "due" : isCustomer ? "received" : "pending"} size="display" style={styles.balanceValue} />
          )}
          {vendor ? (
            <View style={styles.vendorTag}>
              <MaterialIcon name="truck-outline" size={14} color={colors.info} />
              <Text style={styles.vendorTagText}>Vendor{openOrders.length ? ` · ${openOrders.length} ऑर्डर खुले` : ""}</Text>
            </View>
          ) : null}
          {totals.any ? (
            <Text style={styles.breakdown}>
              {[
                totals.work > 0 ? `काम ${formatINR(totals.work)}` : "",
                totals.given > 0 ? `दिए ${formatINR(totals.given)}` : "",
                totals.got > 0 || totals.work + totals.given > 0 ? `मिले ${formatINR(totals.got)}` : "",
                totals.bought > 0 ? `${vendor ? "ऑर्डर" : "सामान"} ${formatINR(totals.bought)}` : "",
                totals.bought > 0 ? `चुकाए ${formatINR(totals.paidOut)}` : "",
              ].filter(Boolean).join(" · ")}
            </Text>
          ) : null}
          {isCustomer && !vendor && (customer.creditLimit ?? 0) > 0 ? (
            <IconLabel
              icon={due > customer.creditLimit! ? "alert-octagon-outline" : "shield-check-outline"}
              color={due > customer.creditLimit! ? semantic.due : colors.onSurfaceSecondary}
              label={`उधार सीमा ${formatINR(customer.creditLimit!)}${due > customer.creditLimit! ? ` · ${formatINR(due - customer.creditLimit!)} पार` : ""}`}
              style={[styles.breakdown, { marginTop: spacing.sm }]}
            />
          ) : null}
          {due > 0 && !vendor && customer.remindOn ? (
            <Pressable onPress={() => setRemindSheet(true)} hitSlop={6} testID="cust-remind-on">
              <IconLabel
                icon="bell-ring-outline"
                color={customer.remindOn <= todayISO() ? semantic.due : semantic.pending}
                label={`वसूली ${customer.remindOn === todayISO() ? "आज" : formatDate(customer.remindOn)}${customer.remindOn < todayISO() ? " · तारीख निकल गई" : ""}`}
                style={[styles.breakdown, { marginTop: spacing.sm }]}
              />
            </Pressable>
          ) : null}
          {customer.notes ? <Text style={styles.notes}>{customer.notes}</Text> : null}
        </View>

        {openJobs.length > 0 && (
          <>
            <View style={styles.sectionRow}>
              <Text style={[styles.sectionHead, { marginTop: 0, marginBottom: 0 }]}>आगे का काम / रिमार्क</Text>
              <Pressable onPress={() => setJobSheet("later")} hitSlop={8} testID="add-job-btn">
                <MaterialIcon name="plus-circle-outline" size={22} color={colors.brandPrimary} />
              </Pressable>
            </View>
            <View style={{ gap: spacing.sm }}>
              {openJobs.map((j) => (
                <Pressable key={j.id} style={styles.jobRow} onPress={() => setEditingJob(j)} testID={`cust-job-${j.id}`}>
                  <MaterialIcon name="calendar-clock" size={20} color={colors.brandPrimary} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.jobTitle}>{j.title}</Text>
                    <Text style={styles.sub}>{formatDate(j.dueDate)}{j.estimatedAmount > 0 ? ` · ${formatINR(j.estimatedAmount)}` : ""}{jobVendor.has(j.id) ? ` · Vendor: ${vendorName(jobVendor.get(j.id)!)}` : ""}</Text>
                    {j.notes ? <Text style={styles.sub}>{j.notes}</Text> : null}
                  </View>
                  <Pressable style={styles.pillBtn} onPress={() => setCompleting(j)} testID={`cust-complete-${j.id}`}>
                    <Text style={styles.pillBtnText}>पूरा</Text>
                  </Pressable>
                </Pressable>
              ))}
            </View>
          </>
        )}

        {aepsList.length > 0 ? (
          <>
            <View style={styles.sectionRow}>
              <Text style={[styles.sectionHead, { marginTop: 0, marginBottom: 0 }]}>काउंटर सेवाएँ ({aepsList.length})</Text>
              {aepsList.length > 4 ? (
                <Pressable onPress={() => setAllAeps((v) => !v)} hitSlop={8} testID="cust-aeps-all">
                  <Text style={styles.linkText}>{allAeps ? "कम दिखाएँ" : "सभी देखें"}</Text>
                </Pressable>
              ) : null}
            </View>
            <View style={{ gap: spacing.sm }}>
              {(allAeps ? aepsList : aepsList.slice(0, 4)).map((t) => (
                <AepsRow key={t.id} t={t} kept={aepsJamaEntry(t.id, entries)?.amount ?? 0} onPress={() => router.push(`/aeps/${t.id}`)} />
              ))}
            </View>
          </>
        ) : null}

        <Text style={styles.sectionHead}>खाता</Text>
        {rows.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingBottom: spacing.md }}>
            {LEDGER_FILTERS.filter((f) => {
              if (f === "all") return true;
              if (f === "due") return counts.due > 0;
              return showMoreFilters && counts[f] > 0;
            }).map((f) => {
              const active = filter === f;
              const tone = f === "due" ? colors.error : f === "all" ? colors.brandPrimary : colors.success;
              return (
                <Pressable key={f} onPress={() => { setFilter(f); setShown(PAGE); }} style={[styles.filterChip, active && { backgroundColor: tone, borderColor: tone }]} testID={`ledger-filter-${f}`}>
                  <Text style={[styles.filterText, !active && f === "due" && { color: colors.error }, active && { color: "#fff" }]}>
                    {LEDGER_FILTER_LABEL[f]} ({counts[f]})
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}
        {rows.length === 0 ? (
          <View style={styles.empty}>
            <MaterialIcon name="notebook-outline" size={28} color={colors.muted} />
            <Text style={{ color: colors.muted, marginTop: spacing.sm }}>अभी कोई एंट्री नहीं</Text>
          </View>
        ) : visible.length === 0 ? (
          <View style={styles.empty}>
            <Text style={{ color: colors.muted }}>इस सूची में कुछ नहीं</Text>
          </View>
        ) : (
          <View style={{ gap: spacing.sm }}>
            {visible.slice(0, shown).map((e, i) => (
              <Animated.View key={e.id} entering={FadeInDown.delay(Math.min(i, 8) * 40).duration(250)}>
                {e.type !== "payment" ? (
                  <WorkCard entry={e} status={ledger.work.get(e.id)!} vendor={vendor} onPress={() => setEditing(e)} onSettle={() => setSettling(e)} onReceipt={() => openReceipt(e)} />
                ) : (
                  <JamaCard entry={e} onPress={() => setEditing(e)} onReceipt={() => openReceipt(e)} />
                )}
              </Animated.View>
            ))}
            {visible.length > shown ? (
              <Pressable style={styles.moreBtn} onPress={() => setShown((n) => n + PAGE)} testID="ledger-more">
                <Text style={styles.linkText}>और दिखाएँ ({visible.length - shown})</Text>
              </Pressable>
            ) : null}
          </View>
        )}
      </ScrollView>

      <View style={[styles.bottomBar, { paddingBottom: spacing.sm + insets.bottom }]}>
        <Button
          label={primary.label}
          icon={primary.icon}
          onPress={primary.run}
          style={{ flex: 1 }}
          testID="cust-primary-btn"
        />
        <Button
          label={secondary === actOrder ? "ऑर्डर" : secondary === actPay ? "भुगतान" : secondary === actWork ? "काम" : secondary === actGot ? "मिले" : "दिए"}
          icon={secondary.icon}
          variant="secondary"
          onPress={secondary.run}
          style={{ paddingHorizontal: spacing.md }}
          testID="cust-secondary-btn"
        />
        {due > 0 && !vendor ? <IconButton icon="message-alert-outline" label="तगादा भेजें" color={semantic.pending} background={semantic.pendingSoft} onPress={openReminder} testID="share-reminder-btn" /> : null}
        <IconButton icon="dots-horizontal" label="और विकल्प" color={colors.brandPrimary} background={colors.brandTertiary} onPress={() => setMore(true)} testID="cust-more-btn" />
      </View>

      <SheetShell visible={more} onClose={() => setMore(false)} title={customer.name}>
        <View style={{ gap: spacing.xs }}>
          {moreActions.map((a) => (
            <Pressable key={a.key} style={styles.moreRow} onPress={() => pickMore(a)} testID={`cust-more-${a.key}`}>
              <View style={[styles.iconBadge, { backgroundColor: colors.brandTertiary }]}>
                <MaterialIcon name={a.icon} size={20} color={a.color ?? colors.brandPrimary} />
              </View>
              <Text style={styles.moreText}>{a.label}</Text>
              <MaterialIcon name="chevron-right" size={20} color={colors.muted} />
            </Pressable>
          ))}
        </View>
      </SheetShell>

      <SheetShell visible={payPick} onClose={() => setPayPick(false)} title="किस ऑर्डर का भुगतान?">
        <View style={{ gap: spacing.xs }}>
          {openOrders.map((o) => (
            <Pressable key={o.id} style={styles.moreRow} onPress={() => { setPayPick(false); setTimeout(() => setSettling(o), 300); }} testID={`pay-order-${o.id}`}>
              <View style={[styles.iconBadge, { backgroundColor: semantic.dueSoft }]}>
                <MaterialIcon name="truck-outline" size={18} color={semantic.due} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.moreText} numberOfLines={1}>{o.description || "Vendor ऑर्डर"}</Text>
                <Text style={styles.sub}>{workOrderNo(o)}{o.dueDate ? ` · कब तक ${formatDate(o.dueDate)}` : ""}</Text>
              </View>
              <Text style={[styles.amount, { color: semantic.due }]}>{formatINR(ledger.work.get(o.id)?.remaining ?? 0)}</Text>
            </Pressable>
          ))}
        </View>
      </SheetShell>
      <AddEntrySheet visible={orderSheet} type="purchase" vendor onClose={() => setOrderSheet(false)} customerId={customer.id} />
      <AddEntrySheet visible={entrySheet !== null} type={entrySheet ?? "work"} onClose={() => setEntrySheet(null)} customerId={customer.id} />
      <EditRecordSheet entry={editing} job={editingJob} onClose={() => { setEditing(null); setEditingJob(null); }} />
      <AddJobSheet visible={jobSheet !== null} initialMode={jobSheet ?? "now"} onClose={() => setJobSheet(null)} customerId={customer.id} />
      <SettleSheet work={settling} onClose={() => setSettling(null)} />
      <AddCustomerSheet
        visible={editSheet}
        onClose={() => setEditSheet(false)}
        initial={customer}
        onDelete={() => { store.deleteCustomer(customer.id); router.back(); }}
      />
      <CompleteJobSheet job={completing} onClose={() => setCompleting(null)} />
      <RemindDateSheet customer={customer} visible={remindSheet} onClose={() => setRemindSheet(false)} />
      <LedgerLinkSheet customer={customer} due={due} shopName={accountName(user ? { ...user, persona: customer.persona === "personal" ? "personal" : "business" } : null)} visible={ledgerSheet} onClose={() => setLedgerSheet(false)} />
      <ReceiptSheet doc={shareDoc} onClose={() => setShareDoc(null)} />
      <ReceiptSheet
        doc={stmtDoc}
        onClose={() => setStmt(null)}
        header={
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.md }}>
            {STMT_RANGES.map((r) => (
              <Chip key={r} label={STMT_LABEL[r]} active={stmt === r} onPress={() => setStmt(r)} testID={`stmt-range-${r}`} />
            ))}
          </View>
        }
      />
      <UpiQrModal
        visible={qrModal}
        onClose={() => setQrModal(false)}
        upiId={user?.shop_upi || ""}
        shopName={accountName(user ? { ...user, persona: customer.persona === "personal" ? "personal" : "business" } : null) || "खाता"}
        amount={due}
        customerName={customer.name}
      />
    </View>
  );
}

type StmtRange = "all" | "this" | "last" | "three";
const STMT_RANGES: StmtRange[] = ["all", "this", "last", "three"];
const STMT_LABEL: Record<StmtRange, string> = { all: "पूरा", this: "इस महीने", last: "पिछला महीना", three: "3 महीने" };
function stmtRange(r: StmtRange): { from: string; to: string } | undefined {
  const today = todayISO();
  if (r === "this") return { from: monthRange(today).from, to: today };
  if (r === "last") return monthRange(today, -1);
  if (r === "three") return { from: monthRange(today, -2).from, to: today };
  return undefined;
}

type LedgerFilter = "all" | "due" | "settled" | "cash" | "jama";
const PAGE = 60;
const LEDGER_FILTERS: LedgerFilter[] = ["all", "due", "settled", "cash", "jama"];
const LEDGER_FILTER_LABEL: Record<LedgerFilter, string> = { all: "सभी", due: "बाकी", settled: "चुकता", cash: "नकद", jama: "मिले" };

// Money handed over (personal loan): same settle flow as udhaar work, different wording.
const GIVEN_UI: Record<WorkState, { label: string; icon: string; fg: string; bg: string }> = {
  cash: { label: "वापस मिले", icon: "check-decagram", fg: colors.success, bg: colors.successSoft },
  pending: { label: "वापस मिलने हैं", icon: "arrow-top-right", fg: colors.error, bg: colors.errorSoft },
  partial: { label: "कुछ बाकी", icon: "progress-clock", fg: colors.warning, bg: "#FEF3E2" },
  settled: { label: "वापस मिले", icon: "check-decagram", fg: colors.success, bg: colors.successSoft },
};

// Goods / service taken on credit: the open part is money we owe them.
const PURCHASE_UI: Record<WorkState, { label: string; icon: string; fg: string; bg: string }> = {
  cash: { label: "पूरे चुकाए", icon: "cart-check", fg: colors.success, bg: colors.successSoft },
  pending: { label: "देने हैं", icon: "cart-outline", fg: colors.warning, bg: "#FEF3E2" },
  partial: { label: "कुछ देने हैं", icon: "progress-clock", fg: colors.warning, bg: "#FEF3E2" },
  settled: { label: "चुकता", icon: "check-decagram", fg: colors.success, bg: colors.successSoft },
};

const STATE_UI: Record<WorkState, { label: string; icon: string; fg: string; bg: string }> = {
  cash: { label: "नकद", icon: "cash", fg: colors.success, bg: colors.successSoft },
  pending: { label: "बाकी", icon: "clock-alert-outline", fg: colors.error, bg: colors.errorSoft },
  partial: { label: "कुछ बाकी", icon: "progress-clock", fg: colors.warning, bg: "#FEF3E2" },
  settled: { label: "चुकता", icon: "check-decagram", fg: colors.success, bg: colors.successSoft },
};

function AepsRow({ t, kept, onPress }: { t: AepsTxn; kept: number; onPress: () => void }) {
  const m = AEPS_META[t.type] ?? AEPS_META.other;
  const via = viaBill(t.via || defaultVia(t.type));
  const bill = aepsBill(t);
  const due = aepsDue(t);
  const st = STATUS_META[t.status];
  const big = bill.flow === "none" ? bill.total : t.amount;
  return (
    <Pressable style={[styles.jobRow, due > 0 && { borderLeftWidth: 4, borderLeftColor: colors.error }]} onPress={onPress} testID={`cust-aeps-${t.id}`}>
      <View style={[styles.iconBadge, { backgroundColor: m.soft }]}>
        <MaterialIcon name={m.icon as any} size={18} color={m.color} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.jobTitle} numberOfLines={1}>{t.type === "other" && t.billerName ? t.billerName : m.hiLabel}</Text>
        <Text style={styles.sub} numberOfLines={1}>{[via, t.beneficiaryName, formatDate(t.date)].filter(Boolean).join(" · ")}</Text>
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <Text style={[styles.amount, { color: m.color }]}>{formatINR(big)}</Text>
        {due > 0 ? (
          <View style={[styles.statePill, { backgroundColor: colors.errorSoft }]}>
            <Text style={[styles.stateText, { color: colors.error }]}>बाकी {formatINR(due)}</Text>
          </View>
        ) : kept > 0 ? (
          <View style={[styles.statePill, { backgroundColor: colors.infoSoft }]}>
            <MaterialIcon name="piggy-bank-outline" size={12} color={colors.info} />
            <Text style={[styles.stateText, { color: colors.info }]}>जमा {formatINR(kept)}</Text>
          </View>
        ) : (
          <View style={[styles.statePill, { backgroundColor: st.soft }]}>
            <MaterialIcon name={st.icon as any} size={12} color={st.color} />
            <Text style={[styles.stateText, { color: st.color }]}>{statusLabel(t)}</Text>
          </View>
        )}
      </View>
    </Pressable>
  );
}

function ReceiptButton({ entryId, onPress }: { entryId: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={6} style={styles.receiptBtn} accessibilityRole="button" accessibilityLabel="रसीद भेजें" testID={`receipt-${entryId}`}>
      <MaterialIcon name="receipt-text-outline" size={20} color={colors.brandPrimary} />
    </Pressable>
  );
}

function WorkCard({ entry, status, vendor, onPress, onSettle, onReceipt }: { entry: Entry; status: WorkStatus; vendor?: boolean; onPress: () => void; onSettle: () => void; onReceipt: () => void }) {
  const given = entry.type === "given";
  const purchase = entry.type === "purchase";
  const order = vendor && purchase;
  const delivered = entry.status !== "ordered";
  const late = order && !delivered && !!entry.dueDate && entry.dueDate < todayISO();
  const ui = (purchase ? PURCHASE_UI : given ? GIVEN_UI : STATE_UI)[status.state];
  const open = status.state === "pending" || status.state === "partial";
  const laterPaid = status.received - status.paidAtBooking;
  const lines = entry.items && entry.items.length > 1 ? itemsOf(entry) : [];
  const word = purchase
    ? { got: "चुकाए", left: "देने हैं", settle: "पैसे चुकाए", fromPool: " (हिसाब में कटे)" }
    : { got: "मिले", left: "बाकी", settle: given ? "पैसे वापस मिले" : "पैसे मिले", fromPool: given ? " (हिसाब में कटे)" : " (पहले के एडवांस से)" };
  return (
    <Pressable
      style={[styles.card, open && { borderLeftWidth: 4, borderLeftColor: ui.fg, backgroundColor: status.state === "pending" ? "#FFF7F6" : colors.surfaceSecondary }]}
      onPress={onPress}
      testID={`entry-${entry.id}`}
    >
      <View style={styles.cardTop}>
        <View style={[styles.iconBadge, { backgroundColor: ui.bg }]}>
          <MaterialIcon name={ui.icon as any} size={18} color={ui.fg} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.jobTitle} numberOfLines={2}>{entry.description || (purchase ? "सामान / सेवा" : given ? "पैसे दिए" : "काम")}</Text>
          <Text style={styles.sub}>{formatDate(entry.date)}{entry.notes ? ` · ${entry.notes}` : ""}</Text>
          {order && entry.dueDate ? (
            <IconLabel
              icon={delivered ? "check-circle-outline" : late ? "alert-circle-outline" : "truck-delivery-outline"}
              color={delivered ? colors.success : late ? colors.error : colors.info}
              label={delivered ? "डिलीवर हो गया" : `कब तक: ${entry.dueDate === todayISO() ? "आज" : formatDate(entry.dueDate)}${late ? " · देर" : ""}`}
              style={[styles.sub, { fontWeight: "700" }]}
            />
          ) : null}
          {entry.fee && entry.fee > 0 ? (
            <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>
              पोर्टल फीस: {formatINR(entry.fee)} ({entry.feeMode === "cash" ? "नकद" : "बैंक"}) · बचत: {formatINR(entry.amount - entry.fee)}
            </Text>
          ) : null}
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={[styles.amount, open && { color: ui.fg }]}>{formatINR(entry.amount)}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 }}>
            {entry.mode === "online" ? (
              <View style={[styles.statePill, { backgroundColor: colors.infoSoft }]}>
                <Text style={[styles.stateText, { color: colors.info }]}>UPI</Text>
              </View>
            ) : null}
            <View style={[styles.statePill, { backgroundColor: ui.bg }]}>
              {status.state === "settled" ? <MaterialIcon name="check" size={12} color={ui.fg} /> : null}
              <Text style={[styles.stateText, { color: ui.fg }]}>{ui.label}</Text>
            </View>
          </View>
        </View>
        <ReceiptButton entryId={entry.id} onPress={onReceipt} />
      </View>

      {lines.length ? (
        <View style={styles.itemList}>
          {lines.map((it, i) => (
            <View key={i} style={styles.itemLine}>
              <Text style={styles.itemName} numberOfLines={1}>{it.title}</Text>
              <Text style={styles.itemAmt}>{formatINR(it.amount)}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {status.state !== "cash" ? (
        <View style={styles.moneyLine}>
          <Text style={styles.moneyText}>कुल {formatINR(entry.amount)}</Text>
          <Text style={styles.moneyText}>
            {word.got} {formatINR(status.received)}
            {status.paidAtBooking > 0 && laterPaid > 0 ? ` (उसी दिन ${formatINR(status.paidAtBooking)} + बाद में ${formatINR(laterPaid)})` : ""}
            {status.fromJama > 0 && status.settlements.length === 0 ? word.fromPool : ""}
          </Text>
          {status.state === "settled" ? (
            <IconLabel icon="check-circle" color={colors.success} label={`${status.settledOn ? `${formatDate(status.settledOn)} को ` : ""}चुकता`} style={[styles.moneyText, { fontWeight: "700" }]} />
          ) : (
            <Text style={[styles.moneyText, { color: ui.fg, fontWeight: "800" }]}>{word.left} {formatINR(status.remaining)}</Text>
          )}
        </View>
      ) : null}

      {open ? (
        <Pressable style={[styles.settleBtn, purchase && { backgroundColor: colors.warning }]} onPress={onSettle} testID={`settle-${entry.id}`}>
          <MaterialIcon name="cash-check" size={16} color="#fff" />
          <Text style={styles.settleText}>{word.settle}{status.state === "partial" ? ` · ${formatINR(status.remaining)}` : ""}</Text>
        </Pressable>
      ) : null}
    </Pressable>
  );
}

function JamaCard({ entry, onPress, onReceipt }: { entry: Entry; onPress: () => void; onReceipt: () => void }) {
  return (
    <Pressable style={styles.card} onPress={onPress} testID={`entry-${entry.id}`}>
      <View style={styles.cardTop}>
        <View style={[styles.iconBadge, { backgroundColor: colors.successSoft }]}>
          <MaterialIcon name="arrow-bottom-left" size={18} color={colors.success} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.jobTitle} numberOfLines={2}>{entry.description || "पैसे मिले"}</Text>
          <Text style={styles.sub}>{formatDate(entry.date)}{entry.notes ? ` · ${entry.notes}` : ""}</Text>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Amount value={entry.amount} tone="received" sign="+" size="bodyLg" style={{ fontWeight: "800" }} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 }}>
            {entry.mode === "online" ? (
              <View style={[styles.statePill, { backgroundColor: colors.infoSoft }]}>
                <Text style={[styles.stateText, { color: colors.info }]}>UPI</Text>
              </View>
            ) : (
              <View style={[styles.statePill, { backgroundColor: colors.successSoft }]}>
                <Text style={[styles.stateText, { color: colors.success }]}>नकद</Text>
              </View>
            )}
            <View style={[styles.statePill, { backgroundColor: colors.successSoft }]}>
              <Text style={[styles.stateText, { color: colors.success }]}>मिले</Text>
            </View>
          </View>
        </View>
        <ReceiptButton entryId={entry.id} onPress={onReceipt} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  name: { fontSize: 18, fontWeight: "700", color: colors.onSurface },
  sub: { fontSize: 12, color: colors.muted, marginTop: 2 },
  vendorTag: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", marginTop: spacing.sm, paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: colors.infoSoft },
  vendorTagText: { fontSize: 12, fontWeight: "800", color: colors.info },
  balanceCard: { padding: spacing.xl, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  balanceLabel: { fontSize: 12, color: colors.muted, fontWeight: "700", textTransform: "uppercase" },
  balanceValue: { fontSize: 36, fontWeight: "800", marginTop: spacing.xs },
  notes: { fontSize: 13, color: colors.onSurfaceSecondary, marginTop: spacing.sm },
  breakdown: { fontSize: 13, color: colors.onSurfaceSecondary, marginTop: spacing.xs, fontWeight: "600" },
  bottomBar: { position: "absolute", left: 0, right: 0, bottom: 0, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border, ...elevation.high },
  moreRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 52, paddingHorizontal: spacing.sm, borderRadius: radius.md },
  moreText: { flex: 1, fontSize: 15, fontWeight: "600", color: colors.onSurface },
  sectionHead: { fontSize: 17, fontWeight: "700", color: colors.onSurface, marginTop: spacing.xl, marginBottom: spacing.md },
  sectionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.xl, marginBottom: spacing.md },  jobRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  jobTitle: { fontSize: 15, fontWeight: "600", color: colors.onSurface },
  linkText: { fontSize: 13, fontWeight: "700", color: colors.brandPrimary },
  moreBtn: { alignSelf: "center", paddingVertical: spacing.md, paddingHorizontal: spacing.xl },
  pillBtn: { paddingHorizontal: spacing.md, paddingVertical: 7, backgroundColor: colors.brandPrimary, borderRadius: radius.pill },
  pillBtnText: { color: colors.onBrandPrimary, fontWeight: "700", fontSize: 12 },
  filterChip: { height: 32, paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  filterText: { fontSize: 12, fontWeight: "700", color: colors.onSurface },
  card: { padding: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  cardTop: { flexDirection: "row", gap: spacing.md, alignItems: "flex-start" },
  receiptBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: colors.brandTertiary },
  iconBadge: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  amount: { fontSize: 16, fontWeight: "800", color: colors.onSurface },
  statePill: { flexDirection: "row", alignItems: "center", gap: 2, paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill, marginTop: 4 },
  stateText: { fontSize: 12, fontWeight: "800" },
  moneyLine: { flexDirection: "row", flexWrap: "wrap", columnGap: spacing.md, rowGap: 2, marginTop: spacing.sm, marginLeft: 48 },
  moneyText: { fontSize: 12, color: colors.onSurfaceSecondary },
  settleBtn: { marginTop: spacing.md, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, borderRadius: radius.md, backgroundColor: colors.success },
  settleText: { color: "#fff", fontWeight: "700", fontSize: 12 },
  itemList: { marginTop: spacing.sm, marginLeft: 48, paddingTop: spacing.xs, borderTopWidth: 1, borderTopColor: colors.border, gap: 2 },
  itemLine: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md },
  itemName: { flex: 1, fontSize: 13, color: colors.onSurface },
  itemAmt: { fontSize: 13, fontWeight: "700", color: colors.onSurface },
  empty: { alignItems: "center", padding: spacing.xl, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
});
