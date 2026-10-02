import type { Customer, EntryType } from "./data";

export type ParsedEntry = {
  raw: string;
  customerId: string;
  customerName: string;
  isNewCustomer: boolean;
  type: EntryType;
  amount: number;
  description: string;
  confidence: "high" | "medium" | "low";
};

const PAYMENT_KEYWORDS = ["मिले", "मिला", "जमा", "आए", "प्राप्त", "paid", "received", "jama", "credit", "payment"];
const GIVEN_KEYWORDS = ["दिए", "दिया", "लोन", "उधार दिया", "gave", "given", "loan", "debit"];
const WORK_KEYWORDS = ["काम", "फोटोकॉपी", "प्रिंट", "form", "फॉर्म", "कागज़", "पर्चा", "फाइल", "online", "बिल", "work", "udhaar", "उधार"];

const HINDI_NUMBER_WORDS: Record<string, number> = {
  "सौ": 100,
  "एक सौ": 100,
  "दो सौ": 200,
  "तीन सौ": 300,
  "चार सौ": 400,
  "पांच सौ": 500,
  "छह सौ": 600,
  "सात सौ": 700,
  "आठ सौ": 800,
  "नौ सौ": 900,
  "हज़ार": 1000,
  "हजार": 1000,
  "एक हज़ार": 1000,
  "दो हज़ार": 2000,
  "तीन हज़ार": 3000,
  "पांच हज़ार": 5000,
};

export function parseQuickText(input: string, customers: Customer[]): ParsedEntry {
  const text = input.trim();
  if (!text) {
    return {
      raw: text,
      customerId: "",
      customerName: "",
      isNewCustomer: false,
      type: "work",
      amount: 0,
      description: "",
      confidence: "low",
    };
  }

  let amount = 0;
  let remainingText = text;

  // 1. Check Hindi words
  for (const [phrase, val] of Object.entries(HINDI_NUMBER_WORDS)) {
    if (remainingText.includes(phrase)) {
      amount = val;
      remainingText = remainingText.replace(phrase, " ");
      break;
    }
  }

  // 2. Check digits if no word amount found or override
  const numMatch = remainingText.match(/(?:₹|\b)(\d+(?:\.\d+)?)\b/);
  if (numMatch) {
    amount = parseFloat(numMatch[1]);
    remainingText = remainingText.replace(numMatch[0], " ");
  }

  // 3. Determine Entry Type
  let type: EntryType = "work";
  const lower = text.toLowerCase();

  const isPayment = PAYMENT_KEYWORDS.some((kw) => lower.includes(kw));
  const isGiven = GIVEN_KEYWORDS.some((kw) => lower.includes(kw));

  if (isPayment) {
    type = "payment";
  } else if (isGiven) {
    type = "given";
  } else {
    type = "work";
  }

  // Remove keywords from remaining text to find name and description
  const cleanTokens = remainingText
    .split(/\s+/)
    .map((w) => w.replace(/[₹,]/g, "").trim())
    .filter(Boolean);

  let matchedCustomer: Customer | null = null;

  // Check against existing customers
  for (const c of customers) {
    const cLower = c.name.toLowerCase();
    for (const token of cleanTokens) {
      if (token.length >= 2 && (cLower === token.toLowerCase() || cLower.includes(token.toLowerCase()))) {
        matchedCustomer = c;
        break;
      }
    }
    if (matchedCustomer) break;
  }

  let customerId = "";
  let customerName = "";
  let isNewCustomer = false;

  if (matchedCustomer) {
    customerId = matchedCustomer.id;
    customerName = matchedCustomer.name;
  } else if (cleanTokens.length > 0) {
    // First non-keyword word can be the customer name
    customerName = cleanTokens[0];
    isNewCustomer = true;
  }

  // Words that aren't the customer name, amount, or common noise
  const noise = new Set([
    ...PAYMENT_KEYWORDS,
    ...GIVEN_KEYWORDS,
    "रुपये",
    "रुपया",
    "रुपए",
    "rs",
    "inr",
    "को",
    "का",
    "की",
    "से",
    "ने",
    customerName.toLowerCase(),
  ]);

  const descTokens = cleanTokens.filter((t) => !noise.has(t.toLowerCase()) && t !== customerName);
  const description = descTokens.join(" ").trim() || (type === "payment" ? "भुगतान मिला" : type === "given" ? "पैसे दिए" : "काम");

  const confidence = (amount > 0 && customerName.length > 0) ? (matchedCustomer ? "high" : "medium") : "low";

  return {
    raw: text,
    customerId,
    customerName,
    isNewCustomer,
    type,
    amount,
    description,
    confidence,
  };
}
