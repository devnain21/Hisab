import { Platform } from "react-native";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { computeBalance, itemsText, type AepsTxn, type Customer, type Entry, type Job } from "@/src/lib/data";
import { AEPS_META, STATUS_META } from "@/src/lib/aeps";
import { todayISO } from "@/src/lib/format";

const cell = (v: unknown) => {
  const s = String(v ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const row = (cols: unknown[]) => cols.map(cell).join(",");

export function buildBackupCsv(customers: Customer[], entries: Entry[], jobs: Job[], aeps: AepsTxn[] = []): string {
  const byId = new Map(customers.map((c) => [c.id, c]));
  const lines: string[] = [];

  lines.push(row(["खाता (सभी एंट्री)"]));
  lines.push(row(["तारीख", "नाम", "फ़ोन", "प्रकार", "विवरण", "रकम", "मिले", "लेने हैं", "नोट"]));
  [...entries]
    .sort((a, b) => (a.date !== b.date ? a.date.localeCompare(b.date) : a.createdAt.localeCompare(b.createdAt)))
    .forEach((e) => {
      const c = byId.get(e.customerId);
      const paid = e.type === "work" ? e.paid ?? 0 : 0;
      const kind = e.type === "payment" ? "मिले" : e.type === "given" ? "दिए" : e.type === "purchase" ? "सामान / सेवा ली" : paid >= e.amount ? "पूरे मिले" : paid > 0 ? "कुछ मिले" : "लेने हैं";
      const due = e.type === "work" ? e.amount - paid : e.type === "purchase" ? -(e.amount - (e.paid ?? 0)) : "";
      lines.push(row([e.date, c?.name ?? "", c?.phone ?? "", kind, itemsText(e), e.amount, e.type === "work" ? paid : "", due, e.notes]));
    });

  lines.push("");
  lines.push(row(["खाता सारांश"]));
  lines.push(row(["नाम", "फ़ोन", "पता", "लेने हैं", "नोट"]));
  customers.forEach((c) => lines.push(row([c.name, c.phone, c.address, computeBalance(entries, c.id), c.notes])));

  lines.push("");
  lines.push(row(["काम"]));
  lines.push(row(["तारीख", "नाम", "काम", "स्थिति", "रकम", "नोट"]));
  const status = { pending: "काम बाकी", doing: "चल रहा", done: "पूरा" } as const;
  [...jobs]
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .forEach((j) => lines.push(row([j.dueDate, j.customerId ? byId.get(j.customerId)?.name ?? "" : "खुद का", j.title, status[j.status], j.estimatedAmount, j.notes])));

  if (aeps.length) {
    lines.push("");
    lines.push(row(["AEPS / सेवाएँ"]));
    lines.push(row(["तारीख", "समय", "सेवा", "स्थिति", "नाम", "मोबाइल", "आधार (आख़िरी 4)", "बैंक", "पाने वाला", "UPI", "खाता", "IFSC", "ऑपरेटर", "नंबर", "बिल", "कंज़्यूमर नं.", "रकम", "कमीशन", "Txn ID", "नोट"]));
    [...aeps]
      .sort((a, b) => (a.date !== b.date ? a.date.localeCompare(b.date) : a.time.localeCompare(b.time)))
      .forEach((t) =>
        lines.push(row([
          t.date, t.time, AEPS_META[t.type]?.short ?? t.type, STATUS_META[t.status]?.label ?? t.status, t.customerName, t.mobile,
          t.aadhaarLast4, t.bankName, t.beneficiaryName, t.upiId ?? "", t.accountNumber, t.ifsc, t.operator, t.rechargeNumber, t.billerName,
          t.billAccount, t.amount, t.commission, t.reference, t.notes,
        ])),
      );
  }

  // BOM so Excel reads the Hindi text as UTF-8.
  return "\uFEFF" + lines.join("\r\n");
}

export async function shareBackup(csv: string) {
  const name = `hisab-backup-${todayISO()}.csv`;
  if (Platform.OS === "web") {
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
    return;
  }
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  file.create();
  file.write(csv);
  await Sharing.shareAsync(file.uri, { mimeType: "text/csv", dialogTitle: "हिसाब बैकअप", UTI: "public.comma-separated-values-text" });
}
