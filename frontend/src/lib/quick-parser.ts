import type { Customer, EntryType } from "./data";

export type ParsedEntry = {
  raw: string;
  customerId: string;
  customerName: string;
  isNewCustomer: boolean;
  type: EntryType;
  amount: number;
  description: string;
  /** Days before today ("कल" = -1, "परसों" = -2). */
  dateOffset: number;
  confidence: "high" | "medium" | "low";
};

const PAYMENT_KEYWORDS = ["मिले", "मिला", "जमा", "आए", "प्राप्त", "paid", "received", "jama", "credit", "payment"];
const GIVEN_KEYWORDS = ["दिए", "दिया", "लोन", "उधार दिया", "gave", "given", "loan", "debit"];
const PURCHASE_KEYWORDS = ["सामान", "खरीदा", "खरीदी", "ख़रीदा", "लिया", "ली", "kharida", "saman", "purchase", "bought"];
const DATE_WORDS: Record<string, number> = { "कल": -1, "परसों": -2, "kal": -1, "parso": -2, "yesterday": -1 };
/** Words that are never a name or a description. */
const NOISE = new Set([
  ...PAYMENT_KEYWORDS,
  ...GIVEN_KEYWORDS,
  "लिया", "ली", "खरीदा", "खरीदी", "ख़रीदा",
  "रुपये", "रुपया", "रुपए", "rs", "inr",
  "को", "का", "की", "से", "ने",
]);
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
      dateOffset: 0,
      confidence: "low",
    };
  }

  let amount = 0;
  let remainingText = text;

  // 1. Check Hindi words
  // Longest phrase first, so "पांच सौ" wins over "सौ".
  for (const [phrase, val] of Object.entries(HINDI_NUMBER_WORDS).sort((a, b) => b[0].length - a[0].length)) {
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

  const words = lower.split(/\s+/);
  const isPayment = PAYMENT_KEYWORDS.some((kw) => lower.includes(kw));
  const isGiven = GIVEN_KEYWORDS.some((kw) => lower.includes(kw));
  const isPurchase = PURCHASE_KEYWORDS.some((kw) => words.includes(kw));

  if (isPayment) {
    type = "payment";
  } else if (isGiven) {
    type = "given";
  } else if (isPurchase) {
    type = "purchase";
  } else {
    type = "work";
  }

  const dateWord = words.find((w) => w in DATE_WORDS);
  const dateOffset = dateWord ? DATE_WORDS[dateWord] : 0;

  // Remove keywords from remaining text to find name and description
  const cleanTokens = remainingText
    .split(/\s+/)
    .map((w) => w.replace(/[₹,]/g, "").trim())
    .filter((w) => w && !(w.toLowerCase() in DATE_WORDS));

  let matchedCustomer: Customer | null = null;

  // Whole-name or whole-word match first; a partial match only for longer words.
  const tokens = cleanTokens.map((t) => t.toLowerCase());
  matchedCustomer =
    customers.find((c) => tokens.includes(c.name.toLowerCase())) ??
    customers.find((c) => c.name.toLowerCase().split(/\s+/).some((w) => tokens.includes(w))) ??
    customers.find((c) => tokens.some((t) => t.length >= 4 && c.name.toLowerCase().includes(t))) ??
    null;

  let customerId = "";
  let customerName = "";
  let isNewCustomer = false;

  if (matchedCustomer) {
    customerId = matchedCustomer.id;
    customerName = matchedCustomer.name;
  } else {
    // First non-keyword word can be the customer name
    const first = cleanTokens.find((t) => !NOISE.has(t.toLowerCase()));
    if (first) {
      customerName = first;
      isNewCustomer = true;
    }
  }

  const descTokens = cleanTokens.filter((t) => !NOISE.has(t.toLowerCase()) && t.toLowerCase() !== customerName.toLowerCase());
  const description =
    descTokens.join(" ").trim() || (type === "payment" ? "भुगतान मिला" : type === "given" ? "पैसे दिए" : type === "purchase" ? "सामान / सेवा ली" : "काम");

  const confidence = (amount > 0 && customerName.length > 0) ? (matchedCustomer ? "high" : "medium") : "low";

  return {
    raw: text,
    customerId,
    customerName,
    isNewCustomer,
    type,
    amount,
    description,
    dateOffset,
    confidence,
  };
}
