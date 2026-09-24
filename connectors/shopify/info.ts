import { hasEnv, type ConnectorInfo } from "@/lib/connections/types";

// Placeholder written so the registry compiles; the connections work replaces it.
const requiredEnv = ["SHOPIFY_CLIENT_ID", "SHOPIFY_CLIENT_SECRET"];

export const shopifyInfo: ConnectorInfo & { available: () => boolean } = {
  provider: "shopify",
  name: "Shopify",
  kind: "store",
  blurb: "Connect a Shopify store to list products, sync prices and send its orders to suppliers.",
  method: "redirect",
  requiredEnv,
  callbackPath: "/api/connect/shopify/callback",
  canOpenNew: false,
  ownerSetup: "Armada's Shopify app (your Shopify partner account, sign-up 4).",
  available: () => hasEnv(requiredEnv),
};
