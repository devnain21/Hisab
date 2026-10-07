import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo";
import * as Sharing from "expo-sharing";
import { File, Paths } from "expo-file-system";
import { itemsOf, type Customer, type Entry, type AepsTxn, type Job } from "@/src/lib/data";
import type { Ledger, WorkStatus } from "@/src/lib/records";
import { formatDate, formatDateShort, formatINR, formatPhone, localDay, roundMoney, todayISO } from "@/src/lib/format";
import { ADVANCE, buildLedger, jobStart, refundIds } from "@/src/lib/records";
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
 * Shop-wide running number for the month: B-2610-012 is the 12th bill of Oct 2026, R- a receipt. Counted from
 * every row of that kind, so it needs all entries; without them the row's own short id is used.
 */
function docNo(entry: Entry, all?: Entry[]): string {
  const short = entry.id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 6).toUpperCase();
  if (!all?.some((e) => e.id === entry.id)) return short;
  const kind = (e: Entry) => (e.type === "work" ? "B" : e.type === "payment" ? "R" : e.type === "given" ? "V" : "");
  const k = kind(entry);
  if (!k) return short;
  const month = entry.date.slice(0, 7);
  const before = (a: Entry, b: Entry) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
  const n = all.filter((e) => kind(e) === k && e.date.slice(0, 7) === month && before(e, entry) <= 0).length;
  return `${k}-${month.slice(2, 4)}${month.slice(5, 7)}-${String(n).padStart(3, "0")}`;
}

const sumOf = (rows: Entry[]) => roundMoney(rows.reduce((s, e) => s + e.amount, 0));
/** Same day, earlier typed: rows that came before `e` on the khata. */
const earlier = (x: Entry, e: Entry) => x.date < e.date || (x.date === e.date && x.createdAt < e.createdAt);

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
  // Paid out of the customer's own jama (a job's advance given back, or jama they asked for): a refund.
  const refund =
    given && isCustomer && !personal && !entry.linkId && (!!entry.refId || refundIds((ctx.entries ?? []).filter((e) => e.customerId === entry.customerId)).has(entry.id));
  const rows: CardRow[] = [personRow(customer, personal ? "नाम" : isCustomer ? "Customer Name" : "नाम")];
  let titleHi = heading;
  let titleEn = "RECEIPT";
  let seal: { text: string; color: string };
  let advanceBanner: Banner | undefined;
  /** Work and job advances: when the job was given, and when it was finished (null = still in progress). */
  let dates: { booked: string; done: string | null } | null = null;
  // The day the work was given, and the day it was finished (or still in progress).
  const doneText = () => (dates?.done ? formatDate(dates.done) : "प्रगति पर");
  const dateRows = (): CardRow[] =>
    dates
      ? [
          { icon: "cal", tint: DUE, label: "बुकिंग तारीख", value: formatDate(dates.booked) },
          { icon: dates.done ? "check" : "clock", tint: dates.done ? OK : AMBER, label: "पूरा होने की तारीख", value: doneText() },
        ]
      : [];
  const dateLines = (): string[] => (dates ? [`📅 बुकिंग : ${formatDate(dates.booked)}`, `${dates.done ? "✅" : "⏳"} पूरा : ${doneText()}`] : []);
  /** Payment that came before its work: an एडवांस everywhere on the slip, not "भुगतान". */
  let early = false;
  /** Open job's advance: by when the work will be ready. */
  let readyBy = "";
  /** Advance of a job called off or given back. */
  let cancelled: { title: string; sub: string } | null = null;

  if (entry.type === "payment") {
    const job = entry.linkId ? ctx.jobs?.find((j) => j.id === entry.linkId && j.status !== "done") : undefined;
    const work = entry.linkId && !job ? ctx.entries?.find((e) => e.id === entry.linkId && e.type === "work") : undefined;
    // Money taken with free work has no work row to link to; it is booked as a plain एडवांस.
    const looseAdvance = !job && !work && entry.description === ADVANCE;
    early = !!job || (!!work && entry.date < work.date) || looseAdvance;
    const label = `${early ? "एडवांस" : "भुगतान"} (${payMode(entry.mode)})`;
    if (job) {
      // Advance on a job not done yet: show it against the job's estimate.
      const est = job.estimatedAmount > 0 ? job.estimatedAmount : 0;
      const before = sumOf((ctx.entries ?? []).filter((e) => e.type === "payment" && e.linkId === job.id && e.id !== entry.id && earlier(e, entry)));
      const backBefore = sumOf((ctx.entries ?? []).filter((e) => e.type === "given" && e.refId === job.id && earlier(e, entry)));
      items = [{ title: job.title, amount: est }];
      heading = "एडवांस रसीद";
      if (est > 0) lines.push({ label: "कुल", value: formatINR(est) });
      if (before > 0) lines.push({ label: "पहले एडवांस", value: formatINR(before), tone: "ok" });
      if (backBefore > 0) lines.push({ label: "लौटाया", value: formatINR(backBefore) });
      lines.push({ label, value: formatINR(entry.amount), tone: "ok" });
      itemDue = est > 0 ? Math.max(0, roundMoney(est - before + backBefore - entry.amount)) : 0;
      if (itemDue > 0) lines.push({ label: TERMS.docDueShort, value: formatINR(itemDue), tone: "due" });
      itemBalance = itemDue;
      dates = { booked: jobStart(job, ctx.entries ?? []), done: null };
      rows.push(itemsRow(items, "कार्य विवरण", ""), ...dateRows());
      if (est > 0) rows.push({ icon: "rupee", tint: DUE, label: "तय राशि", value: formatINR(est) });
      if (before > 0) rows.push({ icon: "paid", tint: OK, label: "पहले एडवांस", value: formatINR(before), tone: "ok", sub: backBefore > 0 ? `${formatINR(backBefore)} लौटाया` : "" });
      rows.push({ icon: "paid", tint: OK, label: "एडवांस राशि", value: formatINR(entry.amount), tone: "ok" }, { icon: "card", tint: BLUE, label: "Payment Mode", value: payMode(entry.mode) });
      if (est > 0) rows.push({ icon: "scale", tint: AMBER, label: "बकाया", value: formatINR(itemDue), tone: itemDue > 0 ? "due" : "ok" });
      titleHi = "एडवांस रसीद";
      titleEn = "ADVANCE RECEIPT";
      readyBy = job.dueDate ? `काम ${formatDate(job.dueDate)} तक पूरा हो जाएगा` : "";
      advanceBanner = {
        color: INFO,
        bg: "#E8F1FD",
        icon: "check",
        title: "एडवांस प्राप्त हुआ",
        sub: [readyBy, itemDue > 0 ? `काम पूरा होने पर बाकी ${formatINR(itemDue)}` : "धन्यवाद 🙏"].filter(Boolean).join(" · "),
      };
    } else {
      lines.push({ label, value: formatINR(entry.amount), tone: "ok" });
      const about = work?.description || (looseAdvance ? entry.notes.trim() : entry.description && entry.description !== "भुगतान" ? entry.description : "");
      if (about) rows.push({ icon: "doc", tint: OK, label: work ? "किस काम का" : "विवरण", value: about, sub: looseAdvance ? "" : entry.notes.trim() });
      rows.push({ icon: "paid", tint: OK, label: early ? "एडवांस राशि" : "भुगतान राशि", value: formatINR(entry.amount), tone: "ok" }, { icon: "card", tint: BLUE, label: "Payment Mode", value: payMode(entry.mode) });
      titleHi = early ? "एडवांस रसीद" : "भुगतान रसीद";
      titleEn = early ? "ADVANCE RECEIPT" : "PAYMENT RECEIPT";
    }
    // An advance whose job was called off, or given back in part: what went back and what stays as jama.
    const jobId = !job && !work ? entry.linkId : undefined;
    const backRows = jobId ? (ctx.entries ?? []).filter((e) => e.type === "given" && e.refId === jobId) : [];
    if (backRows.length) {
      const jobCard = ctx.jobs?.find((j) => j.id === jobId);
      const taken = sumOf((ctx.entries ?? []).filter((e) => e.type === "payment" && e.linkId === jobId));
      const back = sumOf(backRows);
      const kept = jobCard ? 0 : Math.max(0, roundMoney(taken - back));
      const lastBack = backRows.reduce((d, e) => (e.date > d ? e.date : d), "");
      lines.push({ label: `लौटाया (${formatDate(lastBack)})`, value: formatINR(back) });
      if (kept > 0) lines.push({ label: "खाते में जमा", value: formatINR(kept), tone: "ok" });
      rows.push({ icon: "scale", tint: AMBER, label: "लौटाया", value: formatINR(back), sub: formatDate(lastBack) });
      if (kept > 0) rows.push({ icon: "paid", tint: OK, label: "खाते में जमा", value: formatINR(kept), tone: "ok" });
      cancelled = { title: jobCard ? "एडवांस लौटाया गया" : "काम रद्द — एडवांस लौटाया", sub: kept > 0 ? `बचे ${formatINR(kept)} आपके खाते में जमा हैं` : "" };
    }
    // An advance whose work is now finished is stamped by that work: paid in full, or still pending.
    const workLeft = early && work ? buildLedger((ctx.entries ?? []).filter((e) => e.customerId === work.customerId)).work.get(work.id)?.remaining ?? 0 : 0;
    seal = cancelled
      ? { text: ctx.jobs?.some((j) => j.id === jobId) ? "REFUNDED" : "CANCELLED", color: DUE }
      : early && work
        ? workLeft > 0 ? { text: "PENDING", color: AMBER } : { text: "PAID", color: OK }
        : early ? { text: "ADVANCE", color: INFO } : { text: "RECEIVED", color: OK };
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
    seal = itemDue > 0 ? { text: "PENDING", color: AMBER } : { text: "PAID", color: OK };
  } else if (refund) {
    // Money handed back to a customer out of what they had with us: a refund slip, not a loan.
    const jobCard = entry.refId ? ctx.jobs?.find((j) => j.id === entry.refId) : undefined;
    const what = jobCard?.title || entry.notes.replace(/ का एडवांस$/, "").trim();
    const taken = entry.refId ? sumOf((ctx.entries ?? []).filter((e) => e.type === "payment" && e.linkId === entry.refId)) : 0;
    const backAll = entry.refId ? sumOf((ctx.entries ?? []).filter((e) => e.type === "given" && e.refId === entry.refId)) : 0;
    const kept = entry.refId && !jobCard ? Math.max(0, roundMoney(taken - backAll)) : 0;
    const jobState = !entry.refId ? "" : !jobCard ? "रद्द" : jobCard.status === "done" ? "पूरा हुआ" : "चालू है";
    items = [{ title: what || (entry.refId ? "एडवांस" : "जमा राशि"), amount: entry.amount }];
    heading = "वापसी रसीद";
    if (taken > 0 && jobCard?.status !== "done") lines.push({ label: "लिया एडवांस", value: formatINR(taken) });
    lines.push({ label: `लौटाया (${payMode(entry.mode)})`, value: formatINR(entry.amount) });
    if (kept > 0) lines.push({ label: "खाते में जमा", value: formatINR(kept), tone: "ok" });
    rows.push(
      { icon: "doc", tint: OK, label: entry.refId ? "किस काम का" : "विवरण", value: items[0].title, sub: jobState ? `काम: ${jobState}` : entry.notes.trim() },
      ...(taken > 0 && jobCard?.status !== "done" ? [{ icon: "paid" as IconKey, tint: OK, label: "लिया एडवांस", value: formatINR(taken) }] : []),
      { icon: "rupee", tint: DUE, label: "लौटाई राशि", value: formatINR(entry.amount), tone: "due" },
      { icon: "card", tint: BLUE, label: "Payment Mode", value: payMode(entry.mode) },
      { icon: "cal", tint: BLUE, label: "लौटाने की तारीख", value: formatDate(entry.date) },
      ...(kept > 0 ? [{ icon: "scale" as IconKey, tint: OK, label: "खाते में जमा", value: formatINR(kept), tone: "ok" as Tone }] : []),
    );
    titleHi = entry.refId ? "एडवांस वापसी रसीद" : "जमा वापसी रसीद";
    titleEn = "REFUND RECEIPT";
    seal = { text: "REFUNDED", color: INFO };
    cancelled = {
      title: `${formatINR(entry.amount)} वापस किए गए`,
      sub: [jobState === "रद्द" ? "काम रद्द किया गया" : jobState ? `काम ${jobState}` : "", kept > 0 ? `बचे ${formatINR(kept)} खाते में जमा` : ""].filter(Boolean).join(" · "),
    };
    itemBalance = -kept;
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

  const no = docNo(entry, ctx.entries);
  const noLabel = entry.type === "work" ? "बिल नंबर" : "रसीद संख्या";
  const title = heading === "एडवांस रसीद" ? items[0].title : entry.description || fallback;
  const many = items.length > 1;
  const upiDue = purchase || given ? 0 : itemDue > 0 ? itemDue : balance > 0 ? balance : 0;

  // Same dates as the PDF: when the work was given – finished, then the day it was fully paid (left out while money is still due).
  const slipDates = (): string[] => {
    if (entry.type === "work") {
      const paidOn = itemDue <= 0 && entry.amount > 0 ? status?.settledOn || entry.date : "";
      return [...dateLines(), ...(paidOn ? [`💰 भुगतान : ${formatDate(paidOn)}`] : [])];
    }
    if (dates) return [...dateLines(), `💰 एडवांस : ${formatDate(entry.date)}`];
    if (entry.type === "payment") return [`✅ ${early ? "एडवांस" : "भुगतान"} : ${formatDate(entry.date)}`];
    if (refund) return [`↩️ लौटाया : ${formatDate(entry.date)}`];
    return [`📅 ${formatDate(entry.date)}`];
  };
  const message = [
    `*${shop.shop_name}*`,
    `🧾 ${titleHi} · ${noLabel}: ${no}`,
    ...slipDates(),
    "",
    `*${customer.name}*`,
    ...items.map((it, i) => `${many ? `${i + 1}. ` : ""}${it.title}${it.amount > 0 ? ` — ${formatINR(it.amount)}` : ""}`),
    "──────────",
    ...lines.map(lineText),
    ...(itemDue <= 0 && entry.type === "work" ? ["पूरा भुगतान ✓"] : []),
    ...(readyBy ? ["", `⏳ ${readyBy}`] : []),
    ...(cancelled ? ["", `*${cancelled.title}*`, ...(cancelled.sub ? [cancelled.sub] : [])] : []),
    ...(account ? ["", `*${account.label}: ${account.value}*`] : []),
    "",
    ...(isCustomer && !purchase && !given ? shareFooter(shop, upiDue, customer.name) : ["धन्यवाद 🙏"]),
  ].join("\n");

  if (account) rows.push({ icon: "scale", tint: AMBER, label: account.label, value: account.value, tone: account.tone });
  const prefs = getPrefs();
  const facing = isCustomer && !personal && !purchase && !given;
  const banner = cancelled && isCustomer && !personal
    ? { color: refund ? INFO : DUE, bg: refund ? "#E8F1FD" : "#FDECEC", icon: "check" as IconKey, title: cancelled.title, sub: cancelled.sub || "धन्यवाद 🙏" }
    : !facing
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
    {
      titleHi,
      titleEn,
      noLabel,
      no,
      date: dates ? "" : formatDate(entry.date),
      rows,
      stamp: seal,
      banner,
      note: personal ? "" : prefs.receiptNote.trim(),
      receiverSign: refund ? "प्राप्तकर्ता के हस्ताक्षर" : undefined,
    },
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
    fileName: docFileName(customer.name, entry.type === "work" ? "Bill" : refund ? "Refund" : heading === "एडवांस रसीद" ? "Advance" : "Receipt", entry.date),
  };
}

const DAY_MS = 86_400_000;
const daysSince = (iso: string) => Math.max(0, Math.round((Date.parse(todayISO()) - Date.parse(iso)) / DAY_MS));
/** Over a month old: printed in red. */
const OLD_DUE_DAYS = 30;

type OpenDue = { date: string; text: string; left: number; days: number };

/** Rows of this customer still unpaid (work, money given), oldest first, with how long they have been due. */
function openDues(entries: Entry[], ledger: Ledger = buildLedger(entries)): OpenDue[] {
  return entries
    .filter((e) => e.type !== "payment" && e.type !== "purchase" && (ledger.work.get(e.id)?.remaining ?? 0) > 0)
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))
    .map((e) => ({ date: e.date, text: e.description || (e.type === "given" ? "पैसे दिए" : "काम"), left: ledger.work.get(e.id)!.remaining, days: daysSince(e.date) }));
}

const sumLeft = (dues: OpenDue[]) => roundMoney(dues.reduce((s, d) => s + d.left, 0));
const dueLine = (d: OpenDue) => `• ${formatDateShort(d.date)} ${d.text} — ${formatINR(d.left)}${d.days > 0 ? ` (${d.days} दिन)` : ""}`;

function duesTable(dues: OpenDue[]): string {
  if (!dues.length) return "";
  return `
  <div style="margin-top:14px;font-weight:700;color:#333">बकाया एंट्री</div>
  <table class="ledger" style="margin-top:4px">
    <tr><th>तारीख</th><th>विवरण</th><th class="amt">कितने दिन</th><th class="amt">बाकी</th></tr>
    ${dues
      .map((d) => {
        const old = d.days > OLD_DUE_DAYS;
        return `<tr><td class="nowrap">${esc(formatDateShort(d.date))}</td><td>${esc(d.text)}</td><td class="amt" style="color:${old ? DUE : "#555"};font-weight:${old ? 700 : 400}">${d.days} दिन</td><td class="amt" style="color:${DUE}">${esc(formatINR(d.left))}</td></tr>`;
      })
      .join("")}
  </table>`;
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
  const open = openDues(sorted, ledger);
  const lastPay = [...sorted].reverse().find((e) => e.type === "payment" || (e.type === "work" && (e.paid ?? 0) > 0));
  const lastPaid = lastPay ? { date: lastPay.date, amount: lastPay.type === "payment" ? lastPay.amount : lastPay.paid ?? 0 } : null;
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
    ...(lastPaid && isCustomer ? [{ label: "आखिरी भुगतान", value: `${formatINR(lastPaid.amount)} · ${formatDate(lastPaid.date)}` }] : []),
  ];

  const message = [
    ...messageHead(shop),
    `*खाता विवरण* · ${formatDate(today)}`,
    `${customer.persona === "personal" ? "नाम" : "ग्राहक"}: ${customer.name}`,
    ...(period ? [`अवधि: ${period}`] : []),
    "",
    ...lines.map(lineText),
    `*${account.label}: ${account.value}*`,
    ...(open.length ? ["", "बकाया एंट्री:", ...open.map(dueLine)] : []),
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
  ${lastPaid && isCustomer ? `<div class="meta" style="margin-top:6px">आखिरी भुगतान: ${esc(formatINR(lastPaid.amount))} · ${esc(formatDate(lastPaid.date))}</div>` : ""}
  ${balance > 0 ? duesTable(open) : ""}
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

/** `entries`: the customer's own rows; when given, the slip lists what is still unpaid and since when. */
export function reminderDoc(
  customer: Customer,
  balance: number,
  shopIn: Partial<ShopProfile>,
  entries?: Entry[],
): ShareDoc {
  const shop = fullShop(shopIn, customer);
  const upiUrl = shop.shop_upi ? upiLink(shop.shop_upi, shop.shop_name, balance, `Hisab ${customer.name}`) : "";
  const own = entries?.filter((e) => e.customerId === customer.id) ?? [];
  // A long list reads like a ledger; the oldest few say enough, the rest is one line.
  const allDues = own.length ? openDues(own) : [];
  const dues = allDues.slice(0, 6);
  const more = allDues.slice(6);
  const dueText = dues.length
    ? ["", "बाकी एंट्री:", ...dues.map(dueLine), ...(more.length ? [`• और ${more.length} एंट्री — ${formatINR(sumLeft(more))}`] : [])]
    : [];

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
          ...dueText,
          "",
          `कृपया सुविधा अनुसार इसका भुगतान कर दें।`,
        ]),
    ...(custom ? dueText : []),
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
  ${duesTable(allDues)}
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

type PageOpts = { toLabel?: string; foot?: string; hideNote?: boolean };

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
    <div></div>
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

// ---------- Card slip (customer receipt) ----------

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
  note?: string;
  /** Money handed over: a line for the person who took it, in place of the thank-you. */
  receiverSign?: string;
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
  const foot = `${card.banner ? bannerHtml(card.banner) : ""}
      ${card.note ? `<div class="cnote">${esc(card.note)}</div>` : ""}
      <div class="cfoot">
        ${card.receiverSign
          ? `<div class="csign"><div class="signSpace"></div><div class="signLine">${esc(card.receiverSign)}</div></div>`
          : `<div class="thanks"><div class="ty">Thank You!</div>${tagline ? `<div class="tl">${esc(tagline)}</div>` : ""}</div>`}
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

  const customer: Customer = { id: "", name, phone: t.mobile || "", address: "", notes: "", createdAt: t.createdAt };
  const rows: CardRow[] = [
    personRow(customer, "Customer Name"),
    { icon: "doc", tint: OK, label: "सेवा", value: service, sub: via ? `via ${via}` : "" },
    ...details.map((d): CardRow => ({ icon: d.label === "तारीख व समय" ? "cal" : "card", tint: BLUE, label: d.label, value: d.value })),
    ...summary.map((l): CardRow => ({ icon: l.tone === "due" ? "scale" : l.tone === "ok" ? "paid" : "rupee", tint: l.tone === "due" ? AMBER : l.tone === "ok" ? OK : BLUE, label: l.label, value: l.value, tone: l.tone })),
  ];
  const banner: Banner = failed
    ? { color: DUE, bg: "#FDECEC", icon: "alert", title: "लेन-देन फेल", sub: "कोई पैसा नहीं लिया गया" }
    : t.status === "pending"
      ? { color: AMBER, bg: "#FFF4E0", icon: "clock", title: statusLabel(t), sub: "स्थिति बदलते ही बता दिया जाएगा" }
      : bill.due > 0 && bill.flow !== "out"
        ? { color: DUE, bg: "#FDECEC", icon: "alert", title: `बाकी ${formatINR(bill.due)}`, sub: getPrefs().dueNote.trim() || DUE_NOTE_DEFAULT }
        : OK_BANNER("लेन-देन सफल रहा", getPrefs().paidNote.trim() || PAID_NOTE_DEFAULT);
  const html = cardPage(
    shop,
    { titleHi: `${service} रसीद`, titleEn: "TRANSACTION RECEIPT", noLabel: "रसीद संख्या", no, date: formatDate(t.date), rows, stamp, banner, note: getPrefs().receiptNote.trim() },
    false,
  );

  return {
    heading,
    title,
    sub: `${name} · ${formatDate(t.date)} · नं. ${no}`,
    phone: t.mobile || "",
    lines: summary,
    message,
    html,
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
