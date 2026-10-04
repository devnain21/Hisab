/**
 * The one vocabulary for money positions.
 * Screens speak to the owner ("आपको …"); slips and PDFs are read by the other person,
 * so shared documents use the neutral `doc*` words instead.
 * Balance sign everywhere: + means they owe you, − means you hold their money.
 */
export const TERMS = {
  get: "आपको मिलेंगे",
  getShort: "मिलेंगे",
  give: "आपको देने हैं",
  giveShort: "देने हैं",
  advance: "एडवांस जमा",
  advanceShort: "एडवांस",
  settled: "चुकता",
  received: "भुगतान मिला",
  paid: "भुगतान दिया",
  docDue: "बकाया राशि",
  docDueShort: "बकाया",
  docTheirs: "आपके बाकी",
  docSettled: "हिसाब चुकता",
} as const;

/** Owner-facing word for a balance. Personal contacts are paid back; shop customers keep an advance. */
export function balanceTerm(balance: number, personal: boolean, short = false): string {
  if (balance > 0) return short ? TERMS.getShort : TERMS.get;
  if (balance < 0) {
    if (personal) return short ? TERMS.giveShort : TERMS.give;
    return short ? TERMS.advanceShort : TERMS.advance;
  }
  return TERMS.settled;
}

/** Total heading for a list of balances, e.g. "कुल मिलेंगे". */
export function totalTerm(owedToYou: boolean, personal: boolean): string {
  return `कुल ${owedToYou ? TERMS.getShort : personal ? TERMS.giveShort : TERMS.advanceShort}`;
}

/** Word for a balance printed on a slip the other person reads. */
export function docBalanceTerm(balance: number, isCustomer: boolean, short = false): string {
  if (balance > 0) return short ? TERMS.docDueShort : TERMS.docDue;
  if (balance < 0) return isCustomer ? (short ? TERMS.advanceShort : TERMS.advance) : TERMS.docTheirs;
  return TERMS.docSettled;
}
