// A stand-in for eBay's listing calls, used by scripts/mock-pipedream.mjs's relay: the Taxonomy API
// (default category tree, category suggestions, a category's item details) and the Inventory API
// (inventory items, offers, publish, withdraw, delete), answering in the shapes of eBay's own specs
// (sell_inventory_v1 and commerce_taxonomy_v1, checked 2026-09-25) and refusing what eBay refuses:
// a missing Content-Language, a title over 80, a picture that isn't HTTPS, an offer made twice
// (25002 naming the offer), and publishing without the fields eBay requires (policies it doesn't
// know, no category, no price, no ship-from place, no GTC, a required item detail missing).
// It keeps every item, offer and live listing, so a test can read what reached "eBay" at /__stats.

export const ebayListings = {
  policies: new Set(),
  items: new Map(), // sku -> item body
  offers: new Map(), // offerId -> offer
  ended: 0,
  deleted: 0,
  publishCalls: 0,
  contentLanguageMissing: 0,
  refused: [], // { call, errorId, message }
};
let nextOffer = 7_000_000_000;
let nextListing = 3_960_000_000_00;

const values = (...v) => v.map((localizedValue) => ({ localizedValue }));
const brand = { localizedAspectName: "Brand", aspectConstraint: { aspectRequired: true, aspectMode: "FREE_TEXT", itemToAspectCardinality: "SINGLE", aspectUsage: "RECOMMENDED" }, aspectValues: values("Unbranded", "Corelle", "Yankee Candle") };
const CATEGORIES = [
  {
    match: /mug|cup|tumbler/i,
    categoryId: "20625",
    categoryName: "Mugs",
    ancestors: ["Dinnerware & Serveware", "Kitchen, Dining & Bar", "Home & Garden"],
    aspects: [
      brand,
      { localizedAspectName: "Type", aspectConstraint: { aspectRequired: true, aspectMode: "SELECTION_ONLY", itemToAspectCardinality: "SINGLE", aspectUsage: "RECOMMENDED" }, aspectValues: values("Coffee Mug", "Travel Mug", "Tea Cup", "Espresso Cup") },
      { localizedAspectName: "Material", aspectConstraint: { aspectRequired: false, aspectMode: "FREE_TEXT", itemToAspectCardinality: "MULTI", aspectUsage: "RECOMMENDED" }, aspectValues: values("Ceramic", "Stoneware", "Glass", "Stainless Steel") },
      { localizedAspectName: "Color", aspectConstraint: { aspectRequired: false, aspectMode: "FREE_TEXT", itemToAspectCardinality: "MULTI", aspectUsage: "RECOMMENDED" }, aspectValues: values("Black", "White", "Blue", "Green") },
    ],
  },
  {
    match: /candle/i,
    categoryId: "46782",
    categoryName: "Candles",
    ancestors: ["Candles & Home Fragrance", "Home Décor", "Home & Garden"],
    aspects: [
      brand,
      { localizedAspectName: "Type", aspectConstraint: { aspectRequired: true, aspectMode: "SELECTION_ONLY", itemToAspectCardinality: "SINGLE", aspectUsage: "RECOMMENDED" }, aspectValues: values("Jar Candle", "Pillar Candle", "Taper Candle", "Tealight") },
      { localizedAspectName: "Scent", aspectConstraint: { aspectRequired: false, aspectMode: "FREE_TEXT", itemToAspectCardinality: "MULTI", aspectUsage: "RECOMMENDED" }, aspectValues: values("Lavender", "Vanilla", "Unscented") },
    ],
  },
  {
    match: /.*/,
    categoryId: "20698",
    categoryName: "Other Kitchen Tools & Gadgets",
    ancestors: ["Kitchen Tools & Gadgets", "Kitchen, Dining & Bar", "Home & Garden"],
    aspects: [brand, { localizedAspectName: "Type", aspectConstraint: { aspectRequired: true, aspectMode: "SELECTION_ONLY", itemToAspectCardinality: "SINGLE", aspectUsage: "RECOMMENDED" }, aspectValues: values("Kitchen Scale", "Kitchen Timer", "Spatula", "Whisk") }],
  },
];

const err = (status, errorId, message, parameters) => ({ status, body: { errors: [{ errorId, domain: "API_INVENTORY", category: "REQUEST", message, ...(parameters ? { parameters } : {}) }] } });
function refuse(call, status, errorId, message, parameters) {
  ebayListings.refused.push({ call, errorId, message });
  return err(status, errorId, message, parameters);
}

/** Records a business policy made through the stand-in (the offers must name real ones). */
export function rememberPolicy(id) {
  ebayListings.policies.add(id);
}

/** The listing calls, or undefined for any other eBay call. `headers` are the relayed request's. */
export function ebayListingAnswer(method, url, headers, rawBody) {
  const p = url.pathname;
  const body = rawBody ? JSON.parse(rawBody) : undefined;
  const lang = headers["x-pd-proxy-content-language"];

  // ---- Taxonomy
  if (p === "/commerce/taxonomy/v1/get_default_category_tree_id") {
    if (!url.searchParams.get("marketplace_id")) return err(400, 62002, "Missing marketplace ID.");
    return { status: 200, body: { categoryTreeId: "0", categoryTreeVersion: "130" } };
  }
  let m = p.match(/^\/commerce\/taxonomy\/v1\/category_tree\/([^/]+)\/(get_category_suggestions|get_item_aspects_for_category)$/);
  if (m) {
    if (m[1] !== "0") return err(400, 62004, "The specified category tree ID was not found.");
    if (m[2] === "get_category_suggestions") {
      const q = url.searchParams.get("q");
      if (!q) return err(400, 62007, "Missing keyword 'q'.");
      const c = CATEGORIES.find((x) => x.match.test(q));
      return {
        status: 200,
        body: {
          categorySuggestions: [
            {
              category: { categoryId: c.categoryId, categoryName: c.categoryName },
              categoryTreeNodeAncestors: c.ancestors.map((name, i) => ({ categoryId: String(1000 + i), categoryName: name, categoryTreeNodeLevel: c.ancestors.length - i })),
              categoryTreeNodeLevel: c.ancestors.length + 1,
              relevancy: "100",
            },
          ],
          categoryTreeId: "0",
          categoryTreeVersion: "130",
        },
      };
    }
    const c = CATEGORIES.find((x) => x.categoryId === url.searchParams.get("category_id"));
    if (!c) return err(400, 62005, "The specified category ID does not belong to specified category tree.");
    return { status: 200, body: { aspects: c.aspects } };
  }

  // ---- Inventory: items
  m = p.match(/^\/sell\/inventory\/v1\/inventory_item\/([^/]+)$/);
  if (m) {
    const sku = decodeURIComponent(m[1]);
    if (method === "PUT") {
      if (!lang) {
        ebayListings.contentLanguageMissing++;
        return refuse("createOrReplaceInventoryItem", 400, 25709, "Invalid value for header Content-Language.");
      }
      if (sku.length > 50) return refuse("createOrReplaceInventoryItem", 400, 25709, "Invalid value for sku.");
      const t = body?.product?.title ?? "";
      if (t.length > 80) return refuse("createOrReplaceInventoryItem", 400, 25709, "Invalid value for product.title. Max length 80.");
      if ((body?.product?.imageUrls ?? []).some((u) => !/^https:\/\//.test(u))) return refuse("createOrReplaceInventoryItem", 400, 25015, "The unpublished offer has an invalid picture URL.");
      for (const [k, v] of Object.entries(body?.product?.aspects ?? {})) {
        if (k.length > 40 || !Array.isArray(v) || v.some((x) => String(x).length > 50)) return refuse("createOrReplaceInventoryItem", 400, 25022, `Invalid attribute. ${k}`);
      }
      const existed = ebayListings.items.has(sku);
      ebayListings.items.set(sku, { ...body, sku, language: lang });
      return existed ? { status: 200, body: { warnings: [] } } : { status: 204 };
    }
    if (method === "GET") return ebayListings.items.has(sku) ? { status: 200, body: ebayListings.items.get(sku) } : err(404, 25702, `${sku} could not be found or is not available in the system.`);
    if (method === "DELETE") {
      if (!ebayListings.items.has(sku)) return err(404, 25702, `${sku} could not be found or is not available in the system.`);
      ebayListings.items.delete(sku);
      for (const [id, o] of ebayListings.offers) {
        if (o.sku !== sku) continue;
        if (o.status === "PUBLISHED") ebayListings.ended++;
        ebayListings.offers.delete(id);
      }
      ebayListings.deleted++;
      return { status: 204 };
    }
  }

  // ---- Inventory: offers
  if (p === "/sell/inventory/v1/offer") {
    if (method === "GET") {
      const sku = url.searchParams.get("sku");
      const list = [...ebayListings.offers.values()].filter((o) => o.sku === sku);
      if (!list.length) return err(404, 25713, `This Offer is not available : ${sku}.`);
      return { status: 200, body: { href: url.toString(), limit: 100, offers: list, size: list.length, total: list.length } };
    }
    if (method === "POST") {
      if (!lang) {
        ebayListings.contentLanguageMissing++;
        return refuse("createOffer", 400, 25709, "Invalid value for header Content-Language.");
      }
      if (!body?.sku || !body.marketplaceId || !body.format) return refuse("createOffer", 400, 25709, "Invalid value for sku, marketplaceId or format.");
      if (!ebayListings.items.has(body.sku)) return refuse("createOffer", 400, 25702, `${body.sku} could not be found or is not available in the system.`);
      const dupe = [...ebayListings.offers.values()].find((o) => o.sku === body.sku && o.marketplaceId === body.marketplaceId && o.format === body.format);
      if (dupe) return refuse("createOffer", 400, 25002, "A user error has occurred. Offer entity already exists.", [{ name: "offerId", value: dupe.offerId }]);
      const offerId = String(nextOffer++);
      ebayListings.offers.set(offerId, { ...body, offerId, status: "UNPUBLISHED" });
      return { status: 201, body: { offerId, warnings: [] } };
    }
  }
  m = p.match(/^\/sell\/inventory\/v1\/offer\/([^/]+)(\/publish|\/withdraw)?$/);
  if (m) {
    const o = ebayListings.offers.get(decodeURIComponent(m[1]));
    if (!o) return err(404, 25713, "This Offer is not available.");
    if (!m[2] && method === "PUT") {
      if (!lang) {
        ebayListings.contentLanguageMissing++;
        return refuse("updateOffer", 400, 25709, "Invalid value for header Content-Language.");
      }
      Object.assign(o, body, { offerId: o.offerId, status: o.status, listing: o.listing });
      return { status: 200, body: { warnings: [] } };
    }
    if (!m[2] && method === "DELETE") {
      if (o.status === "PUBLISHED") ebayListings.ended++;
      ebayListings.offers.delete(o.offerId);
      return { status: 204 };
    }
    if (m[2] === "/withdraw" && method === "POST") {
      if (o.status !== "PUBLISHED") return refuse("withdrawOffer", 400, 25002, "A user error has occurred. The offer is not published.");
      o.status = "UNPUBLISHED";
      const listingId = o.listing?.listingId;
      o.listing = { listingId, listingStatus: "ENDED" };
      ebayListings.ended++;
      return { status: 200, body: { listingId, warnings: [] } };
    }
    if (m[2] === "/publish" && method === "POST") {
      ebayListings.publishCalls++;
      const item = ebayListings.items.get(o.sku);
      const pr = item?.product ?? {};
      if (!pr.title || !pr.description || !Object.keys(pr.aspects ?? {}).length || !(pr.imageUrls ?? []).length || !item.condition) {
        return refuse("publishOffer", 400, 25017, "Missing information in fields: title, description, aspects, imageUrls and condition are required.");
      }
      const qty = o.availableQuantity ?? item.availability?.shipToLocationAvailability?.quantity;
      if (!(qty > 0)) return refuse("publishOffer", 400, 25004, "The unpublished offer has an invalid quantity.");
      const pol = o.listingPolicies ?? {};
      for (const k of ["paymentPolicyId", "returnPolicyId", "fulfillmentPolicyId"]) {
        if (!pol[k] || !ebayListings.policies.has(pol[k])) return refuse("publishOffer", 400, 25035, `The specified policy is not found for the market place (${k}).`);
      }
      if (!o.categoryId) return refuse("publishOffer", 400, 25005, "The unpublished offer has an invalid category ID.");
      if (!o.merchantLocationKey) return refuse("publishOffer", 400, 25012, "Invalid inventory location.");
      if (!(Number(o.pricingSummary?.price?.value) > 0) || !o.pricingSummary?.price?.currency) return refuse("publishOffer", 400, 25003, "The unpublished offer has an invalid price.");
      if (o.format === "FIXED_PRICE" && o.listingDuration !== "GTC") return refuse("publishOffer", 400, 25016, "The listingDuration value is invalid. Fixed price listings must be GTC.");
      const cat = CATEGORIES.find((c) => c.categoryId === o.categoryId);
      for (const a of cat?.aspects ?? []) {
        if (!a.aspectConstraint.aspectRequired) continue;
        const given = pr.aspects?.[a.localizedAspectName];
        if (!given?.length) return refuse("publishOffer", 400, 25029, `${a.localizedAspectName} is required for this category.`);
        if (a.aspectConstraint.aspectMode === "SELECTION_ONLY" && !given.every((g) => a.aspectValues.some((v) => v.localizedValue === g))) {
          return refuse("publishOffer", 400, 25022, `Invalid attribute. ${a.localizedAspectName}`);
        }
      }
      // A new seller's monthly limit (the privilege answer says 100 items).
      const live = [...ebayListings.offers.values()].filter((x) => x.status === "PUBLISHED" && x.offerId !== o.offerId);
      if (live.reduce((n, x) => n + (x.availableQuantity ?? 1), 0) + qty > 100) return refuse("publishOffer", 400, 25026, "Selling limit exceeded.");
      if (o.status !== "PUBLISHED") {
        o.status = "PUBLISHED";
        o.listing = { listingId: String(nextListing++), listingStatus: "ACTIVE" };
      }
      return { status: 200, body: { listingId: o.listing.listingId, warnings: [] } };
    }
  }
  return undefined;
}

/** What reached the stand-in, for /__stats. */
export function ebayListingStats() {
  const offers = [...ebayListings.offers.values()];
  return {
    items: ebayListings.items.size,
    offers: offers.length,
    live: offers
      .filter((o) => o.status === "PUBLISHED")
      .map((o) => ({ sku: o.sku, offerId: o.offerId, listingId: o.listing?.listingId, price: o.pricingSummary?.price, categoryId: o.categoryId, aspects: ebayListings.items.get(o.sku)?.product?.aspects, title: ebayListings.items.get(o.sku)?.product?.title, quantity: o.availableQuantity, policies: o.listingPolicies, location: o.merchantLocationKey })),
    ended: ebayListings.ended,
    deleted: ebayListings.deleted,
    publishCalls: ebayListings.publishCalls,
    contentLanguageMissing: ebayListings.contentLanguageMissing,
    refused: ebayListings.refused,
  };
}
