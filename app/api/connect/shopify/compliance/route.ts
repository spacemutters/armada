import { isShopDomain } from "@/connectors/shopify/address";
import { shopifyPrivacyNotice } from "@/connectors/shopify/client";
import { shopifyApp } from "@/connectors/shopify/oauth";
import { verifyWebhookHmac } from "@/connectors/shopify/verify";

// Shopify's three required privacy notices for public apps: customers/data_request,
// customers/redact and shop/redact (https://shopify.dev/docs/apps/build/privacy-law-compliance).
// Shopify's rules: answer 401 when the signature is wrong, and a 2xx once the notice is received.
// What Armada does with each one is in shopifyPrivacyNotice (connectors/shopify/client.ts).

export const dynamic = "force-dynamic";

const TOPICS = new Set(["customers/data_request", "customers/redact", "shop/redact"]);

export async function POST(request: Request) {
  const app = shopifyApp();
  if (!app) return new Response(null, { status: 503 });
  const raw = new Uint8Array(await request.arrayBuffer());
  if (!verifyWebhookHmac(raw, request.headers.get("x-shopify-hmac-sha256"), app.clientSecret)) return new Response(null, { status: 401 });

  const topic = request.headers.get("x-shopify-topic") ?? "";
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(new TextDecoder().decode(raw)) as Record<string, unknown>;
  } catch {
    payload = {};
  }
  const shop = request.headers.get("x-shopify-shop-domain") ?? (typeof payload.shop_domain === "string" ? payload.shop_domain : "");
  if (TOPICS.has(topic) && isShopDomain(shop)) await shopifyPrivacyNotice(topic, shop, payload);
  return new Response(null, { status: 200 });
}
