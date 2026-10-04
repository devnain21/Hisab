import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo";
import * as Sharing from "expo-sharing";
import { File, Paths } from "expo-file-system";
import { itemsOf, type Customer, type Entry, type AepsTxn } from "@/src/lib/data";
import type { Ledger, WorkStatus } from "@/src/lib/records";
import { formatDate, formatDateShort, formatINR, formatPhone, todayISO } from "@/src/lib/format";
import type { ShopProfile } from "@/src/context/AuthContext";
import { AEPS_META, aepsBill, customerCharge, defaultVia, maskAccount, statusLabel, viaBill } from "@/src/lib/aeps";
import { accountName } from "@/src/lib/persona";
import { qrSvg, upiLink } from "@/src/lib/qr";

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

const fullShop = (s: Partial<ShopProfile> & { name?: string }): ShopProfile => ({
  shop_name: accountName(s) || "बही खाता",
  shop_phone: s.shop_phone || "",
  shop_address: s.shop_address || "",
  shop_gst: s.shop_gst || "",
  shop_upi: s.shop_upi || "",
});

/** Whole-account position, worded for a customer (advance) or a personal contact (we owe them). */
function accountLine(balance: number, isCustomer: boolean): Line {
  if (balance > 0) return { label: "कुल लेने हैं", value: formatINR(balance), tone: "due" };
  if (balance < 0) return { label: isCustomer ? "एडवांस" : "देने हैं", value: formatINR(-balance), tone: "ok" };
  return { label: "खाता", value: "पूरा क्लियर", tone: "ok" };
}

const fileSafe = (s: string) => s.replace(/[\\/:*?"<>|\s]+/g, "-").slice(0, 30) || "customer";

function upiQrHtml(shop: ShopProfile, amount: number, customerName: string): string {
  if (!shop.shop_upi || amount <= 0) return "";
  const upiUrl = upiLink(shop.shop_upi, shop.shop_name, amount, `Hisab ${customerName}`);
  return `
  <div style="margin-top:14px;padding:10px 12px;border:1.5px solid ${BRAND};border-radius:8px;display:flex;align-items:center;gap:14px;background:#F0FAF8;">
    <div style="flex-shrink:0;border:1px solid #CCC;border-radius:4px;line-height:0;">${qrSvg(upiUrl, 84)}</div>
    <div>
      <div style="font-weight:700;color:${BRAND};font-size:12px;">ऑनलाइन भुगतान के लिए स्कैन करें (${formatINR(amount)})</div>
      <div style="font-size:11px;color:#222;margin-top:2px;">UPI ID: <b>${esc(shop.shop_upi)}</b></div>
      <div style="font-size:10px;color:#666;margin-top:2px;">PhonePe, Google Pay, Paytm, BHIM</div>
    </div>
  </div>`;
}

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
  const purchase = entry.type === "purchase";
  const given = entry.type === "given";
  const fallback = entry.type === "payment" ? "भुगतान" : given ? "पैसे दिए" : purchase ? "सामान / सेवा" : "काम";
  const items = itemsOf(entry, fallback);
  let itemDue = 0;
  let stamp: { text: string; tone: Tone };

  if (entry.type === "payment") {
    lines.push({ label: "पैसे मिले", value: formatINR(entry.amount), tone: "ok" });
    stamp = { text: "पैसे मिले", tone: "ok" };
  } else {
    const received = status?.received ?? (entry.type === "work" || purchase ? entry.paid ?? 0 : 0);
    itemDue = status?.remaining ?? Math.max(0, entry.amount - received);
    lines.push({ label: given ? "पैसे दिए" : "कुल", value: formatINR(entry.amount) });
    lines.push({ label: given ? "वापस मिले" : purchase ? "चुकाए" : "जमा", value: formatINR(received), tone: received > 0 ? "ok" : undefined });
    lines.push({ label: purchase ? "देने बाकी" : "बाकी", value: formatINR(itemDue), tone: itemDue > 0 ? "due" : "ok" });
    stamp = itemDue > 0 ? { text: purchase ? "देने बाकी" : "बाकी", tone: "due" } : { text: given ? "वापस मिले" : purchase ? "चुकता" : "पूरा भुगतान", tone: "ok" };
  }
  // The whole-account box only adds something when other rows change the picture.
  const itemBalance = purchase ? -itemDue : itemDue;
  const account = entry.type === "payment" || balance !== itemBalance ? accountLine(balance, isCustomer) : undefined;

  const no = entry.id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 6).toUpperCase();
  const heading = entry.type === "work" ? "बिल" : "रसीद";
  const title = entry.description || fallback;
  const many = items.length > 1;

  const message = [
    ...messageHead(shop),
    `${heading} नं. ${no} · ${formatDate(entry.date)}`,
    `${customer.persona === "personal" ? "नाम" : "ग्राहक"}: ${customer.name}`,
    "",
    ...items.map((it, i) => `${many ? `${i + 1}. ` : ""}${it.title} — ${formatINR(it.amount)}`),
    "──────────",
    ...lines.map(lineText),
    ...(account ? ["", `*${account.label}: ${account.value}*`] : []),
    "",
    "धन्यवाद 🙏",
  ].join("\n");

  const upiDue = purchase ? 0 : itemDue > 0 ? itemDue : balance > 0 ? balance : 0;

  const body = `
  <table class="items">
    <tr><th class="no">क्र.</th><th>विवरण</th><th class="amt">रकम</th></tr>
    ${items.map((it, i) => `<tr class="item"><td class="no">${i + 1}</td><td>${esc(it.title)}</td><td class="amt">${esc(formatINR(it.amount))}</td></tr>`).join("")}
  </table>
  <table class="sum">${lines.map(sumRow).join("")}</table>
  ${account ? accountBox(account) : ""}
  ${upiQrHtml(shop, upiDue, customer.name)}
  <div class="stamp" style="border-color:${toneColor(stamp.tone)};color:${toneColor(stamp.tone)}">${esc(stamp.text)}</div>`;

  return {
    heading,
    title,
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
  range?: { from: string; to: string },
): ShareDoc {
  const shop = fullShop(shopIn);
  const sorted = [...entries].sort((a, b) => (a.date !== b.date ? a.date.localeCompare(b.date) : a.createdAt.localeCompare(b.createdAt)));
  // d raises what they owe, c lowers it. A purchase is goods they gave (c) less what we paid on the spot (d).
  const legs = (e: Entry) => ({
    d: e.type === "payment" ? 0 : e.type === "purchase" ? e.paid ?? 0 : e.amount,
    c: e.type === "work" ? e.paid ?? 0 : e.type === "payment" || e.type === "purchase" ? e.amount : 0,
  });
  const inRange = (e: Entry) => !range || (e.date >= range.from && e.date <= range.to);
  const opening = range ? sorted.filter((e) => e.date < range.from).reduce((s, e) => { const l = legs(e); return s + l.d - l.c; }, 0) : 0;
  let running = opening;
  let debit = 0;
  let credit = 0;
  const rows = sorted.filter(inRange).map((e) => {
    const { d, c } = legs(e);
    running += d - c;
    debit += d;
    credit += c;
    const base = e.description || (e.type === "payment" ? "पैसे मिले" : e.type === "given" ? "पैसे दिए" : e.type === "purchase" ? "सामान / सेवा" : e.type === "aeps" ? "काउंटर सेवा" : "काम");
    const text = e.type === "purchase" ? `सामान / सेवा ली: ${base}` : base;
    const parts = e.items && e.items.length > 1 ? e.items.map((i) => `${i.title} ${formatINR(i.amount)}`) : [];
    if (e.type === "purchase" && (e.paid ?? 0) > 0) parts.push(`उसी दिन चुकाए ${formatINR(e.paid ?? 0)}`);
    return { date: e.date, text, sub: parts.join(" · "), d, c, bal: running };
  });
  const closing = running;
  const balance = sorted.reduce((s, e) => { const l = legs(e); return s + l.d - l.c; }, 0);
  const account = accountLine(balance, isCustomer);
  const open = sorted.filter((e) => e.type !== "payment" && e.type !== "purchase" && (ledger.work.get(e.id)?.remaining ?? 0) > 0);
  const owed = sorted.filter((e) => e.type === "purchase" && (ledger.work.get(e.id)?.remaining ?? 0) > 0);
  const today = todayISO();
  const shown = sorted.filter(inRange);
  const period = range
    ? `${formatDate(range.from)} – ${formatDate(range.to)}`
    : shown.length
      ? `${formatDate(shown[0].date)} – ${formatDate(shown[shown.length - 1].date)}`
      : "";
  const debitLabel = isCustomer ? "कुल काम / दिए" : "कुल दिए";
  const creditLabel = isCustomer ? "कुल जमा" : "कुल मिले / सामान";
  const signed = (b: number) => (b > 0 ? `${formatINR(b)} लेने` : b < 0 ? `${formatINR(-b)} ${isCustomer ? "एडवांस" : "देने"}` : "₹0");

  const lines: Line[] = [
    ...(range ? [{ label: "पिछला हिसाब", value: signed(opening) }] : []),
    { label: `${debitLabel} (${rows.length} एंट्री)`, value: formatINR(debit) },
    { label: creditLabel, value: formatINR(credit), tone: "ok" as Tone },
    ...(range && range.to < today ? [{ label: `${formatDate(range.to)} तक`, value: signed(closing) }] : []),
  ];

  const message = [
    ...messageHead(shop),
    `*खाता विवरण* · ${formatDate(today)}`,
    `${customer.persona === "personal" ? "नाम" : "ग्राहक"}: ${customer.name}`,
    ...(period ? [`अवधि: ${period}`] : []),
    "",
    ...lines.map(lineText),
    `*${account.label}: ${account.value}*`,
    ...(open.length
      ? ["", "जिन पर लेने हैं:", ...open.map((e) => `• ${formatDateShort(e.date)} ${e.description || "पैसे दिए"} — ${formatINR(ledger.work.get(e.id)!.remaining)}`)]
      : []),
    ...(owed.length
      ? ["", "जिनके देने हैं:", ...owed.map((e) => `• ${formatDateShort(e.date)} ${e.description || "सामान / सेवा"} — ${formatINR(ledger.work.get(e.id)!.remaining)}`)]
      : []),
    "",
    "धन्यवाद 🙏",
  ].join("\n");

  const balCell = (b: number) =>
    b > 0 ? `<span style="color:${DUE}">${esc(formatINR(b))}</span>` : b < 0 ? `<span style="color:${OK}">${esc(formatINR(-b))} ${isCustomer ? "एडवांस" : "देने हैं"}</span>` : "—";
  const body = `
  ${period ? `<div class="meta" style="margin-bottom:8px">अवधि: ${esc(period)}</div>` : ""}
  <table class="ledger">
    <tr><th>तारीख</th><th>विवरण</th><th class="amt">${isCustomer ? "काम / दिए" : "दिए"}</th><th class="amt">${isCustomer ? "जमा" : "मिले / सामान"}</th><th class="amt">हिसाब</th></tr>
    ${range ? `<tr><td class="nowrap">${esc(formatDateShort(range.from))}</td><td><b>पिछला हिसाब</b></td><td class="amt"></td><td class="amt"></td><td class="amt">${balCell(opening)}</td></tr>` : ""}
    ${rows
      .map(
        (r) =>
          `<tr><td class="nowrap">${esc(formatDateShort(r.date))}</td><td>${esc(r.text)}${r.sub ? `<div class="sub">${esc(r.sub)}</div>` : ""}</td><td class="amt">${r.d ? esc(formatINR(r.d)) : ""}</td><td class="amt" style="color:${OK}">${r.c ? esc(formatINR(r.c)) : ""}</td><td class="amt">${balCell(r.bal)}</td></tr>`,
      )
      .join("")}
    <tr class="total"><td colspan="2">कुल</td><td class="amt">${esc(formatINR(debit))}</td><td class="amt" style="color:${OK}">${esc(formatINR(credit))}</td><td class="amt">${balCell(closing)}</td></tr>
  </table>
  ${accountBox(account)}
  ${upiQrHtml(shop, balance, customer.name)}`;

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

export function reminderDoc(
  customer: Customer,
  balance: number,
  shopIn: Partial<ShopProfile>,
): ShareDoc {
  const shop = fullShop(shopIn);
  const upiUrl = shop.shop_upi ? upiLink(shop.shop_upi, shop.shop_name, balance, `Hisab ${customer.name}`) : "";

  const lines: Line[] = [
    { label: "कुल बाकी रकम (लेने हैं)", value: formatINR(balance), tone: "due" },
  ];

  const message = [
    `नमस्ते *${customer.name}* जी 🙏,`,
    `आशा है आप सकुशल हैं।`,
    "",
    `*${shop.shop_name}* की तरफ से आपका हिसाब विवरण:`,
    `💰 कुल बाकी रकम: *${formatINR(balance)}*`,
    "",
    `कृपया सुविधा अनुसार इसका भुगतान कर दें।`,
    ...(shop.shop_upi ? ["", `📱 ऑनलाइन भुगतान के लिए UPI ID:\n*${shop.shop_upi}*`, `🔗 तुरंत पेमेंट लिंक:\n${upiUrl}`] : []),
    "",
    `धन्यवाद 🙏`,
    `— ${shop.shop_name}${shop.shop_phone ? ` (${formatPhone(shop.shop_phone)})` : ""}`,
  ].join("\n");

  const today = todayISO();
  const body = `
  <div style="margin:20px 0;padding:16px;background:#FDECEA;border:1.5px solid ${DUE};border-radius:8px;text-align:center;">
    <div style="font-size:13px;color:#777;">कुल बाकी रकम (लेने हैं)</div>
    <div style="font-size:26px;font-weight:800;color:${DUE};margin:6px 0;">${esc(formatINR(balance))}</div>
    <div style="font-size:12px;color:#555;">कृपया सुविधा अनुसार भुगतान करने का कष्ट करें।</div>
  </div>
  ${upiQrHtml(shop, balance, customer.name)}
  `;

  return {
    heading: "भुगतान रिमाइंडर",
    title: customer.persona === "personal" ? "पैसे की याद" : "उधारी तगादा",
    sub: `${customer.name} · ${formatDate(today)}`,
    phone: customer.phone,
    lines,
    account: { label: "कुल लेने हैं", value: formatINR(balance), tone: "due" },
    message,
    html: page(shop, "भुगतान रिमाइंडर", esc(formatDate(today)), customer, body, "A5"),
    fileName: `Reminder-${fileSafe(customer.name)}-${today}.pdf`,
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
  const personal = customer.persona === "personal";
  const shopMeta = [shop.shop_address, shop.shop_phone ? `फ़ोन: ${formatPhone(shop.shop_phone)}` : "", shop.shop_gst && !personal ? `GSTIN: ${shop.shop_gst}` : ""]
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
  th.no, td.no { width: 32px; text-align: center; color: #777; }
  .sub { color: #666; font-size: 11px; font-weight: 400; margin-top: 2px; }
  .sum tr:first-child td { border-top: 1.5px solid #CCC; }
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
  <div class="to"><div class="label">${customer.persona === "personal" ? "नाम" : "ग्राहक"}</div><div class="name">${esc(customer.name)}</div>${customer.phone ? `<div class="meta">${esc(formatPhone(customer.phone))}</div>` : ""}</div>
  ${body}
  <div class="foot">${personal ? "धन्यवाद 🙏" : "धन्यवाद, फिर पधारें 🙏"}</div>
</body></html>`;
}

/** Counter service receipt: what was done, through which channel, and where the money stands. */
export function aepsReceiptDoc(t: AepsTxn, shopIn: Partial<ShopProfile>): ShareDoc {
  const shop = fullShop(shopIn);
  const m = AEPS_META[t.type] ?? AEPS_META.other;
  const service = t.type === "other" && t.billerName ? t.billerName : m.label;
  const via = viaBill(t.via || defaultVia(t.type));
  const bill = aepsBill(t);
  const failed = t.status === "failed";
  const charge = customerCharge(t);
  const emi = t.via === "emi";

  const details: Line[] = [
    ...(t.bankName ? [{ label: "बैंक", value: t.bankName }] : []),
    ...(t.aadhaarLast4 ? [{ label: "आधार नंबर", value: `XXXX XXXX ${t.aadhaarLast4}` }] : []),
    ...(t.beneficiaryName ? [{ label: emi ? "लोन धारक" : t.type === "deposit" ? "खाताधारक" : "प्राप्तकर्ता", value: t.beneficiaryName }] : []),
    ...(t.accountNumber ? [{ label: "खाता नंबर", value: maskAccount(t.accountNumber) }] : []),
    ...(t.ifsc ? [{ label: "IFSC", value: t.ifsc }] : []),
    ...(t.upiId ? [{ label: t.type === "withdrawal" ? "ग्राहक UPI" : "UPI ID", value: t.upiId }] : []),
    ...(t.operator ? [{ label: "ऑपरेटर", value: t.operator }] : []),
    ...(t.rechargeNumber ? [{ label: "रिचार्ज नंबर", value: t.rechargeNumber }] : []),
    ...(t.billerName && t.type !== "other" ? [{ label: emi ? "लोन कंपनी" : "बिलर", value: t.billerName }] : []),
    ...(t.billAccount ? [{ label: emi ? "लोन खाता नं." : "उपभोक्ता नं.", value: t.billAccount }] : []),
    ...(t.reference ? [{ label: "Txn ID / RRN", value: t.reference }] : []),
    { label: "तारीख व समय", value: `${formatDate(t.date)}${t.time ? `, ${t.time}` : ""}` },
  ];

  const summary: Line[] = [];
  if (failed) {
    if (t.amount > 0) summary.push({ label: m.amountLabel.replace(" (₹)", ""), value: formatINR(t.amount) });
    summary.push({ label: "लेन-देन फेल", value: "कोई पैसा नहीं लिया", tone: "due" });
  } else if (bill.flow === "out") {
    summary.push({ label: m.amountLabel.replace(" (₹)", ""), value: formatINR(t.amount) });
    if (charge > 0) summary.push({ label: t.commissionMode === "cash" ? "सेवा शुल्क (कटौती)" : "सेवा शुल्क (ऑनलाइन)", value: t.commissionMode === "cash" ? `− ${formatINR(charge)}` : formatINR(charge) });
    summary.push(
      bill.due > 0
        ? { label: "ग्राहक को देने बाकी", value: formatINR(bill.due), tone: "due" }
        : { label: "ग्राहक को नकद दिए", value: formatINR(bill.total), tone: "ok" },
    );
  } else {
    if (bill.flow === "in") summary.push({ label: m.amountLabel.replace(" (₹)", ""), value: formatINR(t.amount) });
    if (charge > 0) summary.push({ label: "सेवा शुल्क", value: formatINR(charge) });
    if (summary.length > 1) summary.push({ label: "कुल", value: formatINR(bill.total) });
    else if (bill.flow === "none") summary.push({ label: "कुल", value: formatINR(bill.total) });
    summary.push({ label: "जमा", value: formatINR(bill.settled), tone: bill.settled > 0 ? "ok" : undefined });
    summary.push({ label: "बाकी", value: formatINR(bill.due), tone: bill.due > 0 ? "due" : "ok" });
  }

  const stamp: { text: string; color: string } = failed
    ? { text: "FAILED", color: DUE }
    : t.status === "pending"
      ? { text: statusLabel(t).toUpperCase(), color: "#B45309" }
      : bill.due > 0 && bill.flow !== "out"
        ? { text: `बाकी ${formatINR(bill.due)}`, color: DUE }
        : { text: "SUCCESS", color: OK };

  const no = t.id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 6).toUpperCase();
  const heading = "रसीद";
  const title = `${service}${t.amount > 0 ? ` · ${formatINR(t.amount)}` : ""}`;
  const name = t.customerName || "ग्राहक";

  const message = [
    ...messageHead(shop),
    `🧾 *${service}*${via ? ` · via ${via}` : ""}`,
    `रसीद नं. ${no} · ${formatDate(t.date)}${t.time ? `, ${t.time}` : ""}`,
    `ग्राहक: ${name}`,
    "",
    ...details.filter((d) => d.label !== "तारीख व समय").map(lineText),
    "──────────",
    ...summary.map(lineText),
    `स्थिति: *${failed ? "फेल" : t.status === "pending" ? statusLabel(t) : "सफल"}*`,
    "",
    "धन्यवाद 🙏",
  ].join("\n");

  const big = bill.flow === "none" ? bill.total : t.amount;
  const body = `
  <div style="border:1.5px solid ${m.color};border-radius:10px;overflow:hidden;margin-bottom:14px;">
    <div style="background:${m.color};color:#FFF;padding:10px 14px;display:flex;justify-content:space-between;align-items:center;gap:10px;">
      <div>
        <div style="font-size:17px;font-weight:800;letter-spacing:0.5px;">${esc(service)}</div>
        ${via ? `<div style="font-size:11px;opacity:0.9;margin-top:2px;">via ${esc(via)}</div>` : ""}
      </div>
      ${big > 0 ? `<div style="font-size:24px;font-weight:800;white-space:nowrap;">${esc(formatINR(big))}</div>` : ""}
    </div>
    <table>
      ${details.map((d) => `<tr><td style="color:#666;width:40%;">${esc(d.label)}</td><td style="font-weight:600;">${esc(d.value)}</td></tr>`).join("")}
    </table>
  </div>
  <table class="sum">${summary.map(sumRow).join("")}</table>
  <div class="stamp" style="border-color:${stamp.color};color:${stamp.color}">${esc(stamp.text)}</div>`;

  const customer: Customer = { id: "", name, phone: t.mobile || "", address: "", notes: "", createdAt: t.createdAt };

  return {
    heading,
    title,
    sub: `${name} · ${formatDate(t.date)} · नं. ${no}`,
    phone: t.mobile || "",
    lines: summary,
    message,
    html: page(shop, heading, `नं. ${esc(no)}<br/>${esc(formatDate(t.date))}`, customer, body, "A5"),
    fileName: `${m.short}-${no}-${fileSafe(name)}.pdf`,
  };
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
