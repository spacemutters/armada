import { hasEnv, type ConnectorInfo } from "@/lib/connections/types";

// Placeholder written so the registry compiles; the new-stores work replaces it.
const requiredEnv = ["EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET", "EBAY_RUNAME"];

export const ebayInfo: ConnectorInfo & { available: () => boolean } = {
  provider: "ebay",
  name: "eBay",
  kind: "store",
  blurb: "Connect an eBay seller account, or open a new one, and Armada sets it up to list.",
  method: "redirect",
  requiredEnv,
  callbackPath: "/api/connect/ebay/callback",
  canOpenNew: true,
  ownerSetup: "Armada's eBay app (your eBay developer account, sign-up 5).",
  available: () => hasEnv(requiredEnv),
};
