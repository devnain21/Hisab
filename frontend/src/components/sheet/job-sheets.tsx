import { useState, useEffect } from "react";
import { View, Text, TextInput } from "react-native";
import MaterialIcon from "@react-native-vector-icons/material-design-icons";
import { store } from "@/src/lib/store";
import { advanceOf, useCustomers, useEntries, type Job } from "@/src/lib/data";
import { ADVANCE, advancesForJob, jobStart, releaseVendorOrder, vendorOrdersForJob } from "@/src/lib/records";
import { colors, spacing } from "@/src/theme";
import { dateOnSave, formatDate, formatINR, parseAmount, roundMoney, todayISO } from "@/src/lib/format";
import { Pressable } from "@/src/components/tap";
import { usePersona } from "@/src/lib/persona";
import { getPrefs } from "@/src/lib/prefs";
import { SheetShell, Field, inputStyle, LimitWarning, MoreInfo, Chip, DateField, useCustomerChoice, CustomerPicker, useMoneyInput, MoneyFields, useItems, ItemsField, type PayMode, useSplitPay, splitOf, PayModeField, FeeField, settleDescription, createPaid, PrimaryButton, styles } from "./parts";
import { recordWork, saveVendorEdit, saveVendorAssign, useVendorJob, VendorRelease, VendorOutsource } from "./work-vendor";
import { confirmRemoveJob } from "./record-sheets";

export type JobMode = "now" | "later";

export function AddJobSheet({ visible, onClose, customerId: fixedCustomerId, initialMode = "now" }: { visible: boolean; onClose: () => void; customerId?: string; initialMode?: JobMode }) {
  const choice = useCustomerChoice(visible, fixedCustomerId);
  const [mode, setMode] = useState<JobMode>(initialMode);
  const [title, setTitle] = useState("");
  const money = useMoneyInput(true);
  const items = useItems((sum) => money.setTotal(sum > 0 ? String(sum) : ""));
  const [payMode, setPayMode] = useState<"cash" | "online">("cash");
  const [govtFee, setGovtFee] = useState("");
  const [feeMode, setFeeMode] = useState<"online" | "cash">("online");
  const [date, setDate] = useState(todayISO());
  const [remark, setRemark] = useState("");
  const [remarkDate, setRemarkDate] = useState(todayISO(1));
  const [paidNow, setPaidNow] = useState("");
  const [paidDate, setPaidDate] = useState(todayISO());
  const [takenOn, setTakenOn] = useState(todayISO());
  const [openedOn, setOpenedOn] = useState(todayISO());
  const [saving, setSaving] = useState(false);
  const split = useSplitPay();
  const vendorJob = useVendorJob(visible);
  const { isPersonal } = usePersona();

  useEffect(() => {
    if (visible) {
      split.reset();
      setTakenOn(todayISO());
      setMode(initialMode);
      setTitle("");
      items.reset();
      money.reset("");
      setPayMode(getPrefs().defaultMode);
      setGovtFee("");
      setFeeMode("online");
      setDate(initialMode === "now" ? todayISO() : todayISO(1));
      setRemark("");
      setRemarkDate(todayISO(1));
      setPaidNow("");
      setPaidDate(todayISO());
      setOpenedOn(todayISO());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, initialMode]);

  const entries = useEntries().data ?? [];
  const self = choice.isSelf;
  const itemized = mode === "now" && !self;

  const switchMode = (m: JobMode) => {
    setMode(m);
    setDate(m === "now" ? todayISO() : todayISO(1));
    if (m === "now") {
      money.setTotal(items.total > 0 ? String(items.total) : "");
      if (!items.titled && title.trim()) items.reset([{ title: title.trim(), amount: items.total }]);
    } else if (!title.trim() && items.description) setTitle(items.description);
  };

  const amt = self ? 0 : money.totalNum;
  const advance = choice.existingId ? advanceOf(entries, choice.existingId) : 0;
  const canVendor = !self && !isPersonal;
  const outsource = mode === "now" && canVendor;
  const pendingDatesOk = mode === "now" || self || ((parseAmount(paidNow) <= 0 || paidDate >= takenOn) && (!canVendor || vendorJob.datesOk(takenOn, true)));
  const valid =
    choice.ready && (itemized ? items.titled : !!title.trim()) && (mode !== "now" || self || amt <= 0 || money.answered) && (!canVendor || vendorJob.ready) && pendingDatesOk;
  const saveLabel = mode === "later" ? "पेंडिंग काम सेव करें" : self ? "सेव करें" : amt > 0 ? "काम सेव करें" : "मुफ़्त काम सेव करें";

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      const customerId = await choice.resolve();
      const t = itemized ? items.description : title.trim();
      const feeNum = parseAmount(govtFee);
      const day = dateOnSave(date, openedOn);
      if (mode === "now") {
        const vendor = outsource && customerId ? await vendorJob.resolve() : null;
        const entryId = recordWork({
          customerId,
          title: t,
          amount: amt,
          received: money.receivedNum,
          date: day,
          // The remark is a note to self (and its own reminder); the work row prints on the customer's bill.
          notes: self ? remark.trim() : "",
          mode: payMode,
          fee: feeNum,
          feeMode,
          items: itemized ? items.saved() : [],
          split: splitOf(split, money.receivedNum),
          vendor,
        });
        // Free work books no row, but money taken with it still came in and stays with the customer as advance.
        if (!entryId && !self && customerId && money.receivedNum > 0) {
          createPaid({ customerId, type: "payment", date: day, description: ADVANCE, notes: `${t} के साथ` }, money.receivedNum, payMode, splitOf(split, money.receivedNum));
        }
        store.createJob({ customerId, title: t, dueDate: day, status: "done", estimatedAmount: amt, notes: remark.trim(), entryId });
        if (remark.trim()) {
          await store.createJob({ customerId, title: remark.trim(), dueDate: remarkDate, status: "pending", estimatedAmount: 0, notes: `पिछला काम: ${t}` });
        }
      } else {
        const taken = self ? todayISO() : dateOnSave(takenOn, openedOn);
        const job = store.createJob({
          customerId,
          title: t,
          dueDate: day,
          estimatedAmount: amt,
          notes: remark.trim(),
          ...(taken !== todayISO() ? { createdAt: new Date(`${taken}T12:00:00`).toISOString() } : {}),
        });
        if (canVendor && customerId) await saveVendorAssign(vendorJob, undefined, job.id, t, day, entries);
        const got = parseAmount(paidNow);
        // The advance lands in the drawer/bank on the day it was received, not on the delivery day.
        if (!self && got > 0) {
          createPaid({ customerId, type: "payment", date: dateOnSave(paidDate, openedOn), description: "एडवांस", notes: `${t} के लिए`, linkId: job.id }, got, payMode, splitOf(split, got));
        }
      }
      onClose();
    } finally { setSaving(false); }
  };

  return (
    <SheetShell visible={visible} onClose={onClose} title="काम लिखें" testID="sheet-job">
      {!fixedCustomerId && <CustomerPicker choice={choice} allowSelf testPrefix="chip-job-cust" />}
      {itemized ? (
        <ItemsField items={items} label="क्या काम" placeholder="जैसे फॉर्म भरना" addLabel="और काम" />
      ) : (
        <Field label="क्या काम">
          <TextInput style={inputStyle} value={title} onChangeText={setTitle} placeholder={self ? "जैसे पेपर मँगवाना, बिजली बिल भरना" : "जैसे शादी एलबम"} placeholderTextColor={colors.muted} testID="input-job-title" />
        </Field>
      )}
      <Field label="स्थिति">
        <View style={styles.chipRow}>
          <Chip label="हो गया" icon="check-circle-outline" active={mode === "now"} onPress={() => switchMode("now")} tone={colors.success} testID="job-mode-now" />
          <Chip label="पेंडिंग" icon="clock-outline" active={mode === "later"} onPress={() => switchMode("later")} tone={colors.warning} testID="job-mode-later" />
        </View>
      </Field>
      {self ? null : mode === "now" ? (
        <>
          <MoneyFields money={money} advance={advance} freeAllowed hideTotal />
          {money.receivedNum > 0 ? <PayModeField label="कैसे मिले" value={payMode} onChange={setPayMode} split={split} total={money.receivedNum} /> : null}
          {outsource ? <VendorOutsource v={vendorJob} amount={amt} fee={parseAmount(govtFee)} workDate={date} /> : null}
        </>
      ) : (
        <Field label="रकम (₹)">
          <TextInput style={inputStyle} value={money.total} onChangeText={money.setTotal} placeholder="0" placeholderTextColor={colors.muted} keyboardType="numeric" testID="input-job-amount" />
        </Field>
      )}
      {!self && mode === "later" ? (
        <>
          <DateField label="काम कब आया" value={takenOn} onChange={(d) => { setTakenOn(d); setPaidDate(d); vendorJob.setAssignOn(d === todayISO() ? "" : d); }} testID="input-job-taken-date" />
          <Field label="एडवांस मिला (₹)">
            <TextInput style={inputStyle} value={paidNow} onChangeText={setPaidNow} placeholder="0" placeholderTextColor={colors.muted} keyboardType="numeric" testID="input-job-paid" />
          </Field>
          {parseAmount(paidNow) > 0 ? (
            <>
              <PayModeField label="कैसे मिले" value={payMode} onChange={setPayMode} split={split} total={parseAmount(paidNow)} />
              <DateField label="कब मिले" value={paidDate} onChange={setPaidDate} min={takenOn} money testID="input-job-paid-date" />
            </>
          ) : null}
          {canVendor ? <VendorOutsource v={vendorJob} amount={amt} fee={0} workDate={date} assign start={takenOn} /> : null}
        </>
      ) : null}

      {mode === "now" ? (
        <>
          <DateField label="तारीख" value={date} onChange={setDate} money testID="input-job-date" />
          <MoreInfo open={!!remark || !!govtFee} hint={self ? "रिमार्क" : "सरकारी फीस, रिमार्क"} testID="job-more-info">
            {self ? null : <FeeField fee={govtFee} setFee={setGovtFee} feeMode={feeMode} setFeeMode={setFeeMode} amount={amt} />}
            <Field label="आगे का रिमार्क">
              <TextInput style={[inputStyle, { minHeight: 64 }]} value={remark} onChangeText={setRemark} multiline placeholder="जैसे कल प्रिंट देने हैं, बाकी पैसे शनिवार को" placeholderTextColor={colors.muted} testID="input-job-remark" />
            </Field>
            {remark.trim() ? <DateField label="रिमार्क कब देखना है" value={remarkDate} onChange={setRemarkDate} future testID="input-remark-date" /> : null}
          </MoreInfo>
        </>
      ) : (
        <>
          <DateField label={self ? "कब करना है" : "कब तक"} value={date} onChange={setDate} future testID="input-job-date" />
          <MoreInfo open={!!remark} hint="नोट" testID="job-more-info">
            <Field label="नोट">
              <TextInput style={inputStyle} value={remark} onChangeText={setRemark} placeholderTextColor={colors.muted} testID="input-job-notes" />
            </Field>
          </MoreInfo>
        </>
      )}

      {mode === "now" && !self ? <LimitWarning customerId={choice.existingId} extra={roundMoney(amt - money.receivedNum)} /> : null}
      <PrimaryButton label={saveLabel} onPress={save} disabled={!valid} saving={saving} testID="save-job-btn" />
    </SheetShell>
  );
}

export type JobAction = "self" | "vendor" | "assign";

export const JOB_ACTIONS: { key: JobAction; label: string; icon: string }[] = [
  { key: "self", label: "खुद पूरा किया", icon: "account-check-outline" },
  { key: "vendor", label: "वेंडर से कराया", icon: "truck-check-outline" },
  { key: "assign", label: "वेंडर को दिया", icon: "truck-fast-outline" },
];

/**
 * The one sheet for an open job, whether opened from the row or from "पूरा करें": finish it yourself,
 * finish it through a vendor, or hand it to a vendor and keep it open. Title, notes and removal sit under
 * "विवरण बदलें".
 */
export function CompleteJobSheet({ job, onClose }: { job: Job | null; onClose: () => void }) {
  const entries = useEntries().data ?? [];
  const customers = useCustomers().data ?? [];
  const jobAdvances = job ? advancesForJob(job, entries) : [];
  const jobAdvance = jobAdvances.reduce((s, p) => s + p.amount, 0);
  const advance = job?.customerId ? advanceOf(entries, job.customerId) : 0;
  const money = useMoneyInput(true);
  const [payMode, setPayMode] = useState<PayMode>("cash");
  const [fee, setFee] = useState("");
  const [feeMode, setFeeMode] = useState<PayMode>("online");
  const [workDay, setWorkDate] = useState(todayISO());
  const [cashDay, setCashDate] = useState(todayISO());
  const [openedOn, setOpenedOn] = useState(todayISO());
  const [action, setAction] = useState<JobAction>("self");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<Job["status"]>("pending");
  const [due, setDue] = useState(todayISO());
  const [details, setDetails] = useState(false);
  const [saving, setSaving] = useState(false);
  const split = useSplitPay();
  const vendorJob = useVendorJob(!!job);
  const { isPersonal } = usePersona();
  const outsource = !!job?.customerId && !isPersonal;
  // Given to a vendor while pending: its order (and advances) carry into this sheet.
  const vendorRow = job ? vendorOrdersForJob(job, entries)[0] : undefined;
  const start = job ? jobStart(job, entries) : todayISO();
  const customerName = job?.customerId ? customers.find((c) => c.id === job.customerId)?.name ?? "" : "";
  const orderName = vendorRow ? customers.find((c) => c.id === vendorRow.customerId)?.name ?? "Vendor" : "";

  useEffect(() => {
    if (job) {
      vendorJob.load(vendorRow, entries, true, job.dueDate);
      setAction(vendorRow ? "vendor" : "self");
      split.reset();
      const est = job.estimatedAmount > 0 ? job.estimatedAmount : 0;
      // The advance for this job already sits in the drawer/bank; only the remainder is new money.
      money.reset(est ? String(est) : "", undefined, jobAdvance);
      setPayMode(getPrefs().defaultMode);
      setFee("");
      setFeeMode("online");
      setWorkDate(todayISO());
      setCashDate(todayISO());
      setOpenedOn(todayISO());
      setTitle(job.title);
      setNotes(job.notes);
      setStatus(job.status === "done" ? "pending" : job.status);
      setDue(job.dueDate || todayISO());
      setDetails(false);
    }
    // Only re-initialise when a different job is opened, not when a sync refreshes it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id]);

  const pickAction = (a: JobAction) => {
    setAction(a);
    vendorJob.setOn(a !== "self");
  };

  const assigning = outsource && action === "assign";
  const amt = job?.customerId ? money.totalNum : 0;
  const got = assigning ? 0 : money.receivedNum;
  const cleanTitle = title.trim() || job?.title || "";
  // Finished no earlier than it came in, or than it was handed to the vendor who finished it.
  const doneMin = vendorJob.order && vendorJob.on && !vendorJob.releasing ? vendorJob.assignDay : start;
  const vendorOk = !outsource || (vendorJob.ready && vendorJob.datesOk(start, assigning));
  const datesOk = assigning ? due >= start : workDay >= doneMin && (got <= 0 || cashDay >= start);
  const canFinish = (!job?.customerId || amt <= 0 || money.answered) && vendorOk && (!job?.customerId || datesOk);
  const canAssign = !!title.trim() && vendorOk && datesOk;

  const complete = async () => {
    if (!job || !canFinish) return;
    setSaving(true);
    try {
      const workDate = dateOnSave(workDay, openedOn);
      const cashDate = dateOnSave(cashDay, openedOn);
      const sameDay = cashDate === workDate;
      const parts = splitOf(split, got);
      const entryId = recordWork({
        customerId: job.customerId,
        title: cleanTitle,
        amount: amt,
        received: sameDay ? got : 0,
        date: workDate,
        // The job's own notes are internal (vendor, cost); the work row prints on the customer's bill.
        notes: "काम पूरा",
        mode: payMode,
        fee: parseAmount(fee),
        feeMode,
        split: sameDay ? parts : null,
        keepRow: outsource && vendorJob.costNum > 0,
      });
      if (outsource) {
        if (entryId) await saveVendorEdit(vendorJob, vendorRow, entryId, cleanTitle, workDate, entries);
        else if (vendorRow) releaseVendorOrder(vendorRow, entries, vendorJob.refund());
      }
      if (entryId) {
        jobAdvances.forEach((p) => store.updateEntry(p.id, { linkId: entryId }));
        if (!sameDay && got > 0) {
          createPaid({ customerId: job.customerId, type: "payment", date: cashDate, description: settleDescription(cleanTitle), notes: "", linkId: entryId }, got, payMode, parts);
        }
      } else if (got > 0 && job.customerId) {
        createPaid({ customerId: job.customerId, type: "payment", date: cashDate, description: ADVANCE, notes: `${cleanTitle} के लिए` }, got, payMode, parts);
      }
      store.updateJob(job.id, { title: cleanTitle, notes: notes.trim(), status: "done", dueDate: workDate, estimatedAmount: amt, entryId });
      onClose();
    } finally { setSaving(false); }
  };

  const assign = async () => {
    if (!job || !canAssign) return;
    setSaving(true);
    try {
      store.updateJob(job.id, { title: cleanTitle, estimatedAmount: amt, dueDate: due, notes: notes.trim(), status: status === "pending" ? "doing" : status });
      await saveVendorAssign(vendorJob, vendorRow, job.id, cleanTitle, due, entries);
      onClose();
    } finally { setSaving(false); }
  };

  const saveDetails = () => {
    if (!job || !title.trim()) return;
    store.updateJob(job.id, { title: cleanTitle, notes: notes.trim(), status });
    onClose();
  };

  const remove = () => {
    if (job) confirmRemoveJob(job, entries, !!vendorRow, onClose);
  };

  return (
    <SheetShell visible={!!job} onClose={onClose} title={assigning ? "वेंडर को दें" : "काम पूरा करें"} testID="sheet-complete-job">
      {job ? (
        <View style={styles.jobHead}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.jobName, { marginBottom: 2 }]} numberOfLines={2}>{cleanTitle}</Text>
            <Text style={styles.jobMeta} numberOfLines={1}>
              {[customerName, job.customerId ? `आया ${formatDate(start)}` : "", jobAdvance > 0 ? `एडवांस ${formatINR(jobAdvance)}` : ""].filter(Boolean).join(" · ")}
            </Text>
          </View>
          <Pressable onPress={() => setDetails((d) => !d)} hitSlop={8} style={styles.jobEditBtn} accessibilityRole="button" testID="toggle-job-details">
            <MaterialIcon name={details ? "chevron-up" : "pencil-outline"} size={16} color={colors.brandPrimary} />
            <Text style={styles.jobEditText}>{details ? "बंद करें" : "विवरण बदलें"}</Text>
          </Pressable>
        </View>
      ) : null}

      {details ? (
        <View style={styles.vendorBox}>
          <Field label="क्या काम">
            <TextInput style={inputStyle} value={title} onChangeText={setTitle} placeholderTextColor={colors.muted} testID="input-edit-job-title" />
          </Field>
          <Field label="नोट / रिमार्क">
            <TextInput style={[inputStyle, { minHeight: 56 }]} value={notes} onChangeText={setNotes} multiline placeholderTextColor={colors.muted} testID="input-edit-job-notes" />
          </Field>
          <Field label="स्थिति">
            <View style={styles.chipRow}>
              <Chip label="काम बाकी" active={status === "pending"} onPress={() => setStatus("pending")} testID="edit-job-status-pending" />
              <Chip label="चल रहा" active={status === "doing"} onPress={() => setStatus("doing")} tone={colors.warning} testID="edit-job-status-doing" />
            </View>
          </Field>
          <Pressable onPress={saveDetails} disabled={!title.trim()} style={[styles.detailSave, !title.trim() && { opacity: 0.5 }]} accessibilityRole="button" testID="save-job-details-btn">
            <Text style={styles.detailSaveText}>सिर्फ़ विवरण सेव करें</Text>
          </Pressable>
          <Pressable onPress={remove} style={styles.dangerLink} accessibilityRole="button" testID="delete-job-btn">
            <MaterialIcon name="trash-can-outline" size={18} color={colors.error} />
            <Text style={{ color: colors.error, fontWeight: "700" }}>काम हटाएँ</Text>
          </Pressable>
        </View>
      ) : null}

      {outsource ? (
        <View style={styles.actionRow}>
          {JOB_ACTIONS.map((a) => {
            const active = action === a.key;
            return (
              <Pressable
                key={a.key}
                onPress={() => pickAction(a.key)}
                style={[styles.actionPill, active && styles.actionPillOn]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                testID={`job-action-${a.key}`}
              >
                <MaterialIcon name={a.icon as never} size={20} color={active ? "#fff" : colors.brandPrimary} />
                <Text style={[styles.actionPillText, active && { color: "#fff" }]} numberOfLines={1}>{a.label}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {assigning ? (
        <>
          <Field label="ग्राहक से कुल रकम (₹, वैकल्पिक)">
            <TextInput style={inputStyle} value={money.total} onChangeText={money.setTotal} keyboardType="numeric" placeholder="0" placeholderTextColor={colors.muted} testID="input-assign-amount" />
          </Field>
          <VendorOutsource v={vendorJob} amount={amt} fee={0} workDate={due} assign start={start} bare />
          <DateField label="ग्राहक को कब तक" value={due} onChange={setDue} future min={start} testID="input-assign-due" />
          <PrimaryButton label={vendorRow ? "बदलाव सेव करें" : "वेंडर को सौंपें"} onPress={() => void assign()} disabled={!canAssign} saving={saving} testID="save-assign-btn" />
        </>
      ) : (
        <>
          {outsource && action === "self" && vendorRow ? (
            vendorJob.needFate ? (
              <VendorRelease v={vendorJob} vendorName={orderName} />
            ) : (
              <Text style={[styles.hint, { marginTop: 0, marginBottom: spacing.md }]}>{orderName} से काम वापस लिया जाएगा — उनकी लागत नहीं जुड़ेगी</Text>
            )
          ) : null}
          {job?.customerId ? (
            <>
              <MoneyFields money={money} advance={advance} receivedLabel="आज मिले (₹)" freeAllowed />
              {got > 0 ? <PayModeField label="कैसे मिले" value={payMode} onChange={setPayMode} split={split} total={got} /> : null}
              <FeeField fee={fee} setFee={setFee} feeMode={feeMode} setFeeMode={setFeeMode} amount={amt} />
              {outsource && action === "vendor" ? <VendorOutsource v={vendorJob} amount={amt} fee={parseAmount(fee)} workDate={workDay} start={start} bare /> : null}
            </>
          ) : null}
          <DateField label="काम कब पूरा हुआ" value={workDay} onChange={(d) => { setWorkDate(d); setCashDate(d); }} min={job?.customerId ? doneMin : undefined} testID="input-complete-date" />
          {job?.customerId && got > 0 ? <DateField label="पैसे कब मिले" value={cashDay} onChange={setCashDate} min={start} money testID="input-complete-cash-date" /> : null}
          {job?.customerId ? <LimitWarning customerId={job.customerId} extra={roundMoney(amt - got)} /> : null}
          <PrimaryButton
            label={job?.customerId && amt <= 0 ? "मुफ़्त — पूरा हुआ" : "पूरा हुआ"}
            onPress={() => void complete()}
            disabled={!canFinish}
            saving={saving}
            testID="save-complete-btn"
          />
        </>
      )}
    </SheetShell>
  );
}
