// The connection service (Pipedream Connect), the pure parts: addresses, settings checks and the
// shapes it answers with. No server imports, so tests load it straight from Node.
//
// Why it exists: a platform only shows its "Allow access?" page for an app it has approved. The
// service holds approved apps with Shopify, eBay and others, so a seller presses Connect, approves
// on the platform's own page, and lands back in Armada connected, without Armada registering its
// own app on that platform. Armada never sees the seller's platform keys: it sends each request
// through the service's relay, which adds the seller's access on the way.
// https://pipedream.com/docs/connect/managed-auth/oauth-clients (the relay is allowed with the
// service's own apps in production), https://pipedream.com/docs/connect/api-proxy

export const PD_API = "https://api.pipedream.com";

export type PdEnvironment = "development" | "production";

export interface PdSettings {
  clientId: string;
  clientSecret: string;
  projectId: string;
  environment: PdEnvironment;
}

/** The platforms Armada connects through the service, and the service's name for each. */
export const PD_APPS = { shopify: "shopify", ebay: "ebay" } as const;
export type PdProvider = keyof typeof PD_APPS;

export const isPdProvider = (p: string): p is PdProvider => Object.hasOwn(PD_APPS, p);

/** What's wrong with pasted settings, in plain words, or null when they look right. */
export function checkPdSettings(s: { clientId?: string; clientSecret?: string; projectId?: string; environment?: string }): string | null {
  if (!s.clientId?.trim()) return "Paste the Client ID.";
  if (!s.clientSecret?.trim()) return "Paste the Client secret.";
  if (!s.projectId?.trim()) return "Paste the Project ID. It starts with proj_.";
  if (!/^proj_[A-Za-z0-9]+$/.test(s.projectId.trim())) return "The Project ID starts with proj_ and has only letters and numbers after it.";
  if (/\s/.test(s.clientId.trim()) || /\s/.test(s.clientSecret.trim())) return "That has a space in it. Copy it again without spaces.";
  if (s.environment !== "development" && s.environment !== "production") return "Choose Testing or Live.";
  return null;
}

/** URL-safe base64 without padding, as the relay expects its target address. */
export function b64url(text: string): string {
  return Buffer.from(text, "utf8").toString("base64url");
}

/**
 * The relay address for one request. `target` is a full address for platforms on a fixed domain
 * (eBay), or a path starting with "/" for platforms where each seller has their own address
 * (Shopify's <store>.myshopify.com), which the service fills in from the connected account.
 */
export function relayPath(projectId: string, target: string, externalUserId: string, accountId: string): string {
  const q = new URLSearchParams({ external_user_id: externalUserId, account_id: accountId });
  return `/v1/connect/${encodeURIComponent(projectId)}/proxy/${b64url(target)}?${q}`;
}

/** The service's hosted connect page for one platform. */
export function connectPageUrl(connectLinkUrl: string, provider: PdProvider): string {
  const u = new URL(connectLinkUrl);
  u.searchParams.set("app", PD_APPS[provider]);
  return u.toString();
}

/** Relay headers: only these reach the platform (the service drops the rest). */
export function relayHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    const key = k.toLowerCase();
    // The service adds the seller's access itself, and refuses these outright.
    if (key === "authorization" || key === "x-shopify-access-token") continue;
    if (["accept-encoding", "connection", "content-length", "cookie", "host", "origin", "referer", "te", "transfer-encoding", "upgrade", "via", "expect", "date"].includes(key)) continue;
    out[key.startsWith("x-pd-proxy-") ? key : `x-pd-proxy-${key}`] = v;
  }
  return out;
}

export interface PdAccount {
  id: string;
  name: string | null;
  healthy: boolean;
  dead: boolean | null;
  appSlug: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  error: string | null;
}

/** An account as the service lists it, or null when the answer isn't one. */
export function readAccount(raw: unknown): PdAccount | null {
  const a = raw as { id?: unknown; name?: unknown; healthy?: unknown; dead?: unknown; app?: { name_slug?: unknown }; created_at?: unknown; updated_at?: unknown; error?: unknown } | null;
  if (!a || typeof a.id !== "string" || !a.id) return null;
  return {
    id: a.id,
    name: typeof a.name === "string" && a.name ? a.name : null,
    healthy: a.healthy !== false,
    dead: a.dead === true,
    appSlug: typeof a.app?.name_slug === "string" ? a.app.name_slug : null,
    createdAt: typeof a.created_at === "string" ? a.created_at : null,
    updatedAt: typeof a.updated_at === "string" ? a.updated_at : null,
    error: typeof a.error === "string" && a.error ? a.error : null,
  };
}

/** The accounts list, which the service sends bare or as { data: [...] }. */
export function readAccounts(raw: unknown): PdAccount[] {
  const list = Array.isArray(raw) ? raw : Array.isArray((raw as { data?: unknown })?.data) ? (raw as { data: unknown[] }).data : [];
  return list.map(readAccount).filter((a): a is PdAccount => a !== null);
}

/**
 * The account a seller just connected: the newest live one for the platform that Armada isn't
 * already using. Null when there's none (they closed the page, or it failed).
 */
export function pickNewAccount(accounts: PdAccount[], provider: PdProvider, known: Set<string>, now = Date.now()): PdAccount | null {
  const mine = accounts.filter((a) => (a.appSlug === null || a.appSlug === PD_APPS[provider]) && !a.dead);
  const newest = (list: PdAccount[], field: "createdAt" | "updatedAt") =>
    [...list].sort((x, y) => (Date.parse(y[field] ?? "") || 0) - (Date.parse(x[field] ?? "") || 0))[0] ?? null;
  const fresh = newest(mine.filter((a) => !known.has(a.id)), "createdAt");
  if (fresh) return fresh;
  // Connecting an account again can refresh the same one at the service instead of adding one.
  const again = newest(mine.filter((a) => a.healthy), "updatedAt");
  return again && now - (Date.parse(again.updatedAt ?? "") || 0) < 15 * 60_000 ? again : null;
}

/** A credential kept for a platform connected through the service: which account, never a key. */
export interface ViaService {
  via: "pipedream";
  accountId: string;
  externalUserId: string;
}

export const isViaService = (s: unknown): s is ViaService =>
  Boolean(s) && (s as ViaService).via === "pipedream" && typeof (s as ViaService).accountId === "string" && typeof (s as ViaService).externalUserId === "string";

/** The service's "who is this" for a workspace: stable, and meaningless outside Armada. */
export const externalUserFor = (workspaceId: string) => `armada-${workspaceId}`;
