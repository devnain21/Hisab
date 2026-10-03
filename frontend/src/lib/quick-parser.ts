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

const PAYMENT_KEYWORDS = ["मिले", "मिला", "मिली", "जमा", "आए", "आये", "प्राप्त", "paid", "received", "jama", "mile", "mila", "credit", "payment"];
const GIVEN_KEYWORDS = ["दिए", "दिया", "दिये", "दी", "लोन", "उधार दिया", "gave", "given", "diye", "diya", "loan", "debit"];
const PURCHASE_KEYWORDS = ["सामान", "खरीदा", "खरीदी", "ख़रीदा", "ख़रीदी", "लिया", "ली", "kharida", "saman", "purchase", "bought"];
const DATE_WORDS: Record<string, number> = { "कल": -1, "परसों": -2, "kal": -1, "parso": -2, "yesterday": -1 };
/** Words that are never a name or a description. */
const NOISE = new Set([
  ...PAYMENT_KEYWORDS,
  ...GIVEN_KEYWORDS,
  "लिया", "ली", "खरीदा", "खरीदी", "ख़रीदा", "ख़रीदी",
  "रुपये", "रुपया", "रुपए", "रु", "rs", "inr", "rupees", "rupaye",
  "को", "का", "की", "के", "से", "ने", "ka", "ki", "ko", "se",
]);

const UNITS: Record<string, number> = {
  "एक": 1, "दो": 2, "तीन": 3, "चार": 4, "पांच": 5, "पाँच": 5, "छह": 6, "छः": 6, "सात": 7, "आठ": 8, "नौ": 9,
  "दस": 10, "बीस": 20, "तीस": 30, "चालीस": 40, "पचास": 50, "साठ": 60, "सत्तर": 70, "अस्सी": 80, "नब्बे": 90,
  "डेढ़": 1.5, "ढाई": 2.5,
};
const MULTIPLIERS: Record<string, number> = { "सौ": 100, "हज़ार": 1000, "हजार": 1000, "लाख": 100000, "sau": 100, "hazar": 1000, "hajar": 1000, "lakh": 100000, "k": 1000 };

const clean = (w: string) => w.replace(/[₹,.!?।]+$/g, "").replace(/^₹/, "").replace(/,/g, "");
const isNumber = (w: string) => /^\d+(\.\d+)?$/.test(w);

/**
 * First amount in the words: "500", "₹1,500", "2 हजार", "पांच सौ", "डेढ़ हजार", "हजार".
 * Only whole words count, so a name like "सौरभ" never turns into ₹100.
 */
function findAmount(words: string[]): { amount: number; used: Set<number> } {
  const at = (i: number) => (i < words.length ? clean(words[i]).toLowerCase() : "");
  const withUnit = (i: number, base: number) => {
    const mul = MULTIPLIERS[at(i + 1)];
    return mul ? { amount: base * mul, used: new Set([i, i + 1]) } : { amount: base, used: new Set([i]) };
  };
  // Digits win over number words, so "एक फोटो 50" is ₹50, not ₹1.
  for (let i = 0; i < words.length; i++) {
    if (isNumber(at(i))) return withUnit(i, parseFloat(at(i)));
  }
  for (let i = 0; i < words.length; i++) {
    const w = at(i);
    // A bare "एक"/"दो" is usually a count ("एक फोटो"); only with सौ / हजार is it money.
    if (UNITS[w] !== undefined && ((MULTIPLIERS[at(i + 1)] && at(i + 1) !== "k") || UNITS[w] >= 10)) return withUnit(i, UNITS[w]);
    if (MULTIPLIERS[w] && w !== "k") return { amount: MULTIPLIERS[w], used: new Set([i]) };
  }
  return { amount: 0, used: new Set() };
}

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

  const rawWords = text.split(/\s+/).filter(Boolean);
  const { amount: found, used } = findAmount(rawWords);
  const amount = Math.round(found * 100) / 100;

  const words = rawWords.map((w) => clean(w).toLowerCase());
  const padded = ` ${words.join(" ")} `;
  // Whole words only: "Jamal" is a name, not "jama".
  const has = (kw: string) => padded.includes(` ${kw} `);

  let type: EntryType = "work";
  if (PAYMENT_KEYWORDS.some(has)) type = "payment";
  else if (GIVEN_KEYWORDS.some(has)) type = "given";
  else if (PURCHASE_KEYWORDS.some(has)) type = "purchase";

  const dateWord = words.find((w) => w in DATE_WORDS);
  const dateOffset = dateWord ? DATE_WORDS[dateWord] : 0;

  const cleanTokens = rawWords
    .filter((_, i) => !used.has(i))
    .map((w) => clean(w).trim())
    .filter((w) => w && !(w.toLowerCase() in DATE_WORDS) && !isNumber(w));

  // Whole-name or whole-word match first; a partial match only for longer words.
  const tokens = cleanTokens.map((t) => t.toLowerCase());
  const matchedCustomer =
    customers.find((c) => {
      const parts = c.name.toLowerCase().split(/\s+/).filter(Boolean);
      return parts.length > 1 && parts.every((p) => tokens.includes(p));
    }) ??
    customers.find((c) => tokens.includes(c.name.trim().toLowerCase())) ??
    customers.find((c) => c.name.toLowerCase().split(/\s+/).some((w) => tokens.includes(w))) ??
    customers.find((c) => tokens.some((t) => t.length >= 4 && !NOISE.has(t) && c.name.toLowerCase().includes(t))) ??
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

  const nameParts = new Set(customerName.toLowerCase().split(/\s+/).filter(Boolean));
  const descTokens = cleanTokens.filter((t) => !NOISE.has(t.toLowerCase()) && !nameParts.has(t.toLowerCase()));
  const description =
    descTokens.join(" ").trim() || (type === "payment" ? "भुगतान मिला" : type === "given" ? "पैसे दिए" : type === "purchase" ? "सामान / सेवा ली" : "काम");

  const confidence = amount > 0 && customerName.length > 0 ? (matchedCustomer ? "high" : "medium") : "low";

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
