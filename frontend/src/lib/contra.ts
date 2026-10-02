import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";
import { todayISO } from "./format";

export type ContraType = "bank_to_cash" | "cash_to_bank";

export type ContraTransfer = {
  id: string;
  type: ContraType;
  amount: number;
  date: string;
  notes?: string;
  createdAt: string;
};

const CONTRA_KEY = "hisab_contra_transfers_v1";

let cachedContra: ContraTransfer[] | null = null;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((fn) => fn());
}

export async function getContraTransfers(): Promise<ContraTransfer[]> {
  if (cachedContra) return cachedContra;
  try {
    const raw = await AsyncStorage.getItem(CONTRA_KEY);
    cachedContra = raw ? JSON.parse(raw) : [];
  } catch {
    cachedContra = [];
  }
  return cachedContra || [];
}

export async function addContraTransfer(payload: {
  type: ContraType;
  amount: number;
  date?: string;
  notes?: string;
}): Promise<ContraTransfer> {
  const list = await getContraTransfers();
  const item: ContraTransfer = {
    id: `contra_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type: payload.type,
    amount: payload.amount,
    date: payload.date || todayISO(),
    notes: payload.notes || "",
    createdAt: new Date().toISOString(),
  };

  const updated = [item, ...list];
  cachedContra = updated;
  await AsyncStorage.setItem(CONTRA_KEY, JSON.stringify(updated)).catch(() => {});
  notify();
  return item;
}

export async function deleteContraTransfer(id: string): Promise<void> {
  const list = await getContraTransfers();
  const updated = list.filter((c) => c.id !== id);
  cachedContra = updated;
  await AsyncStorage.setItem(CONTRA_KEY, JSON.stringify(updated)).catch(() => {});
  notify();
}

export function useContraTransfers(date?: string) {
  const [list, setList] = useState<ContraTransfer[]>(cachedContra || []);

  useEffect(() => {
    getContraTransfers().then(setList);
    const listener = () => {
      setList(cachedContra || []);
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const filtered = date ? list.filter((c) => c.date === date) : list;
  // Bank to Cash: ATM से निकाला -> गल्ला बढ़ा, बैंक घटा
  const bankToCash = filtered.filter((c) => c.type === "bank_to_cash").reduce((s, c) => s + c.amount, 0);
  // Cash to Bank: बैंक में जमा किया -> गल्ला घटा, बैंक बढ़ा
  const cashToBank = filtered.filter((c) => c.type === "cash_to_bank").reduce((s, c) => s + c.amount, 0);

  return {
    transfers: filtered,
    bankToCash,
    cashToBank,
  };
}
