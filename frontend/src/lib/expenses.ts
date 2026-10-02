import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";
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
  "अन्य",
];

export const PERSONAL_EXPENSE_CATEGORIES = ["घर का खर्च", "राशन", "बिजली बिल", "पेट्रोल", "किराया", "दवाई", "अन्य"];

let cachedExpenses: Expense[] | null = null;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((fn) => fn());
}

export async function getExpenses(): Promise<Expense[]> {
  if (cachedExpenses) return cachedExpenses;
  try {
    const raw = await AsyncStorage.getItem(EXPENSES_KEY);
    cachedExpenses = raw ? JSON.parse(raw) : [];
  } catch {
    cachedExpenses = [];
  }
  return cachedExpenses || [];
}

export async function addExpense(payload: {
  amount: number;
  title: string;
  mode: ExpenseMode;
  date?: string;
  notes?: string;
  persona: "business" | "personal";
}): Promise<Expense> {
  const list = await getExpenses();
  const item: Expense = {
    id: `exp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    amount: payload.amount,
    title: payload.title.trim() || "खर्च",
    mode: payload.mode,
    date: payload.date || todayISO(),
    notes: payload.notes?.trim() || "",
    persona: payload.persona,
    createdAt: new Date().toISOString(),
  };

  const updated = [item, ...list];
  cachedExpenses = updated;
  await AsyncStorage.setItem(EXPENSES_KEY, JSON.stringify(updated)).catch(() => {});
  notify();
  return item;
}

export async function deleteExpense(id: string): Promise<void> {
  const list = await getExpenses();
  const updated = list.filter((e) => e.id !== id);
  cachedExpenses = updated;
  await AsyncStorage.setItem(EXPENSES_KEY, JSON.stringify(updated)).catch(() => {});
  notify();
}

export function useExpenses(date?: string, persona?: "business" | "personal"): { expenses: Expense[]; all: Expense[]; totalCash: number; totalOnline: number; totalAll: number } {
  const [list, setList] = useState<Expense[]>(cachedExpenses || []);

  useEffect(() => {
    getExpenses().then(setList);
    const listener = () => {
      setList(cachedExpenses || []);
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

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
