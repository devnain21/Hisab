import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo";
import * as Sharing from "expo-sharing";
import { File, Paths } from "expo-file-system";
import { itemsOf, type Customer, type Entry, type AepsTxn, type Job } from "@/src/lib/data";
import type { Ledger, WorkStatus } from "@/src/lib/records";
import { formatDate, formatDateShort, formatINR, formatPhone, roundMoney, todayISO } from "@/src/lib/format";
import type { ShopProfile } from "@/src/context/AuthContext";
import { AEPS_META, aepsBill, customerCharge, defaultVia, maskAccount, statusLabel, viaBill } from "@/src/lib/aeps";
import { accountName } from "@/src/lib/persona";
import { TERMS, docBalanceTerm } from "@/src/lib/terms";
import { DUE_NOTE_DEFAULT, PAID_NOTE_DEFAULT, getPrefs } from "@/src/lib/prefs";
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
  shop_logo: s.shop_logo || "",
  shop_signature: s.shop_signature || "",
});

/** Whole-account position, worded for a customer (advance) or a personal contact (we owe them). */
function accountLine(balance: number, isCustomer: boolean): Line {
  if (balance === 0) return { label: "खाता", value: TERMS.docSettled, tone: "ok" };
  return { label: `कुल ${docBalanceTerm(balance, isCustomer)}`, value: formatINR(Math.abs(balance)), tone: balance > 0 ? "due" : "ok" };
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

/** "Ramesh_Bill_09-08-2026.pdf": whose it is, what it is, and the day it is about. */
export function docFileName(name: string, kind: string, isoDate: string): string {
  const who = name.trim().replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, "_").slice(0, 40) || "Customer";
  const [y, m, d] = isoDate.split("-");
  return `${who}_${kind}_${d}-${m}-${y}.pdf`;
}

const payMode = (m?: string) => (m === "online" ? "Online" : "Cash");

/** Last lines of a shared slip text: the owner's note for money still due (with the UPI link), or the thank-you note. */
function shareFooter(shop: ShopProfile, due: number, customerName: string): string[] {
  const prefs = getPrefs();
  if (due > 0) return [prefs.dueNote.trim() || DUE_NOTE_DEFAULT, ...(shop.shop_upi ? [`UPI: ${upiLink(shop.shop_upi, shop.shop_name, due, `Hisab ${customerName}`)}`] : [])];
  return [prefs.paidNote.trim() || PAID_NOTE_DEFAULT];
}

/**
 * How the money on a work row came in, worded by when it came: on or after the work day it is a
 * भुगतान, before it (taken while booking the job) an एडवांस. Jama from earlier applied to it comes last.
 */
function workParts(entry: Entry, status: WorkStatus | undefined): Line[] {
  const parts = new Map<string, number>();
  let room = entry.amount;
  const take = (label: string, amt: number) => {
    const a = Math.min(amt, room);
    room -= a;
    if (a > 0.004) parts.set(label, (parts.get(label) ?? 0) + a);
  };
  for (const p of status?.settlements ?? []) if (p.date < entry.date) take(`एडवांस (${payMode(p.mode)})`, p.amount);
  take(`भुगतान (${payMode(entry.mode)})`, status?.paidAtBooking ?? Math.min(entry.paid ?? 0, entry.amount));
  for (const p of status?.settlements ?? []) if (p.date >= entry.date) take(`भुगतान (${payMode(p.mode)})`, p.amount);
  if ((status?.fromJama ?? 0) > 0.004) parts.set("पिछली जमा से", status!.fromJama);
  return [...parts].map(([label, amount]) => ({ label, value: formatINR(roundMoney(amount)), tone: "ok" as Tone }));
}

/**
 * Receipt for one ledger row. `balance` is the customer's whole-account balance
 * (positive = they owe us) so dues from other entries are shown too.
 * `ctx` lets a payment be worded as an एडवांस when it came before its work (or the job is still open).
 */
export function receiptDoc(
  entry: Entry,
  status: WorkStatus | undefined,
  customer: Customer,
  balance: number,
  isCustomer: boolean,
  shopIn: Partial<ShopProfile>,
  ctx: { jobs?: Job[]; entries?: Entry[] } = {},
): ShareDoc {
  const shop = fullShop(shopIn);
  const lines: Line[] = [];
  const purchase = entry.type === "purchase";
  const given = entry.type === "given";
  const fallback = entry.type === "payment" ? "भुगतान" : given ? "पैसे दिए" : purchase ? "सामान / सेवा" : "काम";
  let items = itemsOf(entry, fallback);
  let itemDue = 0;
  let itemBalance = 0;
  let stamp: { text: string; tone: Tone };
  let heading = entry.type === "work" ? "बिल" : "रसीद";

  if (entry.type === "payment") {
    const job = entry.linkId ? ctx.jobs?.find((j) => j.id === entry.linkId && j.status !== "done") : undefined;
    const work = entry.linkId && !job ? ctx.entries?.find((e) => e.id === entry.linkId && e.type === "work") : undefined;
    const early = !!job || (!!work && entry.date < work.date);
    const label = `${early ? "एडवांस" : "भुगतान"} (${payMode(entry.mode)})`;
    if (job) {
      // Advance on a job not done yet: show it against the job's estimate.
      const est = job.estimatedAmount > 0 ? job.estimatedAmount : 0;
      const before = (ctx.entries ?? []).filter((e) => e.type === "payment" && e.linkId === job.id && e.id !== entry.id && (e.date < entry.date || (e.date === entry.date && e.createdAt < entry.createdAt))).reduce((s, e) => s + e.amount, 0);
      items = [{ title: job.title, amount: est }];
      heading = "एडवांस रसीद";
      if (est > 0) lines.push({ label: "कुल", value: formatINR(est) });
      if (before > 0) lines.push({ label: "पहले एडवांस", value: formatINR(before), tone: "ok" });
      lines.push({ label, value: formatINR(entry.amount), tone: "ok" });
      itemDue = est > 0 ? Math.max(0, roundMoney(est - before - entry.amount)) : 0;
      if (itemDue > 0) lines.push({ label: TERMS.docDueShort, value: formatINR(itemDue), tone: "due" });
      itemBalance = itemDue;
    } else {
      lines.push({ label, value: formatINR(entry.amount), tone: "ok" });
    }
    stamp = { text: early ? "एडवांस मिला" : "भुगतान मिला", tone: "ok" };
  } else if (entry.type === "work") {
    itemDue = status?.remaining ?? Math.max(0, entry.amount - (entry.paid ?? 0));
    lines.push({ label: "कुल", value: formatINR(entry.amount) }, ...workParts(entry, status));
    if (itemDue > 0) lines.push({ label: TERMS.docDueShort, value: formatINR(itemDue), tone: "due" });
    stamp = itemDue > 0 ? { text: TERMS.docDueShort, tone: "due" } : { text: "पूरा भुगतान", tone: "ok" };
    itemBalance = itemDue;
  } else {
    const received = status?.received ?? (purchase ? entry.paid ?? 0 : 0);
    itemDue = status?.remaining ?? Math.max(0, entry.amount - received);
    lines.push({ label: given ? "पैसे दिए" : "कुल", value: formatINR(entry.amount) });
    lines.push({ label: given ? "वापस मिले" : purchase ? "चुकाए" : "जमा", value: formatINR(received), tone: received > 0 ? "ok" : undefined });
    lines.push({ label: TERMS.docDueShort, value: formatINR(itemDue), tone: itemDue > 0 ? "due" : "ok" });
    stamp = itemDue > 0 ? { text: TERMS.docDueShort, tone: "due" } : { text: given ? "वापस मिले" : purchase ? "चुकता" : "पूरा भुगतान", tone: "ok" };
    itemBalance = purchase ? -itemDue : itemDue;
  }
  // The whole-account box only adds something when other rows change the picture.
  const account = (entry.type === "payment" && !itemBalance) || balance !== itemBalance ? accountLine(balance, isCustomer) : undefined;

  const no = entry.id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 6).toUpperCase();
  const title = heading === "एडवांस रसीद" ? items[0].title : entry.description || fallback;
  const many = items.length > 1;
  const upiDue = purchase || given ? 0 : itemDue > 0 ? itemDue : balance > 0 ? balance : 0;

  const message = [
    `*${shop.shop_name}*`,
    `📅 ${formatDate(entry.date)}`,
    "",
    `*${customer.name}*`,
    ...items.map((it, i) => `${many ? `${i + 1}. ` : ""}${it.title}${it.amount > 0 ? ` — ${formatINR(it.amount)}` : ""}`),
    "──────────",
    ...lines.map(lineText),
    ...(itemDue <= 0 && entry.type === "work" ? ["पूरा भुगतान ✓"] : []),
    ...(account ? ["", `*${account.label}: ${account.value}*`] : []),
    "",
    ...(isCustomer && !purchase && !given ? shareFooter(shop, upiDue, customer.name) : ["धन्यवाद 🙏"]),
  ].join("\n");

  const body = `
  <table class="items">
    <tr><th class="no">क्र.</th><th>विवरण</th><th class="amt">रकम</th></tr>
    ${items.map((it, i) => `<tr class="item"><td class="no">${i + 1}</td><td>${esc(it.title)}</td><td class="amt">${it.amount > 0 ? esc(formatINR(it.amount)) : ""}</td></tr>`).join("")}
  </table>
  <table class="sum">${lines.map(sumRow).join("")}</table>
  ${account ? accountBox(account) : ""}
  ${upiQrHtml(shop, upiDue, customer.name)}
  <div class="stamp" style="border-color:${toneColor(stamp.tone)};color:${toneColor(stamp.tone)}">${esc(stamp.text)}</div>`;

  return {
    heading,
    title,
    sub: `${customer.name} · ${formatDate(entry.date)}`,
    phone: customer.phone,
    lines,
    account,
    message,
    html: page(shop, heading, `नं. ${esc(no)}<br/>${esc(formatDate(entry.date))}`, customer, body, "A5"),
    fileName: docFileName(customer.name, entry.type === "work" ? "Bill" : heading === "एडवांस रसीद" ? "Advance" : "Receipt", entry.date),
  };
}

/** Order number printed on a vendor work order: WO-YYMM- plus a short id, stable for the same row. */
export const workOrderNo = (e: Entry) => `WO-${e.date.slice(2, 4)}${e.date.slice(5, 7)}-${e.id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 4).toUpperCase()}`;

/** Work order / payment voucher for one vendor order: scope, promised date, advance, balance and terms. */
export function workOrderDoc(entry: Entry, status: WorkStatus | undefined, vendor: Customer, shopIn: Partial<ShopProfile>): ShareDoc {
  const shop = fullShop(shopIn);
  const items = itemsOf(entry, "काम / सामान");
  const paid = status?.received ?? entry.paid ?? 0;
  const left = status?.remaining ?? Math.max(0, entry.amount - paid);
  const advance = status?.paidAtBooking ?? entry.paid ?? 0;
  const no = workOrderNo(entry);
  const delivered = entry.status === "delivered";
  const late = !delivered && !!entry.dueDate && entry.dueDate < todayISO();
  const state = left <= 0 ? "पूरा भुगतान" : delivered ? "डिलीवर · भुगतान बाकी" : late ? "तारीख निकल गई" : "ऑर्डर दिया";
  const stampTone: Tone = left <= 0 ? "ok" : "due";
  // An outsourced job (refId) is paid for work already done; an order paid up front is an advance.
  const job = !!entry.refId;
  const heading = job ? "VOUCHER" : "WORK ORDER";
  const jobRef = job ? `JOB-${entry.refId!.replace(/[^a-zA-Z0-9]/g, "").slice(0, 6).toUpperCase()}` : "";

  const lines: Line[] = [
    { label: job ? "तय भुगतान" : "तय रकम", value: formatINR(entry.amount) },
    ...(advance > 0 ? [{ label: `${job ? "भुगतान" : "एडवांस"} (${payMode(entry.mode)})`, value: formatINR(advance), tone: "ok" as Tone }] : []),
    ...(paid - advance > 0 ? [{ label: "बाद में भुगतान", value: formatINR(paid - advance), tone: "ok" as Tone }] : []),
    { label: TERMS.docDueShort, value: formatINR(left), tone: left > 0 ? "due" : "ok" },
  ];
  const terms = (entry.terms ?? "").trim();
  const many = items.length > 1;

  const message = [
    ...messageHead(shop),
    `*${heading}* · ${no}${jobRef ? ` · ${jobRef}` : ""}`,
    `📅 ${formatDate(entry.date)}${entry.dueDate ? ` · कब तक: *${formatDate(entry.dueDate)}*` : ""}`,
    `Vendor: ${vendor.name}`,
    "",
    ...items.map((it, i) => `${many ? `${i + 1}. ` : ""}${it.title} — ${formatINR(it.amount)}`),
    "──────────",
    ...lines.map(lineText),
    `स्थिति: ${state}`,
    ...(terms ? ["", "शर्तें:", terms] : []),
  ].join("\n");

  const meta = [`नं. ${esc(no)}`, jobRef ? `काम: ${esc(jobRef)}` : "", `तारीख: ${esc(formatDate(entry.date))}`, entry.dueDate ? `<b>कब तक: ${esc(formatDate(entry.dueDate))}</b>` : ""].filter(Boolean).join("<br/>");
  const body = `
  <table class="items">
    <tr><th class="no">क्र.</th><th>काम / सामान</th><th class="amt">रकम</th></tr>
    ${items.map((it, i) => `<tr class="item"><td class="no">${i + 1}</td><td>${esc(it.title)}</td><td class="amt">${esc(formatINR(it.amount))}</td></tr>`).join("")}
  </table>
  <table class="sum">${lines.map(sumRow).join("")}</table>
  <div class="stamp" style="border-color:${toneColor(stampTone)};color:${toneColor(stampTone)}">${esc(state)}</div>
  ${terms ? `<div class="note"><b>शर्तें</b><br/>${esc(terms)}</div>` : ""}
  ${entry.notes ? `<div class="note">${esc(entry.notes)}</div>` : ""}`;

  return {
    heading,
    title: entry.description || items[0]?.title || "Vendor ऑर्डर",
    sub: `${vendor.name} · ${no}${entry.dueDate ? ` · कब तक ${formatDate(entry.dueDate)}` : ""}`,
    phone: vendor.phone,
    lines,
    message,
    html: page(shop, heading, meta, vendor, body, "A5", { toLabel: "Vendor / कारीगर", foot: "Generated with Hisab", hideNote: true, counterSign: vendor.name }),
    fileName: docFileName(vendor.name, job ? "Voucher" : "WorkOrder", entry.date),
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
  const signed = (b: number) => (b === 0 ? "₹0" : `${formatINR(Math.abs(b))} ${docBalanceTerm(b, isCustomer, true)}`);

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
      ? ["", "बकाया एंट्री:", ...open.map((e) => `• ${formatDateShort(e.date)} ${e.description || "पैसे दिए"} — ${formatINR(ledger.work.get(e.id)!.remaining)}`)]
      : []),
    ...(owed.length
      ? ["", "जिनके पैसे आपको मिलने हैं:", ...owed.map((e) => `• ${formatDateShort(e.date)} ${e.description || "सामान / सेवा"} — ${formatINR(ledger.work.get(e.id)!.remaining)}`)]
      : []),
    "",
    "धन्यवाद 🙏",
  ].join("\n");

  const balCell = (b: number) =>
    b > 0 ? `<span style="color:${DUE}">${esc(formatINR(b))}</span>` : b < 0 ? `<span style="color:${OK}">${esc(formatINR(-b))} ${esc(docBalanceTerm(b, isCustomer, true))}</span>` : "—";
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
    fileName: docFileName(customer.name, "Statement", today),
  };
}

/** The owner's own reminder text with {नाम} {रकम} {दुकान} filled in. */
export function fillReminder(template: string, name: string, amount: number, shopName: string): string {
  return template.replaceAll("{नाम}", name).replaceAll("{रकम}", formatINR(amount)).replaceAll("{दुकान}", shopName);
}

export function reminderDoc(
  customer: Customer,
  balance: number,
  shopIn: Partial<ShopProfile>,
): ShareDoc {
  const shop = fullShop(shopIn);
  const upiUrl = shop.shop_upi ? upiLink(shop.shop_upi, shop.shop_name, balance, `Hisab ${customer.name}`) : "";

  const lines: Line[] = [
    { label: `कुल ${TERMS.docDue}`, value: formatINR(balance), tone: "due" },
  ];

  const custom = getPrefs().reminderText.trim();
  const message = [
    ...(custom
      ? [fillReminder(custom, customer.name, balance, shop.shop_name)]
      : [
          `नमस्ते *${customer.name}* जी 🙏,`,
          `आशा है आप सकुशल हैं।`,
          "",
          `*${shop.shop_name}* की तरफ से आपका हिसाब विवरण:`,
          `💰 कुल ${TERMS.docDue}: *${formatINR(balance)}*`,
          "",
          `कृपया सुविधा अनुसार इसका भुगतान कर दें।`,
        ]),
    ...(shop.shop_upi ? ["", `📱 ऑनलाइन भुगतान के लिए UPI ID:\n*${shop.shop_upi}*`, `🔗 तुरंत पेमेंट लिंक:\n${upiUrl}`] : []),
    "",
    `धन्यवाद 🙏`,
    `— ${shop.shop_name}${shop.shop_phone ? ` (${formatPhone(shop.shop_phone)})` : ""}`,
  ].join("\n");

  const today = todayISO();
  const body = `
  <div style="margin:20px 0;padding:16px;background:#FDECEA;border:1.5px solid ${DUE};border-radius:8px;text-align:center;">
    <div style="font-size:13px;color:#777;">कुल ${TERMS.docDue}</div>
    <div style="font-size:26px;font-weight:800;color:${DUE};margin:6px 0;">${esc(formatINR(balance))}</div>
    <div style="font-size:12px;color:#555;">कृपया सुविधा अनुसार भुगतान करने का कष्ट करें।</div>
  </div>
  ${upiQrHtml(shop, balance, customer.name)}
  `;

  return {
    heading: "भुगतान रिमाइंडर",
    title: customer.persona === "personal" ? "पैसे की याद" : "भुगतान रिमाइंडर",
    sub: `${customer.name} · ${formatDate(today)}`,
    phone: customer.phone,
    lines,
    account: { label: `कुल ${TERMS.docDue}`, value: formatINR(balance), tone: "due" },
    message,
    html: page(shop, "भुगतान रिमाइंडर", esc(formatDate(today)), customer, body, "A5"),
    fileName: docFileName(customer.name, "Reminder", today),
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

/** `counterSign`: a second signature line on the left, e.g. the vendor's on a work order. */
type PageOpts = { toLabel?: string; foot?: string; hideNote?: boolean; counterSign?: string };

const IMAGE_URI = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

function page(shop: ShopProfile, heading: string, docMeta: string, customer: Customer, body: string, size: "A4" | "A5", opts: PageOpts = {}): string {
  const personal = customer.persona === "personal";
  const prefs = getPrefs();
  const note = !personal && customer.id !== OWN_BOOK && !opts.hideNote ? prefs.receiptNote.trim() : "";
  // The phone-only logo of older versions is used until the owner saves one to the server.
  const logoSrc = shop.shop_logo || prefs.logo;
  const logo = !personal && IMAGE_URI.test(logoSrc) ? logoSrc : "";
  const signImg = shop.shop_signature && IMAGE_URI.test(shop.shop_signature) ? shop.shop_signature : "";
  const signBlock =
    personal || customer.id === OWN_BOOK
      ? ""
      : `<div class="signs">
    ${opts.counterSign ? `<div class="sign"><div class="signSpace"></div><div class="signLine">${esc(opts.counterSign)}</div></div>` : "<div></div>"}
    <div class="sign">${signImg ? `<img class="signImg" src="${signImg}" alt=""/>` : `<div class="signSpace"></div>`}<div class="signLine">अधिकृत हस्ताक्षर</div></div>
  </div>`;
  const shopMeta = [shop.shop_address, shop.shop_phone ? `फ़ोन: ${formatPhone(shop.shop_phone)}` : "", shop.shop_gst && !personal && prefs.showGst ? `GSTIN: ${shop.shop_gst}` : ""]
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
  .brand { display: flex; align-items: center; gap: 10px; }
  .logo { width: 52px; height: 52px; object-fit: contain; border-radius: 8px; }
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
  .note { margin-top: 18px; padding: 8px 10px; background: #F7F7F7; border-radius: 6px; color: #444; font-size: 11px; white-space: pre-line; }
  .foot { margin-top: 24px; text-align: center; color: #777; font-size: 12px; border-top: 1px solid #EEE; padding-top: 10px; }
  .signs { display: flex; justify-content: space-between; align-items: flex-end; gap: 24px; margin-top: 28px; page-break-inside: avoid; }
  .sign { width: 42%; text-align: center; }
  .signImg { max-width: 140px; max-height: 56px; object-fit: contain; display: block; margin: 0 auto 2px; }
  .signSpace { height: 40px; }
  .signLine { border-top: 1px solid #999; padding-top: 4px; font-size: 11px; color: #555; }
</style></head><body>
  <div class="head">
    <div class="brand">${logo ? `<img class="logo" src="${logo}" alt=""/>` : ""}<div><div class="shop">${esc(shop.shop_name)}</div><div class="meta">${shopMeta}</div></div></div>
    <div class="doc"><div class="title">${esc(heading)}</div><div class="meta">${docMeta}</div></div>
  </div>
  ${customer.id === OWN_BOOK ? `<div class="to"><div class="name">${esc(customer.name)}</div></div>` : `<div class="to"><div class="label">${esc(opts.toLabel ?? (customer.persona === "personal" ? "नाम" : "ग्राहक"))}</div><div class="name">${esc(customer.name)}</div>${customer.phone ? `<div class="meta">${esc(formatPhone(customer.phone))}</div>` : ""}</div>`}
  ${body}
  ${note ? `<div class="note">${esc(note)}</div>` : ""}
  ${signBlock}
  <div class="foot">${opts.foot ?? (customer.id === OWN_BOOK ? `बनाया: ${esc(formatDate(todayISO()))}` : personal ? "धन्यवाद 🙏" : "धन्यवाद, फिर पधारें 🙏")}</div>
</body></html>`;
}

/** Marks a document about the owner's own books (no customer block, no thank-you line). */
const OWN_BOOK = "__own_book__";

export type RegisterRow = { date: string; title: string; sub: string; amount: number; inflow: boolean; after: number };

/** Galla / bank register for a period: opening, every movement with the running balance, closing. */
export function registerDoc(
  shopIn: Partial<ShopProfile>,
  pocketTitle: string,
  period: string,
  sums: { opening: number; ins: number; outs: number; closing: number },
  breakdown: Line[],
  rows: RegisterRow[],
): ShareDoc {
  const shop = fullShop(shopIn);
  const today = todayISO();
  const heading = `${pocketTitle} रजिस्टर`;
  const lines: Line[] = [
    { label: "शुरू में", value: formatINR(sums.opening) },
    { label: "आए (+)", value: formatINR(sums.ins), tone: "ok" },
    { label: "गए (−)", value: formatINR(sums.outs), tone: "due" },
  ];
  const account: Line = { label: "आख़िर में बचा", value: formatINR(sums.closing), tone: sums.closing < 0 ? "due" : "ok" };
  const message = [
    ...messageHead(shop),
    `*${heading}* · ${period}`,
    "",
    ...lines.map(lineText),
    `*${account.label}: ${account.value}*`,
    ...(breakdown.length ? ["", ...breakdown.map(lineText)] : []),
  ].join("\n");
  const body = `
  <table class="sum" style="width:100%;margin-left:0">${lines.map(sumRow).join("")}</table>
  ${accountBox(account)}
  ${breakdown.length ? `<h3 style="font-size:13px;margin:16px 0 6px">कहाँ से आए, कहाँ गए</h3><table class="sum" style="width:100%;margin-left:0">${breakdown.map(sumRow).join("")}</table>` : ""}
  <h3 style="font-size:13px;margin:16px 0 6px">सभी लेन-देन (${rows.length})</h3>
  <table class="ledger">
    <tr><th>तारीख</th><th>विवरण</th><th class="amt">आए</th><th class="amt">गए</th><th class="amt">बचा</th></tr>
    ${rows
      .map(
        (r) =>
          `<tr><td class="nowrap">${esc(formatDateShort(r.date))}</td><td>${esc(r.title)}${r.sub ? `<div class="sub">${esc(r.sub)}</div>` : ""}</td><td class="amt" style="color:${OK}">${r.inflow ? esc(formatINR(r.amount)) : ""}</td><td class="amt" style="color:${DUE}">${r.inflow ? "" : esc(formatINR(r.amount))}</td><td class="amt">${esc(formatINR(r.after))}</td></tr>`,
      )
      .join("")}
  </table>`;
  const owner: Customer = { id: OWN_BOOK, name: `${pocketTitle} · ${period}`, phone: "", address: "", notes: "", createdAt: today };
  return {
    heading,
    title: pocketTitle,
    sub: period,
    phone: "",
    lines,
    account,
    message,
    html: page(shop, heading, esc(period), owner, body, "A4"),
    fileName: `${fileSafe(pocketTitle)}-${today}.pdf`,
  };
}

export type ReportSection = { title: string; lines: Line[] };

/** Monthly business / personal summary: headline numbers, the result, then supporting lists. */
export function reportDoc(shopIn: Partial<ShopProfile>, heading: string, period: string, lines: Line[], account: Line, sections: ReportSection[]): ShareDoc {
  const shop = fullShop(shopIn);
  const today = todayISO();
  const shown = sections.filter((s) => s.lines.length > 0);
  const message = [
    ...messageHead(shop),
    `*${heading}* · ${period}`,
    "",
    ...lines.map(lineText),
    `*${account.label}: ${account.value}*`,
    ...shown.flatMap((s) => ["", `*${s.title}*`, ...s.lines.map(lineText)]),
  ].join("\n");
  const body = `
  <table class="sum" style="width:100%;margin-left:0">${lines.map(sumRow).join("")}</table>
  ${accountBox(account)}
  ${shown.map((s) => `<h3 style="font-size:13px;margin:16px 0 6px">${esc(s.title)}</h3><table class="sum" style="width:100%;margin-left:0">${s.lines.map(sumRow).join("")}</table>`).join("")}`;
  const owner: Customer = { id: OWN_BOOK, name: `${heading} · ${period}`, phone: "", address: "", notes: "", createdAt: today };
  return {
    heading,
    title: heading,
    sub: period,
    phone: "",
    lines,
    account,
    message,
    html: page(shop, heading, esc(period), owner, body, "A4"),
    fileName: `${fileSafe(heading)}-${fileSafe(period)}.pdf`,
  };
}

/** Counter service receipt: what was done, through which channel, and where the money stands. */
/** `kept`: money the customer left with the shop on this visit (khata jama), with its label. */
export function aepsReceiptDoc(t: AepsTxn, shopIn: Partial<ShopProfile>, kept = 0, keptLabel = ""): ShareDoc {
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
    if (bill.due > 0) summary.push({ label: "ग्राहक को देने बाकी", value: formatINR(bill.due), tone: "due" });
    else if (kept > 0) {
      summary.push({ label: "ग्राहक को नकद दिए", value: formatINR(Math.max(0, bill.total - kept)), tone: "ok" });
      summary.push({ label: keptLabel || "खाते में जमा", value: formatINR(kept) });
    } else summary.push({ label: "ग्राहक को नकद दिए", value: formatINR(bill.total), tone: "ok" });
  } else {
    if (bill.flow === "in") summary.push({ label: m.amountLabel.replace(" (₹)", ""), value: formatINR(t.amount) });
    if (charge > 0) summary.push({ label: "सेवा शुल्क", value: formatINR(charge) });
    if (summary.length > 1) summary.push({ label: "कुल", value: formatINR(bill.total) });
    else if (bill.flow === "none") summary.push({ label: "कुल", value: formatINR(bill.total) });
    summary.push({ label: "जमा", value: formatINR(bill.settled), tone: bill.settled > 0 ? "ok" : undefined });
    summary.push({ label: "बाकी", value: formatINR(bill.due), tone: bill.due > 0 ? "due" : "ok" });
    if (kept > 0) summary.push({ label: keptLabel || "ज़्यादा मिले (खाते में जमा)", value: formatINR(kept) });
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
    fileName: docFileName(name, "Receipt", t.date),
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
