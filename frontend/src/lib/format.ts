// Hindi (Devanagari) formatting helpers

export function todayISO(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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

export function initials(name: string): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 1);
  return parts[0].slice(0, 1) + parts[1].slice(0, 1);
}
