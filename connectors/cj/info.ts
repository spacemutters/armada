import { hasEnv, type ConnectorInfo } from "@/lib/connections/types";

// CJ has no approval screen for apps: a person copies their account's key from CJ once and pastes
// it into Armada. The key is checked with CJ, then kept sealed (connectors/cj/client.ts).
const requiredEnv = ["ENCRYPTION_KEY"];

/** CJ's own page where an account makes and copies its key. */
export const CJ_KEY_PAGE = "https://www.cjdropshipping.com/my.html#/authorize/API";

export const cjInfo: ConnectorInfo & { available: () => boolean } = {
  provider: "cj",
  name: "CJ Dropshipping",
  kind: "supplier",
  blurb: "Real products with real costs, photos and shipping times, and each sale ordered from CJ for you.",
  method: "key",
  requiredEnv,
  ownerSetup: "Nothing on CJ's side: each person connects their own CJ account. Armada only needs its encryption setting in Vercel.",
  available: () => hasEnv(requiredEnv),
};
