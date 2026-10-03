import AsyncStorage from "@react-native-async-storage/async-storage";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import * as Crypto from "expo-crypto";
import { api } from "./api";
import { store, withPending } from "./store";
import { isBackdated, todayISO } from "./format";
import { isRepayment, useAeps, useCustomers, useEntries, type AepsTxn, type Customer, type Entry } from "./data";
import { useExpenses, expensePersona, type Expense } from "./expenses";
import { aepsTotals } from "./aeps";
import type { Persona } from "./persona";

export type Pocket = "cash" | "bank";
/** `${persona}:${pocket}`, or "" for money coming from / going outside the app's accounts. */
export type AccountKey = `${Persona}:${Pocket}` | "";

export type Move = {
  id: string;
  date: string;
  from: AccountKey;
  to: AccountKey;
  amount: number;
  /** Where the money came from or went, when that is outside the app. */
  note: string;
  createdAt: string;
};

const MOVES_KEY = "hisab_money_moves_v1";
const LEGACY_CONTRA_KEY = "hisab_contra_transfers_v1";

/** Moves saved on this phone before they were stored on the server; queued for upload once. */
async function uploadLocalMoves() {
  try {
    const raw = await AsyncStorage.getItem(MOVES_KEY);
    const legacy = await AsyncStorage.getItem(LEGACY_CONTRA_KEY);
    const list: Move[] = raw ? JSON.parse(raw) : [];
    if (legacy) {
      const old = JSON.parse(legacy) as { id: string; type: string; amount: number; date: string; notes?: string; createdAt: string }[];
      old.forEach((c) =>
        list.push({
          id: c.id,
          date: c.date,
          from: c.type === "bank_to_cash" ? "business:bank" : "business:cash",
          to: c.type === "bank_to_cash" ? "business:cash" : "business:bank",
          amount: c.amount,
          note: c.notes || "",
          createdAt: c.createdAt,
        })
      );
    }
    list.forEach((m) => store.createMove(m));
    if (raw) await AsyncStorage.removeItem(MOVES_KEY);
    if (legacy) await AsyncStorage.removeItem(LEGACY_CONTRA_KEY);
  } catch {}
}

export async function addMove(m: Omit<Move, "id" | "createdAt">): Promise<Move> {
  const item: Move = { ...m, id: Crypto.randomUUID(), createdAt: new Date().toISOString() };
  store.createMove(item);
  return item;
}

export async function deleteMove(id: string) {
  store.deleteMove(id);
}

const NO_MOVES: Move[] = [];

export function useMoves(): Move[] {
  const q = useQuery<Move[]>({
    queryKey: ["moves"],
    queryFn: async () => {
      await uploadLocalMoves();
      return withPending("moves", (await api.listMoves()) as Move[]);
    },
  });
  return q.data ?? NO_MOVES;
}

export const accountKey = (persona: Persona, pocket: Pocket): AccountKey => `${persona}:${pocket}`;

export function pocketName(persona: Persona, pocket: Pocket): string {
  if (pocket === "bank") return persona === "business" ? "दुकान बैंक" : "निजी बैंक";
  return persona === "business" ? "गल्ला" : "निजी कैश";
}

export function accountLabel(key: AccountKey): string {
  if (!key) return "बाहर";
  const [persona, pocket] = key.split(":") as [Persona, Pocket];
  return pocketName(persona, pocket);
}

/** Money in and out of one pocket, by reason. */
export type PocketFlow = {
  work: number;
  received: number;
  counterIn: number;
  commission: number;
  moveIn: number;
  counterOut: number;
  expense: number;
  fee: number;
  given: number;
  /** Goods / services paid for: on the spot or paying back a purchase. */
  purchase: number;
  moveOut: number;
};
export type Flows = Record<Pocket, PocketFlow>;

const emptyPocket = (): PocketFlow => ({ work: 0, received: 0, counterIn: 0, commission: 0, moveIn: 0, counterOut: 0, expense: 0, fee: 0, given: 0, purchase: 0, moveOut: 0 });
export const pocketIn = (f: PocketFlow) => f.work + f.received + f.counterIn + f.commission + f.moveIn;
export const pocketOut = (f: PocketFlow) => f.counterOut + f.expense + f.fee + f.given + f.purchase + f.moveOut;
export const pocketNet = (f: PocketFlow) => pocketIn(f) - pocketOut(f);

type Book = { entries: Entry[]; customers: Customer[]; aeps: AepsTxn[]; expenses: Expense[]; moves: Move[] };

export function personaOfEntry(e: Entry, byId: Map<string, Customer>): Persona {
  return byId.get(e.customerId)?.persona === "personal" ? "personal" : "business";
}

/** Every rupee that moved through this persona's cash and bank on the dates `keep` accepts. */
export function computeFlows(book: Book, persona: Persona, keep: (date: string) => boolean): Flows {
  const f: Flows = { cash: emptyPocket(), bank: emptyPocket() };
  const byId = new Map(book.customers.map((c) => [c.id, c]));
  const pocketOf = (mode?: string): Pocket => (mode === "online" ? "bank" : "cash");

  for (const e of book.entries) {
    if (!keep(e.date) || isBackdated(e.date, e.createdAt) || personaOfEntry(e, byId) !== persona) continue;
    if (e.type === "work") {
      f[pocketOf(e.mode)].work += e.paid ?? 0;
      if ((e.fee ?? 0) > 0) f[e.feeMode === "cash" ? "cash" : "bank"].fee += e.fee ?? 0;
    } else if (e.type === "payment") {
      f[pocketOf(e.mode)].received += e.amount;
    } else if (e.type === "aeps") {
      continue;
    } else if (e.type === "purchase") {
      f[pocketOf(e.mode)].purchase += e.paid ?? 0;
    } else if (isRepayment(e)) {
      f[pocketOf(e.mode)].purchase += e.amount;
    } else {
      f[pocketOf(e.mode)].given += e.amount;
    }
  }

  if (persona === "business") {
    const t = aepsTotals(book.aeps, keep);
    f.cash.counterIn += t.cashIn;
    f.cash.counterOut += t.cashOut;
    f.cash.commission += t.commissionCash;
    f.bank.counterIn += t.bankIn;
    f.bank.counterOut += t.bankOut;
    f.bank.commission += t.commissionBank;
  }

  for (const x of book.expenses) {
    if (!keep(x.date) || isBackdated(x.date, x.createdAt) || expensePersona(x) !== persona) continue;
    f[x.mode === "online" ? "bank" : "cash"].expense += x.amount;
  }

  for (const m of book.moves) {
    if (!keep(m.date)) continue;
    for (const pocket of ["cash", "bank"] as Pocket[]) {
      const key = accountKey(persona, pocket);
      if (m.from === key) f[pocket].moveOut += m.amount;
      if (m.to === key) f[pocket].moveIn += m.amount;
    }
  }
  return f;
}

/** All the money data, ready for balances. */
export function useMoneyBook() {
  const entries = useEntries().data;
  const customers = useCustomers().data;
  const aeps = useAeps().data;
  const { all: expenses } = useExpenses();
  const moves = useMoves();
  return useMemo<Book>(
    () => ({ entries: entries ?? [], customers: customers ?? [], aeps: aeps ?? [], expenses, moves }),
    [entries, customers, aeps, expenses, moves]
  );
}

/** Current balance of one pocket, counting everything up to and including today. */
export function balanceOf(book: Book, key: Exclude<AccountKey, "">, upTo = todayISO()): number {
  const [persona, pocket] = key.split(":") as [Persona, Pocket];
  return pocketNet(computeFlows(book, persona, (d) => d <= upTo)[pocket]);
}
