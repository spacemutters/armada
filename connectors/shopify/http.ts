import "server-only";
import { isShopDomain } from "./address";

// The only place a request leaves Armada for a Shopify store. Every call has a deadline, goes only
// to a well-formed <handle>.myshopify.com address over https, and a failure to reach Shopify at all
// is told apart from Shopify answering "no" (a transport failure never consumed anything, so it is
// safe to try again; an answer is the caller's to read).

export class ShopifyUnreachable extends Error {
  constructor(shop: string, cause?: unknown) {
    super(`Couldn't reach ${shop}`, { cause });
  }
}

export async function shopifyRequest(shop: string, path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  if (!isShopDomain(shop)) throw new Error("Not a Shopify store address");
  if (!path.startsWith("/admin/")) throw new Error("Not a Shopify admin path");
  const { timeoutMs = 20_000, ...rest } = init;
  try {
    return await fetch(`https://${shop}${path}`, { ...rest, signal: AbortSignal.timeout(timeoutMs), cache: "no-store", redirect: "manual" });
  } catch (e) {
    throw new ShopifyUnreachable(shop, e);
  }
}
