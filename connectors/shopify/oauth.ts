import "server-only";
import { appOrigin } from "@/lib/connections/types";
import { SHOPIFY_PATHS, SHOPIFY_SCOPES } from "./config";
import { shopifyRequest, ShopifyUnreachable } from "./http";

// Shopify's approval round trip (the authorization code grant) and the access it hands back.
// https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/authorization-code-grant
//
// Why this method: Armada runs outside the Shopify admin. Shopify's guide says apps that run inside
// the admin use token exchange (and Shopify-managed installation, with the Shopify CLI), and apps
// that run outside it use the authorization code grant. Token exchange needs a session from inside
// the admin, which Armada never has.
//
// Access expires: Armada asks for expiring offline access (expiring=1). Shopify requires it for
// public apps created on or after 1 April 2026 (changelog, "Expiring offline access tokens required
// for new public apps") and for every public app from 1 January 2027. Access lasts an hour and is
// renewed with a refresh credential that lasts up to 90 days; every renewal returns a new pair.

export interface ShopifySecret {
  accessToken: string;
  /** Null only for access that doesn't expire (a store connected without expiring=1). */
  refreshToken: string | null;
  accessExpiresAt: string | null;
  refreshExpiresAt: string | null;
  /** Permissions Shopify granted, comma-separated as Shopify returns them. */
  scope: string;
}

export function shopifyApp(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function redirectUri(): string {
  return appOrigin() + SHOPIFY_PATHS.callback;
}

/** Shopify's approval screen for this store. `shop` must already be a checked myshopify.com address. */
export function authorizeUrl(shop: string, state: string): string {
  const app = shopifyApp();
  if (!app) throw new Error("Shopify isn't set up");
  const q = new URLSearchParams({ client_id: app.clientId, scope: SHOPIFY_SCOPES.join(","), redirect_uri: redirectUri(), state });
  return `https://${shop}/admin/oauth/authorize?${q}`;
}

interface TokenResponse {
  access_token?: string;
  scope?: string;
  expires_in?: number | string;
  refresh_token?: string;
  refresh_token_expires_in?: number | string;
}

/** A time `seconds` from now, or null when Shopify didn't give a lifetime (access that doesn't expire). */
function after(seconds: number | string | undefined): string | null {
  const n = Number(seconds);
  return n > 0 ? new Date(Date.now() + n * 1000).toISOString() : null;
}

function toSecret(t: TokenResponse, previousScope = ""): ShopifySecret {
  return {
    accessToken: String(t.access_token),
    refreshToken: t.refresh_token ? String(t.refresh_token) : null,
    accessExpiresAt: after(t.expires_in),
    refreshExpiresAt: t.refresh_token ? after(t.refresh_token_expires_in) : null,
    scope: t.scope ?? previousScope,
  };
}

async function postForm(shop: string, body: Record<string, string>): Promise<Response> {
  return shopifyRequest(shop, "/admin/oauth/access_token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams(body),
    timeoutMs: 15_000,
  });
}

export type ExchangeResult = { kind: "ok"; secret: ShopifySecret } | { kind: "refused" } | { kind: "unreachable" };

/** Trades the one-time code from the approval callback for the store's offline access. */
export async function exchangeCode(shop: string, code: string): Promise<ExchangeResult> {
  const app = shopifyApp();
  if (!app) return { kind: "refused" };
  let res: Response;
  try {
    res = await postForm(shop, { client_id: app.clientId, client_secret: app.clientSecret, code, expiring: "1" });
  } catch (e) {
    if (e instanceof ShopifyUnreachable) return { kind: "unreachable" };
    throw e;
  }
  if (res.status === 429 || res.status >= 500) return { kind: "unreachable" };
  if (!res.ok) return { kind: "refused" };
  const t = (await res.json().catch(() => null)) as TokenResponse | null;
  if (!t?.access_token) return { kind: "refused" };
  return { kind: "ok", secret: toSecret(t) };
}

/**
 * Renews expiring access. What the caller should do with each answer (Shopify's guide):
 * - "refreshed": store the new pair; the old refresh credential is retired once the new one is used.
 * - "reauthorize": 401, the refresh credential is dead (expired, replaced, or the app was removed);
 *   the store has to be approved again.
 * - "retry": never reached Shopify, or Shopify was busy (429/5xx); the old pair is untouched.
 * - "failed": any other answer; retrying sends the same request and fails the same way.
 */
export type RefreshResult =
  | { kind: "refreshed"; secret: ShopifySecret }
  | { kind: "reauthorize" }
  | { kind: "retry" }
  | { kind: "failed"; status: number };

export async function refreshAccess(shop: string, current: ShopifySecret): Promise<RefreshResult> {
  const app = shopifyApp();
  if (!app || !current.refreshToken) return { kind: "reauthorize" };
  let res: Response;
  try {
    res = await postForm(shop, { client_id: app.clientId, client_secret: app.clientSecret, grant_type: "refresh_token", refresh_token: current.refreshToken });
  } catch (e) {
    if (e instanceof ShopifyUnreachable) return { kind: "retry" };
    throw e;
  }
  if (res.status === 401) return { kind: "reauthorize" };
  if (res.status === 429 || res.status >= 500) return { kind: "retry" };
  if (!res.ok) return { kind: "failed", status: res.status };
  const t = (await res.json().catch(() => null)) as TokenResponse | null;
  if (!t?.access_token) return { kind: "failed", status: res.status };
  return { kind: "refreshed", secret: toSecret(t, current.scope) };
}
