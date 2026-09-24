import { hasEnv, type ConnectorInfo } from "@/lib/connections/types";
import { EBAY_REQUIRED_ENV } from "./core";

// eBay: one press goes to eBay's own sign-in page (where someone new can also create an account),
// then Armada sets the account up to list: business policies, payment, 30-day returns, free
// delivery and a ship-from place. EBAY_ENV=sandbox points everything at eBay's test site.
export const ebayInfo: ConnectorInfo & { available: () => boolean } = {
  provider: "ebay",
  name: "eBay",
  kind: "store",
  blurb: "Connect an eBay seller account, or open a new one, and Armada sets it up to list.",
  method: "redirect",
  requiredEnv: EBAY_REQUIRED_ENV,
  callbackPath: "/api/connect/ebay/callback",
  canOpenNew: true,
  ownerSetup:
    "In eBay's developer site, make a production keyset (it only switches on once the account-deletion address answers eBay's check, which Armada already does). " +
    "Under User Tokens, add a redirect name: Auth Accepted URL = the callback address shown here, Auth Declined URL = the same address with ?declined=1, " +
    "plus Armada's privacy page. Then put the App ID in EBAY_CLIENT_ID, the Cert ID in EBAY_CLIENT_SECRET and the redirect name (RuName) in EBAY_RUNAME. " +
    "The keyset's scopes must include sell.account, sell.inventory, sell.fulfillment, commerce.identity.readonly and commerce.identity.address.readonly.",
  available: () => hasEnv(EBAY_REQUIRED_ENV),
};
