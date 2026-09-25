import "server-only";
import { ebayCall } from "./client";
import { EbayError } from "./http";
import {
  aspectsFromFacts,
  categoryQuery,
  CONTENT_LANGUAGE,
  existingOfferId,
  explainListingProblem,
  imageUrls,
  inventoryItemBody,
  listingBlocker,
  listingDescription,
  listingTitle,
  listingUrl,
  missingDetailsNote,
  offerBody,
  pickCategory,
  skuFor,
  storeCanList,
  type AspectMeta,
  type CategoryChoice,
  type ListingFacts,
  type ListingPolicies,
  type ListingProblemKind,
} from "./listing-core";

// Listing a product on a seller's real eBay account, through the same door as every other eBay
// call (client.ts ebayCall: Armada's own eBay app, or the connection service's relay). The words,
// bodies and rules are in listing-core.ts; this file only asks eBay and reads the answers.
//
//   planEbayListing     reads only: the category eBay suggests and the item details it asks for
//   publishEbayListing  the item, its offer, and publishing the offer: a live listing
//   endEbayListing      takes the listing down and removes the item (undo)
//
// Every step is safe to repeat: the SKU is the product's own, the item is replaced in place, and
// an existing offer for the SKU is found and reused instead of made twice.

const INV = "/sell/inventory/v1";
const TAX = "/commerce/taxonomy/v1";

export interface EbayListingStore {
  storeId: string;
  ebayUserId: string;
  marketplaceId: string;
  env: "production" | "sandbox";
  currency: string;
  policies: ListingPolicies;
  locationKey: string | null;
}

/** A refusal in plain words, with what it means for the rest of the products (listing-core.ts). */
export class ListingProblem extends Error {
  kind: ListingProblemKind;
  constructor(kind: ListingProblemKind, note: string) {
    super(note);
    this.kind = kind;
  }
}

function asProblem(e: unknown): ListingProblem {
  if (e instanceof ListingProblem) return e;
  if (e instanceof EbayError) {
    const why = explainListingProblem(e.status, e.errors);
    return new ListingProblem(why.kind, why.note);
  }
  if (e instanceof Error && /isn't set up yet|switched off/i.test(e.message)) return new ListingProblem("setup", "Armada's eBay connection is switched off right now.");
  console.error("eBay listing failed", e);
  return new ListingProblem("busy", "Something went wrong on Armada's side. Armada tries again in a minute.");
}

const call = <T,>(store: Pick<EbayListingStore, "ebayUserId">, workspaceId: string, opts: Parameters<typeof ebayCall>[2]) =>
  ebayCall<T>(workspaceId, store.ebayUserId, opts);

// eBay's category tree and each category's details change rarely; they're kept for a few hours.
const treeIds = new Map<string, string>();
const aspectCache = new Map<string, { at: number; aspects: AspectMeta[] }>();
const ASPECTS_FOR_MS = 6 * 60 * 60 * 1000;

async function categoryTreeId(workspaceId: string, store: EbayListingStore): Promise<string> {
  const known = treeIds.get(store.marketplaceId);
  if (known) return known;
  const r = await call<{ categoryTreeId?: string }>(store, workspaceId, { path: `${TAX}/get_default_category_tree_id`, query: { marketplace_id: store.marketplaceId } });
  if (!r?.categoryTreeId) throw new ListingProblem("busy", "eBay didn't say which categories this marketplace uses. Armada tries again in a minute.");
  treeIds.set(store.marketplaceId, r.categoryTreeId);
  return r.categoryTreeId;
}

async function suggestCategory(workspaceId: string, store: EbayListingStore, tree: string, q: string): Promise<CategoryChoice | null> {
  const r = await call<unknown>(store, workspaceId, { path: `${TAX}/category_tree/${encodeURIComponent(tree)}/get_category_suggestions`, query: { q } });
  return pickCategory(r);
}

async function categoryAspects(workspaceId: string, store: EbayListingStore, tree: string, categoryId: string): Promise<AspectMeta[]> {
  const key = `${tree}:${categoryId}`;
  const hit = aspectCache.get(key);
  if (hit && Date.now() - hit.at < ASPECTS_FOR_MS) return hit.aspects;
  const r = await call<{ aspects?: AspectMeta[] }>(store, workspaceId, {
    path: `${TAX}/category_tree/${encodeURIComponent(tree)}/get_item_aspects_for_category`,
    query: { category_id: categoryId },
  });
  const aspects = r?.aspects ?? [];
  aspectCache.set(key, { at: Date.now(), aspects });
  return aspects;
}

export interface ListingPlan {
  sku: string;
  title: string;
  description: string;
  imageUrls: string[];
  category: CategoryChoice | null;
  aspects: Record<string, string[]>;
  /** Details eBay requires for the category that the product's facts don't give. */
  missing: string[];
}

/** Reads only: what Armada would send eBay for this product, and anything that would stop it. */
export async function planEbayListing(workspaceId: string, store: EbayListingStore, facts: ListingFacts): Promise<ListingPlan> {
  const base = {
    sku: skuFor(facts.productId),
    title: listingTitle(facts.title),
    description: listingDescription(facts),
    imageUrls: imageUrls(facts.images),
  };
  try {
    const tree = await categoryTreeId(workspaceId, store);
    const category = await suggestCategory(workspaceId, store, tree, categoryQuery(facts));
    if (!category) return { ...base, category: null, aspects: {}, missing: [] };
    const { aspects, missing } = aspectsFromFacts(await categoryAspects(workspaceId, store, tree, category.categoryId), facts);
    return { ...base, category, aspects, missing };
  } catch (e) {
    throw asProblem(e);
  }
}

interface OfferRow {
  offerId?: string;
  sku?: string;
  marketplaceId?: string;
  format?: string;
  status?: string;
  listing?: { listingId?: string; listingStatus?: string };
}

async function offersFor(workspaceId: string, store: Pick<EbayListingStore, "ebayUserId">, sku: string): Promise<OfferRow[]> {
  try {
    const r = await call<{ offers?: OfferRow[] }>(store, workspaceId, { path: `${INV}/offer`, query: { sku } });
    return r?.offers ?? [];
  } catch (e) {
    // eBay answers "not found" when the SKU has no offers yet.
    if (e instanceof EbayError && (e.status === 404 || e.errors.some((x) => x.errorId === 25713))) return [];
    throw e;
  }
}

export interface PublishedListing {
  sku: string;
  offerId: string;
  listingId: string;
  categoryId: string;
  categoryName: string;
  url: string;
}

/**
 * Lists one product on the seller's eBay account: the item (title, description, details, photos,
 * quantity, new), its fixed-price offer on the store's marketplace with the store's own business
 * policies and ship-from place, then publishes the offer. Throws a ListingProblem in plain words.
 */
export async function publishEbayListing(
  workspaceId: string,
  store: EbayListingStore,
  facts: ListingFacts,
  priceCents: number,
  quantity: number,
): Promise<PublishedListing> {
  // Never anything but a real supplier's product, whoever calls this.
  const blocked = listingBlocker(facts);
  if (blocked) throw new ListingProblem("item", blocked);
  if (!storeCanList({ policies: store.policies, locationKey: store.locationKey, marketplaceId: store.marketplaceId })) {
    throw new ListingProblem("setup", "This eBay account's setup isn't finished, so there's nothing to list with yet.");
  }
  if (quantity < 1) throw new ListingProblem("item", "Out of stock at the supplier");
  const language = CONTENT_LANGUAGE[store.marketplaceId] ?? "en-US";

  const plan = await planEbayListing(workspaceId, store, facts);
  if (!plan.category) throw new ListingProblem("item", "eBay didn't suggest a category for this product, so it stays off eBay.");
  if (plan.missing.length) throw new ListingProblem("item", missingDetailsNote(plan.missing, plan.category.categoryName));

  try {
    await call(store, workspaceId, {
      method: "PUT",
      path: `${INV}/inventory_item/${encodeURIComponent(plan.sku)}`,
      headers: { "Content-Language": language },
      body: inventoryItemBody({ title: plan.title, description: plan.description, aspects: plan.aspects, imageUrls: plan.imageUrls, quantity }),
    });

    const body = offerBody({
      sku: plan.sku,
      marketplaceId: store.marketplaceId,
      categoryId: plan.category.categoryId,
      priceCents,
      currency: store.currency,
      quantity,
      policies: store.policies,
      locationKey: store.locationKey!,
      description: plan.description,
    });
    const existing = (await offersFor(workspaceId, store, plan.sku)).find((o) => o.marketplaceId === store.marketplaceId && o.format === "FIXED_PRICE" && o.offerId);
    let offerId = existing?.offerId ?? null;
    if (offerId) {
      // Found from an earlier try (or already live): bring it up to date instead of making another.
      await call(store, workspaceId, { method: "PUT", path: `${INV}/offer/${encodeURIComponent(offerId)}`, headers: { "Content-Language": language }, body });
      if (existing?.status === "PUBLISHED" && existing.listing?.listingId) {
        const listingId = existing.listing.listingId;
        return { sku: plan.sku, offerId, listingId, ...plan.category, url: listingUrl(store.env, listingId) };
      }
    } else {
      try {
        const made = await call<{ offerId?: string }>(store, workspaceId, { method: "POST", path: `${INV}/offer`, headers: { "Content-Language": language }, body });
        offerId = made?.offerId ?? null;
      } catch (e) {
        // Two tries at once: eBay names the offer that already exists.
        const id = e instanceof EbayError ? existingOfferId(e.errors) : null;
        if (!id) throw e;
        offerId = id;
      }
    }
    if (!offerId) throw new ListingProblem("busy", "eBay didn't return the new offer. Armada tries again in a minute.");

    const published = await call<{ listingId?: string }>(store, workspaceId, { method: "POST", path: `${INV}/offer/${encodeURIComponent(offerId)}/publish` });
    const listingId = published?.listingId;
    if (!listingId) throw new ListingProblem("busy", "eBay didn't confirm the listing. Armada tries again in a minute.");
    return { sku: plan.sku, offerId, listingId, ...plan.category, url: listingUrl(store.env, listingId) };
  } catch (e) {
    throw asProblem(e);
  }
}

/**
 * Takes a product's listing down (withdraws every published offer, which ends the listing) and then
 * deletes the item, which removes its offers too. Anything already gone counts as done.
 */
export async function endEbayListing(workspaceId: string, ebayUserId: string, productId: string): Promise<{ ended: number }> {
  const store = { ebayUserId };
  const sku = skuFor(productId);
  let ended = 0;
  try {
    for (const o of await offersFor(workspaceId, store, sku)) {
      if (o.status !== "PUBLISHED" || !o.offerId) continue;
      try {
        await call(store, workspaceId, { method: "POST", path: `${INV}/offer/${encodeURIComponent(o.offerId)}/withdraw` });
        ended++;
      } catch (e) {
        if (!(e instanceof EbayError && (e.status === 404 || e.errors.some((x) => x.errorId === 25713)))) throw e;
      }
    }
    try {
      await call(store, workspaceId, { method: "DELETE", path: `${INV}/inventory_item/${encodeURIComponent(sku)}` });
    } catch (e) {
      if (!(e instanceof EbayError && e.status === 404)) throw e;
    }
    return { ended };
  } catch (e) {
    throw asProblem(e);
  }
}

/** The seller's standing with eBay, read-only (for the live check before anything is listed). */
export async function sellerStanding(workspaceId: string, ebayUserId: string): Promise<{ canSell: boolean; sellingLimit: unknown }> {
  const p = await ebayCall<{ sellerRegistrationCompleted?: boolean; sellingLimit?: unknown }>(workspaceId, ebayUserId, { path: "/sell/account/v1/privilege" });
  return { canSell: Boolean(p?.sellerRegistrationCompleted), sellingLimit: p?.sellingLimit ?? null };
}
