import { useState, useEffect } from "react";
import { View, Text, TextInput } from "react-native";
import MaterialIcon from "@react-native-vector-icons/material-design-icons";
import { store } from "@/src/lib/store";
import { computeBalance, itemsOf, useAeps, useCustomers, useEntries, useJobs, type Entry, type EntryType, type Job } from "@/src/lib/data";
import { ADVANCE, advancesForJob, buildLedger, feePaid, jobForWork, jobStart, linkedPayment, olderAdvances, refundsForJob, removeEntryWithLinks, removeJobWithAdvances, settlementsFor, workForJob, workForPayment } from "@/src/lib/records";
import { confirmAction } from "@/src/lib/confirm";
import { colors, spacing, radius } from "@/src/theme";
import { cleanAmountInput, dateOnSave, formatDate, formatINR, parseAmount, roundMoney, todayISO } from "@/src/lib/format";
import { Pressable } from "@/src/components/tap";
import { useContactPicker } from "@/src/components/contact-picker-modal";
import { usePersona } from "@/src/lib/persona";
import { getPrefs } from "@/src/lib/prefs";
import { useRouter } from "expo-router";
import { EditHistory } from "@/src/components/edit-history";
import { outsideCostId, saveOutsideCost, useExpenseList } from "@/src/lib/expenses";
import { SheetShell, Field, inputStyle, LimitWarning, MoreInfo, Chip, DateField, samePhone, useCustomerChoice, CustomerPicker, useMoneyInput, MoneyFields, useItems, ItemsField, type PayMode, useSplitPay, splitOf, PayModeField, FeeField, OutsideCostField, settleDescription, bookAdvance, createPaid, confirmOldDate, PrimaryButton, DangerLink, styles } from "./parts";
import { CompleteJobSheet } from "./job-sheets";

export function AddCustomerSheet({ visible, onClose, initial, onDelete }: { visible: boolean; onClose: () => void; initial?: any; onDelete?: () => void }) {
  const { isPersonal } = usePersona();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [limit, setLimit] = useState("");
  const [targetPersona, setTargetPersona] = useState<"business" | "personal">("business");
  const [saving, setSaving] = useState(false);
  const contacts = useContactPicker((n, p) => {
    if (n) setName(n);
    if (p) setPhone(p);
  });

  useEffect(() => {
    if (visible) {
      setName(initial?.name ?? "");
      setPhone(initial?.phone ?? "");
      setAddress(initial?.address ?? "");
      setNotes(initial?.notes ?? "");
      setLimit(initial?.creditLimit ? String(initial.creditLimit) : "");
      // Rows saved before personas existed belong to the shop.
      setTargetPersona(initial ? (initial.persona === "personal" ? "personal" : "business") : isPersonal ? "personal" : "business");
    }
    // Only when the sheet opens for a record, not when a sync hands over a fresh copy of it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, initial?.id, isPersonal]);

  const allCustomers = useCustomers().data ?? [];
  const sameBook = allCustomers.filter((c) => (targetPersona === "personal" ? c.persona === "personal" : c.persona !== "personal"));
  const phoneDupe = samePhone(sameBook, phone, initial?.id);
  const nameDupe = !!name.trim() && sameBook.some((c) => c.id !== initial?.id && c.name.trim().toLowerCase() === name.trim().toLowerCase());

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const body = {
        name: name.trim(),
        phone: phone.trim(),
        address: address.trim(),
        notes: notes.trim(),
        persona: targetPersona,
        creditLimit: targetPersona === "personal" ? 0 : parseAmount(limit) || 0,
      };
      if (initial?.id) await store.updateCustomer(initial.id, body);
      else await store.createCustomer(body);
      onClose();
    } finally { setSaving(false); }
  };

  return (
    <SheetShell visible={visible} onClose={onClose} title={initial ? "विवरण बदलें" : targetPersona === "personal" ? "नया व्यक्ति" : "नया ग्राहक"} testID="sheet-customer">
      {!initial ? (
        <View style={{ marginBottom: spacing.md, gap: spacing.sm }}>
          <Pressable
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              backgroundColor: colors.brandTertiary,
              paddingVertical: 10,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: colors.brandPrimary,
            }}
            onPress={contacts.open}
            testID="pick-contact-btn"
          >
            <MaterialIcon name="contacts" size={18} color={colors.brandPrimary} />
            <Text style={{ fontSize: 13, fontWeight: "700", color: colors.brandPrimary }}>
              फ़ोन से चुनें
            </Text>
          </Pressable>
        </View>
      ) : null}
      <Field label="नाम">
        <TextInput style={inputStyle} value={name} onChangeText={setName} placeholder="नाम" placeholderTextColor={colors.muted} testID="input-cust-name" />
      </Field>
      {nameDupe ? (
        <View style={[styles.dupeRow, { marginTop: -spacing.sm, marginBottom: spacing.sm }]}>
          <MaterialIcon name="alert-circle-outline" size={16} color={colors.warning} />
          <Text style={styles.dupeText}>इस नाम से पहले से एक खाता है</Text>
        </View>
      ) : null}
      <Field label="फ़ोन (वैकल्पिक)">
        <TextInput style={inputStyle} value={phone} onChangeText={setPhone} placeholder="10 अंक" placeholderTextColor={colors.muted} keyboardType="phone-pad" testID="input-cust-phone" />
        {phoneDupe ? (
          <View style={styles.dupeRow}>
            <MaterialIcon name="alert-circle-outline" size={16} color={colors.warning} />
            <Text style={styles.dupeText}>यह नंबर पहले से &quot;{phoneDupe.name}&quot; के नाम है</Text>
          </View>
        ) : null}
      </Field>
      <MoreInfo
        open={!!address || !!notes || !!limit}
        hint={targetPersona === "personal" ? "पता, नोट" : "पता, नोट, उधार सीमा"}
        testID="cust-more-info"
      >
        <Field label="पता">
          <TextInput style={inputStyle} value={address} onChangeText={setAddress} placeholder="मोहल्ला, गली या गांव" placeholderTextColor={colors.muted} testID="input-cust-address" />
        </Field>
        <Field label="नोट">
          <TextInput style={[inputStyle, { minHeight: 72 }]} value={notes} onChangeText={setNotes} multiline placeholderTextColor={colors.muted} testID="input-cust-notes" />
        </Field>
        {targetPersona === "personal" ? null : (
          <Field label="उधार सीमा (₹)">
            <TextInput style={inputStyle} value={limit} onChangeText={(v) => setLimit(cleanAmountInput(v))} placeholder="खाली = कोई सीमा नहीं" placeholderTextColor={colors.muted} keyboardType="numeric" testID="input-cust-limit" />
            <Text style={styles.hint}>इससे ज़्यादा उधार होने पर एंट्री लिखते समय चेतावनी दिखेगी</Text>
          </Field>
        )}
      </MoreInfo>
      <PrimaryButton label={initial ? "बदलाव सेव करें" : targetPersona === "personal" ? "व्यक्ति जोड़ें" : "ग्राहक जोड़ें"} onPress={save} disabled={!name.trim()} saving={saving} testID="save-customer-btn" />
      {initial?.id && onDelete ? (
        <DangerLink
          label="यह खाता हटाएँ"
          testID="delete-customer-link"
          onPress={() => confirmAction(`${name || "यह खाता"} हटाएँ?`, `इनकी सारी एंट्री${targetPersona === "personal" ? "" : " और काम"} भी हटेंगे, और पुराने दिनों का ${targetPersona === "personal" ? "कैश" : "गल्ला"} / बैंक हिसाब बदल जाएगा। गलती से हटाया तो प्रोफ़ाइल › कचरा पेटी से पूरा खाता वापस ला सकते हैं।`, "हटा दें", () => { onDelete(); onClose(); })}
        />
      ) : null}
      {initial?.id ? <EditHistory coll="customers" id={initial.id} /> : null}
      {contacts.modal}
    </SheetShell>
  );
}

export const ENTRY_UI: Record<EntryType, { title: string; short: string; icon: string; color: string; placeholder: string }> = {
  work: { title: "काम", short: "काम", icon: "briefcase-outline", color: colors.error, placeholder: "जैसे पासपोर्ट फोटो 8 प्रति" },
  payment: { title: "पैसे मिले", short: "मिले", icon: "arrow-bottom-left", color: colors.success, placeholder: "जैसे पुराना हिसाब, UPI" },
  given: { title: "पैसे दिए", short: "दिए", icon: "arrow-top-right", color: colors.error, placeholder: "जैसे घर के लिए दिए" },
  purchase: { title: "सामान / सेवा ली", short: "सामान", icon: "cart-outline", color: colors.warning, placeholder: "जैसे राशन, दवाई, मरम्मत" },
  aeps: { title: "काउंटर सेवा बाकी", short: "AEPS", icon: "fingerprint", color: colors.error, placeholder: "" },
};

export const PICKER_LABEL: Record<EntryType, string> = { work: "ग्राहक", payment: "किससे मिले", given: "किसको दिए", purchase: "किससे ली", aeps: "ग्राहक" };

/** Plain khata row. With `kinds`, the sheet lets you switch between them (e.g. मिले / दिए / सामान). */
export function AddEntrySheet({
  visible,
  type,
  kinds,
  onClose,
  customerId: fixedCustomerId,
  initial,
}: {
  visible: boolean;
  type: EntryType;
  kinds?: EntryType[];
  onClose: () => void;
  customerId?: string;
  initial?: Entry;
}) {
  const choice = useCustomerChoice(visible, fixedCustomerId ?? initial?.customerId);
  const [kind, setKind] = useState<EntryType>(type);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const money = useMoneyInput();
  const items = useItems((sum) => money.setTotal(sum > 0 ? String(sum) : ""));
  const [payMode, setPayMode] = useState<"cash" | "online">("cash");
  const split = useSplitPay();
  const [date, setDate] = useState(todayISO());
  const [openedOn, setOpenedOn] = useState(todayISO());
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [remind, setRemind] = useState(false);
  const [returnDate, setReturnDate] = useState(todayISO(7));
  const isPersonalBook = usePersona().isPersonal;

  useEffect(() => {
    if (!visible) return;
    split.reset();
    setRemind(false);
    setReturnDate(todayISO(7));
    setKind(initial?.type ?? type);
    setDescription(initial?.description ?? "");
    setAmount(initial ? String(initial.amount) : "");
    if (initial?.type === "purchase") {
      items.reset(itemsOf(initial));
      money.reset(String(initial.amount), String(initial.paid ?? 0));
    } else {
      items.reset();
      money.reset("", "0");
    }
    // Rows saved before the mode field existed were cash; the default only applies to new entries.
    setPayMode(initial ? (initial.mode ?? "cash") : getPrefs().defaultMode);
    setDate(initial?.date ?? todayISO());
    setOpenedOn(todayISO());
    setNotes(initial?.notes ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, initial, type]);

  const entries = useEntries().data ?? [];
  const later = initial && (initial.type === "purchase" || (initial.type === "given" && !initial.linkId)) ? settlementsFor(initial, entries) : [];
  const personId = initial ? "" : choice.existingId;
  const due = personId ? computeBalance(entries, personId) : 0;
  const ui = ENTRY_UI[kind];
  const isPurchase = kind === "purchase";
  const amt = isPurchase ? money.totalNum : parseAmount(amount);
  const paidNow = isPurchase ? money.receivedNum : 0;
  const needsDescription = kind === "work";
  const fullChip = kind === "payment" && due > 0 ? due : kind === "given" && due < 0 ? -due : 0;
  // Paid back later against this purchase; the amount can't go below it or the extra has no row to show on.
  const repaidLater = isPurchase ? roundMoney(later.reduce((s, p) => s + p.amount, 0)) : 0;
  const overRepaid = isPurchase && amt > 0 && paidNow + repaidLater > amt + 0.005;
  const filled = isPurchase ? items.titled && paidNow <= amt && !overRepaid : !needsDescription || !!description.trim();
  const valid = (initial ? true : choice.ready) && filled && isFinite(amt) && amt > 0;
  // Personal: lent money, or goods still to be paid for, can carry a "by when" that lands in मेरे काम.
  const canRemind = !initial && isPersonalBook && (kind === "given" || (isPurchase && amt - paidNow > 0));

  const cashWord = usePersona().labels.cash;
  const save = () => (initial ? confirmOldDate(initial.date, date, initial.createdAt, cashWord, saveNow) : saveNow());
  const saveNow = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      const day = initial ? date : dateOnSave(date, openedOn);
      const body = isPurchase
        ? { type: kind, date: day, description: items.description, amount: amt, paid: paidNow, mode: payMode, notes: notes.trim(), items: items.saved() }
        : { type: kind, date: day, description: description.trim(), amount: amt, mode: payMode, notes: notes.trim() };
      if (initial) await store.updateEntry(initial.id, body);
      else {
        const customerId = await choice.resolve();
        const parts = splitOf(split, isPurchase ? paidNow : amt);
        let rowId: string;
        if (!parts) rowId = store.createEntry({ customerId, ...body }).id;
        else if (isPurchase) {
          // Paid for goods both ways: cash on the purchase row, the online part as a same-day payback.
          rowId = store.createEntry({ customerId, ...body, paid: parts.cash, mode: "cash" }).id;
          store.createEntry({ customerId, type: "given", date: day, description: settleDescription(items.description), amount: parts.online, mode: "online", notes: "", linkId: rowId });
        } else rowId = createPaid({ customerId, type: kind, date: day, description: description.trim(), notes: notes.trim() }, amt, payMode, parts);
        if (canRemind && remind && returnDate > day) {
          const who = choice.recent.find((c) => c.id === customerId)?.name ?? choice.query.trim();
          const title = kind === "given" ? `${who} से ${formatINR(amt)} वापस लेने हैं` : `${who} को ${formatINR(amt - paidNow)} चुकाने हैं`;
          store.createJob({ customerId: "", title, dueDate: returnDate, status: "pending", estimatedAmount: 0, notes: description.trim() || items.description, entryId: rowId, persona: "personal" });
        }
      }
      onClose();
    } finally { setSaving(false); }
  };

  return (
    <SheetShell visible={visible} onClose={onClose} title={initial ? "एंट्री बदलें" : kinds ? "लेन-देन" : ui.title} testID={`sheet-entry-${kind}`}>
      {kinds && !initial ? (
        <View style={styles.segment}>
          {kinds.map((k) => (
            <Pressable key={k} onPress={() => setKind(k)} style={[styles.segmentBtn, kind === k && { backgroundColor: ENTRY_UI[k].color }]} testID={`entry-kind-${k}`}>
              <MaterialIcon name={ENTRY_UI[k].icon as any} size={16} color={kind === k ? "#fff" : colors.onSurface} />
              <Text style={[styles.segmentText, kind === k && { color: "#fff" }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{ENTRY_UI[k].short}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {isPurchase && !initial && !fixedCustomerId ? <CustomerPicker choice={choice} label={PICKER_LABEL[kind]} testPrefix="chip-cust" /> : null}
      {isPurchase ? (
        <>
          <ItemsField items={items} label="क्या लिया" placeholder={ui.placeholder} addLabel="और जोड़ें" />
          <MoneyFields money={money} receivedLabel="अभी कितने दिए (₹)" hideTotal purchase />
          {overRepaid ? (
            <Text style={[styles.hint, { color: colors.error }]}>
              कुल {formatINR(paidNow + repaidLater)} चुका चुके हैं — रकम इससे कम नहीं हो सकती। ज़्यादा दिए पैसे नीचे से हटाएँ।
            </Text>
          ) : null}
          {paidNow > 0 ? <PayModeField label="कैसे दिए" value={payMode} onChange={setPayMode} split={initial ? undefined : split} total={paidNow} /> : null}
        </>
      ) : (
        <>
          <Field label="रकम (₹)">
            {fullChip > 0 ? (
              <View style={[styles.chipRow, { marginBottom: spacing.sm }]}>
                <Chip
                  label={`पूरे ${kind === "payment" ? "लेने" : "देने"} हैं ${formatINR(fullChip)}`}
                  active={amt === fullChip}
                  onPress={() => setAmount(String(fullChip))}
                  tone={kind === "payment" ? colors.success : colors.warning}
                  testID="entry-full-due"
                />
              </View>
            ) : null}
            <TextInput style={inputStyle} value={amount} onChangeText={setAmount} placeholder="0" placeholderTextColor={colors.muted} keyboardType="numeric" testID="input-entry-amount" />
            {fullChip > 0 && amt > 0 ? (
              <Text style={[styles.hint, { color: amt >= fullChip ? colors.success : colors.error }]}>
                {amt > fullChip
                  ? `हिसाब बराबर · ${formatINR(amt - fullChip)} ${kind === "payment" ? "एडवांस" : "ज़्यादा दिए"}`
                  : amt === fullChip
                  ? "हिसाब बराबर"
                  : `${formatINR(fullChip - amt)} अभी भी ${kind === "payment" ? "लेने" : "देने"} हैं`}
              </Text>
            ) : null}
          </Field>
          {!initial && !fixedCustomerId && <CustomerPicker choice={choice} label={PICKER_LABEL[kind]} testPrefix="chip-cust" />}
          {kind !== "work" ? (
            <PayModeField label={kind === "payment" ? "कैसे मिले" : "कैसे दिए"} value={payMode} onChange={setPayMode} split={initial ? undefined : split} total={amt} />
          ) : null}
          {needsDescription ? (
            <Field label="विवरण">
              <TextInput style={inputStyle} value={description} onChangeText={setDescription} placeholder={ui.placeholder} placeholderTextColor={colors.muted} testID="input-entry-desc" />
            </Field>
          ) : null}
        </>
      )}
      {later.length > 0 ? (
        <Field label={isPurchase ? "बाद में चुकाए" : "वापस मिले"}>
          {later.map((p) => (
            <View key={p.id} style={styles.settleRow}>
              <MaterialIcon name="check-circle" size={16} color={colors.success} />
              <Text style={styles.settleText}>{formatINR(p.amount)} · {formatDate(p.date)}{p.mode === "online" ? " · ऑनलाइन" : ""}{p.notes ? ` · ${p.notes}` : ""}</Text>
              <Pressable
                hitSlop={8}
                onPress={() => confirmAction("यह भुगतान हटाएँ?", `${formatINR(p.amount)} · ${formatDate(p.date)}`, "हटा दें", () => store.deleteEntry(p.id))}
                testID={`del-settle-${p.id}`}
              >
                <MaterialIcon name="close" size={18} color={colors.muted} />
              </Pressable>
            </View>
          ))}
        </Field>
      ) : null}
      <DateField label="तारीख" value={date} onChange={setDate} money createdAt={initial?.createdAt} testID="input-entry-date" />
      {canRemind ? (
        <View style={{ marginBottom: spacing.md }}>
          <Chip
            label={kind === "given" ? "वापसी की तारीख याद दिलाएँ" : "चुकाने की तारीख याद दिलाएँ"}
            icon="bell-ring-outline"
            active={remind}
            onPress={() => setRemind(!remind)}
            tone={colors.info}
            testID="entry-remind"
          />
          {remind ? (
            <View style={{ marginTop: spacing.sm }}>
              <DateField label={kind === "given" ? "कब तक वापस मिलेंगे" : "कब तक चुकाने हैं"} value={returnDate} onChange={setReturnDate} future testID="input-entry-return" />            </View>
          ) : null}
        </View>
      ) : null}
      <MoreInfo open={!!notes || (!needsDescription && !isPurchase && !!description)} hint={!needsDescription && !isPurchase ? "किस लिए, नोट" : "नोट"} testID="entry-more-info">
        {!needsDescription && !isPurchase ? (
          <Field label="किस लिए">
            <TextInput style={inputStyle} value={description} onChangeText={setDescription} placeholder={ui.placeholder} placeholderTextColor={colors.muted} testID="input-entry-desc" />
          </Field>
        ) : null}
        <Field label="नोट">
          <TextInput style={inputStyle} value={notes} onChangeText={setNotes} placeholderTextColor={colors.muted} testID="input-entry-notes" />
        </Field>
      </MoreInfo>
      {kind === "work" || kind === "given" ? <LimitWarning customerId={personId} extra={amt} /> : null}
      <PrimaryButton
        label={initial ? "बदलाव सेव करें" : `${ui.title} — सेव करें`}
        onPress={save}
        disabled={!valid}
        saving={saving}
        testID="save-entry-btn"
      />
      {initial ? <DeleteEntryLink entry={initial} onDone={onClose} /> : null}
    </SheetShell>
  );
}
export function DeleteEntryLink({ entry, onDone }: { entry: Entry; onDone: () => void }) {
  const entries = useEntries().data ?? [];
  const jobs = useJobs().data ?? [];
  const remove = () => {
    const later = "\nदूसरे दिन लिए-दिए पैसे खाते में बने रहेंगे।";
    const extra =
      entry.type === "work"
        ? `\nउसी दिन मिले पैसे और काम कार्ड भी हटेंगे।${later}`
        : entry.type === "given" && !entry.linkId
          ? `\nउसी दिन वापस मिले पैसे भी हटेंगे।${later}`
          : entry.type === "purchase"
            ? `\nउसी दिन चुकाए पैसे भी हटेंगे।${later}`
            : "";
    confirmAction("एंट्री हटाएँ?", `${entry.description || ENTRY_UI[entry.type].title} · ${formatINR(entry.amount)}${extra}`, "हटा दें", () => {
      removeEntryWithLinks(entry, entries, jobs);
      onDone();
    });
  };
  return (
    <>
      <DangerLink label="यह एंट्री हटाएँ" onPress={remove} testID="delete-entry-link" />
      <EditHistory coll="entries" id={entry.id} />
    </>
  );
}

/** Edits a finished piece of work: the work entry, the money taken with it and its job card. */
export function WorkEditSheet({ entry, onClose }: { entry: Entry | null; onClose: () => void }) {
  const entries = useEntries().data ?? [];
  const jobs = useJobs().data ?? [];
  const money = useMoneyInput();
  const items = useItems((sum) => money.setTotal(sum > 0 ? String(sum) : ""));
  const [payMode, setPayMode] = useState<"cash" | "online">("cash");
  const [govtFee, setGovtFee] = useState("");
  const [feeMode, setFeeMode] = useState<"online" | "cash">("online");
  const [date, setDate] = useState(todayISO());
  const [notes, setNotes] = useState("");
  const [remark, setRemark] = useState("");
  const [remarkDate, setRemarkDate] = useState(todayISO(1));
  const [saving, setSaving] = useState(false);

  const job = entry ? jobForWork(entry, jobs) : undefined;
  // Extra money taken on the work day beyond the bill, booked as a linked advance row.
  const sameDayExtras = entry ? entries.filter((e) => e.type === "payment" && e.linkId === entry.id && e.date === entry.date && e.description === ADVANCE && e.notes.endsWith("के साथ")) : [];
  const link = entry ? linkedPayment(entry, entries) : undefined;
  // Only an old unlinked two-row record is folded into `paid`. A linked "पैसे मिले" written later
  // the same day is its own row (own mode, own notes) and must stay as it is.
  const legacyLink = entry && link && !link.linkId && !(entry.paid ?? 0) && !sameDayExtras.some((e) => e.id === link.id) ? link : undefined;
  const rowMode: PayMode = legacyLink?.mode ?? entry?.mode ?? "cash";
  // The form has one pay mode; an advance taken the other way (online part of a split) stays its own row.
  const extras = sameDayExtras.filter((e) => (e.mode ?? "cash") === rowMode);
  const extraSum = extras.reduce((s, e) => s + e.amount, 0);
  // Every other payment booked against this work, shown so it can be seen / removed here.
  const later = entry ? settlementsFor(entry, entries).filter((p) => p.id !== legacyLink?.id && !extras.some((e) => e.id === p.id)) : [];
  const expenseList = useExpenseList().data;
  const customerName = useCustomers().data?.find((c) => c.id === entry?.customerId)?.name ?? "";
  const costIds = entry ? [outsideCostId(entry.id), ...(job ? [outsideCostId(job.id)] : [])] : [];
  const outsideRow = (expenseList ?? []).find((x) => costIds.includes(x.id));
  const [outside, setOutside] = useState("");
  const [outsideMode, setOutsideMode] = useState<PayMode>("cash");

  // Separate from the form reset: the expense list can arrive after the sheet opens.
  useEffect(() => {
    if (!entry) return;
    setOutside(outsideRow ? String(outsideRow.amount) : "");
    setOutsideMode(outsideRow?.mode ?? getPrefs().defaultMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry?.id, outsideRow?.id]);

  useEffect(() => {
    if (!entry) return;
    items.reset(itemsOf(entry));
    money.reset(String(entry.amount), String(((entry.paid ?? 0) || (legacyLink?.amount ?? 0)) + extraSum));
    setPayMode(rowMode);
    setGovtFee(entry.fee ? String(entry.fee) : "");
    setFeeMode(entry.feeMode ?? "online");
    setDate(entry.date);
    setNotes(entry.notes);
    setRemark("");
    setRemarkDate(todayISO(1));
    // Only re-initialise when a different record is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry?.id]);

  const amt = money.totalNum;
  const valid = items.titled && (amt > 0 || parseAmount(govtFee) > 0);

  const cashWord = usePersona().labels.cash;
  const save = () => (entry ? confirmOldDate(entry.date, date, entry.createdAt, cashWord, saveNow) : undefined);
  const saveNow = async () => {
    if (!entry || !valid) return;
    setSaving(true);
    try {
      const t = items.description;
      const taken = money.receivedNum;
      const feeNum = parseAmount(govtFee);
      store.updateEntry(entry.id, {
        type: "work",
        date,
        description: t,
        amount: amt,
        paid: Math.min(taken, amt),
        mode: payMode,
        fee: feeNum,
        feeMode,
        notes: notes.trim(),
        items: items.saved(),
      });
      extras.forEach((e) => store.deleteEntry(e.id));
      // Money taken on the work day (online part of a split, other-mode advance) moves with the work's date.
      if (date !== entry.date) later.filter((p) => p.date === entry.date && p.linkId === entry.id).forEach((p) => store.updateEntry(p.id, { date }));
      bookAdvance(entry.customerId, taken - amt, date, t, entry.id, payMode);
      // Old two-row cash records: the same-day jama is now carried by `paid`.
      if (legacyLink) store.deleteEntry(legacyLink.id);
      if (expenseList) saveOutsideCost(entry.id, parseAmount(outside), outsideMode, date, [customerName, t].filter(Boolean).join(" · "), outsideRow);
      if (job) {
        // The job card keeps its own notes (size, copies…); the work row's notes are separate.
        store.updateJob(job.id, { title: t, dueDate: date, estimatedAmount: amt, entryId: entry.id });
      }
      if (remark.trim()) {
        store.createJob({ customerId: entry.customerId, title: remark.trim(), dueDate: remarkDate, status: "pending", estimatedAmount: 0, notes: `पिछला काम: ${t}` });
      }
      onClose();
    } finally { setSaving(false); }
  };

  return (
    <SheetShell visible={!!entry} onClose={onClose} title="काम बदलें" testID="sheet-edit-work">
      <ItemsField items={items} label="क्या काम" placeholder="काम" addLabel="और काम" />
      <MoneyFields money={money} receivedLabel="उस दिन मिले (₹)" hideTotal />
      {money.receivedNum > 0 ? <PayModeField label="कैसे मिले" value={payMode} onChange={setPayMode} /> : null}
      <FeeField fee={govtFee} setFee={setGovtFee} feeMode={feeMode} setFeeMode={setFeeMode} amount={amt} />
      {entry?.feeOn && parseAmount(govtFee) > 0 ? (
        <Text style={[styles.hint, { marginTop: -spacing.sm, marginBottom: spacing.md }]}>फीस {formatDate(entry.feeOn)} को कटी थी (काम पेंडिंग था)</Text>
      ) : null}
      <OutsideCostField cost={outside} setCost={setOutside} mode={outsideMode} setMode={setOutsideMode} />
      {later.length > 0 ? (
        <Field label="अलग से मिले पैसे">
          {later.map((p) => (
            <View key={p.id} style={styles.settleRow}>
              <MaterialIcon name="check-circle" size={16} color={colors.success} />
              <Text style={styles.settleText}>{formatINR(p.amount)} · {formatDate(p.date)}{p.notes ? ` · ${p.notes}` : ""}</Text>
              <Pressable
                hitSlop={8}
                onPress={() => confirmAction("यह भुगतान हटाएँ?", `${formatINR(p.amount)} · ${formatDate(p.date)}\nहटाने के बाद ये पैसे फिर लेने होंगे।`, "हटा दें", () => store.deleteEntry(p.id))}
                testID={`del-settle-${p.id}`}
              >
                <MaterialIcon name="close" size={18} color={colors.muted} />
              </Pressable>
            </View>
          ))}
        </Field>
      ) : null}
      <DateField label="तारीख" value={date} onChange={setDate} money createdAt={entry?.createdAt} testID="input-edit-work-date" />
      <Field label="नोट (वैकल्पिक)">
        <TextInput style={inputStyle} value={notes} onChangeText={setNotes} placeholderTextColor={colors.muted} testID="input-edit-work-notes" />
      </Field>
      <Field label="नया आगे का काम / रिमार्क (वैकल्पिक)">
        <TextInput style={[inputStyle, { minHeight: 56 }]} value={remark} onChangeText={setRemark} multiline placeholder="जैसे बाकी पैसे शनिवार को" placeholderTextColor={colors.muted} testID="input-edit-work-remark" />
      </Field>
      {remark.trim() ? <DateField label="रिमार्क कब देखना है" value={remarkDate} onChange={setRemarkDate} future /> : null}
      <PrimaryButton label="बदलाव सेव करें" onPress={save} disabled={!valid} saving={saving} testID="save-edit-work-btn" />
      {entry ? <DeleteEntryLink entry={entry} onDone={onClose} /> : null}
    </SheetShell>
  );
}

export function confirmRemoveJob(job: Job, entries: Entry[], onDone: () => void) {
  const all = advancesForJob(job, entries).reduce((s, e) => s + e.amount, 0);
  const back = refundsForJob(job, entries).reduce((s, e) => s + e.amount, 0);
  const lines = [job.title];
  if (back > 0) {
    const left = roundMoney(all - back);
    lines.push(`एडवांस ${formatINR(all)} में से ${formatINR(back)} लौटा दिया गया है; वह हिसाब वैसा ही रहेगा।`);
    if (left > 0) lines.push(`बचे ${formatINR(left)} खाते में जमा रहेंगे।`);
  } else {
    const kept = olderAdvances(job, entries).reduce((s, e) => s + e.amount, 0);
    const gone = all - kept;
    if (gone > 0) lines.push(`काम लेते समय लिया एडवांस ${formatINR(gone)} भी हटेगा।`);
    if (kept > 0) lines.push(`बाद में लिया एडवांस ${formatINR(kept)} खाते में जमा रहेगा।`);
    if (all > 0) lines.push(`ग्राहक को पैसे लौटाए हैं तो हटाने की जगह "एडवांस लौटाएँ / काम रद्द" चुनें।`);
  }
  if (feePaid(job) && back > 0) lines.push(`लगी हुई फीस ${formatINR(job.fee ?? 0)} खर्च में जाएगी।`);
  else if (feePaid(job)) {
    lines.push(`लगी हुई फीस ${formatINR(job.fee ?? 0)} भी हिसाब से हट जाएगी (गलती से लिखा काम)। काम रद्द हुआ है तो "काम रद्द" चुनें — फीस वापस मिली या खर्च में, वहाँ बताएँ।`);
  } else if ((job.fee ?? 0) > 0 && !feePaid(job)) lines.push(`फीस ${formatINR(job.fee ?? 0)} अभी नहीं लगी थी; वह भी हटेगी।`);
  confirmAction("काम हटाएँ?", lines.join("\n"), "हटा दें", () => {
    removeJobWithAdvances(job, entries);
    onDone();
  });
}

/** Edits an own task or a money-less finished job card; open customer jobs use CompleteJobSheet. */
export function EditJobSheet({ job, onClose }: { job: Job | null; onClose: () => void }) {
  const entries = useEntries().data ?? [];
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayISO());
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<Job["status"]>("pending");
  const [saving, setSaving] = useState(false);
  const start = job ? jobStart(job, entries) : todayISO();

  useEffect(() => {
    if (!job) return;
    setTitle(job.title);
    setAmount(job.estimatedAmount > 0 ? String(job.estimatedAmount) : "");
    setDate(job.dueDate);
    setNotes(job.notes);
    setStatus(job.status);
  }, [job]);

  const save = async () => {
    if (!job || !title.trim()) return;
    setSaving(true);
    try {
      store.updateJob(job.id, { title: title.trim(), estimatedAmount: parseAmount(amount), dueDate: date, notes: notes.trim(), status });
      onClose();
    } finally { setSaving(false); }
  };

  const remove = () => {
    if (job) confirmRemoveJob(job, entries, onClose);
  };

  return (
    <SheetShell visible={!!job} onClose={onClose} title="काम बदलें" testID="sheet-edit-job">
      {job?.customerId && job.status !== "done" ? <Text style={[styles.hint, { marginTop: 0, marginBottom: spacing.md }]}>काम आया: {formatDate(start)}</Text> : null}
      <Field label="स्थिति">
        <View style={styles.chipRow}>
          <Chip label="काम बाकी" active={status === "pending"} onPress={() => setStatus("pending")} testID="edit-job-status-pending" />
          <Chip label="चल रहा" active={status === "doing"} onPress={() => setStatus("doing")} tone={colors.warning} testID="edit-job-status-doing" />
          {job?.status === "done" ? <Chip label="पूरा" active={status === "done"} onPress={() => setStatus("done")} tone={colors.success} /> : null}
        </View>
      </Field>
      <Field label="क्या काम">
        <TextInput style={inputStyle} value={title} onChangeText={setTitle} placeholderTextColor={colors.muted} testID="input-edit-job-title" />
      </Field>
      {job?.customerId ? (
        <Field label="अनुमानित रकम (₹, वैकल्पिक)">
          <TextInput style={inputStyle} value={amount} onChangeText={setAmount} keyboardType="numeric" placeholder="0" placeholderTextColor={colors.muted} testID="input-edit-job-amount" />
        </Field>
      ) : null}
      <DateField label={status === "done" ? "तारीख" : job?.customerId ? "कब तक" : "कब करना है"} value={date} onChange={setDate} future={status !== "done"} testID="input-edit-job-date" />
      <Field label="नोट / रिमार्क">
        <TextInput style={[inputStyle, { minHeight: 56 }]} value={notes} onChangeText={setNotes} multiline placeholderTextColor={colors.muted} testID="input-edit-job-notes" />
      </Field>
      <PrimaryButton label="बदलाव सेव करें" onPress={() => void save()} disabled={!title.trim()} saving={saving} testID="save-edit-job-btn" />
      <DangerLink label="यह काम हटाएँ" onPress={remove} testID="delete-job-link" />
      {job ? <EditHistory coll="jobs" id={job.id} /> : null}
    </SheetShell>
  );
}

/**
 * One entry point for "tap to edit" anywhere: picks the work editor when the row belongs to a
 * work record, otherwise the plain entry or job editor.
 */
export function EditRecordSheet({ entry, job, onClose }: { entry?: Entry | null; job?: Job | null; onClose: () => void }) {
  const entries = useEntries().data ?? [];
  const router = useRouter();
  const aepsRows = useAeps().data ?? [];
  const jamaOf = entry?.type === "payment" && entry.linkId && aepsRows.some((t) => t.id === entry.linkId) ? entry.linkId : "";
  const aepsId = entry?.type === "aeps" ? entry.linkId : jamaOf;
  // A counter-service due, and money left with the shop on it (जमा), are edited on their AEPS row,
  // so galla, the counter row and its slip never disagree.
  useEffect(() => {
    if (!aepsId) return;
    onClose();
    router.push(`/aeps/${aepsId}` as never);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aepsId]);
  let work: Entry | null = null;
  let plainEntry: Entry | null = null;
  let plainJob: Job | null = null;
  let openJob: Job | null = null;
  if (job) {
    work = workForJob(job, entries) ?? null;
    // An open customer job has one place for everything: finish it, outsource it, or edit it.
    if (!work) {
      if (job.customerId && job.status !== "done") openJob = job;
      else plainJob = job;
    }
  } else if (entry && !aepsId) {
    if (entry.type === "work") work = entry;
    else if (entry.type === "given" || entry.type === "purchase") plainEntry = entry;
    else {
      // Same-day jama from old two-row cash records belongs to the work; later settlements are their own event.
      const w = workForPayment(entry, entries);
      if (w && w.type === "work" && w.date === entry.date) work = w;
      else plainEntry = entry;
    }
  }
  return (
    <>
      <WorkEditSheet entry={work} onClose={onClose} />
      <EditJobSheet job={plainJob} onClose={onClose} />
      <CompleteJobSheet job={openJob} onClose={onClose} />
      <AddEntrySheet visible={!!plainEntry} type={plainEntry?.type ?? "payment"} initial={plainEntry ?? undefined} customerId={plainEntry?.customerId} onClose={onClose} />
    </>
  );
}

/** Settles one open row later: money received against work / given, or paid back against a purchase. */
export function SettleSheet({ work, onClose }: { work: Entry | null; onClose: () => void }) {
  const entries = useEntries().data ?? [];
  const [amount, setAmount] = useState("");
  const [payMode, setPayMode] = useState<"cash" | "online">("cash");
  const [date, setDate] = useState(todayISO());
  const [openedOn, setOpenedOn] = useState(todayISO());
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const status = work ? buildLedger(entries.filter((e) => e.customerId === work.customerId)).work.get(work.id) : undefined;
  const remaining = status?.remaining ?? 0;
  const payBack = work?.type === "purchase";
  const word = payBack ? { done: "चुकाए", left: "देने हैं", how: "कैसे दिए", when: "कब दिए", much: "कितने दिए (₹)" } : { done: "मिल चुके", left: "लेने हैं", how: "कैसे मिले", when: "कब मिले", much: "कितने मिले (₹)" };

  const split = useSplitPay();
  useEffect(() => {
    if (!work) return;
    split.reset();
    setAmount(remaining > 0 ? String(remaining) : "");
    setPayMode(getPrefs().defaultMode);
    setDate(todayISO());
    setOpenedOn(todayISO());
    setNotes("");
    // Only re-initialise when a different record is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [work?.id]);

  const amt = parseAmount(amount);
  const valid = !!work && amt > 0 && (!payBack || amt <= remaining);

  const save = () => {
    if (!work || !valid) return;
    setSaving(true);
    try {
      createPaid(
        {
          customerId: work.customerId,
          type: payBack ? "given" : "payment",
          date: dateOnSave(date, openedOn),
          description: settleDescription(work.description || ENTRY_UI[work.type].title),
          notes: notes.trim(),
          linkId: work.id,
        },
        amt,
        payMode,
        splitOf(split, amt),
      );
      onClose();
    } finally { setSaving(false); }
  };

  return (
    <SheetShell visible={!!work} onClose={onClose} title={payBack ? "पैसे चुकाए" : work?.type === "given" ? "पैसे वापस मिले" : "पैसे मिले"} testID="sheet-settle">
      {work ? (
        <View style={styles.settleSummary}>
          <Text style={styles.jobName}>{work.description || ENTRY_UI[work.type].title}</Text>
          <Text style={styles.hint}>
            कुल {formatINR(work.amount)} · {word.done} {formatINR(status?.received ?? 0)} ·{" "}
            <Text style={{ color: payBack ? colors.warning : colors.error, fontWeight: "700" }}>{word.left} {formatINR(remaining)}</Text>
          </Text>
        </View>
      ) : null}
      <Field label={word.much}>
        {remaining > 0 ? (
          <View style={[styles.chipRow, { marginBottom: spacing.sm }]}>
            <Chip label={`पूरा ${formatINR(remaining)}`} active={amt === remaining} onPress={() => setAmount(String(remaining))} tone={colors.success} testID="settle-full" />
            {remaining >= 2 ? <Chip label="आधा" active={amt === Math.round(remaining / 2)} onPress={() => setAmount(String(Math.round(remaining / 2)))} testID="settle-half" /> : null}
          </View>
        ) : null}
        <TextInput style={inputStyle} value={amount} onChangeText={setAmount} keyboardType="numeric" placeholder="0" placeholderTextColor={colors.muted} testID="input-settle-amount" />
        {amt > 0 && amt < remaining ? <Text style={styles.hint}>{formatINR(remaining - amt)} अभी भी {word.left}</Text> : null}
        {amt > remaining && remaining > 0 ? (
          <Text style={[styles.hint, payBack && { color: colors.error }]}>{payBack ? `${formatINR(remaining)} से ज़्यादा नहीं` : `${formatINR(amt - remaining)} ज़्यादा, एडवांस में जुड़ेगा`}</Text>
        ) : null}
      </Field>
      <PayModeField label={word.how} value={payMode} onChange={setPayMode} split={split} total={amt} />
      <DateField label={word.when} value={date} onChange={setDate} money testID="input-settle-date" />
      <Field label="नोट (वैकल्पिक)">
        <TextInput style={inputStyle} value={notes} onChangeText={setNotes} placeholderTextColor={colors.muted} testID="input-settle-notes" />
      </Field>
      <PrimaryButton
        label={amt >= remaining && remaining > 0 ? "चुकता करें" : payBack ? "चुकाए सेव करें" : "मिले सेव करें"}
        color={colors.success}
        onPress={save}
        disabled={!valid}
        saving={saving}
        testID="save-settle-btn"
      />
    </SheetShell>
  );
}
