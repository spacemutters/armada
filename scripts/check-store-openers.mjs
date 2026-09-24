// Offline checks for one-press store opening (eBay, Facebook and Instagram): the sign-in and setup
// window addresses, the state and return-path handling, the business-policy and catalog payloads,
// the delivery-service choice, the checkout hand-off to Shopify, and the plain answers to platform
// refusals. No network, no database, no real keys: only the pure files, loaded straight from Node.
// Prints one PASS/FAIL line per check and exits 1 on any FAIL.
//
//   node scripts/check-store-openers.mjs

import { createHmac } from "node:crypto";

let failures = 0;
let passes = 0;
function check(ok, label, detail) {
  if (ok) passes++;
  else failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${!ok && detail !== undefined ? ` (${typeof detail === "string" ? detail : JSON.stringify(detail)})` : ""}`);
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

let ebay, meta, bridge;
try {
  ebay = await import("../connectors/ebay/core.ts");
  meta = await import("../connectors/meta/core.ts");
  bridge = await import("../app/api/connect/facebook/bridge.ts");
} catch (e) {
  console.log(`FAIL couldn't load the store-opener code: ${e.message}`);
  process.exit(1);
}

// ---------------------------------------------------------------- eBay settings and sign-in

const fullEnv = { EBAY_CLIENT_ID: "Armada-Test-PRD-1234", EBAY_CLIENT_SECRET: "PRD-secret-for-tests", EBAY_RUNAME: "Armada-Armada-Test-abcdef", ENCRYPTION_KEY: "x" };
check(ebay.ebayConfig({}) === null, "eBay: no settings means switched off");
check(ebay.ebayConfig({ ...fullEnv, EBAY_RUNAME: " " }) === null, "eBay: a blank setting counts as missing");
check(ebay.ebayConfig({ ...fullEnv, ENCRYPTION_KEY: undefined }) === null, "eBay: no sealing key means switched off");
const cfg = ebay.ebayConfig(fullEnv);
check(cfg?.env === "production", "eBay: production by default");
check(ebay.ebayConfig({ ...fullEnv, EBAY_ENV: "Sandbox" })?.env === "sandbox", "eBay: EBAY_ENV=sandbox switches to the test site");

const state = "Ab-_9xYz0123456789abcdefghijklmn"; // base64url, like lib/connections/state.ts makes
const url = new URL(ebay.consentUrl(cfg, state, { forceSignIn: true }));
check(url.origin + url.pathname === "https://auth.ebay.com/oauth2/authorize", "eBay: sign-in goes to eBay's own authorize page", url.origin + url.pathname);
check(url.searchParams.get("client_id") === fullEnv.EBAY_CLIENT_ID, "eBay: client id is sent");
check(url.searchParams.get("redirect_uri") === fullEnv.EBAY_RUNAME, "eBay: redirect is the RuName, not a web address");
check(url.searchParams.get("response_type") === "code", "eBay: asks for a one-time code");
check(url.searchParams.get("state") === state, "eBay: state comes back exactly as sent");
check(url.searchParams.get("prompt") === "login", "eBay: opening a new store always shows eBay's sign-in page");
check(!new URL(ebay.consentUrl(cfg, state)).searchParams.has("prompt"), "eBay: connecting an existing account doesn't force sign-in");
const scopes = url.searchParams.get("scope").split(" ");
for (const s of ["sell.account", "sell.inventory", "sell.fulfillment", "commerce.identity.readonly"]) {
  check(scopes.includes(`https://api.ebay.com/oauth/api_scope/${s}`), `eBay: asks for ${s}`);
}
check(scopes.includes("https://api.ebay.com/oauth/api_scope"), "eBay: asks for the base scope (delivery services)");
check(!url.search.includes("+") && url.search.includes("%20"), "eBay: scopes are separated by %20, as eBay's examples show");
const sandboxUrl = new URL(ebay.consentUrl(ebay.ebayConfig({ ...fullEnv, EBAY_ENV: "sandbox" }), state));
check(sandboxUrl.host === "auth.sandbox.ebay.com", "eBay: sandbox sign-in uses eBay's test site", sandboxUrl.host);

// ---------------------------------------------------------------- eBay tokens

const code = "code^1.1#f^0#p^3#r^1/+=&x";
const body = new URLSearchParams(ebay.codeGrantBody(cfg, code));
check(body.get("grant_type") === "authorization_code" && body.get("code") === code && body.get("redirect_uri") === fullEnv.EBAY_RUNAME, "eBay: code swap body carries the code (with its odd characters) and RuName");
const refreshBody = new URLSearchParams(ebay.refreshGrantBody("refresh-value-1"));
check(refreshBody.get("grant_type") === "refresh_token" && refreshBody.get("refresh_token") === "refresh-value-1" && !refreshBody.has("scope"), "eBay: renewal body reuses the approved scopes");
check(ebay.basicAuth(cfg) === `Basic ${Buffer.from(`${fullEnv.EBAY_CLIENT_ID}:${fullEnv.EBAY_CLIENT_SECRET}`).toString("base64")}`, "eBay: Basic credentials are id:secret in base64");

const now = Date.parse("2026-09-24T12:00:00Z");
const tokens = ebay.readTokenResponse({ access_token: "access-1", expires_in: 7200, refresh_token: "refresh-1", refresh_token_expires_in: 47304000 }, now);
check(tokens.accessExpiresAt === "2026-09-24T14:00:00.000Z", "eBay: access lasts two hours", tokens.accessExpiresAt);
check(Math.round((Date.parse(tokens.refreshExpiresAt) - now) / 86400000) === 548, "eBay: the lasting access runs about 18 months", tokens.refreshExpiresAt);
const renewed = ebay.readTokenResponse({ access_token: "access-2", expires_in: 7200 }, now + 3600_000, tokens);
check(renewed.refreshToken === "refresh-1" && renewed.refreshExpiresAt === tokens.refreshExpiresAt, "eBay: a renewal keeps the lasting access eBay gave at sign-in");
let threw = false;
try {
  ebay.readTokenResponse({ error: "invalid_grant" }, now);
} catch {
  threw = true;
}
check(threw, "eBay: an answer with no access is refused");
check(ebay.accessIsStale(tokens.accessExpiresAt, now + 7200_000 - 60_000) && !ebay.accessIsStale(tokens.accessExpiresAt, now), "eBay: access is renewed when under five minutes are left");

// ---------------------------------------------------------------- eBay business policies

const ret = ebay.returnPolicyBody("EBAY_US");
check(ret.returnsAccepted === true && eq(ret.returnPeriod, { value: 30, unit: "DAY" }), "eBay: returns accepted for 30 days");
check(ret.returnShippingCostPayer === "BUYER" && ret.refundMethod === "MONEY_BACK", "eBay: buyer pays return postage, refund is money back");
check(eq(ret.categoryTypes, [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES" }]) && ret.marketplaceId === "EBAY_US", "eBay: return policy covers everything but vehicles on the right marketplace");
const pay = ebay.paymentPolicyBody("EBAY_GB");
check(pay.immediatePay === true && pay.marketplaceId === "EBAY_GB" && !("paymentMethods" in pay), "eBay: payment policy asks for immediate payment and leaves card methods to eBay");
const ful = ebay.fulfillmentPolicyBody("EBAY_US", { code: "USPSGroundAdvantage", carrier: "USPS" }, "USD");
check(eq(ful.handlingTime, { value: 2, unit: "DAY" }), "eBay: two business days to hand an order to the carrier", ful.handlingTime);
const svc = ful.shippingOptions[0].shippingServices;
check(ful.shippingOptions[0].optionType === "DOMESTIC" && ful.shippingOptions[0].costType === "FLAT_RATE", "eBay: one domestic flat-rate option");
check(svc.length === 1 && svc[0].sortOrder === 1 && svc[0].freeShipping === true, "eBay: free delivery is on the first (and only) service, the one eBay honours");
check(eq(svc[0].shippingCost, { value: "0.00", currency: "USD" }) && svc[0].shippingServiceCode === "USPSGroundAdvantage", "eBay: delivery costs nothing, in the marketplace's currency");
for (const p of [ret, pay, ful]) check(p.name.startsWith("Armada ") && p.name.length <= 64, `eBay: policy name "${p.name}" is Armada's and short enough`);

// ---------------------------------------------------------------- eBay delivery service choice

const services = [
  { shippingService: "USPSPriorityMailInternational", internationalService: true, validForSellingFlow: true, shippingCategory: "STANDARD" },
  { shippingService: "LocalPickup", validForSellingFlow: true, shippingCategory: "PICKUP" },
  { shippingService: "USPSFirstClass", validForSellingFlow: false, shippingCategory: "STANDARD" },
  { shippingService: "UPSNextDayAir", validForSellingFlow: true, shippingCategory: "ONE_DAY" },
  { shippingService: "UPSGround", shippingCarrier: "UPS", validForSellingFlow: true, shippingCategory: "STANDARD", shippingCostTypes: ["FLAT_RATE", "CALCULATED"] },
  { shippingService: "USPSGroundAdvantage", shippingCarrier: "USPS", validForSellingFlow: true, shippingCategory: "STANDARD", description: "USPS Ground Advantage" },
];
check(eq(ebay.pickShippingService(services), { code: "USPSGroundAdvantage", carrier: "USPS", description: "USPS Ground Advantage" }), "eBay: picks the everyday domestic service first", ebay.pickShippingService(services));
check(ebay.pickShippingService(services.filter((s) => s.shippingService !== "USPSGroundAdvantage"))?.code === "UPSGround", "eBay: falls back to another standard service");
check(ebay.pickShippingService(services.slice(0, 4)) === null, "eBay: never picks international, pickup, retired or overnight-only services");
check(ebay.pickShippingService([{ shippingService: "X_Economy", validForSellingFlow: true, shippingCategory: "ECONOMY" }])?.code === "X_Economy", "eBay: takes economy when there's no standard");
check(ebay.pickShippingService([{ shippingService: "CalcOnly", validForSellingFlow: true, shippingCategory: "STANDARD", shippingCostTypes: ["CALCULATED"] }]) === null, "eBay: skips services that can't be flat rate");

// ---------------------------------------------------------------- eBay ship-from place

check(
  eq(ebay.addressFromIdentity({ businessAccount: { address: { addressLine1: "1 Main St", city: "Lakeland", stateOrProvince: "FL", postalCode: "33801", country: "US" } } }), {
    city: "Lakeland",
    stateOrProvince: "FL",
    postalCode: "33801",
    country: "US",
  }),
  "eBay: a business account's address, without the street line",
);
check(ebay.addressFromIdentity({ individualAccount: { registrationAddress: { postalCode: "SW1A 1AA", country: "GB" } } })?.postalCode === "SW1A 1AA", "eBay: an individual's registered address");
check(ebay.addressFromIdentity({ individualAccount: {} }) === null && ebay.addressFromIdentity({ username: "x" }) === null, "eBay: no address when eBay didn't share one (then the setup asks)");
check(!ebay.usableAddress({ city: "Lakeland", country: "US" }) && ebay.usableAddress({ city: "Lakeland", stateOrProvince: "FL", country: "US" }), "eBay: a warehouse needs a postal code, or city and state");
check(ebay.cleanPostalCode(" 33801 ") === "33801" && ebay.cleanPostalCode("sw1a 1aa") === "SW1A 1AA" && ebay.cleanPostalCode("<script>") === null && ebay.cleanPostalCode("1") === null, "eBay: typed ZIP codes are tidied and checked");
const loc = ebay.locationBody({ postalCode: "33801", country: "US" });
check(eq(loc.locationTypes, ["WAREHOUSE"]) && eq(loc.location.address, { postalCode: "33801", country: "US" }), "eBay: the default location is a warehouse at that place");
check(!JSON.stringify(loc).includes("merchantLocationStatus"), "eBay: the location is left enabled (eBay's default)");

// ---------------------------------------------------------------- eBay refusals in plain words

const reg = ebay.explainEbayProblem({ status: 400, errors: [{ errorId: 20408, message: "No payment program available." }], env: "production", storeId: "s1" });
check(reg.state === "needs_you" && reg.action?.href === "https://www.ebay.com/sl/sell" && reg.action.external, "eBay: an account not yet set up to sell gets one button to eBay's selling sign-up", reg);
const opt = ebay.explainEbayProblem({ status: 400, errors: [{ errorId: 20403, message: "Invalid .", parameters: [{ name: "x", value: "The seller is not BP opted in." }] }], env: "production", storeId: "s1" });
check(opt.state === "later" && !opt.action, "eBay: business policies still switching on means come back later", opt);
const signIn = ebay.explainEbayProblem({ status: 401, errors: [], env: "production", storeId: "abc" });
check(signIn.state === "needs_you" && signIn.action?.href === "/api/connect/ebay/start?purpose=connect&store=abc", "eBay: refused access leads back to eBay's sign-in for that store", signIn);
check(ebay.explainEbayProblem({ status: 503, errors: [], env: "production", storeId: "s" }).state === "failed", "eBay: eBay being busy is a try-again");
check(ebay.explainEbayProblem({ status: 400, errors: [{ errorId: 20408 }], env: "sandbox", storeId: "s" }).action?.href.startsWith("https://www.sandbox.ebay.com/"), "eBay: the sandbox sends people to eBay's test site");
const other = ebay.explainEbayProblem({ status: 400, errors: [{ errorId: 1, longMessage: "Something eBay-specific." }], env: "production", storeId: "s" });
check(other.state === "failed" && other.note.includes("Something eBay-specific."), "eBay: anything else shows eBay's own words");

// ---------------------------------------------------------------- setup steps

const steps = ebay.freshSteps(ebay.EBAY_STEPS);
check(steps.every((s) => s.state === "waiting") && ebay.nextStep(steps).key === "account", "Setup: every step starts waiting, sign-in first");
check(eq(ebay.EBAY_STEPS.map((s) => s.key), ["account", "seller", "policies", "payment", "returns", "delivery", "location", "ready"]), "Setup: eBay's steps run in the order eBay needs");
check(ebay.nextStep(steps.map((s) => ({ ...s, state: "done" }))) === null, "Setup: nothing left once every step is done");
check(meta.nextStep(meta.freshSteps(meta.META_STEPS)).key === "business", "Setup: Meta's steps start with the business");

// ---------------------------------------------------------------- Meta settings and setup window

const metaEnv = { META_APP_ID: "1234567890", META_APP_SECRET: "app-secret-for-tests", META_SHOPS_APPROVED: "yes", ENCRYPTION_KEY: "x" };
check(meta.metaConfig({ ...metaEnv, META_SHOPS_APPROVED: undefined }) === null, "Meta: off until Meta has approved the app for shops");
check(meta.metaConfig({ ...metaEnv, META_SHOPS_APPROVED: "no" }) === null, "Meta: META_SHOPS_APPROVED=no keeps it off");
const mcfg = meta.metaConfig(metaEnv);
check(mcfg?.graphVersion === "v25.0" && mcfg.channel === "COMMERCE_OFFSITE", "Meta: current Graph version and the website-checkout flow by default", mcfg);
check(meta.metaConfig({ ...metaEnv, META_GRAPH_VERSION: "latest" }).graphVersion === "v25.0" && meta.metaConfig({ ...metaEnv, META_GRAPH_VERSION: "v26.0" }).graphVersion === "v26.0", "Meta: only a real version number overrides it");

const win = new URL(
  meta.setupWindowUrl(mcfg, {
    redirectUri: "https://armada-pi.vercel.app/api/connect/facebook/callback",
    state,
    externalBusinessId: "armada-1234abcd-k3y",
    businessName: "Juniper Studio",
    currency: "USD",
    timezone: "America/Chicago",
    shopDomain: "juniper-studio.myshopify.com",
  }),
);
check(win.origin + win.pathname === "https://www.facebook.com/v25.0/dialog/oauth", "Meta: opens Meta's own dialog", win.pathname);
check(win.searchParams.get("client_id") === "1234567890" && win.searchParams.get("response_type") === "code" && win.searchParams.get("display") === "popup", "Meta: a popup that returns a one-time code");
check(win.searchParams.get("redirect_uri") === "https://armada-pi.vercel.app/api/connect/facebook/callback" && win.searchParams.get("state") === state, "Meta: comes back to Armada with the state untouched");
const mscopes = win.searchParams.get("scope").split(",");
check(mscopes[0] === "manage_business_extension" && mscopes.includes("catalog_management"), "Meta: asks for the Business Extension and catalog permissions", mscopes);
const extras = JSON.parse(win.searchParams.get("extras"));
check(
  eq(extras.setup, {
    external_business_id: "armada-1234abcd-k3y",
    timezone: "America/Chicago",
    currency: "USD",
    business_vertical: "ECOMMERCE",
    channel: "COMMERCE_OFFSITE",
    domain: "https://juniper-studio.myshopify.com",
  }),
  "Meta: setup names the business, time zone, currency, commerce, and the Shopify store's address",
  extras.setup,
);
check(extras.business_config.business.name === "Juniper Studio" && extras.repeat === false, "Meta: business name passed, repeat off");
check(meta.cleanTimezone("Not a zone; drop table") === "America/New_York" && meta.cleanTimezone("America/Argentina/Buenos_Aires") === "America/Argentina/Buenos_Aires", "Meta: odd time zones fall back safely");
check(meta.cleanShopDomain("https://Juniper-Studio.myshopify.com/admin") === "juniper-studio.myshopify.com" && meta.cleanShopDomain("javascript:alert(1)") === null, "Meta: store addresses are tidied and checked");
check(/^armada-[0-9a-f]{8}-/.test(meta.externalBusinessId("0f3c9d2e-aaaa-bbbb-cccc-ddddeeeeffff", "n0nce")) && meta.externalBusinessId("0f3c9d2e-aaaa", "x".repeat(80)).length <= 60, "Meta: setup ids are Armada's and short");
check(meta.appSecretProof("access-abc", "app-secret-for-tests") === createHmac("sha256", "app-secret-for-tests").update("access-abc").digest("hex"), "Meta: app-secret proof is HMAC-SHA256 of the access");
const gu = new URL(meta.graphUrl(mcfg, "/fbe_business/fbe_installs", { fbe_external_business_id: "armada-x" }));
check(gu.origin === "https://graph.facebook.com" && gu.pathname === "/v25.0/fbe_business/fbe_installs" && gu.searchParams.get("fbe_external_business_id") === "armada-x", "Meta: install lookup address");

// ---------------------------------------------------------------- Meta: what the Business Extension made

const install = {
  data: [
    {
      business_manager_id: "111",
      catalog_id: "222",
      pixel_id: "333",
      pages: ["444"],
      instagram_profiles: ["555"],
      token_type: "User",
      installed_features: [
        {
          feature_type: "fb_shop",
          connected_assets: { commerce_merchant_settings_id: "666", page_id: "444", catalog_id: "222" },
          additional_info: [{ onsite_commerce_eligible: false }, { shop_status: ["inactive_other"] }, { shop_status_info: ["Your shop isn't visible."] }],
        },
      ],
    },
  ],
};
const assets = meta.readInstall(install);
check(eq(assets, { businessId: "111", catalogId: "222", commerceId: "666", pageId: "444", igId: "555", pixelId: "333", adAccountId: undefined, shopStatus: "inactive_other", shopStatusInfo: "Your shop isn't visible." }), "Meta: reads business, catalog, shop, Page, Instagram, pixel and shop status", assets);
check(meta.readInstall({ data: [] }) === null && meta.readInstall(null) === null, "Meta: nothing installed reads as nothing");
check(meta.readInstall({ data: [{ installed_features: [{ connected_assets: { business_manager_id: "9", catalog_id: "8" } }] }] })?.businessId === "9", "Meta: ids inside a feature count too");
check(meta.shopStatusNote({ shopStatus: "active" }) === null && /checkout/.test(meta.shopStatusNote({ shopStatus: "inactive_other" })), "Meta: a hidden shop says the checkout address is what's missing");

// ---------------------------------------------------------------- Meta catalog payloads

const shop = { domain: "juniper-studio.myshopify.com", currency: "USD", brand: "Juniper Studio" };
const listing = {
  listingId: "0f3c9d2e-1111-2222-3333-444455556666",
  externalId: "gid://shopify/ProductVariant/44556677",
  handle: "linen-throw",
  title: "Linen throw ".repeat(12),
  description: "<p>Soft <strong>linen</strong>&nbsp;throw.</p>",
  priceCents: 4299,
  status: "active",
  images: [{ url: "https://cdn.example.com/a.jpg" }, { url: "http://insecure.example.com/b.jpg" }],
};
const item = meta.catalogRequest(listing, shop);
check(item.ok && item.request.method === "UPDATE", "Meta: products go as UPDATE, which adds new ones and updates the rest");
const d = item.request.data;
check(d.id === "44556677" && item.retailerId === "44556677", "Meta: the catalog id is the Shopify variant number when Armada knows it");
check(d.price === "42.99 USD" && d.availability === "in stock" && d.condition === "new", "Meta: price as '42.99 USD', in stock, new", d);
check(d.title.length === 100 && d.description === "Soft linen throw." && d.brand === "Juniper Studio", "Meta: title clipped to 100, description as plain text, brand set");
check(d.link === "https://juniper-studio.myshopify.com/products/linen-throw", "Meta: product link is the Shopify product page");
check(eq(d.image, [{ url: "https://cdn.example.com/a.jpg" }]), "Meta: only secure photo addresses are sent");
check(meta.catalogRequest({ ...listing, externalId: "gid://shopify/Product/1", status: "hidden" }, shop).request.data.id === `armada-${listing.listingId}`, "Meta: without a variant number the id is armada-<listing>");
check(meta.catalogRequest({ ...listing, status: "hidden" }, shop).request.data.availability === "out of stock", "Meta: hidden listings show as out of stock");
check(!meta.catalogRequest({ ...listing, images: [] }, shop).ok && !meta.catalogRequest({ ...listing, handle: null }, shop).ok, "Meta: products without a photo or a product page are left out, with a reason");
check(eq(meta.catalogBatches(Array.from({ length: 7001 }, (_, i) => i)).map((b) => b.length), [3000, 3000, 1001]), "Meta: sent in batches of 3000 or fewer");
check(meta.variantIdFrom("gid://shopify/ProductVariant/12") === "12" && meta.variantIdFrom("12") === null && meta.variantIdFrom(null) === null, "Meta: only a real variant id counts as one");

// ---------------------------------------------------------------- checkout hand-off to Shopify

check(eq(meta.parseCheckoutProducts("12345:3,23456:1"), [{ id: "12345", quantity: 3 }, { id: "23456", quantity: 1 }]), "Checkout: reads Meta's products list");
check(eq(meta.parseCheckoutProducts("111:2,111:1,bad id:1,222:0,333:x,444"), [{ id: "111", quantity: 3 }, { id: "444", quantity: 1 }]), "Checkout: repeats add up, bad entries are skipped, no number means one");
check(meta.parseCheckoutProducts("555:1000")[0].quantity === 99 && meta.parseCheckoutProducts(Array.from({ length: 80 }, (_, i) => `${i + 1}:1`).join(",")).length === 50, "Checkout: quantities and cart size are capped");
const cartUrl = meta.shopifyCartUrl("juniper-studio.myshopify.com", [{ variantId: "44556677", quantity: 2 }, { variantId: "11", quantity: 1 }], { coupon: "SUMMER20", passthrough: [["utm_source", "IGShopping"], ["cart_origin", "instagram"]] });
check(cartUrl === "https://juniper-studio.myshopify.com/cart/44556677:2,11:1?discount=SUMMER20&utm_source=IGShopping&cart_origin=instagram", "Checkout: a Shopify cart link that goes straight to checkout, coupon and tracking kept", cartUrl);
check(!meta.shopifyCartUrl("juniper-studio.myshopify.com", [{ variantId: "1", quantity: 1 }], { coupon: "x&admin=1" }).includes("admin"), "Checkout: a strange coupon is dropped, not passed on");
check(eq(meta.passthroughParams([["utm_campaign", "fall"], ["products", "1:1"], ["redirect", "https://evil.example"], ["cart_origin", "facebook"]]), [["utm_campaign", "fall"], ["cart_origin", "facebook"]]), "Checkout: only Meta's tracking parameters are passed on");
for (const bad of ["shop.myshopify.com@evil.example", "localhost", "", "a b.com", "javascript:alert(1)"]) {
  threw = false;
  try {
    meta.shopifyCartUrl(bad, [], {});
  } catch {
    threw = true;
  }
  check(threw, `Checkout: never builds a link to ${JSON.stringify(bad)}`);
}
check(new URL(meta.shopifyCartUrl("juniper-studio.myshopify.com/admin?x=1", [], {})).host === "juniper-studio.myshopify.com", "Checkout: a stored address with a path still lands on the store itself");

// ---------------------------------------------------------------- Meta refusals in plain words

check(meta.explainMetaProblem(400, { code: 190 }).state === "needs_you", "Meta: lost access asks the person to set up again");
check(meta.explainMetaProblem(400, { code: 80014 }).state === "later", "Meta: too many catalog calls means try again later");
check(/permission/.test(meta.explainMetaProblem(403, { code: 200 }).note), "Meta: a missing permission is said plainly");
check(meta.explainMetaProblem(500, null).state === "failed", "Meta: Meta being busy is a try-again");

// ---------------------------------------------------------------- return paths and the popup's last page

check(bridge.safeReturnPath("/stores/new", "/x") === "/stores/new" && bridge.safeReturnPath("/connections?tab=1", "/x") === "/connections?tab=1", "Return: Armada paths are kept");
for (const bad of ["//evil.example", "/\\evil.example", "https://evil.example", "javascript:alert(1)", "/ok\r\nSet-Cookie: x", 42, null]) {
  check(bridge.safeReturnPath(bad, "/stores/new") === "/stores/new", `Return: ${JSON.stringify(bad)} is refused`);
}
check(bridge.withProblem("/stores/new#facebook", "meta_off") === "/stores/new?problem=meta_off#facebook", "Return: problem code goes before the #section");
check(bridge.withProblem("/connections?x=1", "ebay_declined") === "/connections?x=1&problem=ebay_declined", "Return: problem code joins an existing query");

const page = await bridge.bridgePage("/stores/new/setup/abc", "https://armada-pi.vercel.app").text();
check(page.includes('window.opener.postMessage({ type: "armada:meta-setup", to: to }, "https://armada-pi.vercel.app")'), "Popup: tells only Armada's own page where to go next");
check(page.includes('var to = "/stores/new/setup/abc"') && page.includes("window.close()") && page.includes("location.replace(to)"), "Popup: closes itself, or goes there itself without an opener");
const evil = await bridge.bridgePage('/x"</script><script>alert(1)</script>', "https://armada-pi.vercel.app").text();
const script = evil.slice(evil.indexOf("<script>") + "<script>".length, evil.lastIndexOf("</script>"));
check(!evil.includes("<script>alert(1)") && !script.includes("<") && !script.includes(">"), "Popup: a hostile path can't break out of the page", script.slice(0, 120));
const offsite = await bridge.bridgePage("https://evil.example/", "https://armada-pi.vercel.app").text();
check(offsite.includes('var to = "/stores/new"'), "Popup: an address off Armada is replaced with the store page");

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
