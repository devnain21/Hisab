const BASE = (process.env.EXPO_PUBLIC_BACKEND_URL as string | undefined)?.replace(/\/$/, "") || "";

type TokenProvider = () => Promise<string | null>;

let tokenProvider: TokenProvider | null = null;

export function setTokenProvider(fn: TokenProvider | null) {
  tokenProvider = fn;
}

async function authHeaders(): Promise<Record<string, string>> {
  const t = tokenProvider ? await tokenProvider() : null;
  return t ? { Authorization: `Bearer ${t}` } : {};
}

async function req(path: string, opts: RequestInit = {}) {
  if (!BASE) {
    throw new Error("EXPO_PUBLIC_BACKEND_URL set nahi hai");
  }
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(await authHeaders()),
    ...((opts.headers as Record<string, string>) || {}),
  };
  const res = await fetch(`${BASE}/api${path}`, { ...opts, headers });
  if (res.status === 401) {
    const err: Error & { status?: number } = new Error("Unauthorized");
    err.status = 401;
    throw err;
  }
  if (!res.ok) {
    const text = await res.text();
    const err: Error & { status?: number } = new Error(text || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return res.json();
  return null;
}

export function wakeBackend() {
  if (BASE) fetch(`${BASE}/api/`).catch(() => {});
}

export const api = {
  login: (id_token: string) =>
    req("/auth/login", { method: "POST", body: JSON.stringify({ id_token }) }),
  me: () => req("/auth/me"),
  updateMe: (b: { shop_name: string; shop_phone?: string; shop_address?: string; shop_gst?: string; shop_upi?: string; owner_name?: string; persona?: string }) =>
    req("/auth/me", { method: "PUT", body: JSON.stringify(b) }),
  logout: () => req("/auth/logout", { method: "POST" }),
  closeShop: () => req("/shop/close", { method: "POST" }),
  listCustomers: () => req("/customers"),
  createCustomer: (b: unknown) => req("/customers", { method: "POST", body: JSON.stringify(b) }),
  updateCustomer: (id: string, b: unknown) => req(`/customers/${id}`, { method: "PUT", body: JSON.stringify(b) }),
  deleteCustomer: (id: string) => req(`/customers/${id}`, { method: "DELETE" }),
  listEntries: () => req("/entries"),
  createEntry: (b: unknown) => req("/entries", { method: "POST", body: JSON.stringify(b) }),
  updateEntry: (id: string, b: unknown) => req(`/entries/${id}`, { method: "PUT", body: JSON.stringify(b) }),
  deleteEntry: (id: string) => req(`/entries/${id}`, { method: "DELETE" }),
  listJobs: () => req("/jobs"),
  createJob: (b: unknown) => req("/jobs", { method: "POST", body: JSON.stringify(b) }),
  updateJob: (id: string, b: unknown) => req(`/jobs/${id}`, { method: "PUT", body: JSON.stringify(b) }),
  deleteJob: (id: string) => req(`/jobs/${id}`, { method: "DELETE" }),
  listAeps: () => req("/aeps"),
  createAeps: (b: unknown) => req("/aeps", { method: "POST", body: JSON.stringify(b) }),
  updateAeps: (id: string, b: unknown) => req(`/aeps/${id}`, { method: "PUT", body: JSON.stringify(b) }),
  deleteAeps: (id: string) => req(`/aeps/${id}`, { method: "DELETE" }),
  listExpenses: () => req("/expenses"),
  createExpense: (b: unknown) => req("/expenses", { method: "POST", body: JSON.stringify(b) }),
  updateExpense: (id: string, b: unknown) => req(`/expenses/${id}`, { method: "PUT", body: JSON.stringify(b) }),
  deleteExpense: (id: string) => req(`/expenses/${id}`, { method: "DELETE" }),
  // The server names the move ends src/dst; the app uses from/to.
  listMoves: async () =>
    ((await req("/moves")) as ({ src: string; dst: string } & Record<string, unknown>)[]).map(({ src, dst, ...m }) => ({ ...m, from: src, to: dst })),
  createMove: ({ from, to, ...m }: { from: string; to: string } & Record<string, unknown>) =>
    req("/moves", { method: "POST", body: JSON.stringify({ ...m, src: from, dst: to }) }),
  updateMove: (id: string, { from, to, ...m }: { from: string; to: string } & Record<string, unknown>) =>
    req(`/moves/${id}`, { method: "PUT", body: JSON.stringify({ ...m, src: from, dst: to }) }),
  deleteMove: (id: string) => req(`/moves/${id}`, { method: "DELETE" }),
};
