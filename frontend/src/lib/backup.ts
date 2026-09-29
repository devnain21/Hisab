import { Platform } from "react-native";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { computeBalance, type Customer, type Entry, type Job } from "@/src/lib/data";
import { todayISO } from "@/src/lib/format";

const cell = (v: unknown) => {
  const s = String(v ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const row = (cols: unknown[]) => cols.map(cell).join(",");

export function buildBackupCsv(customers: Customer[], entries: Entry[], jobs: Job[]): string {
  const byId = new Map(customers.map((c) => [c.id, c]));
  const lines: string[] = [];

  lines.push(row(["खाता (सभी एंट्री)"]));
  lines.push(row(["तारीख", "ग्राहक", "फ़ोन", "प्रकार", "विवरण", "रकम", "नोट"]));
  [...entries]
    .sort((a, b) => (a.date !== b.date ? a.date.localeCompare(b.date) : a.createdAt.localeCompare(b.createdAt)))
    .forEach((e) => {
      const c = byId.get(e.customerId);
      lines.push(row([e.date, c?.name ?? "", c?.phone ?? "", e.type === "work" ? "उधार/काम" : "जमा", e.description, e.amount, e.notes]));
    });

  lines.push("");
  lines.push(row(["ग्राहक सारांश"]));
  lines.push(row(["ग्राहक", "फ़ोन", "पता", "बकाया", "नोट"]));
  customers.forEach((c) => lines.push(row([c.name, c.phone, c.address, computeBalance(entries, c.id), c.notes])));

  lines.push("");
  lines.push(row(["काम"]));
  lines.push(row(["तारीख", "ग्राहक", "काम", "स्थिति", "रकम", "नोट"]));
  const status = { pending: "बाकी", doing: "चल रहा", done: "पूरा" } as const;
  [...jobs]
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .forEach((j) => lines.push(row([j.dueDate, byId.get(j.customerId)?.name ?? "", j.title, status[j.status], j.estimatedAmount, j.notes])));

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
