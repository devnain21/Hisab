import type { AepsStatus, AepsTxn, AepsType } from "@/src/lib/data";
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
  | "ifsc";

// "out": shop hands cash to the customer, "in": customer hands cash to the shop.
type Meta = { label: string; short: string; icon: string; color: string; soft: string; cash: "in" | "out" | "none"; amountLabel: string; fields: AepsField[] };

export const AEPS_TYPES: AepsType[] = ["withdrawal", "deposit", "transfer", "recharge", "bill", "balance", "other"];

export const AEPS_META: Record<AepsType, Meta> = {
  withdrawal: {
    label: "नकद निकासी (AEPS)", short: "निकासी", icon: "cash-fast", color: "#C62828", soft: "#FDECEA", cash: "out",
    amountLabel: "निकाली गई रकम (₹)",
    fields: ["mobile", "aadhaarLast4", "bankName", "amount", "reference", "commission"],
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

export function aepsTotals(list: AepsTxn[]) {
  let cashIn = 0;
  let cashOut = 0;
  let commission = 0;
  let count = 0;
  for (const t of list) {
    if (t.status !== "success") continue;
    count += 1;
    commission += t.commission || 0;
    const dir = AEPS_META[t.type]?.cash;
    if (dir === "in") cashIn += t.amount;
    else if (dir === "out") cashOut += t.amount;
  }
  return { count, cashIn, cashOut, commission };
}

/** Short secondary line for list rows: the most identifying detail for each type. */
export function aepsDetailLine(t: AepsTxn): string {
  switch (t.type) {
    case "recharge":
      return [t.operator, t.rechargeNumber].filter(Boolean).join(" · ");
    case "bill":
      return [t.billerName, t.billAccount].filter(Boolean).join(" · ");
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
  add("पाने वाला", t.beneficiaryName);
  add("खाता", maskAccount(t.accountNumber));
  add("IFSC", t.ifsc);
  add("ऑपरेटर", t.operator);
  add("नंबर", t.rechargeNumber);
  add("बिल", t.billerName);
  add("कंज़्यूमर नं.", t.billAccount);
  if (t.amount > 0) rows.push(["रकम", formatINR(t.amount)]);
  add("Txn ID", t.reference);
  rows.push(["स्थिति", STATUS_META[t.status].label]);
  return [`*${shop}*`, "रसीद", "", ...rows.map(([k, v]) => `${k}: ${v}`), "", "धन्यवाद 🙏"].join("\n");
}
