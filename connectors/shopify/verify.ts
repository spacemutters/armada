import { createHmac, timingSafeEqual } from "node:crypto";

// Checking that a request really came from Shopify. Two kinds, both signed with the app's client
// secret (shopify.dev, checked 2026-09-24):
//
// 1. Addresses Shopify sends a person to (the approval callback, and the app address when someone
//    opens Armada from their store's admin) carry `hmac`: HMAC-SHA256 as hex over the other query
//    parameters, sorted by name and joined as name=value with "&".
//    https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/authorization-code-grant
// 2. Notices Shopify posts to Armada (webhooks) carry X-Shopify-Hmac-SHA256: HMAC-SHA256 as base64
//    over the raw request body. https://shopify.dev/docs/apps/build/webhooks/verify-deliveries
//
// Plain Node code with no server-only import, so scripts/check-shopify.mjs can test it directly.

type Query = URLSearchParams | Record<string, string | undefined>;

function entries(query: Query): [string, string][] | null {
  const list: [string, string][] = [];
  const seen = new Set<string>();
  const pairs = query instanceof URLSearchParams ? [...query.entries()] : Object.entries(query).filter((e): e is [string, string] => typeof e[1] === "string");
  for (const [k, v] of pairs) {
    // Shopify's callbacks never repeat a parameter; a repeated one means the address was tampered with.
    if (seen.has(k)) return null;
    seen.add(k);
    if (k !== "hmac") list.push([k, v]);
  }
  return list.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * The two ways the signed text is written out. Shopify's guide joins the values as they are; its
 * own Node library (@shopify/shopify-api) writes them form-encoded. They only differ for values
 * holding characters such as "=" or "/" (the `host` parameter can), so either is accepted: both
 * still need the client secret to produce.
 */
export function signedMessages(query: Query): string[] {
  const list = entries(query);
  if (!list) return [];
  const raw = list.map(([k, v]) => `${k}=${v}`).join("&");
  const encoded = new URLSearchParams(list).toString();
  return raw === encoded ? [raw] : [raw, encoded];
}

function sameBytes(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

/** True when the query's `hmac` was made by Shopify with this client secret. */
export function verifyQueryHmac(query: Query, secret: string): boolean {
  if (!secret) return false;
  const given = query instanceof URLSearchParams ? query.get("hmac") : query.hmac;
  if (!given || !/^[0-9a-f]{64}$/i.test(given)) return false;
  const want = Buffer.from(given.toLowerCase(), "hex");
  let ok = false;
  // Every candidate is checked, so the time taken doesn't depend on which one matched.
  for (const message of signedMessages(query)) {
    if (sameBytes(createHmac("sha256", secret).update(message, "utf8").digest(), want)) ok = true;
  }
  return ok;
}

/** True when a webhook body's X-Shopify-Hmac-SHA256 header was made by Shopify with this client secret. */
export function verifyWebhookHmac(rawBody: Uint8Array | string, header: string | null | undefined, secret: string): boolean {
  if (!secret || !header || !/^[A-Za-z0-9+/]+={0,2}$/.test(header.trim())) return false;
  const body = typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : Buffer.from(rawBody);
  const digest = createHmac("sha256", secret).update(body).digest();
  return sameBytes(digest, Buffer.from(header.trim(), "base64"));
}

/**
 * True when a signed `timestamp` (seconds) is recent. Used for the app address Shopify opens from a
 * store's admin, which carries no one-time state of Armada's own, so an old copied link can't be replayed.
 */
export function timestampIsFresh(timestamp: string | null | undefined, maxAgeSeconds = 3600, now = Date.now()): boolean {
  if (!timestamp || !/^\d{9,11}$/.test(timestamp)) return false;
  const age = now / 1000 - Number(timestamp);
  return age < maxAgeSeconds && age > -300; // five minutes' grace for clocks running ahead
}
