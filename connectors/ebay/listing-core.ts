// The pure half of listing a product on a real eBay account: which products may go there at all,
// the item and offer bodies, the category's item details filled only from the product's own facts,
// eBay's selling limit, and what to tell a person when eBay says no. No network, no database and no
// imports, so scripts/check-launch.mjs loads it straight from Node and tests it offline.
//
// Checked against eBay's own reference on 2026-09-25 (the Inventory and Taxonomy specs,
// developer.ebay.com/api-docs/master/sell/inventory/openapi/3/sell_inventory_v1_oas3.json and
// .../commerce/taxonomy/openapi/3/commerce_taxonomy_v1_oas3.json; copies in the session scratchpad
// ebaydocs/, and the "Required fields for publishing an offer" page):
// - PUT /sell/inventory/v1/inventory_item/{sku} (createOrReplaceInventoryItem) needs Content-Language
//   and Content-Type. SKU max 50. To publish: availability.shipToLocationAvailability.quantity,
//   condition, product.title (max 80), product.description (max 4000, basic HTML), product.aspects
//   (name max 40, value max 50), product.imageUrls (HTTPS, at least one, up to 24).
// - POST /sell/inventory/v1/offer (createOffer), also Content-Language. To publish: sku,
//   marketplaceId, format, availableQuantity, categoryId, listingPolicies (payment, return and
//   fulfillment policy ids), merchantLocationKey, pricingSummary.price, listingDuration (GTC for
//   fixed price). Answers 201 { offerId }.
// - POST /offer/{offerId}/publish answers { listingId, warnings }. POST /offer/{offerId}/withdraw ends
//   the listing and keeps the offer. DELETE /inventory_item/{sku} deletes the item, its offers and
//   its single-variation listings. GET /offer?sku= lists a SKU's offers (404 when there are none).
// - Errors: 25026 "Selling limit exceeded", 25018 incomplete account information, 25007/25008/25009
//   the fulfillment/payment/return policy, 25035 policy not found, 25012 inventory location,
//   25014/25015 pictures, 25005 category, 25017/25029 a missing field, 25001/25025 eBay's side.
// - Taxonomy: GET /commerce/taxonomy/v1/get_default_category_tree_id?marketplace_id=;
//   GET /commerce/taxonomy/v1/category_tree/{id}/get_category_suggestions?q= (leaf categories,
//   most relevant first); GET .../get_item_aspects_for_category?category_id= (aspects with
//   aspectConstraint.aspectRequired, aspectMode FREE_TEXT or SELECTION_ONLY,
//   itemToAspectCardinality SINGLE or MULTI, aspectMaxLength, and aspectValues[].localizedValue).

/** Suppliers whose products are real and can be sold on a real marketplace. Practice items never can. */
export const REAL_SOURCES = ["cj", "aliexpress"] as const;

/** How many of one product a listing offers. Small, so a new account's selling limit fits more products. */
export const EBAY_LISTING_QUANTITY = 2;

export const LIMITS = { sku: 50, title: 80, description: 4000, aspectName: 40, aspectValue: 50, images: 24, aspectValuesPerName: 5 } as const;

/** The language eBay reads each marketplace's listings in (the Content-Language header). */
export const CONTENT_LANGUAGE: Record<string, string> = {
  EBAY_US: "en-US",
  EBAY_GB: "en-GB",
  EBAY_AU: "en-AU",
  EBAY_CA: "en-CA",
  EBAY_IE: "en-IE",
  EBAY_DE: "de-DE",
  EBAY_AT: "de-AT",
  EBAY_FR: "fr-FR",
  EBAY_IT: "it-IT",
  EBAY_ES: "es-ES",
  EBAY_NL: "nl-NL",
};

/** Everything Armada knows about a product that a listing may say. Nothing else goes on eBay. */
export interface ListingFacts {
  productId: string;
  title: string;
  description: string;
  bullets: string[];
  category: string;
  images: { url?: string }[];
  /** The catalog item's supplier ("cj", "aliexpress", "practice"), or null when it has none. */
  source: string | null;
  /** A practice item the AI imagined for a practice shop. */
  imagined: boolean;
  branded: boolean;
  /** The supplier's list of materials, when it gave one. */
  materials: string[];
  /** The supplier's name for the variant sold (e.g. "Black-L"), when there is one. */
  variant: string | null;
  /** Units the supplier has, when it said. */
  stock: number | null;
  /** The product's own status in Armada ("active", "paused", "archived"). */
  status: string;
}

/** Only products from a real supplier. The one rule that keeps practice items off real marketplaces. */
export function isRealSupplierProduct(f: Pick<ListingFacts, "source" | "imagined">): boolean {
  return !f.imagined && (REAL_SOURCES as readonly string[]).includes(f.source ?? "");
}

export const PRACTICE_OFF_EBAY =
  "Practice items can't go on real eBay. Only products from a real supplier (CJ or AliExpress) are listed there.";

/** Why this product can't be listed on a real eBay account, in plain words, or null when it can. */
export function listingBlocker(f: ListingFacts): string | null {
  if (!isRealSupplierProduct(f)) return PRACTICE_OFF_EBAY;
  if (f.branded) return "Names a brand you may not have the right to sell";
  if (f.status !== "active") return "Paused, usually because the supplier is out of stock";
  if (f.stock === 0) return "Out of stock at the supplier";
  if (!squash(f.title)) return "This product has no name";
  if (!imageUrls(f.images).length) return "eBay needs at least one photo, and this product has none";
  return null;
}

// ---------- the listing's words and pictures ----------

const squash = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/** A SKU eBay accepts (letters, digits and dashes, 50 at most), the same every time for one product. */
export function skuFor(productId: string): string {
  const id = productId.toLowerCase().replace(/[^a-z0-9]/g, "");
  return `armada-${id}`.slice(0, LIMITS.sku);
}

/** Cuts text to `max` at a word boundary. Never longer than `max`. */
export function cut(text: string, max: number): string {
  const t = squash(text);
  if (t.length <= max) return t;
  const head = t.slice(0, max + 1);
  const space = head.lastIndexOf(" ");
  const out = (space > max * 0.6 ? head.slice(0, space) : t.slice(0, max)).replace(/[\s,;:·–—-]+$/, "");
  return out.slice(0, max);
}

export function listingTitle(title: string): string {
  return cut(title, LIMITS.title);
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The listing's description: the product's own description in paragraphs, then its points as a
 * list, in the basic HTML eBay allows, never over 4,000 characters. Falls back to the title when
 * the supplier gave no words at all (eBay refuses a listing without a description).
 */
export function listingDescription(f: Pick<ListingFacts, "title" | "description" | "bullets">): string {
  const max = LIMITS.description;
  const paragraphs = (f.description ?? "")
    .split(/\n\s*\n|\r\n\s*\r\n/)
    .map(squash)
    .filter(Boolean);
  const bullets = (f.bullets ?? []).map(squash).filter(Boolean);
  let html = "";
  for (const p of paragraphs) {
    const next = `<p>${escapeHtml(p)}</p>`;
    if (html.length + next.length > max) {
      // One long paragraph: cut it to fit rather than leave the description empty.
      if (!html) html = `<p>${escapeHtml(cut(p, max - 20))}</p>`.slice(0, max);
      break;
    }
    html += next;
  }
  if (bullets.length) {
    let list = "";
    for (const b of bullets) {
      const li = `<li>${escapeHtml(b)}</li>`;
      if (html.length + "<ul></ul>".length + list.length + li.length > max) break;
      list += li;
    }
    if (list) html += `<ul>${list}</ul>`;
  }
  return html || `<p>${escapeHtml(listingTitle(f.title))}</p>`;
}

/** The product's photos eBay can use: HTTPS only, no repeats, 24 at most. */
export function imageUrls(images: { url?: string }[]): string[] {
  const out: string[] = [];
  for (const img of images ?? []) {
    const u = (img?.url ?? "").trim();
    if (!/^https:\/\/[^\s]+$/i.test(u) || out.includes(u)) continue;
    out.push(u);
    if (out.length >= LIMITS.images) break;
  }
  return out;
}

/** What to ask eBay's category suggestions: the listing title (eBay reads free-form keywords). */
export function categoryQuery(f: Pick<ListingFacts, "title">): string {
  return listingTitle(f.title);
}

export interface CategoryChoice {
  categoryId: string;
  categoryName: string;
}

/** eBay's most relevant suggested category (suggestions come most relevant first). */
export function pickCategory(answer: unknown): CategoryChoice | null {
  const list = (answer as { categorySuggestions?: { category?: { categoryId?: unknown; categoryName?: unknown } }[] } | null)?.categorySuggestions ?? [];
  for (const s of list) {
    const id = s?.category?.categoryId;
    if (typeof id === "string" && /^\d+$/.test(id)) return { categoryId: id, categoryName: typeof s.category?.categoryName === "string" ? s.category.categoryName : "" };
  }
  return null;
}

// ---------- item details (eBay's "aspects"), from the product's facts only ----------

export interface AspectMeta {
  localizedAspectName?: string;
  aspectConstraint?: {
    aspectRequired?: boolean;
    aspectMode?: string;
    itemToAspectCardinality?: string;
    aspectUsage?: string;
    aspectMaxLength?: number;
  };
  aspectValues?: { localizedValue?: string }[];
}

/** Values that say nothing about a product, never picked by matching words. */
const EMPTY_VALUES = /^(other|others|does not apply|not applicable|n\/a|na|unknown|unbranded|see description|none|no|yes|mixed|assorted)$/i;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whether `value` appears in `text` as whole words (a plain plural counts: "Mug" in "Mugs"). */
function says(text: string, value: string): boolean {
  const v = squash(value).toLowerCase();
  if (v.length < 3 || !/[a-z]/.test(v)) return false;
  return new RegExp(`(^|[^a-z0-9])${escapeRe(v)}(e?s)?([^a-z0-9]|$)`, "i").test(text);
}

/** Of several matches, the one that contains all the others ("Coffee Mug" over "Mug"), or null. */
function mostSpecific(values: string[]): string | null {
  const byLength = [...values].sort((a, b) => b.length - a.length);
  const top = byLength[0];
  return byLength.every((v) => top.toLowerCase().includes(v.toLowerCase())) ? top : null;
}

const fits = (v: string, max: number) => v.length > 0 && v.length <= max;

/**
 * Fills the category's item details from what the product itself says, never more. Brand is
 * "Unbranded" for a product that names no brand (eBay's own value for that). Material comes from
 * the supplier's materials. Any other detail is filled only when one of eBay's listed values appears
 * in the product's title, points, description, category or variant name, and only when the match
 * isn't ambiguous. Required details that can't be filled that way are reported, not guessed.
 */
export function aspectsFromFacts(meta: AspectMeta[], f: ListingFacts): { aspects: Record<string, string[]>; missing: string[] } {
  const title = squash(f.title).toLowerCase();
  const rest = [f.bullets.join(" "), f.description, f.category, f.variant ?? "", f.materials.join(" ")].map((s) => squash(s).toLowerCase()).join(" \n ");
  const aspects: Record<string, string[]> = {};
  const missing: string[] = [];
  for (const a of meta ?? []) {
    const name = squash(a.localizedAspectName);
    if (!name || name.length > LIMITS.aspectName) continue;
    const c = a.aspectConstraint ?? {};
    const max = Math.min(LIMITS.aspectValue, c.aspectMaxLength && c.aspectMaxLength > 0 ? c.aspectMaxLength : LIMITS.aspectValue);
    const multi = c.itemToAspectCardinality === "MULTI";
    const listed = (a.aspectValues ?? []).map((v) => squash(v.localizedValue)).filter((v) => fits(v, max));
    const selectOnly = c.aspectMode === "SELECTION_ONLY";
    let values: string[] = [];

    if (/^brand$/i.test(name)) {
      // Only for a product that names no brand; branded products are never listed at all.
      if (!f.branded && (!selectOnly || listed.some((v) => /^unbranded$/i.test(v)))) values = ["Unbranded"];
    } else if (/material/i.test(name) && f.materials.length) {
      const mats = f.materials.map(squash).filter((m) => fits(m, max));
      values = listed.length ? listed.filter((v) => mats.some((m) => m.toLowerCase() === v.toLowerCase() || says(m.toLowerCase(), v))) : selectOnly ? [] : mats;
      values = [...new Set(values)];
      if (!multi) values = values.length === 1 ? values : values.length ? [values[0]] : [];
    } else if (listed.length) {
      const usable = listed.filter((v) => !EMPTY_VALUES.test(v));
      const inTitle = usable.filter((v) => says(title, v));
      const anywhere = usable.filter((v) => says(title, v) || says(rest, v));
      if (multi) values = (inTitle.length ? inTitle : anywhere).slice(0, LIMITS.aspectValuesPerName);
      else {
        const pick = inTitle.length ? (inTitle.length === 1 ? inTitle[0] : mostSpecific(inTitle)) : anywhere.length === 1 ? anywhere[0] : anywhere.length ? mostSpecific(anywhere) : null;
        values = pick ? [pick] : [];
      }
    }
    // A free-text detail with no listed values (other than brand and material) is left alone: the
    // product's facts don't name it, and Armada doesn't make one up.

    values = [...new Set(values)].filter((v) => fits(v, max));
    if (values.length) aspects[name] = values;
    else if (c.aspectRequired) missing.push(name);
  }
  return { aspects, missing };
}

/** The sentence for a product eBay can't take without details its facts don't give. */
export function missingDetailsNote(missing: string[], categoryName: string): string {
  const list = missing.length === 1 ? missing[0] : `${missing.slice(0, -1).join(", ")} and ${missing.at(-1)}`;
  return `eBay asks for its ${list}${categoryName ? ` in ${categoryName}` : ""}, and the supplier's details don't say. Armada doesn't guess, so this one stays off eBay.`;
}

// ---------- the bodies eBay takes ----------

export interface ListingPolicies {
  paymentPolicyId?: string;
  returnPolicyId?: string;
  fulfillmentPolicyId?: string;
}

export function inventoryItemBody(p: { title: string; description: string; aspects: Record<string, string[]>; imageUrls: string[]; quantity: number }) {
  return {
    availability: { shipToLocationAvailability: { quantity: p.quantity } },
    condition: "NEW",
    product: { title: listingTitle(p.title), description: p.description, aspects: p.aspects, imageUrls: p.imageUrls },
  };
}

export function offerBody(o: {
  sku: string;
  marketplaceId: string;
  categoryId: string;
  priceCents: number;
  currency: string;
  quantity: number;
  policies: ListingPolicies;
  locationKey: string;
  description: string;
}) {
  return {
    sku: o.sku,
    marketplaceId: o.marketplaceId,
    format: "FIXED_PRICE",
    listingDuration: "GTC",
    availableQuantity: o.quantity,
    categoryId: o.categoryId,
    listingDescription: o.description,
    listingPolicies: {
      paymentPolicyId: o.policies.paymentPolicyId,
      returnPolicyId: o.policies.returnPolicyId,
      fulfillmentPolicyId: o.policies.fulfillmentPolicyId,
    },
    merchantLocationKey: o.locationKey,
    pricingSummary: { price: { value: (Math.max(0, Math.round(o.priceCents)) / 100).toFixed(2), currency: o.currency } },
  };
}

/** Whether an eBay store has everything a listing needs from its setup. */
export function storeCanList(meta: { policies?: ListingPolicies | null; locationKey?: string | null; marketplaceId?: string | null }): boolean {
  const p = meta.policies ?? {};
  return Boolean(p.paymentPolicyId && p.returnPolicyId && p.fulfillmentPolicyId && meta.locationKey && meta.marketplaceId);
}

/** How many of one product to offer: the usual small number, never more than the supplier has. */
export function listingQuantity(stock: number | null): number {
  if (stock == null) return EBAY_LISTING_QUANTITY;
  return Math.max(0, Math.min(EBAY_LISTING_QUANTITY, Math.floor(stock)));
}

export function listingUrl(env: "production" | "sandbox", listingId: string): string {
  return `${env === "sandbox" ? "https://www.sandbox.ebay.com" : "https://www.ebay.com"}/itm/${encodeURIComponent(listingId)}`;
}

// ---------- eBay's selling limit ----------

export interface SellingLimit {
  quantity?: number;
  amountCents?: number;
}

/** The account's monthly cap, as the setup read it from eBay (getPrivileges' sellingLimit). */
export function readSellingLimit(raw: unknown): SellingLimit | null {
  const r = raw as { quantity?: unknown; amount?: { value?: unknown } } | null;
  if (!r) return null;
  const quantity = Number(r.quantity);
  const amount = Number(r.amount?.value);
  const out: SellingLimit = {};
  if (Number.isFinite(quantity) && quantity > 0) out.quantity = Math.floor(quantity);
  if (Number.isFinite(amount) && amount > 0) out.amountCents = Math.round(amount * 100);
  return out.quantity || out.amountCents ? out : null;
}

/**
 * How many of `items` (in order) still fit under the limit, given what the account already has
 * listed. The count of items and the total value (price × quantity) both have to fit.
 */
export function fitSellingLimit(items: { priceCents: number; quantity: number }[], limit: SellingLimit | null, used: { quantity: number; amountCents: number }): number {
  if (!limit) return items.length;
  let q = used.quantity;
  let a = used.amountCents;
  let n = 0;
  for (const it of items) {
    q += it.quantity;
    a += it.priceCents * it.quantity;
    if ((limit.quantity && q > limit.quantity) || (limit.amountCents && a > limit.amountCents)) break;
    n++;
  }
  return n;
}

export const LIMIT_NOTE = "eBay's monthly selling limit for this account is reached, so the rest wait. eBay raises the limit as sales go well.";

// ---------- when eBay says no ----------

export interface ListingErrorItem {
  errorId?: number;
  message?: string;
  longMessage?: string;
  parameters?: { name?: string; value?: string }[];
}

/**
 * What a refusal means for the launch:
 * - "reconnect" and "account" and "setup" stop listing for the whole account until a person acts;
 * - "limit" stops listing until eBay's monthly limit allows more;
 * - "busy" leaves the product to try again shortly;
 * - "item" is about this one product only.
 */
export type ListingProblemKind = "reconnect" | "account" | "setup" | "limit" | "busy" | "item";

export function explainListingProblem(status: number, errors: ListingErrorItem[]): { kind: ListingProblemKind; note: string } {
  const ids = new Set(errors.map((e) => e.errorId));
  const text = errors.map((e) => `${e.message ?? ""} ${e.longMessage ?? ""}`).join(" ");
  const said = errors.map((e) => e.longMessage || e.message).find(Boolean);
  if (status === 401 || ids.has(1001)) return { kind: "reconnect", note: "eBay needs you to sign in again before Armada can list." };
  if (ids.has(1100) || (status === 403 && /scope|permission|access/i.test(text))) {
    return { kind: "reconnect", note: "eBay didn't give Armada permission to list. Sign in again and press Agree on eBay's page." };
  }
  if (ids.has(25026) || /selling limit/i.test(text)) return { kind: "limit", note: LIMIT_NOTE };
  if (ids.has(25018) || ids.has(20408) || /not (yet )?registered|registration|incomplete account|payout|payment method/i.test(text)) {
    return { kind: "account", note: "This eBay account isn't set up to sell yet. eBay asks for your name, address and where your payouts go; it takes a few minutes." };
  }
  if ([25007, 25008, 25009, 25035, 25036].some((id) => ids.has(id)) || /business polic/i.test(text)) {
    return { kind: "setup", note: "eBay didn't accept this account's delivery, payment or return terms. Open the eBay setup and press Try again." };
  }
  if (ids.has(25012) || /inventory location|merchantLocationKey/i.test(text)) {
    return { kind: "setup", note: "eBay didn't accept the place items ship from. Open the eBay setup and press Try again." };
  }
  if (status >= 500 || status === 429 || ids.has(25001) || ids.has(25025)) return { kind: "busy", note: "eBay is busy right now. Armada tries again in a minute." };
  if (ids.has(25014) || ids.has(25015)) return { kind: "item", note: "eBay couldn't use this product's photos." };
  if (ids.has(25005)) return { kind: "item", note: "eBay didn't accept the category for this product." };
  if (ids.has(25029) || ids.has(25017)) return { kind: "item", note: said ? `eBay wants more details: “${said.slice(0, 200)}”` : "eBay wants more details for this category." };
  return { kind: "item", note: said ? `eBay didn't accept this product: “${said.slice(0, 220)}”` : `eBay didn't accept this product (answer ${status}).` };
}

/** The offer id eBay names when an offer for the SKU already exists (createOffer's 25002). */
export function existingOfferId(errors: ListingErrorItem[]): string | null {
  for (const e of errors) {
    for (const p of e.parameters ?? []) if (p.name === "offerId" && p.value) return p.value;
  }
  return null;
}
