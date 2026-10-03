import { Platform } from "react-native";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import type { Customer, Entry, Job, AepsTxn } from "@/src/lib/data";
import { computeBalance, entryDelta, itemsText } from "@/src/lib/data";
import type { ShopProfile } from "@/src/context/AuthContext";
import { formatDate, todayISO } from "@/src/lib/format";

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
  shop?: Partial<ShopProfile> | null;
}): Promise<void> {
  const { customers, entries, aeps, shop } = params;
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
  lines.push(["क्र.", "नाम", "मोबाइल नंबर", "पता", "बाकी रकम (लेने हैं / एडवांस)", "स्थिति"].map(escapeCsv).join(","));

  customers.forEach((c, i) => {
    const bal = computeBalance(entries, c.id);
    const status = bal > 0 ? "लेने हैं" : bal < 0 ? "एडवांस" : "हिसाब बराबर";
    lines.push(
      [
        i + 1,
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
  lines.push(["क्र.", "तारीख", "नाम", "प्रकार", "विवरण", "कुल रकम (₹)", "नकद मिले (₹)", "उधारी/बाकी (₹)", "नोट्स"].map(escapeCsv).join(","));

  const custMap = new Map(customers.map((c) => [c.id, c.name]));
  const sortedEntries = [...entries].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));

  sortedEntries.forEach((e, i) => {
    const custName = custMap.get(e.customerId) || "अन्य / नकद";
    const typeLabel = e.type === "work" ? "काम" : e.type === "payment" ? "पैसे मिले" : e.type === "purchase" ? "सामान / सेवा ली" : e.type === "aeps" ? "AEPS बाकी" : "पैसे दिए";
    const cashReceived = e.type === "work" ? (e.paid || 0) : e.type === "payment" ? e.amount : 0;
    const due = entryDelta(e);

    lines.push(
      [
        i + 1,
        e.date,
        custName,
        typeLabel,
        itemsText(e) || "-",
        e.amount,
        cashReceived,
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
          t.type,
          t.customerName || "-",
          t.mobile || "-",
          t.amount,
          t.commission || 0,
          t.status,
          t.reference || "-",
        ].map(escapeCsv).join(",")
      );
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
