import { formatDate, formatINR, formatPhone, todayISO } from "./format";
import type { Customer, Entry, Job, AepsTxn } from "./data";
import type { Expense } from "./expenses";
import type { ContraTransfer } from "./contra";
import type { ShopProfile } from "../context/AuthContext";
import { shareMessage } from "./share-text";

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
    `🎯 *आज का शुद्ध नकद बहाव:* ${formatINR(data.workCash + data.paymentCash - (data.expenseCash + (data.feePaidCash || 0)))}`,
    `✨ *आज की शुद्ध बचत (काम - फीस - खर्च):* ${formatINR(realNetProfit)}`,
    `--------------------------------`,
    `🙏 हिसाब पूरा हुआ · शुभ रात्रि!`,
  );

  return lines.join("\n");
}

export async function shareDayCloseReport(data: DaySummaryData): Promise<void> {
  const msg = buildDayCloseMessage(data);
  await shareMessage(msg);
}
