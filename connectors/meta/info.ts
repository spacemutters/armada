import { hasEnv, type ConnectorInfo } from "@/lib/connections/types";
import { META_REQUIRED_ENV } from "./core";

// Facebook and Instagram shops: one press opens Meta's own setup window (the Business Extension),
// which makes the business, catalog, Page and shop; Armada then fills the catalog from a linked
// Shopify store and hands Meta a checkout address that goes to that store's cart. Since September
// 2025 every Meta shop checks out on the seller's own website, so a Shopify store comes first.
export const facebookInfo: ConnectorInfo & { available: () => boolean } = {
  provider: "facebook",
  name: "Facebook and Instagram shop",
  kind: "store",
  blurb: "Open a shop on Facebook and Instagram that checks out on your Shopify store, with its products kept in step.",
  method: "popup",
  requiredEnv: META_REQUIRED_ENV,
  callbackPath: "/api/connect/facebook/callback",
  canOpenNew: true,
  ownerSetup:
    "Armada's Meta app must belong to a verified business, and Meta must add it to the Business Extension allow list and the Shops onboarding beta " +
    "(ask a Meta partner representative; the permission manage_business_extension can't be requested any other way). " +
    "Get App Review for catalog_management, business_management, pages_read_engagement and instagram_basic, plus Advanced Access to public_profile. " +
    "In Facebook Login settings, add the callback address shown here to Valid OAuth Redirect URIs. " +
    "Then set META_APP_ID and META_APP_SECRET, and META_SHOPS_APPROVED=yes once Meta confirms the allow list.",
  available: () => hasEnv(META_REQUIRED_ENV) && /^(1|yes|true|on)$/i.test(process.env.META_SHOPS_APPROVED?.trim() ?? ""),
};
