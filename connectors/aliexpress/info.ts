import { hasEnv, type ConnectorInfo } from "@/lib/connections/types";

// AliExpress as a supplier: one press goes to AliExpress's own sign-in and approval page; back in
// Armada its catalog appears in Find products with real costs, photos and shipping quotes.
const requiredEnv = ["ALIEXPRESS_APP_KEY", "ALIEXPRESS_APP_SECRET"];

export const aliexpressInfo: ConnectorInfo & { available: () => boolean } = {
  provider: "aliexpress",
  name: "AliExpress",
  kind: "supplier",
  blurb: "AliExpress's catalog with real costs, photos, ratings and shipping quotes.",
  method: "redirect",
  requiredEnv,
  callbackPath: "/api/connect/aliexpress/callback",
  ownerSetup:
    "Register as a developer on openservice.aliexpress.com, create an app of the Dropshipping type and wait for AliExpress to approve it. " +
    "Set its callback address to the one shown here, then put the App Key in ALIEXPRESS_APP_KEY and the App Secret in ALIEXPRESS_APP_SECRET in Vercel.",
  available: () => hasEnv(requiredEnv),
};
