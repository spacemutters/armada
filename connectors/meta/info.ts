import { hasEnv, type ConnectorInfo } from "@/lib/connections/types";

// Placeholder written so the registry compiles; the new-stores work replaces it.
const requiredEnv = ["META_APP_ID", "META_APP_SECRET"];

export const facebookInfo: ConnectorInfo & { available: () => boolean } = {
  provider: "facebook",
  name: "Facebook and Instagram shop",
  kind: "store",
  blurb: "Open a shop on Facebook and Instagram, with your products kept in step automatically.",
  method: "popup",
  requiredEnv,
  callbackPath: "/api/connect/facebook/callback",
  canOpenNew: true,
  ownerSetup: "Armada's Meta app with Business Verification and App Review (sign-up 1).",
  available: () => hasEnv(requiredEnv),
};
