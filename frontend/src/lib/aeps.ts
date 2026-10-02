import type { AepsCash, AepsCommissionMode, AepsStatus, AepsTxn, AepsType } from "@/src/lib/data";
import { formatDate, formatINR } from "@/src/lib/format";

export type AepsField =
  | "mobile"
  | "aadhaarLast4"
  | "bankName"
  | "amount"
  | "commission"
  | "reference"
  | "operator"
  | "rechargeNumber"
  | "billerName"
  | "billAccount"
  | "beneficiaryName"
  | "accountNumber"
  | "ifsc"
  | "upiId";

// "out": shop hands cash to the customer, "in": customer hands cash to the shop.
type Meta = { label: string; short: string; icon: string; color: string; soft: string; cash: "in" | "out" | "none"; amountLabel: string; fields: AepsField[] };

export const AEPS_TYPES: AepsType[] = ["withdrawal", "cash", "upi", "deposit", "transfer", "recharge", "bill", "balance", "other"];

export const AEPS_META: Record<AepsType, Meta> = {
  withdrawal: {
    label: "नकद निकासी (AEPS)", short: "निकासी", icon: "cash-fast", color: "#C62828", soft: "#FDECEA", cash: "out",
    amountLabel: "निकाली गई रकम (₹)",
    fields: ["mobile", "aadhaarLast4", "bankName", "amount", "reference", "commission"],
  },
  cash: {
    label: "नकद दिया", short: "नकद", icon: "cash", color: "#9A3412", soft: "#FFEDD5", cash: "out",
    amountLabel: "दिए गए नकद (₹)",
    fields: ["amount", "reference", "commission"],
  },
  deposit: {
    label: "खाते में जमा", short: "जमा", icon: "bank-plus", color: "#2E7D32", soft: "#E8F5E9", cash: "in",
    amountLabel: "जमा की गई रकम (₹)",
    fields: ["mobile", "bankName", "accountNumber", "amount", "reference", "commission"],
  },
  transfer: {
    label: "मनी ट्रांसफर", short: "ट्रांसफर", icon: "bank-transfer", color: "#1D4ED8", soft: "#E0E9FF", cash: "in",
    amountLabel: "भेजी गई रकम (₹)",
    fields: ["mobile", "beneficiaryName", "bankName", "accountNumber", "ifsc", "amount", "reference", "commission"],
  },
  upi: {
    label: "UPI", short: "UPI", icon: "qrcode", color: "#5B21B6", soft: "#EDE9FE", cash: "in",
    amountLabel: "नकद रकम (₹)",
    fields: ["mobile", "beneficiaryName", "upiId", "amount", "reference", "commission"],
  },
  recharge: {
    label: "मोबाइल / DTH रिचार्ज", short: "रिचार्ज", icon: "cellphone-arrow-down", color: "#7C3AED", soft: "#F1E9FF", cash: "in",
    amountLabel: "रिचार्ज रकम (₹)",
    fields: ["operator", "rechargeNumber", "amount", "reference", "commission"],
  },
  bill: {
    label: "बिल भुगतान", short: "बिल", icon: "receipt-text-outline", color: "#B45309", soft: "#FEF3E2", cash: "in",
    amountLabel: "बिल रकम (₹)",
    fields: ["mobile", "billerName", "billAccount", "amount", "reference", "commission"],
  },
  balance: {
    label: "बैलेंस / मिनी स्टेटमेंट", short: "बैलेंस", icon: "bank-outline", color: "#00796B", soft: "#E0F2F1", cash: "none",
    amountLabel: "खाते का बैलेंस (₹, वैकल्पिक)",
    fields: ["mobile", "aadhaarLast4", "bankName", "amount", "reference", "commission"],
  },
  other: {
    label: "अन्य सेवा", short: "अन्य", icon: "dots-horizontal-circle-outline", color: "#2D2D2D", soft: "#EBE4D5", cash: "none",
    amountLabel: "रकम (₹)",
    fields: ["mobile", "amount", "reference", "commission"],
  },
};

export const FIELD_LABEL: Record<AepsField, string> = {
  mobile: "मोबाइल नंबर",
  aadhaarLast4: "आधार (आख़िरी 4 अंक)",
  bankName: "बैंक",
  amount: "रकम",
  commission: "मेरा कमीशन / चार्ज (₹)",
  reference: "ट्रांज़ैक्शन ID / RRN / UTR",
  operator: "ऑपरेटर",
  rechargeNumber: "मोबाइल / DTH नंबर",
  billerName: "बिल किसका",
  billAccount: "कंज़्यूमर / अकाउंट नंबर",
  beneficiaryName: "पाने वाले का नाम",
  upiId: "UPI ID",
  accountNumber: "खाता नंबर",
  ifsc: "IFSC कोड",
};

export const STATUS_META: Record<AepsStatus, { label: string; color: string; soft: string; icon: string }> = {
  success: { label: "सफल", color: "#2E7D32", soft: "#E8F5E9", icon: "check-circle" },
  pending: { label: "पेंडिंग", color: "#B45309", soft: "#FEF3E2", icon: "clock-outline" },
  failed: { label: "फेल", color: "#C62828", soft: "#FDECEA", icon: "close-circle" },
};

export const BANKS = ["SBI", "PNB", "Bank of Baroda", "Canara", "Union Bank", "HDFC", "ICICI", "Axis", "Bank of India", "India Post (IPPB)"];
export const OPERATORS = ["Jio", "Airtel", "Vi", "BSNL", "Tata Play", "Dish TV", "Airtel DTH", "d2h"];
export const BILLERS = ["बिजली", "पानी", "गैस सिलेंडर", "पाइप गैस", "पोस्टपेड मोबाइल", "ब्रॉडबैंड", "बीमा प्रीमियम", "लोन EMI", "FASTag"];

export type CashFlow = "in" | "out" | "none";

export const CASH_GROUPS: { id: CashFlow; label: string; hint: string }[] = [
  { id: "out", label: "नकद दिया", hint: "दराज से गया" },
  { id: "in", label: "नकद मिला", hint: "दराज में आया" },
  { id: "none", label: "नकद नहीं", hint: "सिर्फ़ देखा" },
];

/** Drawer direction. An explicit `cash` on the row wins, so one service can move the drawer in more than one way. */
export function cashOf(t: { type: AepsType; cash?: AepsCash }): CashFlow {
  if (t.cash === "in" || t.cash === "out" || t.cash === "none") return t.cash;
  return AEPS_META[t.type]?.cash ?? "none";
}

export function typesFor(flow: CashFlow): AepsType[] {
  return AEPS_TYPES.filter((t) => t !== "other" && AEPS_META[t].cash === flow);
}

/** One sentence for the drawer, so the service name and the cash never disagree. */
export function drawerSentence(type: AepsType, amount: number, flow: CashFlow, status: AepsStatus = "success"): string {
  if (status === "failed") return "फेल — दराज नहीं बदली";
  const money = amount > 0 ? formatINR(amount) : "रकम";
  if (type === "upi" && flow === "none") return amount > 0 ? `UPI से ${formatINR(amount)} भेजे, दराज नहीं छुई` : "UPI, दराज नहीं छुई";
  if (type === "balance" || flow === "none") return "दराज नहीं बदली";
  const tail: Partial<Record<AepsType, string>> = {
    withdrawal: "ग्राहक को दिए",
    cash: "नकद दिए",
    deposit: "खाते में डाले",
    transfer: "दूसरे खाते में भेजे",
    upi: "UPI से भेजे",
    recharge: "रिचार्ज किया",
    bill: "बिल भरा",
  };
  const head = flow === "out" ? `दराज से ${money} निकले` : `दराज में ${money} आए`;
  return tail[type] ? `${head}, ${tail[type]}` : head;
}

/** The bank side mirrors the counter cash: cash taken in is sent out from the bank, cash handed out was credited to it. */
export function bankOf(t: { type: AepsType; cash?: AepsCash }): CashFlow {
  if (t.type === "other" || t.type === "balance") return "none";
  const c = cashOf(t);
  return c === "in" ? "out" : c === "out" ? "in" : "none";
}

type LegRow = Pick<AepsTxn, "type" | "date" | "status" | "cash" | "cashDate" | "doneDate" | "commissionMode">;

/** Day the counter cash changed hands, or null if it has not. */
export function cashLegDate(t: LegRow): string | null {
  if (t.status === "failed") return null;
  if (t.cashDate === undefined || t.cashDate === null) return t.status === "success" ? t.date : null;
  return t.cashDate || null;
}

/** Day the bank side went through, or null while pending. */
export function bankLegDate(t: LegRow): string | null {
  if (t.status === "failed") return null;
  return t.doneDate || (t.status === "success" ? t.date : null);
}

/** Commission paid by the customer arrives with the cash; app commission arrives with the bank side. */
export function commissionPocket(t: LegRow): "cash" | "bank" {
  return t.commissionMode === "cash" ? "cash" : "bank";
}
export function commissionDate(t: LegRow): string | null {
  return t.commissionMode === "cash" || t.commissionMode === "online" ? cashLegDate(t) : bankLegDate(t);
}

export const COMMISSION_MODES: { id: Exclude<AepsCommissionMode, "">; label: string }[] = [
  { id: "cash", label: "ग्राहक से कैश" },
  { id: "online", label: "ग्राहक से ऑनलाइन" },
  { id: "app", label: "ऐप / पोर्टल से" },
];

export function commissionModeLabel(m?: AepsCommissionMode) {
  return m === "cash" ? "कैश में मिला" : m === "online" ? "ऑनलाइन मिला" : "ऐप से मिला";
}

export function isLater(t: Pick<AepsTxn, "status" | "dueDate">) {
  return t.status === "pending" && !!t.dueDate;
}

export function statusLabel(t: Pick<AepsTxn, "status" | "dueDate">) {
  return isLater(t) ? `${formatDate(t.dueDate!)} को भेजनी है` : STATUS_META[t.status].label;
}

export type AepsMoney = { cashIn: number; cashOut: number; bankIn: number; bankOut: number; commissionCash: number; commissionBank: number; count: number };

/** Galla and bank movement of counter rows on the days `keep` accepts. */
export function aepsTotals(list: AepsTxn[], keep: (date: string) => boolean = () => true): AepsMoney & { cashNet: number; bankNet: number; commission: number } {
  const m: AepsMoney = { cashIn: 0, cashOut: 0, bankIn: 0, bankOut: 0, commissionCash: 0, commissionBank: 0, count: 0 };
  for (const t of list) {
    const cd = cashLegDate(t);
    const bd = bankLegDate(t);
    const kd = commissionDate(t);
    let touched = false;
    if (cd && keep(cd)) {
      const dir = cashOf(t);
      if (dir === "in") m.cashIn += t.amount;
      else if (dir === "out") m.cashOut += t.amount;
      touched = true;
    }
    if (bd && keep(bd)) {
      const dir = bankOf(t);
      if (dir === "in") m.bankIn += t.amount;
      else if (dir === "out") m.bankOut += t.amount;
      touched = true;
    }
    if (kd && keep(kd) && t.commission > 0) {
      if (commissionPocket(t) === "cash") m.commissionCash += t.commission;
      else m.commissionBank += t.commission;
      touched = true;
    }
    if (touched) m.count += 1;
  }
  return {
    ...m,
    cashNet: m.cashIn + m.commissionCash - m.cashOut,
    bankNet: m.bankIn + m.commissionBank - m.bankOut,
    commission: m.commissionCash + m.commissionBank,
  };
}

/** Plain lines for one row: what happened to galla, bank and commission. */
export function moneyLines(t: LegRow & { amount: number; commission: number }): { label: string; value: string; tone: "in" | "out" | "wait" | "muted" }[] {
  if (t.status === "failed") return [{ label: "फेल", value: "कुछ नहीं बदला", tone: "muted" }];
  const out: { label: string; value: string; tone: "in" | "out" | "wait" | "muted" }[] = [];
  const amt = formatINR(t.amount);
  const c = cashOf(t);
  if (c !== "none" && t.amount > 0) {
    const done = !!cashLegDate(t);
    out.push({ label: "गल्ला", value: done ? `${c === "in" ? "+" : "−"}${amt}` : c === "in" ? "कैश अभी नहीं मिला" : "कैश अभी नहीं दिया", tone: done ? (c === "in" ? "in" : "out") : "wait" });
  }
  const b = bankOf(t);
  if (b !== "none" && t.amount > 0) {
    const done = !!bankLegDate(t);
    out.push({ label: "बैंक", value: done ? `${b === "in" ? "+" : "−"}${amt}` : "पेंडिंग", tone: done ? (b === "in" ? "in" : "out") : "wait" });
  }
  if (t.commission > 0) {
    const done = !!commissionDate(t);
    const where = commissionPocket(t) === "cash" ? "गल्ला" : "बैंक";
    out.push({ label: `कमीशन (${where})`, value: done ? `+${formatINR(t.commission)}` : "बाद में", tone: done ? "in" : "wait" });
  }
  if (out.length === 0) out.push({ label: "पैसा", value: "कुछ नहीं बदला", tone: "muted" });
  return out;
}

/** Short secondary line for list rows: the most identifying detail for each type. */
export function aepsDetailLine(t: AepsTxn): string {
  switch (t.type) {
    case "recharge":
      return [t.operator, t.rechargeNumber].filter(Boolean).join(" · ");
    case "bill":
      return [t.billerName, t.billAccount].filter(Boolean).join(" · ");
    case "upi":
      return [t.upiId, t.beneficiaryName && `→ ${t.beneficiaryName}`].filter(Boolean).join(" · ");
    case "transfer":
      return [t.beneficiaryName && `→ ${t.beneficiaryName}`, t.bankName, maskAccount(t.accountNumber)].filter(Boolean).join(" · ");
    case "deposit":
      return [t.bankName, maskAccount(t.accountNumber)].filter(Boolean).join(" · ");
    default:
      return [t.bankName, t.aadhaarLast4 && `आधार XXXX${t.aadhaarLast4}`].filter(Boolean).join(" · ");
  }
}

export function maskAccount(acc: string): string {
  const a = (acc || "").replace(/\s/g, "");
  return a.length > 4 ? `XX${a.slice(-4)}` : a;
}

export function receiptText(t: AepsTxn, shop: string): string {
  const meta = AEPS_META[t.type];
  const rows: [string, string][] = [
    ["सेवा", meta.label],
    ["तारीख", `${formatDate(t.date)}${t.time ? `, ${t.time}` : ""}`],
    ["ग्राहक", t.customerName],
  ];
  const add = (label: string, v: string) => { if (v) rows.push([label, v]); };
  add("बैंक", t.bankName);
  add("आधार", t.aadhaarLast4 ? `XXXX XXXX ${t.aadhaarLast4}` : "");
  add("UPI", t.upiId ?? "");
  add("पाने वाला", t.beneficiaryName);
  add("खाता", maskAccount(t.accountNumber));
  add("IFSC", t.ifsc);
  add("ऑपरेटर", t.operator);
  add("नंबर", t.rechargeNumber);
  add("बिल", t.billerName);
  add("कंज़्यूमर नं.", t.billAccount);
  if (t.amount > 0) rows.push(["रकम", formatINR(t.amount)]);
  add("Txn ID", t.reference);
  rows.push(["स्थिति", statusLabel(t)]);
  return [`*${shop}*`, "रसीद", "", ...rows.map(([k, v]) => `${k}: ${v}`), "", "धन्यवाद 🙏"].join("\n");
}
