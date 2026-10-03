import { formatDate, formatINR, formatPhone, todayISO } from "./format";
import type { Customer, Entry, Job, AepsTxn } from "./data";
import type { Expense } from "./expenses";
import type { ShopProfile } from "../context/AuthContext";
import { shareMessage } from "./share-text";
import type { PocketFlow } from "./wallet";

export type DaySummaryData = {
  date: string;
  shop: Partial<ShopProfile>;
  // Work & Collections
  workTotal: number;
  workFees: number;
  workProfit: number;
  workCash: number;
  workOnline: number;
  workUdhaar: number;
  // Fees Paid breakdown
  feePaidOnline: number;
  feePaidCash: number;
  // Payments
  paymentCash: number;
  paymentOnline: number;
  // Expenses
  expenseCash: number;
  expenseOnline: number;
  // Contra
  bankToCash: number;
  cashToBank: number;
  // Cash Drawer
  openingCash: number;
  expectedCash: number;
  countedCash: number | null;
  cashDiff: number | null;
  // Bank Account
  openingBank: number;
  expectedBank: number;
  actualBank: number | null;
  bankDiff: number | null;
  // Every rupee through each pocket that day (same numbers as the galla / bank cards)
  cashFlow: PocketFlow;
  bankFlow: PocketFlow;
  // Net
  netProfitEstimate: number;
};

export function buildDayCloseMessage(data: DaySummaryData): string {
  const shopName = data.shop.shop_name || "दुकान खाता";
  const dateStr = formatDate(data.date);

  const lines: string[] = [
    `🌙 *दुकान बंद रिपोर्ट / दिन का हिसाब*`,
    `🏪 *${shopName}*`,
    `📅 तारीख: ${dateStr}`,
    `--------------------------------`,
    `💼 *आज की कुल बिक्री / काम:* ${formatINR(data.workTotal)}`,
  ];

  if (data.workFees > 0) {
    lines.push(`  • पोर्टल/सरकारी फीस कटी: -${formatINR(data.workFees)}`);
    lines.push(`  • काम से शुद्ध बचत: ${formatINR(data.workProfit || data.workTotal - data.workFees)}`);
  }

  lines.push(
    `  • नकद मिले: ${formatINR(data.workCash)}`,
    `  • ऑनलाइन/UPI: ${formatINR(data.workOnline)}`,
    `  • आज की उधारी: ${formatINR(data.workUdhaar)}`,
    ``,
    `💰 *पुरानी उधारी वापसी (मिले):* ${formatINR(data.paymentCash + data.paymentOnline)}`,
    `  • नकद मिले: ${formatINR(data.paymentCash)}`,
    `  • ऑनलाइन मिले: ${formatINR(data.paymentOnline)}`,
    ``,
    `☕ *आज का दुकान खर्च:* ${formatINR(data.expenseCash + data.expenseOnline)}`,
    `  • गल्ले से दिया: ${formatINR(data.expenseCash)}`,
    `  • बैंक/UPI से दिया: ${formatINR(data.expenseOnline)}`,
  );

  const c = data.cashFlow;
  const b = data.bankFlow;
  const counter = c.counterIn + c.counterOut + b.counterIn + b.counterOut + c.commission + b.commission;
  if (counter > 0) {
    lines.push(
      ``,
      `👆 *काउंटर (AEPS / UPI):*`,
      `  • गल्ला: +${formatINR(c.counterIn)} / −${formatINR(c.counterOut)}`,
      `  • बैंक: +${formatINR(b.counterIn)} / −${formatINR(b.counterOut)}`,
      `  • कमीशन: ${formatINR(c.commission + b.commission)}`,
    );
  }
  const handedOut = c.given + c.purchase + b.given + b.purchase;
  if (handedOut > 0) lines.push(``, `🤝 *दिए / सामान के पैसे:* ${formatINR(handedOut)} (गल्ला ${formatINR(c.given + c.purchase)} · बैंक ${formatINR(b.given + b.purchase)})`);
  if (data.bankToCash + data.cashToBank > 0) {
    lines.push(``, `🔁 *गल्ला ↔ बैंक:* बैंक से गल्ले में ${formatINR(data.bankToCash)} · गल्ले से बैंक में ${formatINR(data.cashToBank)}`);
  }
  const otherIn = c.moveIn - data.bankToCash;
  const otherOut = c.moveOut - data.cashToBank;
  if (otherIn > 0 || otherOut > 0) lines.push(`  • गल्ले में बाहर से जोड़े ${formatINR(Math.max(otherIn, 0))} · बाहर निकाले ${formatINR(Math.max(otherOut, 0))}`);

  lines.push(
    ``,
    `--------------------------------`,
    `💵 *दुकान का गल्ला (Cash Drawer):*`,
    `  • सुबह का गल्ला: ${formatINR(data.openingCash)}`,
    `  • शाम को होना चाहिए: ${formatINR(data.expectedCash)}`,
  );

  if (data.countedCash !== null) {
    lines.push(`  • गिने हुए नोट: ${formatINR(data.countedCash)}`);
    if (data.cashDiff === 0) {
      lines.push(`  • स्थिति: ✅ गल्ला बिल्कुल सही है!`);
    } else if (data.cashDiff && data.cashDiff > 0) {
      lines.push(`  • स्थिति: ⚠️ गल्ले में ${formatINR(data.cashDiff)} ज़्यादा हैं`);
    } else if (data.cashDiff && data.cashDiff < 0) {
      lines.push(`  • स्थिति: ⚠️ गल्ले में ${formatINR(-data.cashDiff)} कम हैं`);
    }
  }

  lines.push(
    ``,
    `📱 *ऑनलाइन बैंक / UPI खाता:*`,
    `  • सुबह का बैलेंस: ${formatINR(data.openingBank)}`,
    `  • शाम को होना चाहिए: ${formatINR(data.expectedBank)}`,
  );

  if (data.actualBank !== null) {
    lines.push(`  • बैंक में मौजूद: ${formatINR(data.actualBank)}`);
  }

  const realNetProfit = data.netProfitEstimate;

  lines.push(
    `--------------------------------`,
    `🎯 *आज गल्ले में बदलाव:* ${data.expectedCash - data.openingCash < 0 ? "−" : "+"}${formatINR(Math.abs(data.expectedCash - data.openingCash))}`,
    `✨ *आज की शुद्ध बचत (काम − फीस + कमीशन − खर्च):* ${formatINR(realNetProfit)}`,
    `--------------------------------`,
    `🙏 हिसाब पूरा हुआ · शुभ रात्रि!`,
  );

  return lines.join("\n");
}

export async function shareDayCloseReport(data: DaySummaryData): Promise<void> {
  const msg = buildDayCloseMessage(data);
  await shareMessage(msg);
}
