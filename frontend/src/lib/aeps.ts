import type { AepsCash, AepsCommissionMode, AepsStatus, AepsTxn, AepsType, AepsVia } from "@/src/lib/data";
import { formatDate, formatINR, isBackdated } from "@/src/lib/format";

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

/** Services offered when adding; the rest only exist on older rows. */
export const AEPS_SERVICES: AepsType[] = ["withdrawal", "deposit", "transfer", "bill", "recharge", "other"];
export const AEPS_TYPES: AepsType[] = [...AEPS_SERVICES, "upi", "cash", "balance"];

export const AEPS_META: Record<AepsType, Meta> = {
  withdrawal: {
    label: "Money Withdrawal", short: "Withdrawal", icon: "cash-fast", color: "#C62828", soft: "#FDECEA", cash: "out",
    amountLabel: "निकासी रकम (₹)",
    fields: ["mobile", "aadhaarLast4", "bankName", "ifsc", "upiId", "amount", "reference", "commission"],
  },
  deposit: {
    label: "Money Deposit", short: "Deposit", icon: "bank-plus", color: "#2E7D32", soft: "#E8F5E9", cash: "in",
    amountLabel: "जमा रकम (₹)",
    fields: ["mobile", "beneficiaryName", "bankName", "accountNumber", "ifsc", "upiId", "amount", "reference", "commission"],
  },
  transfer: {
    label: "Money Transfer", short: "Transfer", icon: "bank-transfer", color: "#1D4ED8", soft: "#E0E9FF", cash: "in",
    amountLabel: "भेजी रकम (₹)",
    fields: ["mobile", "beneficiaryName", "bankName", "accountNumber", "ifsc", "upiId", "billerName", "billAccount", "amount", "reference", "commission"],
  },
  bill: {
    label: "Bill Payment", short: "Bill", icon: "receipt-text-outline", color: "#B45309", soft: "#FEF3E2", cash: "in",
    amountLabel: "बिल रकम (₹)",
    fields: ["mobile", "billerName", "billAccount", "amount", "reference", "commission"],
  },
  recharge: {
    label: "Mobile / DTH Recharge", short: "Recharge", icon: "cellphone-arrow-down", color: "#7C3AED", soft: "#F1E9FF", cash: "in",
    amountLabel: "रिचार्ज रकम (₹)",
    fields: ["operator", "rechargeNumber", "amount", "reference", "commission"],
  },
  other: {
    label: "Other Service", short: "Other", icon: "dots-horizontal-circle-outline", color: "#2D2D2D", soft: "#EBE4D5", cash: "none",
    amountLabel: "रकम (₹)",
    fields: ["mobile", "billerName", "amount", "reference", "commission"],
  },
  upi: {
    label: "UPI Transfer", short: "UPI", icon: "qrcode", color: "#5B21B6", soft: "#EDE9FE", cash: "in",
    amountLabel: "नकद रकम (₹)",
    fields: ["mobile", "beneficiaryName", "upiId", "amount", "reference", "commission"],
  },
  cash: {
    label: "Cash Given", short: "Cash", icon: "cash", color: "#9A3412", soft: "#FFEDD5", cash: "out",
    amountLabel: "दिए गए नकद (₹)",
    fields: ["amount", "reference", "commission"],
  },
  balance: {
    label: "Balance Enquiry", short: "Balance", icon: "bank-outline", color: "#00796B", soft: "#E0F2F1", cash: "none",
    amountLabel: "खाते का बैलेंस (₹, वैकल्पिक)",
    fields: ["mobile", "aadhaarLast4", "bankName", "amount", "reference", "commission"],
  },
};

type ViaOption = { id: Exclude<AepsVia, "">; label: string; bill: string };
const VIA: Record<Exclude<AepsVia, "">, ViaOption> = {
  aeps: { id: "aeps", label: "AEPS (आधार)", bill: "AEPS (Aadhaar)" },
  upi: { id: "upi", label: "UPI", bill: "UPI" },
  bank: { id: "bank", label: "बैंक खाता", bill: "Bank Account (IMPS / NEFT)" },
  emi: { id: "emi", label: "EMI / लोन", bill: "EMI / Loan" },
};

/** How each service can be done; the first one is the default. */
export const VIA_FOR: Partial<Record<AepsType, ViaOption[]>> = {
  withdrawal: [VIA.aeps, VIA.upi],
  deposit: [VIA.bank, VIA.upi],
  transfer: [VIA.bank, VIA.upi, VIA.emi],
};

export const defaultVia = (type: AepsType): AepsVia => VIA_FOR[type]?.[0].id ?? "";
export const viaBill = (via?: AepsVia) => (via ? VIA[via].bill : "");

/** Fields that apply to this service done this way. */
export function fieldsFor(type: AepsType, via: AepsVia = ""): AepsField[] {
  const v = via || defaultVia(type);
  const pick = (...f: AepsField[]): AepsField[] => ["mobile", ...f, "amount", "reference", "commission"];
  if (type === "withdrawal") return v === "upi" ? pick("upiId") : pick("aadhaarLast4", "bankName", "ifsc");
  if (type === "deposit") return v === "upi" ? pick("beneficiaryName", "upiId") : pick("beneficiaryName", "bankName", "accountNumber", "ifsc");
  if (type === "transfer") {
    if (v === "upi") return pick("beneficiaryName", "upiId");
    if (v === "emi") return pick("billerName", "billAccount", "beneficiaryName");
    return pick("beneficiaryName", "bankName", "accountNumber", "ifsc");
  }
  return AEPS_META[type].fields;
}

/** Field labels that depend on the service. */
export function fieldLabel(type: AepsType, via: AepsVia, f: AepsField): string {
  const v = via || defaultVia(type);
  if (f === "beneficiaryName") return type === "deposit" ? "खाताधारक का नाम" : v === "emi" ? "लोन किसके नाम (वैकल्पिक)" : "किसको भेजे (नाम)";
  if (f === "upiId") return type === "withdrawal" ? "ग्राहक का UPI ID (वैकल्पिक)" : "किसको भेजे (UPI ID / नंबर)";
  if (f === "billerName") return type === "other" ? "सेवा का नाम" : v === "emi" ? "लोन कंपनी / बैंक" : FIELD_LABEL.billerName;
  if (f === "billAccount" && v === "emi") return "लोन / EMI खाता नंबर";
  return FIELD_LABEL[f];
}
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

type LegRow = Pick<AepsTxn, "type" | "date" | "status" | "cash" | "cashDate" | "doneDate" | "commissionMode"> &
  Partial<Pick<AepsTxn, "collected" | "payMode">>;

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
/** Customer-paid commission arrives with the cash only when the customer paid in full; otherwise it stays on the khata. */
export function commissionDate(t: LegRow & { amount?: number }): string | null {
  if (t.commissionMode !== "cash" && t.commissionMode !== "online") return bankLegDate(t);
  const leg = cashLegDate(t);
  if (!leg || cashOf(t) !== "in" || t.collected == null || t.amount == null) return leg;
  return t.collected >= t.amount ? leg : null;
}

export const COMMISSION_MODES: { id: Exclude<AepsCommissionMode, "">; label: string }[] = [
  { id: "cash", label: "ग्राहक से कैश" },
  { id: "online", label: "ग्राहक से ऑनलाइन" },
  { id: "app", label: "ऐप / पोर्टल से" },
];

export function commissionModeLabel(m?: AepsCommissionMode) {
  return m === "cash" ? "कैश में मिला" : m === "online" ? "ऑनलाइन मिला" : "ऐप से मिला";
}

type MoneyRow = LegRow & { amount: number; commission: number };

/** Service charge the customer pays (app commission never reaches the customer's bill). */
export function customerCharge(t: MoneyRow): number {
  return t.commission > 0 && (t.commissionMode === "cash" || t.commissionMode === "online") ? t.commission : 0;
}

/** Money the customer has handed over toward the amount of an incoming service. */
export function collectedOf(t: MoneyRow): number {
  if (cashOf(t) !== "in" || !cashLegDate(t)) return 0;
  return t.collected == null ? t.amount : Math.min(Math.max(t.collected, 0), t.amount);
}

/** Pocket the customer's money landed in. */
export const customerPocket = (t: Pick<AepsTxn, "payMode">): "cash" | "bank" => (t.payMode === "online" ? "bank" : "cash");

export type AepsBill = {
  flow: CashFlow;
  amount: number;
  charge: number;
  /** in: amount + charge the customer pays · out: cash the customer gets. */
  total: number;
  /** in: received from the customer · out: cash handed over. */
  settled: number;
  /** in: customer still owes us · out: cash we still have to hand over. */
  due: number;
};

/** The customer's side of one row, the way the bill shows it. */
export function aepsBill(t: MoneyRow): AepsBill {
  const flow = cashOf(t);
  const charge = customerCharge(t);
  const legDone = !!cashLegDate(t);
  if (t.status === "failed") return { flow, amount: t.amount, charge: 0, total: 0, settled: 0, due: 0 };
  if (flow === "out") {
    const total = Math.max(0, t.amount - (t.commissionMode === "cash" ? charge : 0));
    const settled = legDone ? total : 0;
    return { flow, amount: t.amount, charge, total, settled, due: total - settled };
  }
  if (flow === "in") {
    const total = t.amount + charge;
    const settled = collectedOf(t) + (commissionDate(t) ? charge : 0);
    return { flow, amount: t.amount, charge, total, settled, due: Math.max(0, total - settled) };
  }
  const settled = legDone ? charge : 0;
  return { flow, amount: t.amount, charge, total: charge, settled, due: charge - settled };
}

/** What goes on the customer's khata: unpaid money for a service that has gone through. */
export function aepsDue(t: MoneyRow & Pick<AepsTxn, "customerId">): number {
  if (!t.customerId || t.status !== "success") return 0;
  const b = aepsBill(t);
  return b.flow === "out" ? 0 : b.due;
}

export function isLater(t: Pick<AepsTxn, "status" | "dueDate">) {
  return t.status === "pending" && !!t.dueDate;
}

export function statusLabel(t: Pick<AepsTxn, "status" | "dueDate">) {
  return isLater(t) ? `${formatDate(t.dueDate!)} को भेजनी है` : STATUS_META[t.status].label;
}

export type AepsMoney = { cashIn: number; cashOut: number; bankIn: number; bankOut: number; commissionCash: number; commissionBank: number; count: number };

export type AepsLeg = { pocket: "cash" | "bank"; dir: "in" | "out"; commission: boolean; amount: number; date: string };

/** Every galla / bank movement of one counter row, each on its own day. Backdated legs never touch the pockets. */
export function aepsLegs(t: AepsTxn): AepsLeg[] {
  const { cash: cd, bank: bd, commission: kd } = aepsLiveDays(t);
  const legs: AepsLeg[] = [];
  if (cd) {
    const dir = cashOf(t);
    if (dir === "in") legs.push({ pocket: customerPocket(t), dir: "in", commission: false, amount: collectedOf(t), date: cd });
    else if (dir === "out") legs.push({ pocket: "cash", dir: "out", commission: false, amount: t.amount, date: cd });
  }
  if (bd) {
    const dir = bankOf(t);
    if (dir !== "none") legs.push({ pocket: "bank", dir, commission: false, amount: t.amount, date: bd });
  }
  if (kd) legs.push({ pocket: commissionPocket(t), dir: "in", commission: true, amount: t.commission, date: kd });
  return legs;
}

function aepsLiveDays(t: AepsTxn) {
  const live = (d: string | null) => (d && !isBackdated(d, t.createdAt) ? d : null);
  const kd = live(commissionDate(t));
  return { cash: live(cashLegDate(t)), bank: live(bankLegDate(t)), commission: kd && t.commission > 0 ? kd : null };
}

/** Galla and bank movement of counter rows on the days `keep` accepts. */
export function aepsTotals(list: AepsTxn[], keep: (date: string) => boolean = () => true): AepsMoney & { cashNet: number; bankNet: number; commission: number } {
  const m: AepsMoney = { cashIn: 0, cashOut: 0, bankIn: 0, bankOut: 0, commissionCash: 0, commissionBank: 0, count: 0 };
  for (const t of list) {
    const days = aepsLiveDays(t);
    const touched = [days.cash, days.bank, days.commission].some((d) => d && keep(d));
    for (const l of aepsLegs(t)) {
      if (!keep(l.date)) continue;
      if (l.commission) {
        if (l.pocket === "cash") m.commissionCash += l.amount;
        else m.commissionBank += l.amount;
      } else if (l.pocket === "cash") {
        if (l.dir === "in") m.cashIn += l.amount;
        else m.cashOut += l.amount;
      } else if (l.dir === "in") m.bankIn += l.amount;
      else m.bankOut += l.amount;
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
export function moneyLines(t: MoneyRow): { label: string; value: string; tone: "in" | "out" | "wait" | "muted" }[] {
  if (t.status === "failed") return [{ label: "फेल", value: "कुछ नहीं बदला", tone: "muted" }];
  const out: { label: string; value: string; tone: "in" | "out" | "wait" | "muted" }[] = [];
  const amt = formatINR(t.amount);
  const c = cashOf(t);
  const b = bankOf(t);
  if (c === "out" && t.amount > 0) {
    const done = !!cashLegDate(t);
    out.push({ label: "गल्ला", value: done ? `−${amt}` : "कैश अभी नहीं दिया", tone: done ? "out" : "wait" });
  }
  if (c === "in" && t.amount > 0) {
    const got = collectedOf(t);
    const where = customerPocket(t) === "bank" ? "बैंक (ग्राहक से)" : "गल्ला";
    out.push({ label: where, value: got > 0 ? `+${formatINR(got)}` : "अभी नहीं मिले", tone: got > 0 ? "in" : "wait" });
  }
  if (b !== "none" && t.amount > 0) {
    const done = !!bankLegDate(t);
    out.push({ label: "बैंक", value: done ? `${b === "in" ? "+" : "−"}${amt}` : "पेंडिंग", tone: done ? (b === "in" ? "in" : "out") : "wait" });
  }
  if (c === "in" && t.amount > 0 && t.status === "success") {
    const left = t.amount - collectedOf(t);
    if (left > 0) out.push({ label: "ग्राहक पर बाकी", value: formatINR(left), tone: "wait" });
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
      if (t.via === "upi") return ["UPI", t.beneficiaryName && `→ ${t.beneficiaryName}`, t.upiId].filter(Boolean).join(" · ");
      if (t.via === "emi") return ["EMI", t.billerName, t.billAccount].filter(Boolean).join(" · ");
      return [t.beneficiaryName && `→ ${t.beneficiaryName}`, t.bankName, maskAccount(t.accountNumber)].filter(Boolean).join(" · ");
    case "deposit":
      if (t.via === "upi") return ["UPI", t.beneficiaryName, t.upiId].filter(Boolean).join(" · ");
      return [t.bankName, maskAccount(t.accountNumber)].filter(Boolean).join(" · ");
    case "other":
      return t.billerName;
    case "withdrawal":
      if (t.via === "upi") return ["UPI", t.upiId].filter(Boolean).join(" · ");
      return ["AEPS", t.bankName, t.aadhaarLast4 && `आधार XXXX${t.aadhaarLast4}`].filter(Boolean).join(" · ");
    default:
      return [t.bankName, t.aadhaarLast4 && `आधार XXXX${t.aadhaarLast4}`].filter(Boolean).join(" · ");
  }
}

export function maskAccount(acc: string): string {
  const a = (acc || "").replace(/\s/g, "");
  return a.length > 4 ? `XX${a.slice(-4)}` : a;
}
