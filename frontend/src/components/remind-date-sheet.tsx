import { useEffect, useState } from "react";
import { StyleSheet, Text } from "react-native";
import type { Customer } from "@/src/lib/data";
import { store } from "@/src/lib/store";
import { todayISO } from "@/src/lib/format";
import { remindersSupported } from "@/src/lib/notify";
import { colors, spacing } from "@/src/theme";
import { DangerLink, DateField, PrimaryButton, SheetShell } from "@/src/components/sheets";

/** The day to chase this customer's udhaar; the phone rings a reminder at 9 am that day. */
export function RemindDateSheet({ customer, visible, onClose }: { customer: Customer; visible: boolean; onClose: () => void }) {
  const [date, setDate] = useState(todayISO(7));

  useEffect(() => {
    if (visible) setDate(customer.remindOn && customer.remindOn >= todayISO() ? customer.remindOn : todayISO(7));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const save = (remindOn: string) => {
    const { id: _id, createdAt: _c, ...rest } = customer;
    store.updateCustomer(customer.id, { ...rest, remindOn });
    onClose();
  };

  return (
    <SheetShell visible={visible} onClose={onClose} title="वसूली की तारीख" testID="sheet-remind-date">
      <DateField label="किस दिन याद दिलाएँ" value={date} onChange={setDate} future testID="remind-date" />
      <Text style={styles.hint}>
        {remindersSupported()
          ? "उस दिन सुबह 9 बजे फ़ोन पर याद दिलाएँगे, अगर तब भी पैसे बाकी हों।"
          : "फ़ोन पर याद दिलाने के लिए ऐप का नया वर्ज़न (APK) डालें। तारीख खाते में दिखती रहेगी।"}
      </Text>
      <PrimaryButton label="तारीख सेव करें" onPress={() => save(date)} disabled={date < todayISO()} testID="remind-date-save" />
      {customer.remindOn ? <DangerLink label="तारीख हटाएँ" onPress={() => save("")} testID="remind-date-clear" /> : null}
    </SheetShell>
  );
}

const styles = StyleSheet.create({
  hint: { fontSize: 13, color: colors.muted, marginBottom: spacing.md, lineHeight: 19 },
});
