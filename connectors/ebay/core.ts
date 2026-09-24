// The pure half of Armada's eBay connection: settings, addresses, the sign-in link, the token
// request bodies, the setup steps, the default business policies, and what to tell a person when
// eBay says no. No network, no database and no runtime imports, so scripts/check-store-openers.mjs
// can load it straight from Node and test it offline.
//
// Checked against eBay's docs on 2026-09-24 (developer.ebay.com/develop/api/sell/account_api_v1,
// inventory_api, identity_api, metadata_api, and the OAuth guide /api-docs/static/oauth-*.html):
// - Sign-in: GET https://auth.ebay.com/oauth2/authorize with client_id, redirect_uri = the RuName,
//   response_type=code, scope (space separated), state, and prompt=login to force the sign-in page
//   (where someone without an account can create one). Sandbox: auth.sandbox.ebay.com.
// - Tokens: POST https://api.ebay.com/identity/v1/oauth2/token, form body, Basic client_id:secret.
//   Access lasts 7,200 s; the refresh lasts 47,304,000 s (about 18 months).
// - Business policies need SELLING_POLICY_MANAGEMENT: POST /sell/account/v1/program/opt_in, which
//   "can take up to 24-hours" to process. Until then policy calls fail with 20403 ("not BP opted in").
// - 20408: "No payment program available. The user may not be registered to the specified site."
// - getPrivileges: sellerRegistrationCompleted says whether the account has finished seller sign-up.
// - Inventory locations: a WAREHOUSE needs postalCode + country, or city + stateOrProvince + country.
// - Delivery services come from the Metadata API's get_shipping_services for the marketplace, so
//   Armada never guesses a service code.

export type EbayEnv = "production" | "sandbox";

export interface EbayConfig {
  clientId: string;
  clientSecret: string;
  ruName: string;
  env: EbayEnv;
}

/** Server settings the eBay connection needs. ENCRYPTION_KEY seals the account's access. */
export const EBAY_REQUIRED_ENV = ["EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET", "EBAY_RUNAME", "ENCRYPTION_KEY"];

/** Reads the settings, or null when any is missing. EBAY_ENV=sandbox switches to eBay's test site. */
export function ebayConfig(env: Record<string, string | undefined>): EbayConfig | null {
  const clientId = env.EBAY_CLIENT_ID?.trim();
  const clientSecret = env.EBAY_CLIENT_SECRET?.trim();
  const ruName = env.EBAY_RUNAME?.trim();
  if (!clientId || !clientSecret || !ruName || !env.ENCRYPTION_KEY) return null;
  return { clientId, clientSecret, ruName, env: env.EBAY_ENV?.trim().toLowerCase() === "sandbox" ? "sandbox" : "production" };
}

export function ebayHosts(env: EbayEnv) {
  return env === "sandbox"
    ? { auth: "https://auth.sandbox.ebay.com", api: "https://api.sandbox.ebay.com", apiz: "https://apiz.sandbox.ebay.com", web: "https://www.sandbox.ebay.com" }
    : { auth: "https://auth.ebay.com", api: "https://api.ebay.com", apiz: "https://apiz.ebay.com", web: "https://www.ebay.com" };
}

const SCOPE = "https://api.ebay.com/oauth/api_scope";

/**
 * What Armada asks the seller to approve. The base scope reads eBay's delivery services; account
 * sets up business policies; inventory makes the location and, later, listings; fulfillment reads
 * orders; identity reads the username, marketplace and registered address (for the default
 * location). All of them must be listed for Armada's keys on eBay's Application Keys page.
 */
export const EBAY_SCOPES = [
  SCOPE,
  `${SCOPE}/sell.account`,
  `${SCOPE}/sell.inventory`,
  `${SCOPE}/sell.fulfillment`,
  `${SCOPE}/commerce.identity.readonly`,
  `${SCOPE}/commerce.identity.address.readonly`,
];

/**
 * eBay's own sign-in and approval page. `forceSignIn` shows the sign-in page even when the person is
 * already signed in to eBay, so opening a new store never quietly reuses the account in the browser;
 * that page is also where someone without an account creates one.
 */
export function consentUrl(cfg: EbayConfig, state: string, opts: { forceSignIn?: boolean; locale?: string } = {}): string {
  const q: [string, string][] = [
    ["client_id", cfg.clientId],
    ["redirect_uri", cfg.ruName],
    ["response_type", "code"],
    ["scope", EBAY_SCOPES.join(" ")],
    ["state", state],
  ];
  if (opts.forceSignIn) q.push(["prompt", "login"]);
  if (opts.locale) q.push(["locale", opts.locale]);
  // encodeURIComponent writes spaces as %20, which is what eBay's examples use.
  return `${ebayHosts(cfg.env).auth}/oauth2/authorize?${q.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")}`;
}

export const TOKEN_PATH = "/identity/v1/oauth2/token";

export function basicAuth(cfg: EbayConfig): string {
  return `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`, "utf8").toString("base64")}`;
}

export function codeGrantBody(cfg: EbayConfig, code: string): string {
  return new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: cfg.ruName }).toString();
}

/** Leaving out `scope` makes eBay reuse the scopes the seller approved. */
export function refreshGrantBody(refreshToken: string): string {
  return new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }).toString();
}

export interface EbayTokens {
  accessToken: string;
  accessExpiresAt: string;
  refreshToken: string;
  refreshExpiresAt: string;
}

/** eBay's token answer as Armada stores it. A refresh answer has no new refresh value, so the old one is kept. */
export function readTokenResponse(json: unknown, now: number, previous?: Pick<EbayTokens, "refreshToken" | "refreshExpiresAt">): EbayTokens {
  const j = (json ?? {}) as Record<string, unknown>;
  const access = typeof j.access_token === "string" ? j.access_token : "";
  if (!access) throw new Error("eBay's answer had no access in it");
  const expiresIn = Number(j.expires_in) > 0 ? Number(j.expires_in) : 7200;
  const refresh = typeof j.refresh_token === "string" ? j.refresh_token : previous?.refreshToken;
  if (!refresh) throw new Error("eBay's answer had no lasting access in it");
  const refreshIn = Number(j.refresh_token_expires_in) > 0 ? Number(j.refresh_token_expires_in) : null;
  return {
    accessToken: access,
    accessExpiresAt: new Date(now + expiresIn * 1000).toISOString(),
    refreshToken: refresh,
    refreshExpiresAt: refreshIn ? new Date(now + refreshIn * 1000).toISOString() : (previous?.refreshExpiresAt ?? new Date(now + 47_304_000_000).toISOString()),
  };
}

/** True when the access runs out within `marginMs` (default five minutes), so it should be renewed first. */
export function accessIsStale(accessExpiresAt: string, now: number, marginMs = 5 * 60_000): boolean {
  const t = Date.parse(accessExpiresAt);
  return !Number.isFinite(t) || t - now < marginMs;
}

// ---------- setup steps ----------

export type StepState = "waiting" | "done" | "needs_you" | "later" | "failed";

/** One line of the live setup view. Shared shape with the Facebook shop setup (connectors/meta/core.ts). */
export interface SetupStep {
  key: string;
  label: string;
  state: StepState;
  /** One plain sentence: what happened, or what's needed. */
  note?: string;
  /** The one button for a step that needs the person: usually the exact page on the platform. */
  action?: { label: string; href: string; external?: boolean };
  /** A small question Armada can't answer itself (e.g. the ZIP code items ship from). */
  ask?: { field: "postalCode"; label: string; hint?: string };
  /** Something to copy into the platform (e.g. the checkout address for Commerce Manager). */
  copy?: { label: string; value: string };
  /** For a step the person finishes on the platform: the words on the "done it" button. */
  confirmLabel?: string;
  finishedAt?: string;
}

export const EBAY_STEPS: { key: string; label: string }[] = [
  { key: "account", label: "Sign in to eBay" },
  { key: "seller", label: "Check the account can sell" },
  { key: "policies", label: "Switch on business policies" },
  { key: "payment", label: "Payment terms" },
  { key: "returns", label: "30-day returns" },
  { key: "delivery", label: "Free delivery" },
  { key: "location", label: "Where items ship from" },
  { key: "ready", label: "Ready to list" },
];

export function freshSteps(list: { key: string; label: string }[]): SetupStep[] {
  return list.map((s) => ({ ...s, state: "waiting" as const }));
}

/** The first step that isn't finished, or null when everything is. */
export function nextStep(steps: SetupStep[]): SetupStep | null {
  return steps.find((s) => s.state !== "done") ?? null;
}

// ---------- defaults for a new seller ----------

/**
 * Armada's starting terms. Two business days to hand an order to the carrier (the same as the shop
 * builder's HANDLING_DAYS in lib/shops/pipeline.ts), 30-day returns with the buyer paying return
 * postage (eBay's usual default; a seller can switch to free returns in Seller Hub), free standard
 * delivery, and immediate payment for fixed-price listings.
 */
export const EBAY_DEFAULTS = {
  handlingDays: 2,
  returnDays: 30,
  returnShippingCostPayer: "BUYER" as "BUYER" | "SELLER",
  names: { payment: "Armada payments", returns: "Armada 30-day returns", delivery: "Armada free delivery" },
  locationKey: "armada-default",
  locationName: "Armada default location",
};

/** Marketplaces Armada can set up automatically, with the currency each one prices in. */
export const MARKETPLACE_CURRENCY: Record<string, string> = {
  EBAY_US: "USD",
  EBAY_GB: "GBP",
  EBAY_AU: "AUD",
  EBAY_CA: "CAD",
  EBAY_DE: "EUR",
  EBAY_FR: "EUR",
  EBAY_IT: "EUR",
  EBAY_ES: "EUR",
  EBAY_IE: "EUR",
  EBAY_AT: "EUR",
  EBAY_NL: "EUR",
};

export const MARKETPLACE_COUNTRY: Record<string, string> = {
  EBAY_US: "US",
  EBAY_GB: "GB",
  EBAY_AU: "AU",
  EBAY_CA: "CA",
  EBAY_DE: "DE",
  EBAY_FR: "FR",
  EBAY_IT: "IT",
  EBAY_ES: "ES",
  EBAY_IE: "IE",
  EBAY_AT: "AT",
  EBAY_NL: "NL",
};

const CATEGORY_TYPES = [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES" }];

export function paymentPolicyBody(marketplaceId: string) {
  return {
    name: EBAY_DEFAULTS.names.payment,
    description: "Set up by Armada. eBay handles card and wallet payments.",
    marketplaceId,
    categoryTypes: CATEGORY_TYPES,
    immediatePay: true,
  };
}

export function returnPolicyBody(marketplaceId: string) {
  return {
    name: EBAY_DEFAULTS.names.returns,
    description: "Set up by Armada.",
    marketplaceId,
    categoryTypes: CATEGORY_TYPES,
    returnsAccepted: true,
    returnPeriod: { value: EBAY_DEFAULTS.returnDays, unit: "DAY" },
    returnShippingCostPayer: EBAY_DEFAULTS.returnShippingCostPayer,
    refundMethod: "MONEY_BACK",
  };
}

export interface ShippingServiceChoice {
  code: string;
  carrier?: string;
  description?: string;
}

export function fulfillmentPolicyBody(marketplaceId: string, service: ShippingServiceChoice, currency: string) {
  return {
    name: EBAY_DEFAULTS.names.delivery,
    description: "Set up by Armada.",
    marketplaceId,
    categoryTypes: CATEGORY_TYPES,
    handlingTime: { value: EBAY_DEFAULTS.handlingDays, unit: "DAY" },
    shippingOptions: [
      {
        optionType: "DOMESTIC",
        costType: "FLAT_RATE",
        shippingServices: [
          {
            sortOrder: 1,
            shippingServiceCode: service.code,
            ...(service.carrier ? { shippingCarrierCode: service.carrier } : {}),
            freeShipping: true,
            shippingCost: { value: "0.00", currency },
          },
        ],
      },
    ],
  };
}

/** One entry of the Metadata API's get_shipping_services answer. */
export interface EbayShippingService {
  shippingService?: string;
  shippingCarrier?: string;
  description?: string;
  internationalService?: boolean;
  validForSellingFlow?: boolean;
  shippingCategory?: string;
  shippingCostTypes?: string[];
  minShippingTime?: number;
  maxShippingTime?: number;
}

// Well-known everyday services, in order of preference, when eBay offers them for the marketplace.
const PREFERRED_SERVICES = [
  "USPSGroundAdvantage",
  "ShippingMethodStandard",
  "UK_RoyalMailSecondClassStandard",
  "UK_OtherCourier24",
  "AU_Regular",
  "CA_PostRegularParcel",
  "DE_DHLPaket",
];

/**
 * Picks a domestic, everyday delivery service from eBay's own list for the marketplace: one eBay
 * marks as valid for new listings, standard speed first (then economy), able to be flat-rate.
 */
export function pickShippingService(services: EbayShippingService[]): ShippingServiceChoice | null {
  const usable = services.filter(
    (s) =>
      s.shippingService &&
      s.internationalService !== true &&
      s.validForSellingFlow !== false &&
      !/pickup|freight/i.test(`${s.shippingCategory ?? ""} ${s.shippingService}`) &&
      (!s.shippingCostTypes?.length || s.shippingCostTypes.some((t) => /^FLAT/i.test(t))),
  );
  const rank = (s: EbayShippingService) => {
    const pref = PREFERRED_SERVICES.indexOf(s.shippingService!);
    const cat = (s.shippingCategory ?? "").toUpperCase();
    const catRank = cat === "STANDARD" ? 0 : cat === "ECONOMY" ? 1 : cat === "EXPEDITED" ? 2 : 3;
    // A service of some other speed (overnight, freight) only counts if it's one of the everyday ones above.
    if (catRank === 3 && pref < 0) return Infinity;
    return (pref >= 0 ? pref : 100) + catRank * 1000;
  };
  const best = [...usable].sort((a, b) => rank(a) - rank(b))[0];
  if (!best || rank(best) === Infinity) return null;
  return { code: best.shippingService!, carrier: best.shippingCarrier || undefined, description: best.description };
}

// ---------- the seller's address, for the default location ----------

export interface EbayAddress {
  city?: string;
  stateOrProvince?: string;
  postalCode?: string;
  country?: string;
}

/** Identity API getUser: a business account's address, or an individual's registered address. */
export function addressFromIdentity(user: unknown): EbayAddress | null {
  const u = (user ?? {}) as { businessAccount?: { address?: EbayAddress }; individualAccount?: { registrationAddress?: EbayAddress } };
  const a = u.businessAccount?.address ?? u.individualAccount?.registrationAddress;
  return usableAddress(a) ? pickAddress(a!) : null;
}

function pickAddress(a: EbayAddress): EbayAddress {
  return {
    ...(a.city ? { city: a.city } : {}),
    ...(a.stateOrProvince ? { stateOrProvince: a.stateOrProvince } : {}),
    ...(a.postalCode ? { postalCode: a.postalCode } : {}),
    country: a.country,
  };
}

/** eBay takes a warehouse with postal code + country, or city + state + country. */
export function usableAddress(a: EbayAddress | null | undefined): boolean {
  if (!a?.country || !/^[A-Z]{2}$/.test(a.country)) return false;
  return Boolean(a.postalCode?.trim()) || Boolean(a.city?.trim() && a.stateOrProvince?.trim());
}

export function locationBody(address: EbayAddress) {
  return {
    location: { address: pickAddress(address) },
    locationTypes: ["WAREHOUSE"],
    name: EBAY_DEFAULTS.locationName,
  };
}

/** A ZIP or postal code typed by a person: letters, digits, spaces and dashes, 3 to 10 long. */
export function cleanPostalCode(raw: string): string | null {
  const v = raw.trim().toUpperCase();
  return /^[A-Z0-9][A-Z0-9 -]{1,8}[A-Z0-9]$/.test(v) ? v : null;
}

// ---------- when eBay says no ----------

export interface EbayErrorItem {
  errorId?: number;
  message?: string;
  longMessage?: string;
  parameters?: { name?: string; value?: string }[];
}

export interface StepOutcome {
  state: StepState;
  note: string;
  action?: SetupStep["action"];
}

export function ebayPages(env: EbayEnv) {
  const web = ebayHosts(env).web;
  return {
    /** Starting to sell walks a new account through seller sign-up: identity, address and payouts. */
    sell: `${web}/sl/sell`,
    /** Seller Hub's Payments tab: where payouts go. */
    payments: `${web}/sh/fin`,
    sellerHub: `${web}/sh/ovw`,
    account: env === "sandbox" ? "https://accountsettings.sandbox.ebay.com/profile" : "https://accountsettings.ebay.com/profile",
  };
}

/** Where to send someone to sign in to eBay again for an existing store. */
export function reconnectHref(storeId: string): string {
  return `/api/connect/ebay/start?purpose=connect&store=${encodeURIComponent(storeId)}`;
}

/** Turns an eBay refusal into one plain sentence and, where there is one, a single button. */
export function explainEbayProblem(input: { status: number; errors: EbayErrorItem[]; env: EbayEnv; storeId: string }): StepOutcome {
  const { status, errors, env, storeId } = input;
  const pages = ebayPages(env);
  const ids = new Set(errors.map((e) => e.errorId));
  const text = errors.map((e) => `${e.message ?? ""} ${e.longMessage ?? ""} ${(e.parameters ?? []).map((p) => p.value ?? "").join(" ")}`).join(" ");

  if (status === 401 || ids.has(1001)) {
    return {
      state: "needs_you",
      note: "eBay needs you to sign in again before Armada can carry on.",
      action: { label: "Sign in to eBay", href: reconnectHref(storeId) },
    };
  }
  if (ids.has(1100) || (status === 403 && /scope|permission/i.test(text))) {
    return {
      state: "needs_you",
      note: "eBay didn't give Armada everything it needs. Sign in again and press Agree on eBay's page.",
      action: { label: "Sign in to eBay", href: reconnectHref(storeId) },
    };
  }
  if (ids.has(20408) || /not be registered|registration/i.test(text)) {
    return {
      state: "needs_you",
      note: "This eBay account isn't set up to sell yet. eBay asks for your name, address and where your payouts go; it takes a few minutes.",
      action: { label: "Finish on eBay", href: pages.sell, external: true },
    };
  }
  if (/opted in|opt.?in|not eligible for business polic|BP opted/i.test(text)) {
    return {
      state: "later",
      note: "eBay is switching on business policies for this account. eBay says that can take up to a day; come back here and press Try again.",
    };
  }
  if (/payout|payment method|bank/i.test(text)) {
    return {
      state: "needs_you",
      note: "eBay needs to know where your payouts go before this account can sell.",
      action: { label: "Add payouts on eBay", href: pages.payments, external: true },
    };
  }
  if (status >= 500 || status === 429 || ids.has(20500) || ids.has(20501) || ids.has(35001) || ids.has(35002)) {
    return { state: "failed", note: "eBay is busy right now. Try again in a minute." };
  }
  const said = errors.map((e) => e.longMessage || e.message).find(Boolean);
  return { state: "failed", note: said ? `eBay didn't accept this step: “${said.slice(0, 240)}”` : `eBay didn't accept this step (answer ${status}).` };
}
