// Hindi (Devanagari) formatting helpers

/** Local calendar day of an ISO timestamp, e.g. the day a row was typed in. */
export function localDay(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** A row dated before the day it was typed is old history: it stays in the khata but never touches galla / bank. */
export function isBackdated(date: string, createdAt?: string | null): boolean {
  const typed = localDay(createdAt);
  return !!typed && date < typed;
}

export function todayISO(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** A real calendar day written as YYYY-MM-DD (rejects 2026-02-30, 2026-13-01, ...). */
export function isValidISO(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map((n) => parseInt(n, 10));
  const dt = new Date(y, m - 1, d);
  return y >= 2000 && y <= 2100 && dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

/** Day `n` days after (or before) `iso`. */
export function shiftISO(iso: string, n: number): string {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** First and last day of the month `offset` months from the one holding `iso`. */
export function monthRange(iso: string, offset = 0): { from: string; to: string } {
  const d = parseISO(iso);
  const first = new Date(d.getFullYear(), d.getMonth() + offset, 1);
  const last = new Date(d.getFullYear(), d.getMonth() + offset + 1, 0);
  const f = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  return { from: f(first), to: f(last) };
}

/** Monday-to-Sunday week holding `iso`. */
export function weekRange(iso: string): { from: string; to: string } {
  const back = (parseISO(iso).getDay() + 6) % 7;
  const from = shiftISO(iso, -back);
  return { from, to: shiftISO(from, 6) };
}

export function formatMonth(iso: string): string {
  const d = parseISO(iso);
  return `${HINDI_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

const HINDI_MONTHS = [
  "जनवरी", "फरवरी", "मार्च", "अप्रैल", "मई", "जून",
  "जुलाई", "अगस्त", "सितंबर", "अक्टूबर", "नवंबर", "दिसंबर",
];

const HINDI_WEEKDAYS = [
  "रविवार", "सोमवार", "मंगलवार", "बुधवार", "गुरुवार", "शुक्रवार", "शनिवार",
];

function parseISO(iso: string): Date {
  // yyyy-mm-dd -> local Date at 00:00
  const [y, m, d] = iso.split("-").map((n) => parseInt(n, 10));
  return new Date(y, (m || 1) - 1, d || 1);
}

export function formatDate(iso: string): string {
  if (!iso) return "";
  const d = parseISO(iso);
  return `${d.getDate()} ${HINDI_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function formatDateShort(iso: string): string {
  if (!iso) return "";
  const d = parseISO(iso);
  return `${d.getDate()} ${HINDI_MONTHS[d.getMonth()].slice(0, 4)}`;
}

export function formatWeekdayDate(iso: string): string {
  if (!iso) return "";
  const d = parseISO(iso);
  return `${HINDI_WEEKDAYS[d.getDay()]}, ${d.getDate()} ${HINDI_MONTHS[d.getMonth()]}`;
}

export function formatINR(n: number): string {
  const val = Math.round(Number(n) || 0);
  const abs = Math.abs(val);
  // Indian numbering system
  const s = abs.toString();
  let out = "";
  if (s.length <= 3) out = s;
  else {
    const last3 = s.slice(-3);
    const rest = s.slice(0, -3);
    out = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3;
  }
  return `${val < 0 ? "−" : ""}₹${out}`;
}

export function formatPhone(p: string): string {
  const s = (p || "").replace(/\D/g, "");
  if (s.length === 10) return `${s.slice(0, 5)} ${s.slice(5)}`;
  return s || "";
}

/** Indian mobile number in the international form wa.me expects, or "" if it can't be used. */
export function waNumber(phone: string): string {
  const d = (phone || "").replace(/\D/g, "");
  if (d.length === 10) return `91${d}`;
  if (d.length === 11 && d.startsWith("0")) return `91${d.slice(1)}`;
  return d.length >= 12 ? d : "";
}

export function nowHM(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function initials(name: string): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 1);
  return parts[0].slice(0, 1) + parts[1].slice(0, 1);
}
