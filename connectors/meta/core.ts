import { createHmac } from "node:crypto";
import type { SetupStep, StepOutcome } from "../ebay/core";

// The pure half of Armada's Facebook and Instagram shop connection: settings, Meta's setup window
// address, reading what Meta set up, catalog items, and the checkout address that hands a Meta cart
// to the linked Shopify store. No network and no database, so scripts/check-store-openers.mjs can
// test it offline. (The setup-step shape is shared with eBay's; see connectors/ebay/core.ts.)
//
// Checked against Meta's docs on 2026-09-24:
// - "As of September 2025, Shops on Facebook and Instagram now use website checkout" (Business Help
//   Center 1314349509894768). Shops keep their home page, collections and product pages; buyers pay
//   on the seller's own website. So a shop needs a real website checkout: in Armada, a Shopify store.
// - The one-window setup is the Meta Business Extension (MBE, formerly Facebook Business Extension):
//   https://www.facebook.com/dialog/oauth with client_id, display, redirect_uri, response_type=code,
//   scope (manage_business_extension + catalog_management...), state and `extras` = {setup,
//   business_config, repeat:false}. setup needs external_business_id, timezone, currency,
//   business_vertical=ECOMMERCE, channel (COMMERCE or COMMERCE_OFFSITE) and domain.
//   manage_business_extension is a private permission: Meta must add the app to its allow list,
//   the app must belong to a verified business, and the Shops onboarding flow is "only available to
//   select partners in a closed beta". Hence META_SHOPS_APPROVED.
// - Afterwards: GET /fbe_business/fbe_installs?fbe_external_business_id=… returns the business,
//   catalog, commerce account, page, Instagram and pixel ids; POST /{business_id}/access_token (with
//   appsecret_proof) returns the lasting system-user access for the business.
// - Catalog: POST /{catalog_id}/items_batch, item_type=PRODUCT_ITEM, requests=[{method, data}], up to
//   5000 a call (3000 recommended). Required: id, title (100), description (5000), availability,
//   condition, price ("9.99 USD"), link, image [{url}], brand.
// - Checkout address: Meta opens it with ?products=ID:QTY,ID:QTY&coupon=CODE (plus utm_ and
//   cart_origin), and the seller submits it in Commerce Manager's checkout validation tool.
//   Shopify's cart links take /cart/VARIANT:QTY,VARIANT:QTY?discount=CODE.

export type { SetupStep, StepOutcome } from "../ebay/core";

export interface MetaConfig {
  appId: string;
  appSecret: string;
  graphVersion: string;
  channel: "COMMERCE" | "COMMERCE_OFFSITE";
}

/** Server settings the Facebook and Instagram shop connection needs. */
export const META_REQUIRED_ENV = ["META_APP_ID", "META_APP_SECRET", "META_SHOPS_APPROVED", "ENCRYPTION_KEY"];

const YES = /^(1|yes|true|on)$/i;

/**
 * Reads the settings, or null when any is missing. META_SHOPS_APPROVED says Meta has added Armada's
 * app to the Business Extension allow list and the Shops onboarding beta; without that Meta's window
 * refuses to open. META_GRAPH_VERSION (default v25.0) and META_SHOP_CHANNEL (default
 * COMMERCE_OFFSITE, the website-checkout flow) are optional.
 */
export function metaConfig(env: Record<string, string | undefined>): MetaConfig | null {
  const appId = env.META_APP_ID?.trim();
  const appSecret = env.META_APP_SECRET?.trim();
  if (!appId || !appSecret || !env.ENCRYPTION_KEY || !YES.test(env.META_SHOPS_APPROVED?.trim() ?? "")) return null;
  const v = env.META_GRAPH_VERSION?.trim();
  return {
    appId,
    appSecret,
    graphVersion: v && /^v\d{1,3}\.\d$/.test(v) ? v : "v25.0",
    channel: env.META_SHOP_CHANNEL?.trim().toUpperCase() === "COMMERCE" ? "COMMERCE" : "COMMERCE_OFFSITE",
  };
}

/** What the business owner approves in Meta's window. All but the first need Meta's App Review. */
export const META_SCOPES = ["manage_business_extension", "catalog_management", "business_management", "pages_read_engagement", "instagram_basic"];

export const GRAPH = "https://graph.facebook.com";

export function graphUrl(cfg: Pick<MetaConfig, "graphVersion">, path: string, query: Record<string, string | undefined> = {}): string {
  const u = new URL(`${GRAPH}/${cfg.graphVersion}${path.startsWith("/") ? path : `/${path}`}`);
  for (const [k, v] of Object.entries(query)) if (v !== undefined) u.searchParams.set(k, v);
  return u.toString();
}

/** Meta's proof that a call comes from the app that owns the access: HMAC-SHA256 of it, keyed by the app secret. */
export function appSecretProof(accessToken: string, appSecret: string): string {
  return createHmac("sha256", appSecret).update(accessToken).digest("hex");
}

const TIMEZONE = /^[A-Za-z]+(?:\/[A-Za-z0-9_+-]+){1,2}$/;

export function cleanTimezone(tz: string | null | undefined): string {
  return tz && tz.length <= 40 && TIMEZONE.test(tz) ? tz : "America/New_York";
}

/** A Shopify store's address as Armada stores it (yourstore.myshopify.com). */
export function cleanShopDomain(domain: string | null | undefined): string | null {
  const d = (domain ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return /^[a-z0-9][a-z0-9-]*(\.[a-z0-9-]+)+$/.test(d) ? d : null;
}

/** The id Armada gives this setup in Meta's window; it's how the installed assets are found again. */
export function externalBusinessId(workspaceId: string, nonce: string): string {
  return `armada-${workspaceId.slice(0, 8)}-${nonce}`.slice(0, 60);
}

/** Meta's own setup window (the Business Extension), opened as a popup. */
export function setupWindowUrl(
  cfg: MetaConfig,
  o: { redirectUri: string; state: string; externalBusinessId: string; businessName: string; currency: string; timezone: string; shopDomain: string; display?: "popup" | "page" },
): string {
  const extras = {
    setup: {
      external_business_id: o.externalBusinessId,
      timezone: cleanTimezone(o.timezone),
      currency: o.currency,
      business_vertical: "ECOMMERCE",
      channel: cfg.channel,
      domain: `https://${o.shopDomain}`,
    },
    business_config: { business: { name: o.businessName.slice(0, 100) } },
    repeat: false,
  };
  const q: [string, string][] = [
    ["client_id", cfg.appId],
    ["display", o.display ?? "popup"],
    ["redirect_uri", o.redirectUri],
    ["response_type", "code"],
    ["scope", META_SCOPES.join(",")],
    ["state", o.state],
    ["extras", JSON.stringify(extras)],
  ];
  return `https://www.facebook.com/${cfg.graphVersion}/dialog/oauth?${q.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")}`;
}

// ---------- what Meta set up ----------

export interface MetaAssets {
  businessId?: string;
  catalogId?: string;
  commerceId?: string;
  pageId?: string;
  igId?: string;
  pixelId?: string;
  adAccountId?: string;
  /** "active" when buyers can see the shop; otherwise Meta's reason it's hidden. */
  shopStatus?: string;
  shopStatusInfo?: string;
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : typeof v === "number" ? String(v) : undefined);

/** Reads the answer of GET /fbe_business/fbe_installs (or the install notice, which has the same fields). */
export function readInstall(json: unknown): MetaAssets | null {
  const data = ((json ?? {}) as { data?: unknown[] }).data;
  const d = (Array.isArray(data) ? data[0] : json) as Record<string, unknown> | undefined;
  if (!d || typeof d !== "object") return null;
  const features = (Array.isArray(d.installed_features) ? d.installed_features : []) as Record<string, unknown>[];
  const assets = features.map((f) => (f.connected_assets ?? {}) as Record<string, unknown>);
  const pick = (key: string) => str(d[key]) ?? assets.map((a) => str(a[key])).find(Boolean);
  const pages = Array.isArray(d.pages) ? d.pages.map(str).filter(Boolean) : [];
  const igs = Array.isArray(d.instagram_profiles) ? d.instagram_profiles.map(str).filter(Boolean) : [];
  // additional_info arrives as an object or a list of small objects, depending on the feature.
  const infos = features.flatMap((f) => (Array.isArray(f.additional_info) ? f.additional_info : f.additional_info ? [f.additional_info] : [])) as Record<string, unknown>[];
  const info = (key: string) => {
    for (const i of infos) {
      const v = i?.[key];
      if (typeof v === "string" && v) return v;
      if (Array.isArray(v) && typeof v[0] === "string") return v[0] as string;
    }
    return undefined;
  };
  const out: MetaAssets = {
    businessId: pick("business_manager_id"),
    catalogId: pick("catalog_id"),
    commerceId: pick("commerce_merchant_settings_id") ?? pick("commerce_account_id"),
    pageId: pick("page_id") ?? (pages[0] as string | undefined),
    igId: pick("ig_profile_id") ?? (igs[0] as string | undefined),
    pixelId: pick("pixel_id"),
    adAccountId: pick("ad_account_id"),
    shopStatus: info("shop_status"),
    shopStatusInfo: info("shop_status_info"),
  };
  return out.businessId || out.catalogId ? out : null;
}

// ---------- catalog ----------

export interface CatalogSource {
  listingId: string;
  externalId: string | null;
  handle: string | null;
  title: string;
  description: string;
  priceCents: number;
  status: string;
  images: { url: string }[];
}

export interface CatalogShop {
  domain: string;
  currency: string;
  brand: string;
}

/** A Shopify variant's number from the id Armada keeps for a Shopify listing, or null when it isn't one. */
export function variantIdFrom(externalId: string | null | undefined): string | null {
  const m = /^gid:\/\/shopify\/ProductVariant\/(\d{1,20})$/.exec(externalId ?? "");
  return m ? m[1] : null;
}

/**
 * The id a product has in the Meta catalog. The Shopify variant number when Armada knows it (so the
 * checkout address can go straight to Shopify's cart), otherwise armada-<listing id>.
 */
export function retailerIdFor(l: Pick<CatalogSource, "listingId" | "externalId">): string {
  return variantIdFrom(l.externalId) ?? `armada-${l.listingId}`;
}

export function formatPrice(cents: number, currency: string): string {
  return `${(Math.max(0, Math.round(cents)) / 100).toFixed(2)} ${currency}`;
}

function plainText(s: string): string {
  return s
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export type CatalogResult =
  | { ok: true; retailerId: string; request: { method: "UPDATE"; data: Record<string, unknown> } }
  | { ok: false; title: string; reason: string };

/** One product as a Catalog Batch request. UPDATE with Meta's default allow_upsert creates it when it's new. */
export function catalogRequest(l: CatalogSource, shop: CatalogShop): CatalogResult {
  const images = l.images.map((i) => i.url).filter((u) => /^https:\/\//.test(u));
  if (!images.length) return { ok: false, title: l.title, reason: "Meta needs a photo, and this product has none yet." };
  if (!l.handle) return { ok: false, title: l.title, reason: "This product has no page on the Shopify store yet." };
  const retailerId = retailerIdFor(l);
  const description = plainText(l.description).slice(0, 5000) || l.title;
  return {
    ok: true,
    retailerId,
    request: {
      method: "UPDATE",
      data: {
        id: retailerId,
        title: l.title.slice(0, 100),
        description,
        availability: l.status === "active" ? "in stock" : "out of stock",
        condition: "new",
        price: formatPrice(l.priceCents, shop.currency),
        link: `https://${shop.domain}/products/${encodeURIComponent(l.handle)}`,
        image: images.slice(0, 21).map((url) => ({ url })),
        brand: shop.brand.slice(0, 100) || "Shop",
      },
    },
  };
}

/** Splits requests into calls Meta handles well (it takes 5000, and recommends 3000 or fewer). */
export function catalogBatches<T>(requests: T[], size = 3000): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < requests.length; i += size) out.push(requests.slice(i, i + size));
  return out;
}

// ---------- checkout address ----------

export interface CartLine {
  id: string;
  quantity: number;
}

/** Reads Meta's products parameter (already URL-decoded): "12345:3,armada-…:1". Bad entries are skipped. */
export function parseCheckoutProducts(raw: string | null | undefined): CartLine[] {
  const lines = new Map<string, number>();
  for (const entry of (raw ?? "").split(",").slice(0, 50)) {
    const [id, qty] = entry.split(":");
    if (!id || !/^[A-Za-z0-9_-]{1,100}$/.test(id)) continue;
    const n = qty === undefined || qty === "" ? 1 : Number(qty);
    if (!Number.isInteger(n) || n < 1) continue;
    lines.set(id, Math.min(99, (lines.get(id) ?? 0) + n));
  }
  return [...lines].map(([id, quantity]) => ({ id, quantity }));
}

/** Query parameters Meta adds for tracking, which must survive the hop to Shopify. */
export function passthroughParams(params: Iterable<[string, string]>): [string, string][] {
  return [...params].filter(([k, v]) => /^(utm_[a-z_]{1,20}|cart_origin|fbclid)$/.test(k) && v.length <= 200).slice(0, 12);
}

/** A Shopify cart link that fills the cart and goes to checkout: /cart/VARIANT:QTY,…?discount=CODE. */
export function shopifyCartUrl(domain: string, lines: { variantId: string; quantity: number }[], opts: { coupon?: string | null; passthrough?: [string, string][] } = {}): string {
  const d = cleanShopDomain(domain);
  if (!d) throw new Error("not a store address");
  const path = lines.length ? `/cart/${lines.map((l) => `${l.variantId}:${l.quantity}`).join(",")}` : "/cart";
  const q = new URLSearchParams();
  const coupon = opts.coupon?.trim();
  if (coupon && /^[A-Za-z0-9_-]{1,64}$/.test(coupon)) q.set("discount", coupon);
  for (const [k, v] of opts.passthrough ?? []) q.set(k, v);
  const s = q.toString();
  return `https://${d}${path}${s ? `?${s}` : ""}`;
}

// ---------- setup steps and plain answers ----------

export function freshSteps(list: { key: string; label: string }[]): SetupStep[] {
  return list.map((s) => ({ ...s, state: "waiting" as const }));
}

/** The first step that isn't finished, or null when everything is. */
export function nextStep(steps: SetupStep[]): SetupStep | null {
  return steps.find((s) => s.state !== "done") ?? null;
}

export const META_STEPS: { key: string; label: string }[] = [
  { key: "business", label: "Set up your business on Meta" },
  { key: "shop", label: "Check the shop" },
  { key: "catalog", label: "Put your products in the catalog" },
  { key: "checkout", label: "Send buyers to your Shopify checkout" },
  { key: "ready", label: "Ready" },
];

export const META_PAGES = {
  commerceManager: "https://business.facebook.com/commerce/",
  businessSettings: "https://business.facebook.com/settings",
};

export interface GraphErrorBody {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  error_user_msg?: string;
}

/** Turns a Meta refusal into one plain sentence and, where there is one, a single button. */
export function explainMetaProblem(status: number, err: GraphErrorBody | null | undefined): StepOutcome {
  const code = err?.code;
  if (code === 190 || status === 401) {
    return {
      state: "needs_you",
      note: "Meta stopped letting Armada in to this business. Set the shop up again from Open a new store.",
      action: { label: "Set it up again", href: "/stores/new#facebook" },
    };
  }
  if (code === 10 || (code !== undefined && code >= 200 && code < 300) || status === 403) {
    return { state: "failed", note: "Meta hasn't given Armada permission for this yet. Armada's owner has been told what Meta needs." };
  }
  if (code === 4 || code === 17 || code === 32 || code === 613 || code === 80014 || status === 429) {
    return { state: "later", note: "Meta asked Armada to slow down. Try again in a few minutes." };
  }
  if (status >= 500 || code === 1 || code === 2) return { state: "failed", note: "Meta is busy right now. Try again in a minute." };
  const said = err?.error_user_msg || err?.message;
  return { state: "failed", note: said ? `Meta didn't accept this step: “${said.slice(0, 240)}”` : `Meta didn't accept this step (answer ${status}).` };
}

/** Plain words for why a shop isn't visible yet, from Meta's shop_status. */
export function shopStatusNote(a: Pick<MetaAssets, "shopStatus" | "shopStatusInfo">): string | null {
  const s = (a.shopStatus ?? "").toLowerCase();
  if (!s || s === "active") return null;
  if (s === "no_longer_available") return "Meta says shops aren't available in this business's country.";
  return "Buyers can't see the shop until its checkout address is added in Commerce Manager (the next step).";
}
