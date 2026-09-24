import { hasEnv, type ConnectorInfo } from "@/lib/connections/types";
import { SHOPIFY_ENV, SHOPIFY_PATHS } from "./config";

// Shopify: a store connects with one approval on Shopify's own screen (the authorization code
// grant, the method Shopify gives for apps that run outside the Shopify admin, like Armada).
// Switched on by SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET from Armada's app in Shopify's Dev
// Dashboard. Platform admins see the exact setup on the Connections page until it's switched on.
const requiredEnv = [...SHOPIFY_ENV];

export const shopifyInfo: ConnectorInfo & { available: () => boolean } = {
  provider: "shopify",
  name: "Shopify",
  kind: "store",
  blurb: "List products on your Shopify stores, keep prices and stock in step, and send each order to your supplier.",
  method: "redirect",
  requiredEnv,
  callbackPath: SHOPIFY_PATHS.callback,
  canOpenNew: false,
  ownerSetup:
    "Create Armada's app in Shopify's Dev Dashboard (dev.shopify.com) and choose public distribution. In a new version, set the app address and the return address shown here, leave it out of the Shopify admin (not embedded), and ask for the permissions listed here. Then copy the app's Client ID and Client secret into Vercel under the two setting names below. Until Shopify approves the app, only development stores can connect.",
  available: () => hasEnv(requiredEnv),
};
