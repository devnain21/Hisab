import AsyncStorage from "@react-native-async-storage/async-storage";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import * as Crypto from "expo-crypto";
import { api } from "./api";
import { store, withPending } from "./store";
import { isBackdated, roundMoney, todayISO } from "./format";
import { isRepayment, useAeps, useCustomers, useEntries, type AepsTxn, type Customer, type Entry } from "./data";
import { useExpenses, expensePersona, type Expense } from "./expenses";
import { aepsLegs } from "./aeps";
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

export async function addMove(m: Omit<Move, "id" | "createdAt">, createdAt?: string): Promise<Move> {
  const item: Move = { ...m, id: Crypto.randomUUID(), createdAt: createdAt ?? new Date().toISOString() };
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
// Rounded to paise: summed paise amounts leave float noise that would read as "−₹0".
export const pocketIn = (f: PocketFlow) => roundMoney(f.work + f.received + f.counterIn + f.commission + f.moveIn);
export const pocketOut = (f: PocketFlow) => roundMoney(f.counterOut + f.expense + f.fee + f.given + f.purchase + f.moveOut);
export const pocketNet = (f: PocketFlow) => roundMoney(pocketIn(f) - pocketOut(f)) + 0;

type Book = { entries: Entry[]; customers: Customer[]; aeps: AepsTxn[]; expenses: Expense[]; moves: Move[] };

export function personaOfEntry(e: Entry, byId: Map<string, Customer>): Persona {
  return byId.get(e.customerId)?.persona === "personal" ? "personal" : "business";
}

export type FlowKey = keyof PocketFlow;
export const IN_KEYS: FlowKey[] = ["work", "received", "counterIn", "commission", "moveIn"];

export type WalletSource =
  | { kind: "entry"; entry: Entry }
  | { kind: "expense"; expense: Expense }
  | { kind: "move"; move: Move }
  | { kind: "aeps"; txn: AepsTxn };

/** One rupee movement of one pocket. `amount` is always positive; `key` says which way and why. */
export type WalletTxn = {
  id: string;
  pocket: Pocket;
  key: FlowKey;
  amount: number;
  date: string;
  createdAt: string;
  src: WalletSource;
};

export const isInflow = (key: FlowKey) => IN_KEYS.includes(key);

/** Every rupee that moved through this persona's cash and bank on the dates `keep` accepts, one row per movement. */
export function walletTxns(book: Book, persona: Persona, keep: (date: string) => boolean): WalletTxn[] {
  const out: WalletTxn[] = [];
  const byId = new Map(book.customers.map((c) => [c.id, c]));
  const pocketOf = (mode?: string): Pocket => (mode === "online" ? "bank" : "cash");
  const push = (id: string, pocket: Pocket, key: FlowKey, amount: number, date: string, createdAt: string, src: WalletSource) => {
    if (amount > 0) out.push({ id, pocket, key, amount, date, createdAt, src });
  };

  for (const e of book.entries) {
    if (!keep(e.date) || isBackdated(e.date, e.createdAt) || personaOfEntry(e, byId) !== persona) continue;
    const src: WalletSource = { kind: "entry", entry: e };
    const p = pocketOf(e.mode);
    if (e.type === "work") {
      push(e.id, p, "work", e.paid ?? 0, e.date, e.createdAt, src);
      push(`${e.id}:fee`, e.feeMode === "cash" ? "cash" : "bank", "fee", e.fee ?? 0, e.date, e.createdAt, src);
    } else if (e.type === "payment") push(e.id, p, "received", e.amount, e.date, e.createdAt, src);
    else if (e.type === "aeps") continue;
    else if (e.type === "purchase") push(e.id, p, "purchase", e.paid ?? 0, e.date, e.createdAt, src);
    else if (isRepayment(e)) push(e.id, p, "purchase", e.amount, e.date, e.createdAt, src);
    else push(e.id, p, "given", e.amount, e.date, e.createdAt, src);
  }

  if (persona === "business") {
    for (const t of book.aeps) {
      aepsLegs(t).forEach((l, i) => {
        if (!keep(l.date)) return;
        const key: FlowKey = l.commission ? "commission" : l.dir === "in" ? "counterIn" : "counterOut";
        push(`${t.id}:${i}`, l.pocket, key, l.amount, l.date, t.createdAt, { kind: "aeps", txn: t });
      });
    }
  }

  for (const x of book.expenses) {
    if (!keep(x.date) || isBackdated(x.date, x.createdAt) || expensePersona(x) !== persona) continue;
    push(x.id, x.mode === "online" ? "bank" : "cash", "expense", x.amount, x.date, x.createdAt, { kind: "expense", expense: x });
  }

  for (const m of book.moves) {
    if (!keep(m.date) || isBackdated(m.date, m.createdAt)) continue;
    for (const pocket of ["cash", "bank"] as Pocket[]) {
      const key = accountKey(persona, pocket);
      if (m.from === key) push(`${m.id}:out`, pocket, "moveOut", m.amount, m.date, m.createdAt, { kind: "move", move: m });
      if (m.to === key) push(`${m.id}:in`, pocket, "moveIn", m.amount, m.date, m.createdAt, { kind: "move", move: m });
    }
  }
  return out;
}

/** Totals of `walletTxns` by pocket and reason, so every screen adds up the same rows. */
export function computeFlows(book: Book, persona: Persona, keep: (date: string) => boolean): Flows {
  const f: Flows = { cash: emptyPocket(), bank: emptyPocket() };
  for (const t of walletTxns(book, persona, keep)) f[t.pocket][t.key] += t.amount;
  return f;
}

/** A transfer between two of this book's own accounts: it changes neither its In nor its Out. */
export function isInternal(t: WalletTxn, persona: Persona): boolean {
  if (t.src.kind !== "move") return false;
  const { from, to } = t.src.move;
  return from.startsWith(`${persona}:`) && to.startsWith(`${persona}:`);
}

export type CashTotals = { ins: number; outs: number; net: number; byKey: Map<FlowKey, number> };

/** Money In / Out of cash and bank together for the dates `keep` accepts; Net equals the two pockets' nets added. */
export function cashTotals(book: Book, persona: Persona, keep: (date: string) => boolean): CashTotals {
  const byKey = new Map<FlowKey, number>();
  let ins = 0;
  let outs = 0;
  for (const t of walletTxns(book, persona, keep)) {
    if (isInternal(t, persona)) continue;
    if (isInflow(t.key)) ins += t.amount;
    else outs += t.amount;
    byKey.set(t.key, roundMoney((byKey.get(t.key) ?? 0) + t.amount));
  }
  return { ins: roundMoney(ins), outs: roundMoney(outs), net: roundMoney(ins - outs) + 0, byKey };
}

/** All the money data, ready for balances. */
export function useMoneyBook() {
  const entries = useEntries().data;
  const customers = useCustomers().data;
  const aeps = useAeps().data;
  const { all: expenses } = useExpenses();
  const moves = useMoves();
  return useMemo<Book>(
    // An entry's book is known from its customer; until customers load, personal rows would count as shop money.
    () => ({ entries: customers ? (entries ?? []) : [], customers: customers ?? [], aeps: aeps ?? [], expenses, moves }),
    [entries, customers, aeps, expenses, moves]
  );
}

/** Current balance of one pocket, counting everything up to and including today. */
export function balanceOf(book: Book, key: Exclude<AccountKey, "">, upTo = todayISO()): number {
  const [persona, pocket] = key.split(":") as [Persona, Pocket];
  return pocketNet(computeFlows(book, persona, (d) => d <= upTo)[pocket]);
}
