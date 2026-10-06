import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo";
import * as Sharing from "expo-sharing";
import { File, Paths } from "expo-file-system";
import { itemsOf, type Customer, type Entry, type AepsTxn, type Job } from "@/src/lib/data";
import type { Ledger, WorkStatus } from "@/src/lib/records";
import { formatDate, formatDateShort, formatINR, formatPhone, localDay, roundMoney, todayISO } from "@/src/lib/format";
import { jobStart } from "@/src/lib/records";
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

/**
 * Who the slip is from. `contact` decides the book, not the mode the app is in: a shop customer's slip always
 * carries the shop, a personal contact's carries the owner's own name and none of the shop's GST / address / logo.
 */
const fullShop = (s: Partial<ShopProfile> & { name?: string; persona?: string }, contact?: Pick<Customer, "persona"> | "business"): ShopProfile => {
  const book = contact === undefined ? s.persona : contact === "business" ? "business" : contact.persona === "personal" ? "personal" : "business";
  const personal = book === "personal";
  return {
    shop_name: accountName({ ...s, persona: book }) || "बही खाता",
    shop_phone: s.shop_phone || "",
    shop_address: personal ? "" : s.shop_address || "",
    shop_gst: personal ? "" : s.shop_gst || "",
    shop_upi: s.shop_upi || "",
    shop_logo: personal ? "" : s.shop_logo || "",
    shop_signature: s.shop_signature || "",
  };
};

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
 * Day the work was handed to the shop: its job card's day, or an advance taken before that; a walk-in
 * job is booked and finished the same day.
 */
function bookedOn(entry: Entry, ctx: { jobs?: Job[]; entries?: Entry[] }): string {
  const job = ctx.jobs?.find((j) => j.entryId === entry.id);
  let day = (job && localDay(job.createdAt)) || entry.date;
  for (const p of ctx.entries ?? []) {
    if (p.type === "payment" && (p.linkId === entry.id || (!!job && p.linkId === job.id)) && p.date < day) day = p.date;
  }
  return day < entry.date ? day : entry.date;
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
  const shop = fullShop(shopIn, customer);
  const lines: Line[] = [];
  const purchase = entry.type === "purchase";
  const given = entry.type === "given";
  const fallback = entry.type === "payment" ? "भुगतान" : given ? "पैसे दिए" : purchase ? "सामान / सेवा" : "काम";
  let items = itemsOf(entry, fallback);
  let itemDue = 0;
  let itemBalance = 0;
  let heading = entry.type === "work" ? "बिल" : "रसीद";
  const personal = customer.persona === "personal";
  const rows: CardRow[] = [personRow(customer, personal ? "नाम" : isCustomer ? "Customer Name" : "नाम")];
  let titleHi = heading;
  let titleEn = "RECEIPT";
  let seal: { text: string; color: string };
  let advanceBanner: Banner | undefined;
  /** Work and job advances: when the job was given, and when it was finished (null = still in progress). */
  let dates: { booked: string; done: string | null } | null = null;
  // "1 अक्टूबर 2026 – 6 अक्टूबर 2026": the day it was given, then the day it was finished.
  const dateText = () =>
    !dates ? "" : dates.done === dates.booked ? formatDate(dates.booked) : `${formatDate(dates.booked)} – ${dates.done ? formatDate(dates.done) : "प्रगति पर"}`;
  const dateRows = (): CardRow[] => (dates ? [{ icon: "cal", tint: DUE, label: "तारीख", value: dateText() }] : []);

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
      dates = { booked: jobStart(job, ctx.entries ?? []), done: null };
      rows.push(itemsRow(items, "कार्य विवरण", ""), ...dateRows());
      if (est > 0) rows.push({ icon: "rupee", tint: DUE, label: "तय राशि", value: formatINR(est) });
      if (before > 0) rows.push({ icon: "paid", tint: OK, label: "पहले एडवांस", value: formatINR(before), tone: "ok" });
      rows.push({ icon: "paid", tint: OK, label: "एडवांस राशि", value: formatINR(entry.amount), tone: "ok" }, { icon: "card", tint: BLUE, label: "Payment Mode", value: payMode(entry.mode) });
      if (est > 0) rows.push({ icon: "scale", tint: AMBER, label: "बकाया", value: formatINR(itemDue), tone: itemDue > 0 ? "due" : "ok" });
      titleHi = "एडवांस रसीद";
      titleEn = "ADVANCE RECEIPT";
      advanceBanner = { color: INFO, bg: "#E8F1FD", icon: "check", title: "एडवांस प्राप्त हुआ", sub: itemDue > 0 ? `काम पूरा होने पर बाकी ${formatINR(itemDue)}` : "धन्यवाद 🙏" };
    } else {
      lines.push({ label, value: formatINR(entry.amount), tone: "ok" });
      const about = work?.description || (entry.description && entry.description !== "भुगतान" ? entry.description : "");
      if (about) rows.push({ icon: "doc", tint: OK, label: work ? "किस काम का" : "विवरण", value: about, sub: entry.notes.trim() });
      rows.push({ icon: "paid", tint: OK, label: early ? "एडवांस राशि" : "भुगतान राशि", value: formatINR(entry.amount), tone: "ok" }, { icon: "card", tint: BLUE, label: "Payment Mode", value: payMode(entry.mode) });
      titleHi = early ? "एडवांस रसीद" : "भुगतान रसीद";
      titleEn = early ? "ADVANCE RECEIPT" : "PAYMENT RECEIPT";
    }
    seal = early ? { text: "ADVANCE", color: INFO } : { text: "RECEIVED", color: OK };
  } else if (entry.type === "work") {
    itemDue = status?.remaining ?? Math.max(0, entry.amount - (entry.paid ?? 0));
    const parts = workParts(entry, status);
    lines.push({ label: "कुल", value: formatINR(entry.amount) }, ...parts);
    if (itemDue > 0) lines.push({ label: TERMS.docDueShort, value: formatINR(itemDue), tone: "due" });
    itemBalance = itemDue;
    dates = { booked: bookedOn(entry, ctx), done: entry.date };
    rows.push(
      itemsRow(items, "कार्य विवरण", entry.notes),
      ...dateRows(),
      { icon: "rupee", tint: DUE, label: "तय राशि", value: formatINR(entry.amount) },
      { icon: "paid", tint: OK, label: "भुगतान की गई राशि", value: formatINR(roundMoney(entry.amount - itemDue)), tone: "ok", list: parts.length > 1 ? parts.map((p) => `${p.label} — ${p.value}`) : undefined },
      ...(parts.length === 1 ? [{ icon: "card" as IconKey, tint: BLUE, label: "Payment Mode", value: modeOf(parts[0].label) }] : []),
      { icon: "scale", tint: AMBER, label: "बकाया", value: formatINR(itemDue), tone: itemDue > 0 ? "due" : "ok" },
    );
    titleHi = personal ? "बिल" : itemDue > 0 ? "ग्राहक बिल" : "ग्राहक भुगतान रसीद";
    titleEn = personal ? "BILL" : itemDue > 0 ? "CUSTOMER BILL" : "CUSTOMER PAYMENT RECEIPT";
    seal = itemDue > 0 ? { text: TERMS.docDueShort, color: DUE } : { text: "PAID", color: OK };
  } else {
    const received = status?.received ?? (purchase ? entry.paid ?? 0 : 0);
    itemDue = status?.remaining ?? Math.max(0, entry.amount - received);
    lines.push({ label: given ? "पैसे दिए" : "कुल", value: formatINR(entry.amount) });
    lines.push({ label: given ? "वापस मिले" : purchase ? "चुकाए" : "जमा", value: formatINR(received), tone: received > 0 ? "ok" : undefined });
    lines.push({ label: TERMS.docDueShort, value: formatINR(itemDue), tone: itemDue > 0 ? "due" : "ok" });
    seal = itemDue > 0 ? { text: TERMS.docDueShort, color: DUE } : { text: given ? "वापस मिले" : purchase ? "चुकता" : "PAID", color: OK };
    itemBalance = purchase ? -itemDue : itemDue;
    rows.push(itemsRow(items, "विवरण", entry.notes), ...lines.map((l): CardRow => ({ icon: l.tone === "due" || l.label === TERMS.docDueShort ? "scale" : "rupee", tint: l.tone === "due" ? AMBER : BLUE, label: l.label, value: l.value, tone: l.tone })));
  }
  // The whole-account box only adds something when other rows change the picture.
  const account = (entry.type === "payment" && !itemBalance) || balance !== itemBalance ? accountLine(balance, isCustomer) : undefined;

  const no = entry.id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 6).toUpperCase();
  const title = heading === "एडवांस रसीद" ? items[0].title : entry.description || fallback;
  const many = items.length > 1;
  const upiDue = purchase || given ? 0 : itemDue > 0 ? itemDue : balance > 0 ? balance : 0;

  // Work: the day it was done, and the day it was fully paid (left out while money is still due).
  const slipDates = (): string[] => {
    if (entry.type === "work") {
      const paidOn = itemDue <= 0 && entry.amount > 0 ? status?.settledOn || entry.date : "";
      return [`📅 Work Done : ${formatDate(entry.date)}`, ...(paidOn ? [`✅ Payment : ${formatDate(paidOn)}`] : [])];
    }
    if (dates) return [`📅 Work Done : प्रगति पर`, `✅ Advance : ${formatDate(entry.date)}`];
    if (entry.type === "payment") return [`✅ Payment : ${formatDate(entry.date)}`];
    return [`📅 ${formatDate(entry.date)}`];
  };
  const message = [
    `*${shop.shop_name}*`,
    ...slipDates(),
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

  if (account) rows.push({ icon: "scale", tint: AMBER, label: account.label, value: account.value, tone: account.tone });
  const prefs = getPrefs();
  const facing = isCustomer && !personal && !purchase && !given;
  const banner = !facing
    ? undefined
    : advanceBanner ??
      (upiDue > 0
        ? {
            color: DUE,
            bg: "#FDECEC",
            icon: "alert" as IconKey,
            title: `बकाया ${formatINR(upiDue)}`,
            sub: prefs.dueNote.trim() || DUE_NOTE_DEFAULT,
            qr: shop.shop_upi ? qrSvg(upiLink(shop.shop_upi, shop.shop_name, upiDue, `Hisab ${customer.name}`), 70) : undefined,
          }
        : OK_BANNER(seal.text === "ADVANCE" ? "एडवांस प्राप्त हुआ" : "भुगतान सफलतापूर्वक प्राप्त हो गया है।", prefs.paidNote.trim() || PAID_NOTE_DEFAULT));
  const html = cardPage(
    shop,
    { titleHi, titleEn, noLabel: "रसीद संख्या", no, date: dates ? "" : formatDate(entry.date), rows, stamp: seal, banner, note: personal ? "" : prefs.receiptNote.trim() },
    personal,
  );

  return {
    heading,
    title,
    sub: `${customer.name} · ${formatDate(entry.date)}`,
    phone: customer.phone,
    lines,
    account,
    message,
    html,
    fileName: docFileName(customer.name, entry.type === "work" ? "Bill" : heading === "एडवांस रसीद" ? "Advance" : "Receipt", entry.date),
  };
}

/** Order number printed on a vendor work order: WO-YYMM- plus a short id, stable for the same row. */
export const workOrderNo = (e: Entry) => `WO-${e.date.slice(2, 4)}${e.date.slice(5, 7)}-${e.id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 4).toUpperCase()}`;

/** Work order / payment voucher for one vendor order: scope, promised date, advance, balance and terms. */
export function workOrderDoc(entry: Entry, status: WorkStatus | undefined, vendor: Customer, shopIn: Partial<ShopProfile>, entries: Entry[] = []): ShareDoc {
  const shop = fullShop(shopIn, vendor);
  const items = itemsOf(entry, "काम / सामान");
  const paid = status?.received ?? entry.paid ?? 0;
  const left = status?.remaining ?? Math.max(0, entry.amount - paid);
  const no = workOrderNo(entry);
  const delivered = entry.status === "delivered";
  const late = !delivered && !!entry.dueDate && entry.dueDate < todayISO();
  // An outsourced job (refId) is paid for work already done; an order paid up front is an advance.
  const job = !!entry.refId;
  const assigned = entry.assignedOn && entry.assignedOn <= entry.date ? entry.assignedOn : entry.date;
  const heading = job ? "VOUCHER" : "WORK ORDER";
  const jobRef = job ? `JOB-${entry.refId!.replace(/[^a-zA-Z0-9]/g, "").slice(0, 6).toUpperCase()}` : "";
  const state = left <= 0 ? "पूरा भुगतान" : job || delivered ? "भुगतान बाकी" : late ? "तारीख निकल गई" : "ऑर्डर दिया";

  // One line per payment with its day and mode, oldest first.
  const booked = status?.paidAtBooking ?? entry.paid ?? 0;
  const pays = [
    ...(booked > 0 ? [{ date: entry.date, mode: entry.mode, amount: booked, first: true }] : []),
    ...entries
      .filter((e) => e.type === "given" && e.linkId === entry.id)
      .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))
      .map((e) => ({ date: e.date, mode: e.mode, amount: e.amount, first: false })),
  ];
  const payments: Line[] = pays.map((p) => ({
    label: `${p.first && !job && !delivered ? "एडवांस" : "भुगतान"} · ${formatDate(p.date)} · ${payMode(p.mode)}`,
    value: formatINR(p.amount),
    tone: "ok" as Tone,
  }));
  const fromJama = status?.fromJama ?? 0;
  const lines: Line[] = [
    { label: job ? "तय भुगतान" : "तय रकम", value: formatINR(entry.amount) },
    ...payments,
    ...(fromJama > 0 ? [{ label: "पहले के एडवांस से", value: formatINR(fromJama), tone: "ok" as Tone }] : []),
    { label: TERMS.docDueShort, value: formatINR(left), tone: left > 0 ? "due" : "ok" },
  ];
  const terms = (entry.terms ?? "").trim();
  const many = items.length > 1;

  const message = [
    ...messageHead(shop),
    `*${heading}* · ${no}${jobRef ? ` · ${jobRef}` : ""}`,
    job && assigned !== entry.date
      ? `📅 सौंपा: ${formatDate(assigned)} · पूरा: ${formatDate(entry.date)}`
      : `📅 ${job ? "काम" : "तारीख"}: ${formatDate(assigned)}${entry.dueDate ? ` · कब तक: *${formatDate(entry.dueDate)}*` : ""}`,
    `Vendor: ${vendor.name}`,
    "",
    ...items.map((it, i) => `${many ? `${i + 1}. ` : ""}${it.title} — ${formatINR(it.amount)}`),
    "──────────",
    ...lines.map(lineText),
    ...(left <= 0 ? ["पूरा भुगतान ✓"] : !job && !delivered ? [`स्थिति: ${state}`] : []),
    ...(terms ? ["", "शर्तें:", terms] : []),
  ].join("\n");

  const rows: CardRow[] = [
    personRow(vendor, "Vendor Name"),
    { ...itemsRow(items, "कार्य विवरण", entry.notes), ...(jobRef ? { sub: [jobRef, entry.notes.trim()].filter(Boolean).join(" · ") } : {}) },
    { icon: "cal", tint: DUE, label: "Work Assign Date", value: formatDate(assigned) },
  ];
  if (job) rows.push({ icon: "cal", tint: BLUE, label: "कार्य पूर्ण तिथि", value: formatDate(entry.date) });
  else if (!delivered && entry.dueDate) rows.push({ icon: "cal", tint: BLUE, label: "कब तक", value: formatDate(entry.dueDate), tone: late ? "due" : undefined });
  if (pays.length === 1 && fromJama <= 0) {
    rows.push(
      { icon: "cal", tint: OK, label: pays[0].first && !job && !delivered ? "Advance Date" : "Payment Date", value: formatDate(pays[0].date) },
      { icon: "card", tint: BLUE, label: "Payment Mode", value: payMode(pays[0].mode) },
    );
  } else if (pays.length || fromJama > 0) {
    rows.push({ icon: "cal", tint: OK, label: "Payment Dates", value: `${pays.length + (fromJama > 0 ? 1 : 0)} भुगतान`, list: [...payments.map((p) => `${p.label.replace(/^(भुगतान|एडवांस) · /, "")} — ${p.value}`), ...(fromJama > 0 ? [`पहले के एडवांस से — ${formatINR(fromJama)}`] : [])] });
  }
  rows.push(
    { icon: "rupee", tint: "#7B4DD6", label: "तय राशि", value: formatINR(entry.amount) },
    { icon: "paid", tint: OK, label: "भुगतान की गई राशि", value: formatINR(roundMoney(entry.amount - left)), tone: "ok" },
    { icon: "scale", tint: AMBER, label: "बकाया", value: formatINR(left), tone: left > 0 ? "due" : "ok" },
  );
  const seal = left <= 0 ? { text: "FULLY PAID", color: OK } : job || delivered ? { text: "PENDING", color: AMBER } : late ? { text: "LATE", color: DUE } : { text: "ORDERED", color: INFO };
  const banner: Banner =
    left <= 0
      ? OK_BANNER("भुगतान सफलतापूर्वक पूर्ण हो गया है।", "आपकी सेवा और सहयोग के लिए धन्यवाद।")
      : job || delivered
        ? { color: AMBER, bg: "#FFF4E0", icon: "clock", title: `भुगतान बाकी ${formatINR(left)}`, sub: "जल्द भुगतान किया जाएगा।" }
        : { color: INFO, bg: "#E8F1FD", icon: "clock", title: "ऑर्डर दिया", sub: entry.dueDate ? `कब तक: ${formatDate(entry.dueDate)}` : "" };
  const html = cardPage(
    shop,
    {
      titleHi: job ? "Vendor Payment Voucher" : "Vendor Work Order",
      titleEn: job ? "PAYMENT CONFIRMATION RECEIPT" : "WORK ORDER",
      noLabel: job ? "Voucher No." : "Order No.",
      no,
      date: formatDate(pays.length ? pays[pays.length - 1].date : entry.date),
      rows,
      stamp: seal,
      banner,
      vendor: true,
      note: terms ? `शर्तें: ${terms}` : "",
    },
    false,
  );

  return {
    heading,
    title: entry.description || items[0]?.title || "Vendor ऑर्डर",
    sub: `${vendor.name} · ${no}${entry.dueDate ? ` · कब तक ${formatDate(entry.dueDate)}` : ""}`,
    phone: vendor.phone,
    lines,
    message,
    html,
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
  const shop = fullShop(shopIn, customer);
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
  const shop = fullShop(shopIn, customer);
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
  const signImg = shop.shop_signature && IMAGE_URI.test(shop.shop_signature) ? shop.shop_signature : "";
  const signBlock =
    personal || customer.id === OWN_BOOK
      ? ""
      : `<div class="signs">
    ${opts.counterSign ? `<div class="sign"><div class="signSpace"></div><div class="signLine">${esc(opts.counterSign)}</div></div>` : "<div></div>"}
    <div class="sign">${signImg ? `<img class="signImg" src="${signImg}" alt=""/>` : `<div class="signSpace"></div>`}<div class="signLine">अधिकृत हस्ताक्षर</div></div>
  </div>`;
  return `<!DOCTYPE html><html lang="hi"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<style>
  @page { size: ${size}; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: "Noto Sans Devanagari", Roboto, Arial, "Mangal", sans-serif; font-style: normal; color: #1A1A1A; margin: 0; font-size: 13px; }
  ${HEADER_CSS}
  .head { margin-top: 10px; padding: 8px 12px; border-radius: 10px; background: #EAF3FF; display: flex; justify-content: space-between; align-items: center; gap: 12px; }
  .head .title { font-size: 17px; font-weight: 800; color: ${NAVY}; letter-spacing: .5px; }
  .meta { color: #555; font-size: 11px; line-height: 1.5; margin-top: 2px; }
  .doc { text-align: right; }
  .doc .meta { margin-top: 0; }
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
  ${slipHeader(shop, personal)}
  <div class="head">
    <div class="title">${esc(heading)}</div>
    <div class="doc"><div class="meta">${docMeta}</div></div>
  </div>
  ${customer.id === OWN_BOOK ? `<div class="to"><div class="name">${esc(customer.name)}</div></div>` : `<div class="to"><div class="label">${esc(opts.toLabel ?? (customer.persona === "personal" ? "नाम" : "ग्राहक"))}</div><div class="name">${esc(customer.name)}</div>${customer.phone ? `<div class="meta">${esc(formatPhone(customer.phone))}</div>` : ""}</div>`}
  ${body}
  ${note ? `<div class="note">${esc(note)}</div>` : ""}
  ${signBlock}
  <div class="foot">${opts.foot ?? (customer.id === OWN_BOOK ? `बनाया: ${esc(formatDate(todayISO()))}` : personal ? "धन्यवाद 🙏" : "धन्यवाद, फिर पधारें 🙏")}</div>
</body></html>`;
}

// ---------- Card slip (customer receipt and vendor voucher) ----------

const NAVY = "#0D2B5E";
const BLUE = "#1E6FD9";
const AMBER = "#D98200";
const INFO = "#1565C0";

const ICONS = {
  user: `<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>`,
  doc: `<path d="M6 2h8l5 5v15H6z"/><path d="M14 2v5h5M9 12h7M9 16h7"/>`,
  rupee: `<text x="12" y="18" text-anchor="middle" font-size="17" font-weight="700" stroke="none" fill="currentColor">₹</text>`,
  paid: `<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>`,
  card: `<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h4"/>`,
  scale: `<path d="M12 4v16M7 20h10M5 7h14M5 7l-3 6h6zM19 7l-3 6h6z"/>`,
  cal: `<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>`,
  check: `<path d="M6 12.5l4 4 8-9"/>`,
  alert: `<path d="M12 6v8M12 18v.5"/>`,
  clock: `<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>`,
} as const;
type IconKey = keyof typeof ICONS;
const svgIcon = (k: IconKey, color: string, size = 16) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" color="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[k]}</svg>`;

type CardRow = { icon: IconKey; tint: string; label: string; value: string; sub?: string; tone?: Tone; list?: string[] };
type Banner = { color: string; bg: string; icon: IconKey; title: string; sub?: string; qr?: string };
type Card = {
  titleHi: string;
  titleEn: string;
  noLabel: string;
  no: string;
  date: string;
  rows: CardRow[];
  stamp: { text: string; color: string };
  banner?: Banner;
  /** Vendor voucher: banner and owner's signature side by side, no thank-you line. */
  vendor?: boolean;
  note?: string;
};

const cardRow = (r: CardRow) => `
  <div class="row">
    <div class="ic" style="background:${r.tint}1A">${svgIcon(r.icon, r.tint)}</div>
    <div class="lb">${esc(r.label)}</div>
    <div class="colon">:</div>
    <div class="val">
      <div class="v" style="color:${r.tone ? toneColor(r.tone) : "#111"}">${esc(r.value)}</div>
      ${r.sub ? `<div class="vs">${esc(r.sub)}</div>` : ""}
      ${r.list?.length ? r.list.map((l) => `<div class="li">${esc(l)}</div>`).join("") : ""}
    </div>
  </div>`;

const bannerHtml = (b: Banner) => `
  <div class="banner" style="background:${b.bg};border-color:${b.color}33">
    <div class="bIc" style="background:${b.color}">${svgIcon(b.icon, "#fff", 22)}</div>
    <div class="bTx"><div class="bT" style="color:${b.color}">${esc(b.title)}</div>${b.sub ? `<div class="bS">${esc(b.sub)}</div>` : ""}</div>
    ${b.qr ? `<div class="bQr">${b.qr}<div>UPI से भुगतान</div></div>` : ""}
  </div>`;

/** Shop header shared by every slip: logo, two-tone name, address line, tagline and services strip. */
function slipHeader(shop: ShopProfile, personal: boolean): string {
  const prefs = getPrefs();
  const logoSrc = shop.shop_logo || prefs.logo;
  const logo = !personal && IMAGE_URI.test(logoSrc) ? logoSrc : "";
  // "Nain Photostate & Online Center": the part after "&" / "और" is printed in the accent colour.
  const split = shop.shop_name.match(/^(.*?(?:&|और))\s+(.+)$/);
  const name = split ? `${esc(split[1])} <span style="color:${BLUE}">${esc(split[2])}</span>` : esc(shop.shop_name);
  const meta = [shop.shop_address, shop.shop_phone ? `Mob: ${formatPhone(shop.shop_phone)}` : "", shop.shop_gst && !personal && prefs.showGst ? `GSTIN: ${shop.shop_gst}` : ""]
    .filter(Boolean)
    .map(esc)
    .join(" &nbsp;|&nbsp; ");
  const tagline = personal ? "" : prefs.tagline.trim();
  const services = personal ? [] : prefs.services.split(/[,|]/).map((s) => s.trim()).filter(Boolean).slice(0, 6);
  return `
  <div class="sh">
    ${logo ? `<img class="shLogo" src="${logo}" alt=""/><div class="shBar"></div>` : ""}
    <div class="shMain"><div class="shName">${name}</div>${meta ? `<div class="shMeta">${meta}</div>` : ""}</div>
    ${tagline ? `<div class="shTag">${esc(tagline)}<svg width="90" height="8" viewBox="0 0 90 8"><path d="M2 6 C30 1 60 1 88 4" stroke="${OK}" stroke-width="2" fill="none" stroke-linecap="round"/></svg></div>` : ""}
  </div>
  ${services.length ? `<div class="svc">${services.map((s) => `<span><i></i>${esc(s)}</span>`).join("")}</div>` : ""}`;
}

const HEADER_CSS = `
  .sh { display: flex; align-items: center; gap: 10px; }
  .shLogo { width: 58px; height: 58px; object-fit: contain; border-radius: 10px; }
  .shBar { width: 2px; align-self: stretch; background: ${NAVY}; opacity: .6; }
  .shMain { flex: 1; min-width: 0; }
  .shName { font-size: 21px; font-weight: 800; color: ${NAVY}; line-height: 1.15; }
  .shMeta { font-size: 10.5px; color: #333; margin-top: 3px; }
  .shTag { font-size: 11px; font-weight: 700; font-style: italic; color: ${NAVY}; text-align: right; max-width: 120px; line-height: 1.3; }
  .shTag svg { display: block; margin-left: auto; }
  .svc { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 0; margin-top: 8px; padding: 5px 0; border-top: 1px solid #E3E9F2; border-bottom: 1px solid #E3E9F2; font-size: 10.5px; color: #222; }
  .svc span { display: flex; align-items: center; gap: 4px; padding: 0 6px; }
  .svc span + span { border-left: 1px solid #C9D4E5; }
  .svc i { width: 6px; height: 6px; border-radius: 50%; background: ${BLUE}; display: inline-block; }`;

const BAND_ICON = `<svg width="46" height="46" viewBox="0 0 48 48" fill="none">
  <rect x="5" y="4" width="28" height="36" rx="4" stroke="${BLUE}" stroke-width="2.5"/>
  <path d="M11 13h16M11 19h16M11 25h9" stroke="${BLUE}" stroke-width="2.5" stroke-linecap="round"/>
  <circle cx="33" cy="33" r="11" fill="${BLUE}"/>
  <text x="33" y="38.5" text-anchor="middle" font-size="15" font-weight="700" fill="#fff">₹</text>
</svg>`;

function cardPage(shop: ShopProfile, card: Card, personal: boolean): string {
  const signImg = shop.shop_signature && IMAGE_URI.test(shop.shop_signature) ? shop.shop_signature : "";
  const signArt = signImg ? `<img class="signImg" src="${signImg}" alt=""/>` : `<div class="signSpace"></div>`;
  const tagline = personal ? "" : getPrefs().tagline.trim();
  const stampSize = card.stamp.text.length > 8 ? 14 : card.stamp.text.length > 6 ? 17 : 24;
  const foot = card.vendor
    ? `<div class="vfoot">
        <div style="flex:1">${card.banner ? bannerHtml(card.banner) : ""}</div>
        <div class="vsign">${signArt}<div class="signLine"><b>Owner Signature</b></div><div class="vsMeta">${esc(shop.shop_name)}${shop.shop_address ? `<br/>${esc(shop.shop_address)}` : ""}</div></div>
      </div>
      ${card.note ? `<div class="cnote" style="text-align:left">${esc(card.note)}</div>` : ""}`
    : `${card.banner ? bannerHtml(card.banner) : ""}
      ${card.note ? `<div class="cnote">${esc(card.note)}</div>` : ""}
      <div class="cfoot">
        <div class="thanks"><div class="ty">Thank You!</div>${tagline ? `<div class="tl">${esc(tagline)}</div>` : ""}</div>
        ${personal ? "" : `<div class="csign">${signArt}<div class="signLine">अधिकृत हस्ताक्षर</div></div>`}
      </div>`;
  return `<!DOCTYPE html><html lang="hi"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<style>
  @page { size: A5; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body { font-family: "Noto Sans Devanagari", Roboto, Arial, "Mangal", sans-serif; color: #111; font-size: 12.5px; position: relative; min-height: 205mm; padding: 9mm 9mm 12mm; overflow: hidden; }
  .wave { position: absolute; z-index: 0; }
  .wTop { top: 0; right: 0; }
  .wBot { bottom: 0; left: 0; }
  .wrap { position: relative; z-index: 1; }
  ${HEADER_CSS}
  .band { display: flex; align-items: center; gap: 12px; margin-top: 10px; padding: 10px 12px; border-radius: 12px; background: #EAF3FF; border: 1px solid #D3E4FA; }
  .bandT { flex: 1; border-left: 2px solid ${NAVY}33; padding-left: 12px; }
  .hi { font-size: 21px; font-weight: 800; color: ${NAVY}; line-height: 1.2; }
  .en { font-size: 9.5px; letter-spacing: 2.5px; color: #444; margin-top: 2px; }
  .bandNo { text-align: center; background: #DCEBFF; border-radius: 8px; padding: 5px 8px; min-width: 96px; }
  .noL { font-size: 9.5px; color: #333; }
  .noV { font-size: 11px; font-weight: 800; color: ${NAVY}; background: #fff; border-radius: 4px; padding: 2px 6px; margin-top: 2px; }
  .dt { display: flex; align-items: center; justify-content: center; gap: 4px; font-size: 10px; color: #333; margin-top: 4px; }
  .card { position: relative; margin-top: 10px; border: 1px solid #E6EAF0; border-radius: 12px; padding: 2px 12px; background: #fff; }
  .row { display: flex; align-items: center; gap: 10px; padding: 7px 0; border-bottom: 1px solid #EEF1F5; }
  .row:last-child { border-bottom: none; }
  .ic { width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .lb { width: 34%; font-weight: 700; color: ${NAVY}; }
  .colon { color: #666; }
  .val { flex: 1; min-width: 0; max-width: 58%; }
  .v { font-size: 14px; font-weight: 700; }
  .vs { font-size: 10.5px; color: #666; margin-top: 1px; }
  .li { font-size: 11.5px; color: #222; margin-top: 2px; }
  .seal { position: absolute; right: 12px; bottom: 14px; width: 124px; height: 124px; border: 4px solid; border-radius: 50%; transform: rotate(-14deg); display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,.55); opacity: .88; }
  .sealIn { width: 104px; height: 104px; border: 2px dashed; border-radius: 50%; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
  .sealIn b { font-weight: 900; letter-spacing: 1px; line-height: 1.1; }
  .sealIn span { font-size: 10px; letter-spacing: 3px; }
  .banner { display: flex; align-items: center; gap: 12px; margin-top: 10px; padding: 10px 12px; border-radius: 12px; border: 1px solid; }
  .bIc { width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .bTx { flex: 1; }
  .bT { font-size: 14px; font-weight: 800; }
  .bS { font-size: 11px; color: #333; margin-top: 2px; }
  .bQr { text-align: center; font-size: 9px; color: #333; line-height: 1.2; }
  .bQr svg { display: block; background: #fff; padding: 3px; border-radius: 4px; }
  .cnote { margin-top: 8px; font-size: 10.5px; color: #555; text-align: center; white-space: pre-line; }
  .cfoot { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin-top: 14px; }
  .thanks { flex: 1; text-align: center; }
  .ty { font-family: "Brush Script MT", "Segoe Script", cursive; font-style: italic; font-size: 30px; font-weight: 700; color: ${NAVY}; }
  .tl { font-size: 11px; color: #333; margin-top: 2px; }
  .csign { width: 38%; text-align: center; }
  .vfoot { display: flex; align-items: stretch; gap: 12px; margin-top: 10px; }
  .vfoot .banner { margin-top: 0; height: 100%; }
  .vsign { width: 38%; text-align: center; border-left: 1px solid #E3E9F2; padding-left: 10px; display: flex; flex-direction: column; justify-content: flex-end; }
  .vsMeta { font-size: 9.5px; color: #444; margin-top: 2px; }
  .signImg { max-width: 140px; max-height: 52px; object-fit: contain; display: block; margin: 0 auto 2px; }
  .signSpace { height: 38px; }
  .signLine { border-top: 1px solid #999; padding-top: 4px; font-size: 11px; color: #333; }
</style></head><body>
  <svg class="wave wTop" width="190" height="70" viewBox="0 0 190 70"><path d="M40 0 C90 40 140 5 190 38 V0Z" fill="#D6E7FF"/><path d="M100 0 C140 26 165 8 190 16 V0Z" fill="#B8EBC8"/></svg>
  <svg class="wave wBot" width="210" height="80" viewBox="0 0 210 80"><path d="M0 22 C50 55 120 30 210 80 H0Z" fill="#D6E7FF"/><path d="M0 48 C40 70 90 58 140 80 H0Z" fill="#B8EBC8"/></svg>
  <div class="wrap">
    ${slipHeader(shop, personal)}
    <div class="band">
      ${BAND_ICON}
      <div class="bandT"><div class="hi">${esc(card.titleHi)}</div><div class="en">${esc(card.titleEn)}</div></div>
      <div class="bandNo"><div class="noL">${esc(card.noLabel)}</div><div class="noV">${esc(card.no)}</div>${card.date ? `<div class="dt">${svgIcon("cal", BLUE, 12)}${esc(card.date)}</div>` : ""}</div>
    </div>
    <div class="card">
      <div class="seal" style="color:${card.stamp.color};border-color:${card.stamp.color}"><div class="sealIn" style="border-color:${card.stamp.color}"><span>★ ★ ★</span><b style="font-size:${stampSize}px">${esc(card.stamp.text)}</b><span>★ ★</span></div></div>
      ${card.rows.map(cardRow).join("")}
    </div>
    ${foot}
  </div>
</body></html>`;
}

/** Customer / contact line of a card: name with address or phone under it. */
const personRow = (c: Customer, label: string): CardRow => ({ icon: "user", tint: BLUE, label, value: c.name, sub: c.address?.trim() || (c.phone ? formatPhone(c.phone) : "") });

/** Work / goods line of a card: one item with its note, or every item with its amount. */
function itemsRow(items: { title: string; amount: number }[], label: string, note = ""): CardRow {
  if (items.length <= 1) return { icon: "doc", tint: OK, label, value: items[0]?.title ?? "", sub: note.trim() };
  return { icon: "doc", tint: OK, label, value: `${items.length} काम`, list: items.map((it) => `${it.title}${it.amount > 0 ? ` — ${formatINR(it.amount)}` : ""}`) };
}

/** "भुगतान (Cash)" → "Cash", "एडवांस (Online)" → "Online · एडवांस". */
const modeOf = (label: string) => {
  const m = label.match(/^(भुगतान|एडवांस) \((.+)\)$/);
  return m ? (m[1] === "एडवांस" ? `${m[2]} · एडवांस` : m[2]) : label;
};

const OK_BANNER = (title: string, sub: string): Banner => ({ color: OK, bg: "#EAF6EC", icon: "check", title, sub });

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
  const shop = fullShop(shopIn, "business");
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
