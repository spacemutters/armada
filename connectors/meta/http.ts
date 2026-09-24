import "server-only";
import { appSecretProof, graphUrl, type GraphErrorBody, type MetaConfig } from "./core";

// The one door to Meta's Graph. Every request leaves through send(): a 20-second limit, no caching,
// the app-secret proof added to anything that carries an access, and Meta's error body kept so
// callers can explain it (core.ts explainMetaProblem).

export class MetaError extends Error {
  status: number;
  body: GraphErrorBody | null;
  constructor(status: number, body: GraphErrorBody | null, message?: string) {
    super(message ?? body?.message ?? `Meta answered ${status}`);
    this.status = status;
    this.body = body;
  }
}

async function send<T>(url: string, init: { method: string; form?: Record<string, string> }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method,
      headers: init.form ? { "content-type": "application/x-www-form-urlencoded" } : undefined,
      body: init.form ? new URLSearchParams(init.form).toString() : undefined,
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
  } catch {
    throw new MetaError(503, null, "Meta didn't answer in time.");
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  const err = (json as { error?: GraphErrorBody } | null)?.error;
  if (!res.ok || err) throw new MetaError(res.status, err ?? null);
  return json as T;
}

/** A Graph call. With `token`, the access and its app-secret proof ride along (query for GET, form for POST). */
export async function graph<T>(
  cfg: MetaConfig,
  opts: { method?: "GET" | "POST" | "DELETE"; path: string; token?: string; query?: Record<string, string>; form?: Record<string, string> },
): Promise<T> {
  const auth: Record<string, string> = opts.token ? { access_token: opts.token, appsecret_proof: appSecretProof(opts.token, cfg.appSecret) } : {};
  const method = opts.method ?? "GET";
  if (method === "POST") return send<T>(graphUrl(cfg, opts.path, opts.query), { method, form: { ...opts.form, ...auth } });
  return send<T>(graphUrl(cfg, opts.path, { ...opts.query, ...auth }), { method });
}

/** Swaps the one-time code from Meta's window for the person's (short-lived) access. */
export async function exchangeCode(cfg: MetaConfig, code: string, redirectUri: string): Promise<{ accessToken: string; expiresIn?: number }> {
  const r = await graph<{ access_token?: string; expires_in?: number }>(cfg, {
    path: "/oauth/access_token",
    query: { client_id: cfg.appId, client_secret: cfg.appSecret, redirect_uri: redirectUri, code },
  });
  if (!r.access_token) throw new MetaError(502, null, "Meta's answer had no access in it");
  return { accessToken: r.access_token, expiresIn: r.expires_in };
}

/** A 60-day version of a person's access, used only if the business's lasting access can't be had. */
export async function longLivedUserAccess(cfg: MetaConfig, token: string): Promise<{ accessToken: string; expiresIn?: number }> {
  const r = await graph<{ access_token?: string; expires_in?: number }>(cfg, {
    path: "/oauth/access_token",
    query: { grant_type: "fb_exchange_token", client_id: cfg.appId, client_secret: cfg.appSecret, fb_exchange_token: token },
  });
  if (!r.access_token) throw new MetaError(502, null, "Meta's answer had no access in it");
  return { accessToken: r.access_token, expiresIn: r.expires_in };
}

/** What the Business Extension installed for this setup: business, catalog, shop, page, Instagram, pixel. */
export function fbeInstalls(cfg: MetaConfig, token: string, externalBusinessId: string): Promise<unknown> {
  return graph<unknown>(cfg, { path: "/fbe_business/fbe_installs", token, query: { fbe_external_business_id: externalBusinessId } });
}

/** The business's own lasting access (its "{App} System User (FBE)"), made from the person's access. */
export async function businessAccess(cfg: MetaConfig, businessId: string, userToken: string, externalBusinessId: string, scope: string): Promise<string> {
  const r = await graph<{ access_token?: string }>(cfg, {
    method: "POST",
    path: `/${encodeURIComponent(businessId)}/access_token`,
    token: userToken,
    form: { app_id: cfg.appId, scope, fbe_external_business_id: externalBusinessId },
  });
  if (!r.access_token) throw new MetaError(502, null, "Meta's answer had no business access in it");
  return r.access_token;
}

export interface BatchAnswer {
  handles?: string[];
  validation_status?: { retailer_id?: string; errors?: { message?: string }[]; warnings?: { message?: string }[] }[];
}

/** Adds or updates products in a catalog (Catalog Batch, item_type PRODUCT_ITEM). */
export function itemsBatch(cfg: MetaConfig, token: string, catalogId: string, requests: unknown[]): Promise<BatchAnswer> {
  return graph<BatchAnswer>(cfg, {
    method: "POST",
    path: `/${encodeURIComponent(catalogId)}/items_batch`,
    token,
    form: { item_type: "PRODUCT_ITEM", allow_upsert: "true", requests: JSON.stringify(requests) },
  });
}
