import { useEffect, useState } from "react";
import { View, Text, TextInput, StyleSheet } from "react-native";
import MaterialIcon from "@react-native-vector-icons/material-design-icons";
import { colors, radius, spacing } from "@/src/theme";
import { Chip, DangerLink, Field, PrimaryButton, SheetShell, inputStyle } from "@/src/components/sheets";
import { CalendarModal } from "@/src/components/calendar-modal";
import { Pressable } from "@/src/components/tap";
import { store } from "@/src/lib/store";
import { confirmAction } from "@/src/lib/confirm";
import { formatDate, todayISO } from "@/src/lib/format";
import { TIME_RE, formatTime } from "@/src/lib/tasks";
import type { Job } from "@/src/lib/data";

const TIME_PRESETS = ["09:00", "12:00", "17:00", "20:00"];

/** Add or edit a to-do of the personal book. `initial` = edit; `draft` pre-fills a new one. */
export function TaskSheet({ visible, onClose, initial, draft, onSaved }: { visible: boolean; onClose: () => void; initial?: Job | null; draft?: string; onSaved?: () => void }) {
  const today = todayISO();
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [timeText, setTimeText] = useState("");
  const [high, setHigh] = useState(false);
  const [calendar, setCalendar] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setTitle(initial?.title ?? draft ?? "");
    setNotes(initial?.notes ?? "");
    setDate(initial ? initial.dueDate : "");
    setTime(initial?.time ?? "");
    setTimeText(initial?.time ?? "");
    setHigh(initial?.priority === "high");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, initial?.id]);

  const datePresets = [
    { label: "आज", d: today },
    { label: "कल", d: todayISO(1) },
    { label: "परसों", d: todayISO(2) },
    { label: "1 हफ़्ता", d: todayISO(7) },
  ];
  const customDate = !!date && !datePresets.some((p) => p.d === date);
  const timeBad = timeText !== "" && !TIME_RE.test(timeText);
  const valid = !!title.trim() && !timeBad;

  const pickTime = (t: string) => {
    setTime(t);
    setTimeText(t);
  };

  const save = () => {
    if (!valid) return;
    const fields = { title: title.trim(), notes: notes.trim(), dueDate: date, time, priority: high ? ("high" as const) : ("" as const) };
    if (initial) store.updateJob(initial.id, fields);
    else store.createJob({ customerId: "", estimatedAmount: 0, persona: "personal", ...fields });
    onSaved?.();
    onClose();
  };

  const toggleDone = () => {
    if (!initial) return;
    store.updateJob(initial.id, { status: initial.status === "done" ? "pending" : "done" });
    onClose();
  };

  const remove = () => {
    if (!initial) return;
    confirmAction("यह काम हटाएँ?", initial.title, "हटाएँ", () => {
      store.deleteJob(initial.id);
      onClose();
    });
  };

  return (
    <SheetShell visible={visible} onClose={onClose} title={initial ? "काम बदलें" : "नया काम"} testID="sheet-task">
      <Field label="क्या करना है?">
        <TextInput
          style={[inputStyle, { minHeight: 56, textAlignVertical: "top" }]}
          value={title}
          onChangeText={setTitle}
          placeholder="जैसे: बिजली का बिल भरना"
          placeholderTextColor={colors.muted}
          multiline
          maxLength={200}
          autoFocus={!initial}
          testID="task-title"
        />
      </Field>

      <Pressable style={[styles.flagRow, high && styles.flagRowOn]} onPress={() => setHigh((v) => !v)} testID="task-priority">
        <MaterialIcon name={high ? "flag" : "flag-outline"} size={20} color={high ? colors.error : colors.muted} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.flagTitle, high && { color: colors.error }]}>ज़रूरी काम</Text>
          <Text style={styles.flagSub}>सबसे ऊपर दिखेगा</Text>
        </View>
        <MaterialIcon name={high ? "checkbox-marked" : "checkbox-blank-outline"} size={22} color={high ? colors.error : colors.muted} />
      </Pressable>

      <Field label="कब तक?">
        <View style={styles.row}>
          <Chip label="कोई तारीख नहीं" active={!date} onPress={() => setDate("")} testID="task-date-none" />
          {datePresets.map((p) => (
            <Chip key={p.label} label={p.label} active={date === p.d} onPress={() => setDate(p.d)} />
          ))}
          <Chip label={customDate ? formatDate(date) : "तारीख चुनें"} icon="calendar-month-outline" active={customDate} onPress={() => setCalendar(true)} testID="task-date-pick" />
        </View>
      </Field>

      <Field label="समय (वैकल्पिक)">
        <View style={styles.row}>
          <Chip label="कोई नहीं" active={!time && !timeText} onPress={() => pickTime("")} />
          {TIME_PRESETS.map((t) => (
            <Chip key={t} label={formatTime(t)} active={time === t} onPress={() => pickTime(t)} />
          ))}
        </View>
        <TextInput
          style={[inputStyle, styles.timeInput, timeBad && { borderColor: colors.error }]}
          value={timeText}
          onChangeText={(v) => {
            const clean = v.replace(/[^\d:]/g, "").slice(0, 5);
            setTimeText(clean);
            setTime(TIME_RE.test(clean) ? clean : "");
          }}
          placeholder="या लिखें, जैसे 14:30"
          placeholderTextColor={colors.muted}
          keyboardType="numbers-and-punctuation"
          maxLength={5}
          testID="task-time"
        />
        {timeBad ? <Text style={styles.err}>समय ऐसे लिखें: 09:30 या 18:45</Text> : null}
      </Field>

      <Field label="नोट (वैकल्पिक)">
        <TextInput
          style={[inputStyle, { minHeight: 90, textAlignVertical: "top" }]}
          value={notes}
          onChangeText={setNotes}
          placeholder="ज़रूरी बातें, नंबर, सामान की लिस्ट…"
          placeholderTextColor={colors.muted}
          multiline
          maxLength={1000}
          testID="task-notes"
        />
      </Field>

      <PrimaryButton label={initial ? "सेव करें" : "काम जोड़ें"} onPress={save} disabled={!valid} testID="task-save" />

      {initial ? (
        <>
          <Pressable style={styles.doneBtn} onPress={toggleDone} testID="task-toggle-done">
            <MaterialIcon name={initial.status === "done" ? "restore" : "check-circle-outline"} size={18} color={colors.success} />
            <Text style={styles.doneText}>{initial.status === "done" ? "फिर से बाकी करें" : "पूरा हो गया"}</Text>
          </Pressable>
          <DangerLink label="यह काम हटाएँ" onPress={remove} testID="task-delete" />
        </>
      ) : null}

      <CalendarModal visible={calendar} value={date || today} heading="कब तक?" onPick={setDate} onClose={() => setCalendar(false)} />
    </SheetShell>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  flagRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, marginBottom: spacing.md },
  flagRowOn: { borderColor: colors.error, backgroundColor: colors.errorSoft },
  flagTitle: { fontSize: 15, fontWeight: "700", color: colors.onSurface },
  flagSub: { fontSize: 12, color: colors.muted, marginTop: 2 },
  timeInput: { marginTop: spacing.sm },
  err: { fontSize: 12, color: colors.error, marginTop: 6 },
  doneBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: spacing.sm, paddingVertical: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.success },
  doneText: { fontSize: 14, fontWeight: "700", color: colors.success },
});
