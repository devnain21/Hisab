import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQuery } from "@tanstack/react-query";
import * as Crypto from "expo-crypto";
import { api } from "./api";
import { store, withPending } from "./store";
import { todayISO } from "./format";

export type ExpenseMode = "cash" | "online";

export type Expense = {
  id: string;
  amount: number;
  title: string;
  mode: ExpenseMode; // "cash" = गल्ले से नकद, "online" = बैंक / UPI से
  date: string;
  notes?: string;
  /** Missing on rows saved before the personal account had its own cash; those were shop expenses. */
  persona?: "business" | "personal";
  createdAt: string;
};

export const expensePersona = (e: Expense) => e.persona ?? "business";

const EXPENSES_KEY = "hisab_expenses_v1";

export const EXPENSE_CATEGORIES = [
  "चाय-नाश्ता",
  "दुकान सामान",
  "किराया",
  "बिजली बिल",
  "पेट्रोल / किराया",
  "सफ़ाई",
  "बाहर का खर्च",
  "अन्य",
];

/** Money paid out for a customer's job (tehsil, outside help): a shop expense, not part of the work margin. */
export const OUTSIDE_COST = "बाहर का खर्च";

export const PERSONAL_EXPENSE_CATEGORIES = ["घर का खर्च", "राशन", "बिजली बिल", "पेट्रोल", "किराया", "दवाई", "अन्य"];

/** Expenses saved on this phone before they were stored on the server; queued for upload once. */
async function uploadLocalExpenses() {
  try {
    const raw = await AsyncStorage.getItem(EXPENSES_KEY);
    const old: Expense[] = raw ? JSON.parse(raw) : [];
    old.forEach((e) => store.createExpense({ ...e, notes: e.notes ?? "", persona: expensePersona(e) }));
    if (raw) await AsyncStorage.removeItem(EXPENSES_KEY);
  } catch {}
}

export function useExpenseList() {
  return useQuery<Expense[]>({
    queryKey: ["expenses"],
    queryFn: async () => {
      await uploadLocalExpenses();
      return withPending("expenses", await api.listExpenses());
    },
  });
}

export async function addExpense(payload: {
  amount: number;
  title: string;
  mode: ExpenseMode;
  date?: string;
  notes?: string;
  persona: "business" | "personal";
}): Promise<Expense> {
  const item: Expense = {
    id: Crypto.randomUUID(),
    amount: payload.amount,
    title: payload.title.trim() || "खर्च",
    mode: payload.mode,
    date: payload.date || todayISO(),
    notes: payload.notes?.trim() || "",
    persona: payload.persona,
    createdAt: new Date().toISOString(),
  };
  store.createExpense(item);
  return item;
}

export async function deleteExpense(id: string): Promise<void> {
  store.deleteExpense(id);
}

const NONE: Expense[] = [];

export function useExpenses(date?: string, persona?: "business" | "personal"): { expenses: Expense[]; all: Expense[]; totalCash: number; totalOnline: number; totalAll: number } {
  const list = useExpenseList().data ?? NONE;
  const filtered = list.filter((e) => (!date || e.date === date) && (!persona || expensePersona(e) === persona));
  const totalCash = filtered.filter((e) => e.mode === "cash").reduce((s, e) => s + e.amount, 0);
  const totalOnline = filtered.filter((e) => e.mode === "online").reduce((s, e) => s + e.amount, 0);

  return {
    expenses: filtered,
    all: list,
    totalCash,
    totalOnline,
    totalAll: totalCash + totalOnline,
  };
}
