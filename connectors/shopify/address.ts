// A Shopify store's permanent address is "<handle>.myshopify.com". It never changes, even when the
// store adds its own web address, so it is what Armada keys a store by.
//
// People type all sorts of things into "your store's address", so this turns the common ones into
// the permanent address and says plainly what's wrong with the rest. Pure code: it runs in the
// browser (live hint under the field), on the server (the start of a connection), and in
// scripts/check-shopify.mjs.

/** Shopify's own rule for a store address, anchored at both ends (shopify.dev, authorization code grant). */
export const SHOP_DOMAIN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

/** True for a well-formed permanent store address, such as "yourstore.myshopify.com". */
export function isShopDomain(value: unknown): value is string {
  return typeof value === "string" && value.length <= 255 && SHOP_DOMAIN.test(value);
}

export type ShopAddress =
  | { ok: true; shop: string }
  | { ok: false; reason: "empty" | "custom_domain" | "invalid" };

/**
 * Accepts "yourstore", "yourstore.myshopify.com", "https://yourstore.myshopify.com/admin",
 * "admin.shopify.com/store/yourstore" and the same with capitals or spaces around them.
 * A shop's own web address ("yourstore.com") can't be turned into its permanent address without
 * asking Shopify, so it's refused with its own reason.
 */
export function normalizeShopAddress(input: string | null | undefined): ShopAddress {
  let s = String(input ?? "").trim().toLowerCase();
  if (!s) return { ok: false, reason: "empty" };
  if (s.length > 300) return { ok: false, reason: "invalid" };
  s = s.replace(/^[a-z]+:\/\//, "");
  const admin = s.match(/^admin\.shopify\.com\/store\/([^/?#]+)/);
  if (admin) s = admin[1];
  s = s.split(/[/?#]/)[0].replace(/:\d+$/, "").replace(/\.+$/, "");
  if (!s) return { ok: false, reason: "empty" };
  if (!s.includes(".")) s = `${s}.myshopify.com`;
  else if (!s.endsWith(".myshopify.com")) return { ok: false, reason: "custom_domain" };
  return isShopDomain(s) ? { ok: true, shop: s } : { ok: false, reason: "invalid" };
}

/** Plain words for each reason an address was refused, shown under the field and after a redirect. */
export const ADDRESS_HINTS: Record<"empty" | "custom_domain" | "invalid", string> = {
  empty: "Type your store's address. It ends in .myshopify.com.",
  custom_domain: "That's your shop's own web address. Use the one that ends in .myshopify.com: in Shopify, open Settings, then Domains.",
  invalid: "A store address is letters, numbers and dashes, like yourstore.myshopify.com.",
};
