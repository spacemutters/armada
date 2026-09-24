// Fixed facts about Armada's Shopify app, in one place: the Admin API version every call is pinned
// to, the permissions Armada asks each store for, and the addresses Shopify is told about.
// Plain constants (no server-only import) so the Connections page can show them to the platform
// admin and scripts/check-shopify.mjs can read them.
//
// Checked against shopify.dev on 2026-09-24:
// - API versions: 2026-07 is the latest stable version (supported until July 2027); 2026-10 is only
//   a release candidate. https://shopify.dev/docs/api/usage/versioning
// - Scopes: https://shopify.dev/docs/api/usage/access-scopes

/** The GraphQL Admin API version. Move it forward each quarter after reading Shopify's release notes. */
export const SHOPIFY_API_VERSION = "2026-07";

/**
 * What Armada asks each store to approve, and why:
 * - products: create and update listings, collections and variants.
 * - inventory + locations: keep stock in step (stock lives per location).
 * - publications: put new products on the store's sales channels so shoppers can see them.
 * - orders: read new orders (the last 60 days) and mark them up.
 * - merchant-managed fulfillment orders: add the supplier's tracking number when an order ships.
 * A write permission includes its read permission; both are listed so the approval screen and the
 * granted list are easy to compare.
 */
export const SHOPIFY_SCOPES = [
  "read_products",
  "write_products",
  "read_inventory",
  "write_inventory",
  "read_locations",
  "read_publications",
  "write_publications",
  "read_orders",
  "write_orders",
  "read_merchant_managed_fulfillment_orders",
  "write_merchant_managed_fulfillment_orders",
] as const;

/**
 * Scopes Armada asked for that Shopify didn't grant, from the comma-separated list Shopify returns.
 * A write permission covers its read permission, so Shopify may return only the write one.
 */
export function missingScopes(granted: string): string[] {
  const have = new Set(granted.split(",").map((s) => s.trim()).filter(Boolean));
  return SHOPIFY_SCOPES.filter((s) => !have.has(s) && !(s.startsWith("read_") && have.has(`write_${s.slice(5)}`)));
}

/** Paths on Armada's own site that Shopify is told about (joined to the public origin). */
export const SHOPIFY_PATHS = {
  /** The app's address in Shopify's Dev Dashboard. Shopify sends people here when they open the app from their store's admin. */
  start: "/api/connect/shopify/start",
  /** Where Shopify sends people back after they approve (the redirect URL). */
  callback: "/api/connect/shopify/callback",
  /** Shopify's notice that a store removed Armada. Armada subscribes each store to it when it connects. */
  uninstalled: "/api/connect/shopify/uninstalled",
  /** Shopify's three required privacy notices (customers/data_request, customers/redact, shop/redact). */
  compliance: "/api/connect/shopify/compliance",
} as const;

/** Server settings the connection needs. */
export const SHOPIFY_ENV = ["SHOPIFY_CLIENT_ID", "SHOPIFY_CLIENT_SECRET"] as const;

/** The cookie that ties a Shopify round trip to the browser that started it. */
export const SHOPIFY_STATE_COOKIE = "armada_shopify_state";
