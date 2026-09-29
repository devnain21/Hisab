import { useQuery } from "@tanstack/react-query";
import { api } from "@/src/lib/api";
import { withPending } from "@/src/lib/store";

export type Customer = { id: string; name: string; phone: string; address: string; notes: string; createdAt: string };
export type Entry = { id: string; customerId: string; type: "work" | "payment"; date: string; description: string; amount: number; notes: string; createdAt: string };
export type Job = { id: string; customerId: string; title: string; dueDate: string; status: "pending" | "doing" | "done"; estimatedAmount: number; notes: string; createdAt: string };

export function useCustomers() {
  return useQuery<Customer[]>({ queryKey: ["customers"], queryFn: async () => withPending("customers", await api.listCustomers()) });
}
export function useEntries() {
  return useQuery<Entry[]>({ queryKey: ["entries"], queryFn: async () => withPending("entries", await api.listEntries()) });
}
export function useJobs() {
  return useQuery<Job[]>({ queryKey: ["jobs"], queryFn: async () => withPending("jobs", await api.listJobs()) });
}

export function computeBalance(entries: Entry[], customerId?: string): number {
  const list = customerId ? entries.filter((e) => e.customerId === customerId) : entries;
  return list.reduce((s, e) => s + (e.type === "work" ? e.amount : -e.amount), 0);
}
