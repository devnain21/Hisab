// Fallback for OTA bundles, which don't get the build's env vars.
const BASE = ((process.env.EXPO_PUBLIC_BACKEND_URL as string | undefined) || "https://hisab-api-4i09.onrender.com").replace(/\/$/, "");

type TokenProvider = () => Promise<string | null>;

let tokenProvider: TokenProvider | null = null;

export function setTokenProvider(fn: TokenProvider | null) {
  tokenProvider = fn;
}

async function authHeaders(): Promise<Record<string, string>> {
  const t = tokenProvider ? await tokenProvider() : null;
  return t ? { Authorization: `Bearer ${t}` } : {};
}

// The free server can take most of a minute to wake up; past that a request is treated as lost and retried.
const REQUEST_TIMEOUT_MS = 60_000;

async function fetchWithTimeout(url: string, opts: RequestInit, ms: number) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
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
  const res = await fetchWithTimeout(`${BASE}/api${path}`, { ...opts, headers }, REQUEST_TIMEOUT_MS);
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

/** True when the server answers at all, so one failing change can be told apart from an outage. */
export async function serverIsUp() {
  if (!BASE) return false;
  try {
    // /health also checks the database; a server deployed before it existed answers 404 there.
    const res = await fetchWithTimeout(`${BASE}/api/health`, {}, 20_000);
    if (res.status !== 404) return res.ok;
    return (await fetchWithTimeout(`${BASE}/api/`, {}, 20_000)).ok;
  } catch {
    return false;
  }
}

/** Which saved copy an edit was made from, so the server won't overwrite a newer one from another device. */
const based = (base?: string): Record<string, string> => (base ? { "X-Base-Updated-At": base } : {});

export const api = {
  login: (id_token: string) =>
    req("/auth/login", { method: "POST", body: JSON.stringify({ id_token }) }),
  me: () => req("/auth/me"),
  updateMe: (b: { shop_name: string; shop_phone?: string; shop_address?: string; shop_gst?: string; shop_upi?: string; owner_name?: string; persona?: string; shop_logo?: string; shop_signature?: string }) =>
    req("/auth/me", { method: "PUT", body: JSON.stringify(b) }),
  logout: () => req("/auth/logout", { method: "POST" }),
  ledgerUrl: (token: string) => `${BASE}/l/${token}`,
  getLedgerLink: (customerId: string): Promise<{ token: string }> => req(`/customers/${customerId}/ledger-link`),
  createLedgerLink: (customerId: string): Promise<{ token: string }> => req(`/customers/${customerId}/ledger-link`, { method: "POST" }),
  revokeLedgerLink: (customerId: string) => req(`/customers/${customerId}/ledger-link`, { method: "DELETE" }),
  getHistory: (coll: string, id: string): Promise<{ at: string; changes: Record<string, [unknown, unknown]> }[]> =>
    req(`/history/${coll}/${encodeURIComponent(id)}`),
  listArchive: (): Promise<{ coll: string; id: string; deletedAt: string; doc: Record<string, unknown> }[]> => req("/archive"),
  restoreArchive: (coll: string, id: string): Promise<{ ok: boolean; restored: number }> =>
    req("/archive/restore", { method: "POST", body: JSON.stringify({ coll, id }) }),
  purgeArchive: (items: { coll: string; id: string }[]): Promise<{ ok: boolean; removed: number }> =>
    req("/archive/purge", { method: "POST", body: JSON.stringify({ items }) }),
  getSettings: (): Promise<{ data: Record<string, unknown> | null; updatedAt: string }> => req("/settings"),
  putSettings: (b: { data: Record<string, unknown>; updatedAt: string }) => req("/settings", { method: "PUT", body: JSON.stringify(b) }),
  closeShop: () => req("/shop/close", { method: "POST" }),
  listCustomers: () => req("/customers"),
  createCustomer: (b: unknown) => req("/customers", { method: "POST", body: JSON.stringify(b) }),
  updateCustomer: (id: string, b: unknown, base?: string) => req(`/customers/${id}`, { method: "PUT", body: JSON.stringify(b), headers: based(base) }),
  deleteCustomer: (id: string) => req(`/customers/${id}`, { method: "DELETE" }),
  listEntries: () => req("/entries"),
  createEntry: (b: unknown) => req("/entries", { method: "POST", body: JSON.stringify(b) }),
  updateEntry: (id: string, b: unknown, base?: string) => req(`/entries/${id}`, { method: "PUT", body: JSON.stringify(b), headers: based(base) }),
  deleteEntry: (id: string) => req(`/entries/${id}`, { method: "DELETE" }),
  listJobs: () => req("/jobs"),
  createJob: (b: unknown) => req("/jobs", { method: "POST", body: JSON.stringify(b) }),
  updateJob: (id: string, b: unknown, base?: string) => req(`/jobs/${id}`, { method: "PUT", body: JSON.stringify(b), headers: based(base) }),
  deleteJob: (id: string) => req(`/jobs/${id}`, { method: "DELETE" }),
  listAeps: () => req("/aeps"),
  createAeps: (b: unknown) => req("/aeps", { method: "POST", body: JSON.stringify(b) }),
  updateAeps: (id: string, b: unknown, base?: string) => req(`/aeps/${id}`, { method: "PUT", body: JSON.stringify(b), headers: based(base) }),
  deleteAeps: (id: string) => req(`/aeps/${id}`, { method: "DELETE" }),
  listExpenses: () => req("/expenses"),
  createExpense: (b: unknown) => req("/expenses", { method: "POST", body: JSON.stringify(b) }),
  updateExpense: (id: string, b: unknown, base?: string) => req(`/expenses/${id}`, { method: "PUT", body: JSON.stringify(b), headers: based(base) }),
  deleteExpense: (id: string) => req(`/expenses/${id}`, { method: "DELETE" }),
  // The server names the move ends src/dst; the app uses from/to.
  listMoves: async () =>
    ((await req("/moves")) as ({ src: string; dst: string } & Record<string, unknown>)[]).map(({ src, dst, ...m }) => ({ ...m, from: src, to: dst })),
  createMove: ({ from, to, ...m }: { from: string; to: string } & Record<string, unknown>) =>
    req("/moves", { method: "POST", body: JSON.stringify({ ...m, src: from, dst: to }) }),
  updateMove: (id: string, { from, to, ...m }: { from: string; to: string } & Record<string, unknown>, base?: string) =>
    req(`/moves/${id}`, { method: "PUT", body: JSON.stringify({ ...m, src: from, dst: to }), headers: based(base) }),
  deleteMove: (id: string) => req(`/moves/${id}`, { method: "DELETE" }),
};
