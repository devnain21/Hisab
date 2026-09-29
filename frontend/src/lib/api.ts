import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const KEY = "nain_session_token";

export async function saveToken(token: string) {
  if (Platform.OS === "web") {
    try { window.localStorage.setItem(KEY, token); } catch {}
  } else {
    await SecureStore.setItemAsync(KEY, token);
  }
}

export async function getToken(): Promise<string | null> {
  if (Platform.OS === "web") {
    try { return window.localStorage.getItem(KEY); } catch { return null; }
  }
  return SecureStore.getItemAsync(KEY);
}

export async function clearToken() {
  if (Platform.OS === "web") {
    try { window.localStorage.removeItem(KEY); } catch {}
  } else {
    await SecureStore.deleteItemAsync(KEY);
  }
}

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL as string;

let inMemoryToken: string | null = null;

export function setInMemoryToken(t: string | null) {
  inMemoryToken = t;
}

async function authHeaders(): Promise<Record<string, string>> {
  const t = inMemoryToken ?? (await getToken());
  return t ? { Authorization: `Bearer ${t}` } : {};
}

async function req(path: string, opts: RequestInit = {}) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(await authHeaders()),
    ...((opts.headers as Record<string, string>) || {}),
  };
  const res = await fetch(`${BASE}/api${path}`, { ...opts, headers });
  if (res.status === 401) {
    inMemoryToken = null;
    await clearToken();
    const err: any = new Error("Unauthorized");
    err.status = 401;
    throw err;
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return res.json();
  return null;
}

export const api = {
  exchangeSession: (session_id: string) =>
    req("/auth/session", { method: "POST", body: JSON.stringify({ session_id }) }),
  me: () => req("/auth/me"),
  logout: () => req("/auth/logout", { method: "POST" }),
  // Customers
  listCustomers: () => req("/customers"),
  createCustomer: (b: any) => req("/customers", { method: "POST", body: JSON.stringify(b) }),
  updateCustomer: (id: string, b: any) => req(`/customers/${id}`, { method: "PUT", body: JSON.stringify(b) }),
  deleteCustomer: (id: string) => req(`/customers/${id}`, { method: "DELETE" }),
  // Entries
  listEntries: () => req("/entries"),
  createEntry: (b: any) => req("/entries", { method: "POST", body: JSON.stringify(b) }),
  deleteEntry: (id: string) => req(`/entries/${id}`, { method: "DELETE" }),
  // Jobs
  listJobs: () => req("/jobs"),
  createJob: (b: any) => req("/jobs", { method: "POST", body: JSON.stringify(b) }),
  updateJob: (id: string, b: any) => req(`/jobs/${id}`, { method: "PUT", body: JSON.stringify(b) }),
  deleteJob: (id: string) => req(`/jobs/${id}`, { method: "DELETE" }),
};
