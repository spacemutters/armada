import type { ConnectorInfo } from "@/lib/connections/types";

// CJ has no sign-in approval for apps: a person pastes their account's key once. Always available.
export const cjInfo: ConnectorInfo & { available: () => boolean } = {
  provider: "cj",
  name: "CJ Dropshipping",
  kind: "supplier",
  blurb: "The real supplier catalog: real costs, photos and shipping times, and automatic ordering.",
  method: "key",
  requiredEnv: ["ENCRYPTION_KEY"],
  ownerSetup: "Nothing: each person connects their own CJ account.",
  available: () => true,
};
