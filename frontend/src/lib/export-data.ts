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
import { balanceTerm } from "@/src/lib/terms";
import type { Persona } from "@/src/lib/persona";

function escapeCsv(val: any): string {
  if (val == null) return '""';
  const str = String(val).replace(/"/g, '""');
  return `"${str}"`;
}

/** Long digit strings (phones, RRNs) must stay text, or Excel shows them as 9.88E+09 and drops leading zeros. */
function textNum(val: string | undefined | null): string {
  const s = (val ?? "").trim();
  return /^\+?\d[\d ]{5,}$/.test(s) ? `="${s}"` : s || "-";
}

export async function exportFullLedgerCsv(params: {
  customers: Customer[];
  entries: Entry[];
  jobs: Job[];
  aeps: AepsTxn[];
  expenses: Expense[];
  moves: Move[];
  shop?: Partial<ShopProfile> | null;
  /** Limit the file to one book; both books when left out. */
  only?: Persona;
  /** Rows of these days only (monthly report); balances still count every day. */
  range?: { from: string; to: string; label: string };
}): Promise<void> {
  const { shop, only, range } = params;
  const inBook = (p: Persona) => !only || p === only;
  const inRange = (d: string) => !range || (d >= range.from && d <= range.to);
  const customers = params.customers.filter((c) => inBook(c.persona === "personal" ? "personal" : "business"));
  const ids = new Set(customers.map((c) => c.id));
  const entries = params.entries.filter((e) => ids.has(e.customerId));
  const aeps = (only === "personal" ? [] : params.aeps).filter((t) => inRange(t.date));
  const expenses = params.expenses.filter((x) => inBook(expensePersona(x)) && inRange(x.date));
  const moves = params.moves.filter((m) => (!only || m.from.startsWith(only) || m.to.startsWith(only)) && inRange(m.date));
  const bookOf = (c?: Customer) => (c?.persona === "personal" ? "निजी" : "दुकान");
  const shopName = shop?.shop_name || "हिसाब बही खाता";
  const dateStr = todayISO();

  const lines: string[] = [];

  // UTF-8 BOM for Excel
  lines.push("\uFEFF");

  // Shop & Metadata Header
  lines.push(`${escapeCsv(shopName)} - ${only === "personal" ? "निजी खाता" : only === "business" ? "दुकान खाता" : "सम्पूर्ण बही खाता"} बैकअप`);
  if (range) lines.push(escapeCsv(`महीना: ${range.label} (${range.from} से ${range.to}) · बकाया आज तक का`));
  lines.push(`डाउनलोड तिथि: ${dateStr}`);
  if (shop?.shop_phone) lines.push(["फ़ोन", textNum(shop.shop_phone)].map(escapeCsv).join(","));
  lines.push("");

  // SECTION 1: CUSTOMER BALANCES
  lines.push("=== 1. खातों का हिसाब (CUSTOMER BALANCES) ===");
  lines.push(["क्र.", "खाता", "नाम", "मोबाइल नंबर", "पता", "बकाया (₹)", "स्थिति"].map(escapeCsv).join(","));

  [...customers].sort((a, b) => bookOf(a).localeCompare(bookOf(b)) || a.name.localeCompare(b.name)).forEach((c, i) => {
    const bal = computeBalance(entries, c.id);
    const personal = c.persona === "personal";
    const status = balanceTerm(bal, personal);
    lines.push(
      [
        i + 1,
        bookOf(c),
        c.name,
        textNum(c.phone),
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
  lines.push(["क्र.", "तारीख", "खाता", "नाम", "प्रकार", "विवरण", "कुल रकम (₹)", "मिले (₹)", "दिए (₹)", "नकद / ऑनलाइन", "बाकी पर असर (₹)", "नोट्स"].map(escapeCsv).join(","));

  const custMap = new Map(customers.map((c) => [c.id, c]));
  const entryIds = new Set(entries.map((e) => e.id));
  const aepsIds = new Set(params.aeps.map((t) => t.id));
  const sortedEntries = entries.filter((e) => inRange(e.date)).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));

  sortedEntries.forEach((e, i) => {
    const cust = custMap.get(e.customerId);
    const personal = cust?.persona === "personal";
    const typeLabel =
      e.type === "work"
        ? "काम / बिक्री"
        : e.type === "payment"
          ? e.linkId && aepsIds.has(e.linkId)
            ? "AEPS जमा"
            : e.linkId && !entryIds.has(e.linkId)
              ? "एडवांस जमा"
              : "भुगतान मिला"
          : e.type === "purchase"
            ? personal
              ? "उधार लिया / सामान लिया"
              : "माल / सेवा ली"
            : e.type === "aeps"
              ? "काउंटर बाकी"
              : personal
                ? "उधार दिया / पैसे दिए"
                : "भुगतान दिया";
    const received = e.type === "work" ? (e.paid || 0) : e.type === "payment" ? e.amount : 0;
    const given = e.type === "given" ? e.amount : e.type === "purchase" ? (e.paid || 0) : 0;
    const moved = received + given > 0;

    lines.push(
      [
        i + 1,
        e.date,
        bookOf(cust),
        cust?.name || "अन्य / नकद",
        typeLabel,
        itemsText(e) || "-",
        e.amount,
        received || "-",
        given || "-",
        moved ? (e.mode === "online" ? "ऑनलाइन" : "नकद") : "-",
        entryDelta(e),
        e.notes || "-",
      ].map(escapeCsv).join(",")
    );
  });
  lines.push(escapeCsv("बाकी पर असर: + मतलब आपको मिलेंगे, − मतलब आपको देने हैं / एडवांस"));

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
          textNum(t.mobile),
          t.amount,
          t.commission || 0,
          STATUS_META[t.status]?.label ?? t.status,
          textNum(t.reference),
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
          [i + 1, x.date, expensePersona(x) === "personal" ? "निजी" : "दुकान", x.title, x.amount, x.mode === "online" ? "ऑनलाइन" : "नकद", x.notes || "-"]
            .map(escapeCsv)
            .join(","),
        );
      });
    lines.push("");
    lines.push("");
  }

  // SECTION 5: MONEY MOVES (cash ↔ bank, added / taken out)
  if (moves.length > 0) {
    lines.push("=== 5. कैश / बैंक ट्रांसफर (MONEY MOVES) ===");
    lines.push(["क्र.", "तारीख", "कहाँ से", "कहाँ", "रकम (₹)", "नोट"].map(escapeCsv).join(","));
    [...moves]
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
      .forEach((m, i) => {
        lines.push([i + 1, m.date, accountLabel(m.from), accountLabel(m.to), m.amount, m.note || "-"].map(escapeCsv).join(","));
      });
  }

  const csvContent = lines.join("\r\n");
  const fileName = `Hisab_${only === "personal" ? "Niji_" : only === "business" ? "Dukan_" : ""}${range ? `Mahina_${range.from.slice(0, 7)}` : dateStr}.csv`;

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
