import { Platform } from "react-native";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import type { Customer, Entry, Job, AepsTxn } from "@/src/lib/data";
import { computeBalance, entryDelta, itemsText } from "@/src/lib/data";
import type { ShopProfile } from "@/src/context/AuthContext";
import { todayISO } from "@/src/lib/format";
import { AEPS_META, STATUS_META } from "@/src/lib/aeps";
import { expensePersona, type Expense } from "@/src/lib/expenses";
import { accountLabel, type Move } from "@/src/lib/wallet";

function escapeCsv(val: any): string {
  if (val == null) return '""';
  const str = String(val).replace(/"/g, '""');
  return `"${str}"`;
}

export async function exportFullLedgerCsv(params: {
  customers: Customer[];
  entries: Entry[];
  jobs: Job[];
  aeps: AepsTxn[];
  expenses: Expense[];
  moves: Move[];
  shop?: Partial<ShopProfile> | null;
}): Promise<void> {
  const { customers, entries, aeps, expenses, moves, shop } = params;
  const bookOf = (c?: Customer) => (c?.persona === "personal" ? "निजी" : "दुकान");
  const shopName = shop?.shop_name || "हिसाब बही खाता";
  const dateStr = todayISO();

  const lines: string[] = [];

  // UTF-8 BOM for Excel
  lines.push("\uFEFF");

  // Shop & Metadata Header
  lines.push(`${escapeCsv(shopName)} - सम्पूर्ण बही खाता बैकअप`);
  lines.push(`डाउनलोड तिथि: ${dateStr}`);
  if (shop?.shop_phone) lines.push(`फ़ोन: ${escapeCsv(shop.shop_phone)}`);
  lines.push("");

  // SECTION 1: CUSTOMER BALANCES
  lines.push("=== 1. खातों का हिसाब (CUSTOMER BALANCES) ===");
  lines.push(["क्र.", "खाता", "नाम", "मोबाइल नंबर", "पता", "बाकी रकम (लेने हैं / एडवांस)", "स्थिति"].map(escapeCsv).join(","));

  customers.forEach((c, i) => {
    const bal = computeBalance(entries, c.id);
    const personal = c.persona === "personal";
    const status = bal > 0 ? "लेने हैं" : bal < 0 ? (personal ? "देने हैं" : "एडवांस") : "हिसाब बराबर";
    lines.push(
      [
        i + 1,
        bookOf(c),
        c.name,
        c.phone || "-",
        c.address || "-",
        bal,
        status,
      ].map(escapeCsv).join(",")
    );
  });

  lines.push("");
  lines.push("");

  // SECTION 2: ALL ENTRIES
  lines.push("=== 2. लेन-देन बही खाता (ALL ENTRIES) ===");
  lines.push(["क्र.", "तारीख", "खाता", "नाम", "प्रकार", "विवरण", "कुल रकम (₹)", "मिले (₹)", "कैसे मिले", "उधारी/बाकी (₹)", "नोट्स"].map(escapeCsv).join(","));

  const custMap = new Map(customers.map((c) => [c.id, c]));
  const sortedEntries = [...entries].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));

  sortedEntries.forEach((e, i) => {
    const cust = custMap.get(e.customerId);
    const typeLabel = e.type === "work" ? "काम" : e.type === "payment" ? "पैसे मिले" : e.type === "purchase" ? "सामान / सेवा ली" : e.type === "aeps" ? "काउंटर बाकी" : "पैसे दिए";
    const received = e.type === "work" ? (e.paid || 0) : e.type === "payment" ? e.amount : 0;
    const due = entryDelta(e);

    lines.push(
      [
        i + 1,
        e.date,
        bookOf(cust),
        cust?.name || "अन्य / नकद",
        typeLabel,
        itemsText(e) || "-",
        e.amount,
        received,
        received > 0 ? (e.mode === "online" ? "ऑनलाइन" : "नकद") : "-",
        due,
        e.notes || "-",
      ].map(escapeCsv).join(",")
    );
  });

  lines.push("");
  lines.push("");

  // SECTION 3: COUNTER & AEPS TRANSACTIONS
  if (aeps.length > 0) {
    lines.push("=== 3. काउंटर व मनी ट्रांसफर (AEPS & COUNTER) ===");
    lines.push(["क्र.", "तारीख व समय", "सेवा", "नाम", "मोबाइल", "रकम (₹)", "कमीशन (₹)", "स्थिति", "रेफरेंस"].map(escapeCsv).join(","));

    const sortedAeps = [...aeps].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
    sortedAeps.forEach((t, i) => {
      lines.push(
        [
          i + 1,
          `${t.date} ${t.time || ""}`,
          AEPS_META[t.type]?.label ?? t.type,
          t.customerName || "-",
          t.mobile || "-",
          t.amount,
          t.commission || 0,
          STATUS_META[t.status]?.label ?? t.status,
          t.reference || "-",
        ].map(escapeCsv).join(",")
      );
    });
    lines.push("");
    lines.push("");
  }

  // SECTION 4: EXPENSES
  if (expenses.length > 0) {
    lines.push("=== 4. खर्च (EXPENSES) ===");
    lines.push(["क्र.", "तारीख", "खाता", "किस पर", "रकम (₹)", "कैसे दिए", "नोट्स"].map(escapeCsv).join(","));
    [...expenses]
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
      .forEach((x, i) => {
        lines.push(
          [i + 1, x.date, expensePersona(x) === "personal" ? "निजी" : "दुकान", x.title, x.amount, x.mode === "online" ? "बैंक / UPI" : "नकद", x.notes || "-"]
            .map(escapeCsv)
            .join(","),
        );
      });
    lines.push("");
    lines.push("");
  }

  // SECTION 5: MONEY MOVES (cash ↔ bank, added / taken out)
  if (moves.length > 0) {
    lines.push("=== 5. पैसे इधर-उधर (MONEY MOVES) ===");
    lines.push(["क्र.", "तारीख", "कहाँ से", "कहाँ", "रकम (₹)", "नोट"].map(escapeCsv).join(","));
    [...moves]
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
      .forEach((m, i) => {
        lines.push([i + 1, m.date, accountLabel(m.from), accountLabel(m.to), m.amount, m.note || "-"].map(escapeCsv).join(","));
      });
  }

  const csvContent = lines.join("\r\n");
  const fileName = `Hisab_${dateStr}.csv`;

  if (Platform.OS === "web") {
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
    return;
  }

  const file = new File(Paths.cache, fileName);
  if (file.exists) file.delete();
  file.create();
  file.write(csvContent);

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, {
      mimeType: "text/csv",
      dialogTitle: `${shopName} का हिसाब एक्सपोर्ट`,
      UTI: "public.comma-separated-values-text",
    });
  }
}
