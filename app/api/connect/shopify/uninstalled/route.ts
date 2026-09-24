import { isShopDomain } from "@/connectors/shopify/address";
import { shopifyRemovedArmada } from "@/connectors/shopify/client";
import { shopifyApp } from "@/connectors/shopify/oauth";
import { verifyWebhookHmac } from "@/connectors/shopify/verify";

// Shopify's notice that a store removed Armada (topic app/uninstalled). Armada subscribes each store
// to it when the store connects. The body's signature is checked against the raw bytes before
// anything is trusted; a bad signature gets 401. Shopify wants a 2xx within five seconds and
// retries otherwise, and handling the same notice twice changes nothing.

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const app = shopifyApp();
  if (!app) return new Response(null, { status: 503 });
  const raw = new Uint8Array(await request.arrayBuffer());
  if (!verifyWebhookHmac(raw, request.headers.get("x-shopify-hmac-sha256"), app.clientSecret)) return new Response(null, { status: 401 });

  const topic = request.headers.get("x-shopify-topic");
  const shop = request.headers.get("x-shopify-shop-domain");
  if (topic !== "app/uninstalled" || !isShopDomain(shop)) return new Response(null, { status: 200 });

  const triggered = Date.parse(request.headers.get("x-shopify-triggered-at") ?? "");
  await shopifyRemovedArmada(shop, Number.isNaN(triggered) ? new Date() : new Date(triggered));
  return new Response(null, { status: 200 });
}
