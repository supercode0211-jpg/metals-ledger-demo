import { z } from "zod";

// Response schemas, mirroring api/src/lib/views.ts. Every response is parsed,
// so a backend change shows up as a clear error instead of NaN on screen.

export const METALS = ["gold", "silver", "platinum"] as const;
export type Metal = (typeof METALS)[number];

const metal = z.enum(METALS);
const grams = z.string().regex(/^-?\d+\.\d{3}$/);

const userSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.enum(["user", "admin"]),
});
export type SessionUser = z.infer<typeof userSchema>;

const balanceSchema = z.object({
  metal,
  available: grams,
  held: grams,
  total: grams,
  availableMg: z.number().int(),
  heldMg: z.number().int(),
  totalMg: z.number().int(),
});
export type Balance = z.infer<typeof balanceSchema>;

const requestSchema = z.object({
  id: z.string(),
  type: z.enum(["deposit", "withdrawal", "redemption"]),
  metal,
  grams,
  amountMg: z.number().int(),
  status: z.enum(["pending", "completed", "rejected"]),
  note: z.string().nullable(),
  reason: z.string().nullable(),
  createdAt: z.string(),
  decidedAt: z.string().nullable(),
  user: z.object({ id: z.string(), name: z.string(), email: z.string() }).nullable().optional(),
});
export type MetalRequest = z.infer<typeof requestSchema>;
export type RequestType = MetalRequest["type"];

const ledgerEntrySchema = z.object({
  id: z.string(),
  requestId: z.string(),
  kind: z.enum(["deposit_credit", "hold", "settle", "release"]),
  metal,
  available: grams,
  held: grams,
  availableAfter: grams,
  heldAfter: grams,
  createdAt: z.string(),
});
export type LedgerEntry = z.infer<typeof ledgerEntrySchema>;

const reconciliationSchema = z.object({
  ok: z.boolean(),
  checkedAt: z.string(),
  balancesChecked: z.number(),
  issues: z.array(
    z.object({
      user: z.string(),
      metal,
      check: z.string(),
      expectedMg: z.number(),
      actualMg: z.number(),
    })
  ),
  liabilities: z.array(z.object({ metal, total: grams })),
});
export type Reconciliation = z.infer<typeof reconciliationSchema>;

const reserveSchema = z.object({
  status: z.string(),
  asOf: z.string(),
  metals: z.array(
    z.object({ metal, liabilities: grams, reserves: grams.nullable(), coverage: z.number().nullable() })
  ),
});
export type ProofOfReserve = z.infer<typeof reserveSchema>;

const envelope = <T extends z.ZodType>(data: T) => z.object({ success: z.literal(true), data });

// ---------------------------------------------------------------------------

const SESSION_KEY = "metals-ledger-session";
const sessionSchema = z.object({ token: z.string(), user: userSchema });
export type Session = z.infer<typeof sessionSchema>;

export function loadSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? sessionSchema.parse(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function saveSession(session: Session) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // Private mode etc. The session just won't survive a reload.
  }
}

export function clearSession() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // nothing to clear
  }
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export const errorMessage = (error: unknown) =>
  error instanceof ApiError ? error.message : "Something went wrong. Please try again.";

async function call<S extends z.ZodType>(
  path: string,
  schema: S,
  init: RequestInit & { idempotencyKey?: string } = {}
): Promise<z.infer<S>> {
  const { idempotencyKey, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (rest.body) headers.set("Content-Type", "application/json");
  if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey);
  const session = loadSession();
  if (session) headers.set("Authorization", `Bearer ${session.token}`);

  let res: Response;
  try {
    res = await fetch(path, { ...rest, headers, cache: "no-store" });
  } catch {
    throw new ApiError(0, "NETWORK", "Can't reach the server. Check your connection and try again.");
  }

  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.success) {
    if (res.status === 401 && session) clearSession();
    throw new ApiError(res.status, body?.code ?? "UNKNOWN", body?.message ?? `Request failed (${res.status})`);
  }
  return schema.parse(body);
}

const post = (body?: unknown, idempotencyKey?: string): RequestInit & { idempotencyKey?: string } => ({
  method: "POST",
  body: body === undefined ? undefined : JSON.stringify(body),
  idempotencyKey,
});

export const api = {
  async login(email: string, password: string) {
    const res = await call(
      "/user/login",
      z.object({ success: z.literal(true), token: z.string(), user: userSchema }),
      post({ email, password })
    );
    const session = { token: res.token, user: res.user };
    saveSession(session);
    return session;
  },

  holdings: () => call("/api/holdings", envelope(z.array(balanceSchema))).then((r) => r.data),
  requests: () => call("/api/requests?limit=50", envelope(z.array(requestSchema))).then((r) => r.data),
  ledger: () => call("/api/ledger?limit=50", envelope(z.array(ledgerEntrySchema))).then((r) => r.data),

  createRequest: (
    input: { type: RequestType; metal: Metal; grams: string; note?: string },
    idempotencyKey: string
  ) => call("/api/requests", envelope(requestSchema), post(input, idempotencyKey)).then((r) => r.data),

  queue: (status: MetalRequest["status"] = "pending") =>
    call(`/api/admin/requests?status=${status}&limit=50`, envelope(z.array(requestSchema))).then((r) => r.data),
  approve: (id: string) => call(`/api/admin/requests/${id}/approve`, envelope(requestSchema), post()),
  reject: (id: string, reason: string) =>
    call(`/api/admin/requests/${id}/reject`, envelope(requestSchema), post({ reason })),
  reconciliation: () => call("/api/admin/reconciliation", envelope(reconciliationSchema)).then((r) => r.data),

  proofOfReserve: () => call("/api/proof-of-reserve", envelope(reserveSchema)).then((r) => r.data),
};
