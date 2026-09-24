import "server-only";
import crypto from "node:crypto";
import type { BillingInterval, PlanKey, PriceSpec } from "@/lib/billing/plans";
import { formEncode, type FormParams } from "./form";
import {
  checkoutParams,
  newProductParams,
  portalConfigParams,
  portalSessionParams,
  priceMatches,
  priceParams,
  productId,
  productParams,
  STRIPE_API_VERSION,
  webhookParams,
  webhookUpdateParams,
  type CheckoutInput,
  type PortalFlow,
  type PortalProduct,
  type StripePriceLike,
} from "./payloads";

// The one door to Stripe. Every request goes through send(): form-encoded, pinned to one API version,
// with an idempotency key on every POST so a retry after a dropped connection can't do the work twice.
// Only busy answers (429, 5xx, or Stripe saying "retry") are retried, twice, with a short pause.
// Docs: https://docs.stripe.com/api

const API = "https://api.stripe.com";

export class StripeError extends Error {
  status: number;
  type: string;
  code: string | null;
  param: string | null;
  constructor(status: number, type: string, message: string, code: string | null = null, param: string | null = null) {
    super(message);
    this.name = "StripeError";
    this.status = status;
    this.type = type;
    this.code = code;
    this.param = param;
  }
}

type Method = "GET" | "POST" | "DELETE";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function send<T>(key: string, method: Method, path: string, params: FormParams = {}): Promise<T> {
  const encoded = formEncode(params);
  const url = `${API}${path}${method !== "POST" && encoded ? `?${encoded}` : ""}`;
  const headers: Record<string, string> = { Authorization: `Bearer ${key}`, "Stripe-Version": STRIPE_API_VERSION };
  if (method === "POST") {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    headers["Idempotency-Key"] = crypto.randomUUID();
  }
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, { method, headers, body: method === "POST" ? encoded : undefined, signal: AbortSignal.timeout(20_000), cache: "no-store" });
    } catch {
      if (attempt < 2) {
        await sleep(400 * 2 ** attempt);
        continue;
      }
      throw new StripeError(0, "network_error", "Armada couldn't reach Stripe.");
    }
    const text = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      // handled below
    }
    if (res.ok && json) return json as T;
    const hint = res.headers.get("stripe-should-retry");
    const busy = hint === "true" || (hint !== "false" && (res.status === 429 || res.status >= 500));
    if (busy && attempt < 2) {
      await sleep(500 * 2 ** attempt);
      continue;
    }
    const err = ((json as { error?: Record<string, unknown> } | null)?.error ?? {}) as Record<string, unknown>;
    throw new StripeError(
      res.status,
      typeof err.type === "string" ? err.type : "api_error",
      typeof err.message === "string" ? err.message : `Stripe answered with status ${res.status}.`,
      typeof err.code === "string" ? err.code : null,
      typeof err.param === "string" ? err.param : null,
    );
  }
}

interface List<T> {
  data: T[];
  has_more: boolean;
}

/** Every item of a list, following pages (at most `maxPages` of 100). */
async function listAll<T extends { id: string }>(key: string, path: string, params: FormParams = {}, maxPages = 5): Promise<T[]> {
  const out: T[] = [];
  let after: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const res = await send<List<T>>(key, "GET", path, { ...params, limit: 100, starting_after: after });
    out.push(...res.data);
    if (!res.has_more || !res.data.length) break;
    after = res.data[res.data.length - 1].id;
  }
  return out;
}

const isMissing = (e: unknown) => e instanceof StripeError && e.status === 404;
export const isPermissionError = (e: unknown) => e instanceof StripeError && (e.status === 403 || /rak_[a-z_]+_(read|write)/.test(e.message));

// ---------- The account ----------

export interface StripeAccountInfo {
  id: string | null;
  name: string | null;
}

/**
 * The account's id and business name. A restricted key may not be allowed to read the account; that's
 * fine, the name is only for showing, so it comes back empty instead of failing. A key Stripe rejects
 * outright still throws.
 */
export async function retrieveAccount(key: string): Promise<StripeAccountInfo> {
  try {
    const a = await send<{ id: string; email?: string | null; business_profile?: { name?: string | null } | null; settings?: { dashboard?: { display_name?: string | null } } | null }>(key, "GET", "/v1/account");
    return { id: a.id, name: a.business_profile?.name || a.settings?.dashboard?.display_name || a.email || null };
  } catch (e) {
    if (!isPermissionError(e)) throw e;
    const acct = /on account '(acct_[A-Za-z0-9]+)'/.exec((e as Error).message)?.[1] ?? null;
    return { id: acct, name: null };
  }
}

// ---------- Products and Prices ----------

interface StripeProduct {
  id: string;
  active: boolean;
  livemode: boolean;
  metadata?: Record<string, string>;
}
interface StripePrice extends StripePriceLike {
  id: string;
  active: boolean;
  livemode: boolean;
  product: string;
}

/** The plan's Product, found by Armada's own id (or its metadata), brought up to date, or made. */
async function ensureProduct(key: string, spec: PriceSpec): Promise<StripeProduct> {
  const plan = spec.plan;
  try {
    await send<StripeProduct>(key, "GET", `/v1/products/${productId(plan)}`);
    return await send<StripeProduct>(key, "POST", `/v1/products/${productId(plan)}`, { ...productParams(plan), active: true });
  } catch (e) {
    if (!isMissing(e)) throw e;
  }
  try {
    return await send<StripeProduct>(key, "POST", "/v1/products", newProductParams(plan));
  } catch (e) {
    // The id can be taken by a product that was deleted. Then find it by metadata, or make one with Stripe's own id.
    if (!(e instanceof StripeError && e.code === "resource_already_exists")) throw e;
  }
  const all = await listAll<StripeProduct>(key, "/v1/products", { active: true });
  const found = all.find((p) => p.metadata?.armada_plan === plan.key && p.metadata?.armada === "billing");
  if (found) return await send<StripeProduct>(key, "POST", `/v1/products/${found.id}`, productParams(plan));
  return await send<StripeProduct>(key, "POST", "/v1/products", newProductParams(plan, false));
}

async function pricesByLookupKey(key: string, lookupKeys: string[]): Promise<Map<string, StripePrice>> {
  const found = new Map<string, StripePrice>();
  for (let i = 0; i < lookupKeys.length; i += 10) {
    const chunk = lookupKeys.slice(i, i + 10);
    const res = await send<List<StripePrice>>(key, "GET", "/v1/prices", { lookup_keys: chunk, limit: 100 });
    for (const p of res.data) if (p.lookup_key) found.set(p.lookup_key, p);
  }
  return found;
}

export type PriceIds = Partial<Record<PlanKey, Partial<Record<BillingInterval, string>>>>;

export interface Catalog {
  priceIds: PriceIds;
  productIds: Partial<Record<PlanKey, string>>;
  /** Each product with the prices a customer may switch between, for the portal. */
  portalProducts: PortalProduct[];
  livemode: boolean | null;
}

/**
 * Makes sure Stripe has a Product for every paid plan and a Price for each plan at each interval.
 * Prices are found by lookup key, which carries the amount, so running this again finds what it made
 * before, and a changed amount in lib/billing/plans.ts makes a new Price instead of editing one.
 */
export async function ensureCatalog(key: string, specs: PriceSpec[]): Promise<Catalog> {
  const products = new Map<PlanKey, StripeProduct>();
  for (const spec of specs) if (!products.has(spec.plan.key)) products.set(spec.plan.key, await ensureProduct(key, spec));

  const existing = await pricesByLookupKey(
    key,
    specs.map((s) => s.lookupKey),
  );
  const priceIds: PriceIds = {};
  const byProduct = new Map<string, string[]>();
  let livemode: boolean | null = null;
  for (const spec of specs) {
    const product = products.get(spec.plan.key)!;
    livemode = product.livemode;
    let price = existing.get(spec.lookupKey);
    if (price && priceMatches(price, spec)) {
      if (!price.active) price = await send<StripePrice>(key, "POST", `/v1/prices/${price.id}`, { active: true });
    } else {
      // No price yet, or one that doesn't match its lookup key (made by hand): make the right one and move the key to it.
      try {
        price = await send<StripePrice>(key, "POST", "/v1/prices", priceParams(spec, product.id, { transferLookupKey: Boolean(price) }));
      } catch (e) {
        // Two connects at once: the other one made it first.
        const again = (await pricesByLookupKey(key, [spec.lookupKey])).get(spec.lookupKey);
        if (!again || !priceMatches(again, spec)) throw e;
        price = again;
      }
    }
    (priceIds[spec.plan.key] ??= {})[spec.interval] = price.id;
    const pid = typeof price.product === "string" ? price.product : product.id;
    byProduct.set(pid, [...(byProduct.get(pid) ?? []), price.id]);
  }
  const productIds: Partial<Record<PlanKey, string>> = {};
  for (const [plan, p] of products) productIds[plan] = p.id;
  return { priceIds, productIds, portalProducts: [...byProduct].map(([product, prices]) => ({ product, prices })), livemode };
}

// ---------- The customer portal ----------

interface PortalConfiguration {
  id: string;
  metadata?: Record<string, string>;
}

/** Turns on Stripe's billing page for customers, set up for Armada's plans. Returns its id. */
export async function ensurePortal(key: string, products: PortalProduct[], returnUrl: string, knownId?: string | null): Promise<string> {
  const params = portalConfigParams({ products, returnUrl });
  if (knownId) {
    try {
      return (await send<PortalConfiguration>(key, "POST", `/v1/billing_portal/configurations/${knownId}`, { ...params, active: true })).id;
    } catch (e) {
      if (!isMissing(e)) throw e;
    }
  }
  const all = await listAll<PortalConfiguration>(key, "/v1/billing_portal/configurations");
  const mine = all.find((c) => c.metadata?.armada === "billing");
  if (mine) return (await send<PortalConfiguration>(key, "POST", `/v1/billing_portal/configurations/${mine.id}`, { ...params, active: true })).id;
  return (await send<PortalConfiguration>(key, "POST", "/v1/billing_portal/configurations", params)).id;
}

// ---------- The notification address ----------

interface WebhookEndpoint {
  id: string;
  url: string;
  api_version: string | null;
  livemode: boolean;
  secret?: string;
}

export interface EnsuredWebhook {
  id: string;
  secret: string;
  livemode: boolean;
  /** Older Armada endpoints at the same address, to delete once the new secret is saved. */
  stale: string[];
}

/**
 * Registers Armada's notification address with Stripe and returns its signing secret. Stripe shows a
 * secret only when an endpoint is created, so an endpoint made earlier is kept only when Armada still
 * holds its secret (`previous`); otherwise a new one is made and the old ones are listed as stale.
 */
export async function ensureWebhook(key: string, url: string, previous?: { id: string; secret: string } | null): Promise<EnsuredWebhook> {
  const all = await listAll<WebhookEndpoint>(key, "/v1/webhook_endpoints");
  const mine = all.filter((e) => e.url === url);
  const keep = previous ? mine.find((e) => e.id === previous.id && e.api_version === STRIPE_API_VERSION) : undefined;
  if (keep && previous) {
    const updated = await send<WebhookEndpoint>(key, "POST", `/v1/webhook_endpoints/${keep.id}`, webhookUpdateParams(url));
    return { id: keep.id, secret: previous.secret, livemode: updated.livemode, stale: mine.filter((e) => e.id !== keep.id).map((e) => e.id) };
  }
  const created = await send<WebhookEndpoint>(key, "POST", "/v1/webhook_endpoints", webhookParams(url));
  if (!created.secret) throw new StripeError(0, "api_error", "Stripe didn't send back the signing secret for Armada's notification address.");
  return { id: created.id, secret: created.secret, livemode: created.livemode, stale: mine.map((e) => e.id) };
}

/** Removes a notification address. One that's already gone counts as removed. */
export async function deleteWebhook(key: string, id: string): Promise<void> {
  try {
    await send(key, "DELETE", `/v1/webhook_endpoints/${id}`);
  } catch (e) {
    if (!isMissing(e)) throw e;
  }
}

// ---------- Paying and managing ----------

export async function createCheckoutSession(key: string, input: CheckoutInput): Promise<{ id: string; url: string }> {
  const s = await send<{ id: string; url: string | null }>(key, "POST", "/v1/checkout/sessions", checkoutParams(input));
  if (!s.url) throw new StripeError(0, "api_error", "Stripe didn't send back a checkout page.");
  return { id: s.id, url: s.url };
}

export async function createPortalSession(key: string, opts: { customerId: string; configurationId?: string | null; returnUrl: string; flow?: PortalFlow }): Promise<string> {
  return (await send<{ url: string }>(key, "POST", "/v1/billing_portal/sessions", portalSessionParams(opts))).url;
}

export async function retrieveSubscription(key: string, id: string): Promise<unknown> {
  return send<unknown>(key, "GET", `/v1/subscriptions/${encodeURIComponent(id)}`);
}

export async function retrieveCheckoutSession(key: string, id: string): Promise<unknown> {
  return send<unknown>(key, "GET", `/v1/checkout/sessions/${encodeURIComponent(id)}`);
}
