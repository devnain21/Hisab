import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo";
import * as Sharing from "expo-sharing";
import { File, Paths } from "expo-file-system";
import type { Customer, Entry } from "@/src/lib/data";
import type { Ledger, WorkStatus } from "@/src/lib/records";
import { formatDate, formatDateShort, formatINR, formatPhone, todayISO } from "@/src/lib/format";
import type { ShopProfile } from "@/src/context/AuthContext";

type Tone = "due" | "ok";
export type Line = { label: string; value: string; tone?: Tone };

/** Everything the share sheet needs: a short preview, the WhatsApp text and the PDF. */
export type ShareDoc = {
  heading: string;
  title: string;
  sub: string;
  phone: string;
  lines: Line[];
  account?: Line;
  message: string;
  html: string;
  fileName: string;
};

const fullShop = (s: Partial<ShopProfile>): ShopProfile => ({
  shop_name: s.shop_name || "बही खाता",
  shop_phone: s.shop_phone || "",
  shop_address: s.shop_address || "",
  shop_gst: s.shop_gst || "",
});

/** Whole-account position, worded for a customer (advance) or a personal contact (we owe them). */
function accountLine(balance: number, isCustomer: boolean): Line {
  if (balance > 0) return { label: "खाते में कुल बाकी", value: formatINR(balance), tone: "due" };
  if (balance < 0) return { label: isCustomer ? "एडवांस जमा" : "हमें आपको देने हैं", value: formatINR(-balance), tone: "ok" };
  return { label: "खाता", value: "पूरा क्लियर", tone: "ok" };
}

const fileSafe = (s: string) => s.replace(/[\\/:*?"<>|\s]+/g, "-").slice(0, 30) || "customer";

/**
 * Receipt for one ledger row. `balance` is the customer's whole-account balance
 * (positive = they owe us) so dues from other entries are shown too.
 */
export function receiptDoc(
  entry: Entry,
  status: WorkStatus | undefined,
  customer: Customer,
  balance: number,
  isCustomer: boolean,
  shopIn: Partial<ShopProfile>,
): ShareDoc {
  const shop = fullShop(shopIn);
  const lines: Line[] = [];
  let itemDue = 0;
  let stamp: { text: string; tone: Tone };

  if (entry.type === "payment") {
    lines.push({ label: "पैसे मिले", value: formatINR(entry.amount), tone: "ok" });
    stamp = { text: "पैसे मिले", tone: "ok" };
  } else {
    const received = status?.received ?? (entry.type === "work" ? entry.paid ?? 0 : 0);
    itemDue = status?.remaining ?? entry.amount - received;
    const given = entry.type === "given";
    lines.push({ label: given ? "उधार दिए" : "कुल रकम", value: formatINR(entry.amount) });
    if (received > 0) lines.push({ label: given ? "वापस मिले" : "मिले", value: formatINR(received), tone: "ok" });
    if (itemDue > 0) {
      lines.push({ label: "बाकी", value: formatINR(itemDue), tone: "due" });
      stamp = { text: "बाकी", tone: "due" };
    } else {
      stamp = { text: given ? "वापस मिले" : "पूरा भुगतान", tone: "ok" };
    }
  }
  const account = entry.type === "payment" || balance !== itemDue ? accountLine(balance, isCustomer) : undefined;

  const no = entry.id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 6).toUpperCase();
  const heading = entry.type === "work" ? "बिल" : "रसीद";
  const item = entry.description || (entry.type === "payment" ? "भुगतान" : entry.type === "given" ? "उधार दिए" : "काम");

  const message = [
    ...messageHead(shop),
    `${heading} नं. ${no} · ${formatDate(entry.date)}`,
    `ग्राहक: ${customer.name}`,
    "",
    item,
    ...lines.map(lineText),
    ...(account ? ["", `*${account.label}: ${account.value}*`] : []),
    "",
    "धन्यवाद 🙏",
  ].join("\n");

  const body = `
  <table>
    <tr><th>विवरण</th><th class="amt">रकम</th></tr>
    <tr class="item"><td>${esc(item)}</td><td class="amt">${esc(formatINR(entry.amount))}</td></tr>
  </table>
  <table class="sum">${lines.map(sumRow).join("")}</table>
  ${account ? accountBox(account) : ""}
  <div class="stamp" style="border-color:${toneColor(stamp.tone)};color:${toneColor(stamp.tone)}">${esc(stamp.text)}</div>`;

  return {
    heading,
    title: item,
    sub: `${customer.name} · ${formatDate(entry.date)} · नं. ${no}`,
    phone: customer.phone,
    lines,
    account,
    message,
    html: page(shop, heading, `नं. ${esc(no)}<br/>${esc(formatDate(entry.date))}`, customer, body, "A5"),
    fileName: `${entry.type === "work" ? "Bill" : "Rasid"}-${no}-${fileSafe(customer.name)}.pdf`,
  };
}

/** Full account statement: every entry with a running balance, plus the items still unpaid. */
export function statementDoc(
  entries: Entry[],
  ledger: Ledger,
  customer: Customer,
  isCustomer: boolean,
  shopIn: Partial<ShopProfile>,
): ShareDoc {
  const shop = fullShop(shopIn);
  const sorted = [...entries].sort((a, b) => (a.date !== b.date ? a.date.localeCompare(b.date) : a.createdAt.localeCompare(b.createdAt)));
  let running = 0;
  let debit = 0;
  let credit = 0;
  const rows = sorted.map((e) => {
    const d = e.type === "payment" ? 0 : e.amount;
    const c = e.type === "work" ? e.paid ?? 0 : e.type === "payment" ? e.amount : 0;
    running += d - c;
    debit += d;
    credit += c;
    const text = e.description || (e.type === "payment" ? "पैसे मिले" : e.type === "given" ? "उधार दिए" : "काम");
    return { date: e.date, text, d, c, bal: running };
  });
  const balance = running;
  const account = accountLine(balance, isCustomer);
  const open = sorted.filter((e) => e.type !== "payment" && (ledger.work.get(e.id)?.remaining ?? 0) > 0);
  const today = todayISO();
  const period = sorted.length ? `${formatDate(sorted[0].date)} – ${formatDate(sorted[sorted.length - 1].date)}` : "";
  const debitLabel = isCustomer ? "कुल काम" : "कुल दिए";

  const lines: Line[] = [
    { label: `${debitLabel} (${rows.length} एंट्री)`, value: formatINR(debit) },
    { label: "कुल मिले", value: formatINR(credit), tone: "ok" },
  ];

  const message = [
    ...messageHead(shop),
    `*खाता विवरण* · ${formatDate(today)}`,
    `ग्राहक: ${customer.name}`,
    "",
    ...lines.map(lineText),
    `*${account.label}: ${account.value}*`,
    ...(open.length
      ? ["", "बाकी वाले काम:", ...open.map((e) => `• ${formatDateShort(e.date)} ${e.description || "उधार दिए"} — ${formatINR(ledger.work.get(e.id)!.remaining)}`)]
      : []),
    "",
    "धन्यवाद 🙏",
  ].join("\n");

  const balCell = (b: number) =>
    b > 0 ? `<span style="color:${DUE}">${esc(formatINR(b))}</span>` : b < 0 ? `<span style="color:${OK}">${esc(formatINR(-b))} जमा</span>` : "—";
  const body = `
  ${period ? `<div class="meta" style="margin-bottom:8px">अवधि: ${esc(period)}</div>` : ""}
  <table class="ledger">
    <tr><th>तारीख</th><th>विवरण</th><th class="amt">रकम</th><th class="amt">मिले</th><th class="amt">बाकी</th></tr>
    ${rows
      .map(
        (r) =>
          `<tr><td class="nowrap">${esc(formatDateShort(r.date))}</td><td>${esc(r.text)}</td><td class="amt">${r.d ? esc(formatINR(r.d)) : ""}</td><td class="amt" style="color:${OK}">${r.c ? esc(formatINR(r.c)) : ""}</td><td class="amt">${balCell(r.bal)}</td></tr>`,
      )
      .join("")}
    <tr class="total"><td colspan="2">कुल</td><td class="amt">${esc(formatINR(debit))}</td><td class="amt" style="color:${OK}">${esc(formatINR(credit))}</td><td class="amt">${balCell(balance)}</td></tr>
  </table>
  ${accountBox(account)}`;

  return {
    heading: "खाता विवरण",
    title: "पूरा हिसाब",
    sub: `${customer.name}${period ? ` · ${period}` : ""}`,
    phone: customer.phone,
    lines,
    account,
    message,
    html: page(shop, "खाता विवरण", esc(formatDate(today)), customer, body, "A4"),
    fileName: `Hisab-${fileSafe(customer.name)}-${today}.pdf`,
  };
}

function messageHead(shop: ShopProfile): string[] {
  return [`*${shop.shop_name}*`, ...(shop.shop_phone ? [`📞 ${formatPhone(shop.shop_phone)}`] : []), ""];
}
const lineText = (l: Line) => (l.tone === "due" ? `*${l.label}: ${l.value}*` : `${l.label}: ${l.value}`);

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const BRAND = "#00796B";
const DUE = "#C62828";
const OK = "#2E7D32";
const toneColor = (t?: Tone) => (t === "due" ? DUE : t === "ok" ? OK : "#1A1A1A");
const sumRow = (l: Line) => `<tr><td>${esc(l.label)}</td><td class="amt" style="color:${toneColor(l.tone)}">${esc(l.value)}</td></tr>`;
const accountBox = (l: Line) =>
  `<div class="account" style="border-color:${toneColor(l.tone)}"><span>${esc(l.label)}</span><b style="color:${toneColor(l.tone)}">${esc(l.value)}</b></div>`;

function page(shop: ShopProfile, heading: string, docMeta: string, customer: Customer, body: string, size: "A4" | "A5"): string {
  const shopMeta = [shop.shop_address, shop.shop_phone ? `फ़ोन: ${formatPhone(shop.shop_phone)}` : "", shop.shop_gst ? `GSTIN: ${shop.shop_gst}` : ""]
    .filter(Boolean)
    .map((s) => `<div>${esc(s)}</div>`)
    .join("");
  return `<!DOCTYPE html><html lang="hi"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<style>
  @page { size: ${size}; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: "Noto Sans Devanagari", Roboto, Arial, "Mangal", sans-serif; font-style: normal; color: #1A1A1A; margin: 0; font-size: 13px; }
  .head { border-bottom: 3px solid ${BRAND}; padding-bottom: 10px; display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
  .shop { font-size: 22px; font-weight: 800; color: ${BRAND}; }
  .meta { color: #555; font-size: 11px; line-height: 1.5; margin-top: 2px; }
  .doc { text-align: right; }
  .doc .title { font-size: 18px; font-weight: 800; letter-spacing: 1px; white-space: nowrap; }
  .doc .meta { margin-top: 4px; }
  .to { margin: 16px 0 12px; }
  .to .label { color: #777; font-size: 11px; }
  .to .name { font-size: 15px; font-weight: 700; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #F2F7F6; color: #333; text-align: left; font-size: 11px; padding: 8px; border-bottom: 1px solid #DDE7E5; }
  th.amt, td.amt { text-align: right; white-space: nowrap; }
  td { padding: 8px; border-bottom: 1px solid #EEE; }
  td.nowrap { white-space: nowrap; }
  .item td { font-weight: 600; font-size: 14px; }
  .ledger td { padding: 6px 8px; font-size: 12px; }
  .ledger tr.total td { font-weight: 800; font-size: 13px; border-top: 2px solid #CCC; border-bottom: none; background: #FAFAFA; }
  .sum { margin-top: 6px; margin-left: auto; width: 65%; }
  .sum td { border: none; padding: 5px 8px; }
  .sum tr:last-child td { font-weight: 800; font-size: 15px; }
  .account { margin-top: 14px; border: 1.5px dashed; border-radius: 8px; padding: 10px 12px; display: flex; justify-content: space-between; font-size: 14px; }
  .stamp { display: inline-block; margin-top: 16px; border: 2px solid; padding: 4px 14px; border-radius: 6px; font-weight: 800; transform: rotate(-4deg); }
  .foot { margin-top: 24px; text-align: center; color: #777; font-size: 12px; border-top: 1px solid #EEE; padding-top: 10px; }
</style></head><body>
  <div class="head">
    <div><div class="shop">${esc(shop.shop_name)}</div><div class="meta">${shopMeta}</div></div>
    <div class="doc"><div class="title">${esc(heading)}</div><div class="meta">${docMeta}</div></div>
  </div>
  <div class="to"><div class="label">ग्राहक</div><div class="name">${esc(customer.name)}</div>${customer.phone ? `<div class="meta">${esc(formatPhone(customer.phone))}</div>` : ""}</div>
  ${body}
  <div class="foot">धन्यवाद, फिर पधारें 🙏</div>
</body></html>`;
}

// APKs built before expo-print was added still receive this code over OTA; importing expo-print there would crash.
export const pdfSupported = Platform.OS === "web" || requireOptionalNativeModule("ExpoPrint") != null;

export async function sharePdf(doc: ShareDoc) {
  if (Platform.OS === "web") {
    const w = window.open("", "_blank");
    if (!w) throw new Error("popup blocked");
    w.document.write(doc.html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
    return;
  }
  const Print: typeof import("expo-print") = require("expo-print");
  const { uri } = await Print.printToFileAsync({ html: doc.html });
  const named = new File(Paths.cache, doc.fileName);
  if (named.exists) named.delete();
  new File(uri).move(named);
  await Sharing.shareAsync(named.uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf", dialogTitle: `${doc.heading} भेजें` });
}
