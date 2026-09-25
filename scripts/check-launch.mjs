// Offline checks for Launch and real eBay listings: which products may ever go on a real
// marketplace, the listing's words, pictures and item details (filled from the product's facts
// only, never guessed), the item and offer bodies eBay takes, eBay's selling limit, the plain
// answers to eBay's refusals, and the launch's own steps and states. The bodies are also run
// through the eBay stand-in (scripts/mock-ebay-listings.mjs), which refuses what eBay's specs say
// eBay refuses. No network, no database, no keys. Prints PASS/FAIL lines; exits 1 on any FAIL.
//
//   node scripts/check-launch.mjs

let failures = 0;
let passes = 0;
function check(ok, label, detail) {
  if (ok) passes++;
  else failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${!ok && detail !== undefined ? ` (${typeof detail === "string" ? detail : JSON.stringify(detail)})` : ""}`);
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

let L, C, mock;
try {
  L = await import("../connectors/ebay/listing-core.ts");
  C = await import("../lib/launch/core.ts");
  mock = await import("./mock-ebay-listings.mjs");
} catch (e) {
  console.log(`FAIL couldn't load the launch code: ${e.message}`);
  process.exit(1);
}

const PID = "3f2a9c1e-5b7d-4e8f-a012-3456789abcde";
const facts = (over = {}) => ({
  productId: PID,
  title: "Speckled Stoneware Coffee Mug, 12 oz",
  description: "Hand-glazed stoneware.\n\nDishwasher safe.",
  bullets: ["Holds 12 oz", "Speckled glaze"],
  category: "Mugs",
  images: [{ url: "https://cdn.example.com/a.jpg" }, { url: "https://cdn.example.com/b.jpg" }],
  source: "cj",
  imagined: false,
  branded: false,
  materials: ["Stoneware"],
  variant: "Speckled White",
  stock: 250,
  status: "active",
  ...over,
});

// ---------------------------------------------------------------- only real products

check(L.isRealSupplierProduct({ source: "cj", imagined: false }), "a CJ product is a real supplier product");
check(L.isRealSupplierProduct({ source: "aliexpress", imagined: false }), "an AliExpress product is a real supplier product");
check(!L.isRealSupplierProduct({ source: "practice", imagined: false }), "a practice-catalog product is never real");
check(!L.isRealSupplierProduct({ source: "cj", imagined: true }), "an imagined item is never real, whatever its catalog says");
check(!L.isRealSupplierProduct({ source: null, imagined: false }), "a product with no supplier behind it is never real");
check(L.listingBlocker(facts()) === null, "a real, active, unbranded product with photos may be listed");
check(L.listingBlocker(facts({ source: "practice" })) === L.PRACTICE_OFF_EBAY, "practice items are refused, in plain words", L.listingBlocker(facts({ source: "practice" })));
check(/real supplier \(CJ or AliExpress\)/.test(L.PRACTICE_OFF_EBAY) && /can't go on real eBay/.test(L.PRACTICE_OFF_EBAY), "the practice refusal says why and what can go there");
check(L.listingBlocker(facts({ imagined: true })) === L.PRACTICE_OFF_EBAY, "imagined items are refused");
check(/brand/.test(L.listingBlocker(facts({ branded: true })) ?? ""), "branded products are refused");
check(/Paused/.test(L.listingBlocker(facts({ status: "paused" })) ?? ""), "paused products are refused");
check(/Out of stock/.test(L.listingBlocker(facts({ stock: 0 })) ?? ""), "products the supplier has none of are refused");
check(/photo/.test(L.listingBlocker(facts({ images: [{ url: "http://cdn.example.com/a.jpg" }] })) ?? ""), "a product with no HTTPS photo is refused");

// ---------------------------------------------------------------- words and pictures

const sku = L.skuFor(PID);
check(sku === L.skuFor(PID.toUpperCase()), "the SKU is the same every time for one product");
check(sku.length <= 50 && /^[a-z0-9-]+$/.test(sku), "the SKU fits eBay's 50 characters, letters, digits and dashes", sku);
check(L.skuFor("11111111-1111-1111-1111-111111111111") !== sku, "different products get different SKUs");
const long = "Handmade Speckled Stoneware Coffee Mug with Wide Handle for Tea and Latte Lovers, Large 16 oz Capacity";
const t = L.listingTitle(long);
check(t.length <= 80 && long.startsWith(t) && !/[\s,]$/.test(t), "titles are cut to 80 at a word boundary", t);
check(L.listingTitle("  Short   title ") === "Short title", "titles are tidied");
const d = L.listingDescription({ title: "X", description: "Line one <script>alert(1)</script>\n\nLine & two", bullets: ["A \"quoted\" point"] });
check(!/<script>/.test(d) && /&lt;script&gt;/.test(d) && /&amp; two/.test(d) && /&quot;quoted&quot;/.test(d), "descriptions escape anything that isn't eBay's basic HTML", d);
check(/<p>Line one/.test(d) && /<ul><li>/.test(d), "descriptions keep paragraphs and points", d);
const huge = L.listingDescription({ title: "X", description: Array.from({ length: 200 }, (_, i) => `Paragraph ${i} ${"word ".repeat(20)}`).join("\n\n"), bullets: Array(50).fill("point ".repeat(10)) });
check(huge.length <= 4000, "descriptions never pass eBay's 4,000 characters", huge.length);
check(L.listingDescription({ title: "Plain Mug", description: "", bullets: [] }) === "<p>Plain Mug</p>", "no supplier words: the title becomes the description");
const oneLong = L.listingDescription({ title: "X", description: "word ".repeat(2000), bullets: [] });
check(oneLong.length <= 4000 && oneLong.startsWith("<p>word"), "one very long paragraph is cut to fit rather than dropped", oneLong.length);
const imgs = L.imageUrls([{ url: "https://a/1.jpg" }, { url: "http://a/2.jpg" }, { url: "https://a/1.jpg" }, {}, ...Array.from({ length: 40 }, (_, i) => ({ url: `https://a/${i + 3}.jpg` }))]);
check(imgs[0] === "https://a/1.jpg" && !imgs.includes("http://a/2.jpg") && imgs.length === 24 && new Set(imgs).size === 24, "pictures: HTTPS only, no repeats, 24 at most", imgs.length);

check(eq(L.pickCategory({ categorySuggestions: [{ category: { categoryId: "20625", categoryName: "Mugs" } }, { category: { categoryId: "1", categoryName: "Other" } }] }), { categoryId: "20625", categoryName: "Mugs" }), "eBay's most relevant suggestion is taken");
check(L.pickCategory({ categorySuggestions: [] }) === null && L.pickCategory(null) === null, "no suggestion means no category, never a guess");
check(L.pickCategory({ categorySuggestions: [{ category: { categoryId: "" } }, { category: { categoryId: "99", categoryName: "B" } }] })?.categoryId === "99", "a suggestion without an id is passed over");

// ---------------------------------------------------------------- item details from facts only

const A = (name, required, mode, card, vals, max) => ({
  localizedAspectName: name,
  aspectConstraint: { aspectRequired: required, aspectMode: mode, itemToAspectCardinality: card, ...(max ? { aspectMaxLength: max } : {}) },
  aspectValues: (vals ?? []).map((localizedValue) => ({ localizedValue })),
});
const mugMeta = [
  A("Brand", true, "FREE_TEXT", "SINGLE", ["Unbranded", "Corelle"]),
  A("Type", true, "SELECTION_ONLY", "SINGLE", ["Mug", "Coffee Mug", "Travel Mug", "Other"]),
  A("Material", false, "FREE_TEXT", "MULTI", ["Ceramic", "Stoneware", "Glass"]),
  A("Color", false, "FREE_TEXT", "SINGLE", ["Black", "White", "Blue"]),
  A("Capacity", false, "FREE_TEXT", "SINGLE", []),
  A("Size", false, "SELECTION_ONLY", "SINGLE", ["S", "M", "L"]),
];
let r = L.aspectsFromFacts(mugMeta, facts());
check(eq(r.aspects.Brand, ["Unbranded"]), "Brand is Unbranded for a product that names no brand", r.aspects);
check(eq(r.aspects.Type, ["Coffee Mug"]), "a required detail is taken from the title, most specific value first", r.aspects.Type);
check(eq(r.aspects.Material, ["Stoneware"]), "Material comes from the supplier's materials", r.aspects.Material);
check(eq(r.aspects.Color, ["White"]), "a detail named once in the product's words (its variant) is used", r.aspects.Color);
check(!("Capacity" in r.aspects), "a free-text detail the facts don't name is left out, not made up");
check(!("Size" in r.aspects), "one- and two-letter values are never matched from words");
check(r.missing.length === 0, "nothing required is missing for a mug that says it's a coffee mug", r.missing);

r = L.aspectsFromFacts(mugMeta, facts({ title: "Speckled Stoneware Vessel", description: "", bullets: [], category: "", variant: null }));
check(!("Type" in r.aspects) && eq(r.missing, ["Type"]), "a required detail the product never states is reported missing, not guessed", r);
check(!Object.values(r.aspects).flat().includes("Other"), "empty values like Other are never picked to fill a gap");
r = L.aspectsFromFacts(mugMeta, facts({ title: "Black and White Mug", variant: null, materials: [], description: "Dishwasher safe.", bullets: [] }));
check(!("Color" in r.aspects), "a single-value detail with two different matches is left out rather than picked", r.aspects);
check(!("Material" in r.aspects), "no materials from the supplier: no Material");
r = L.aspectsFromFacts([A("Color", false, "FREE_TEXT", "MULTI", ["Black", "White", "Blue"])], facts({ title: "Black and White Mug", variant: null }));
check(eq(r.aspects.Color, ["Black", "White"]), "a multi-value detail takes every value the title names", r.aspects);
r = L.aspectsFromFacts([A("Type", true, "SELECTION_ONLY", "SINGLE", ["Mug"])], facts({ title: "Set of 4 Mugs" }));
check(eq(r.aspects.Type, ["Mug"]), "a plain plural in the title counts (Mugs names Mug)", r.aspects);
r = L.aspectsFromFacts([A("Type", true, "SELECTION_ONLY", "SINGLE", ["Mug"])], facts({ title: "Smuggler's Tin", category: "", description: "", bullets: [] }));
check(!("Type" in r.aspects), "only whole words count (Smuggler doesn't name Mug)", r.aspects);
r = L.aspectsFromFacts([A("Brand", true, "SELECTION_ONLY", "SINGLE", ["Corelle"])], facts());
check(eq(r.missing, ["Brand"]), "Unbranded is never forced into a list that doesn't offer it", r);
r = L.aspectsFromFacts([A("Material", false, "SELECTION_ONLY", "SINGLE", ["Ceramic", "Glass"])], facts());
check(!("Material" in r.aspects), "a select-only detail never takes a value outside eBay's list", r.aspects);
r = L.aspectsFromFacts([A("Material", false, "FREE_TEXT", "SINGLE", [], 5)], facts({ materials: ["Stoneware"] }));
check(!("Material" in r.aspects), "a value longer than the detail allows is left out", r.aspects);
r = L.aspectsFromFacts([A("A very long item detail name that goes past forty", true, "FREE_TEXT", "SINGLE", ["x"])], facts());
check(eq(r.aspects, {}), "a detail name over 40 characters is never sent");
check(/eBay asks for its Type and Style in Mugs, and the supplier's details don't say\. Armada doesn't guess/.test(L.missingDetailsNote(["Type", "Style"], "Mugs")), "the missing-details sentence is plain", L.missingDetailsNote(["Type", "Style"], "Mugs"));

// ---------------------------------------------------------------- bodies

const item = L.inventoryItemBody({ title: long, description: "<p>x</p>", aspects: { Brand: ["Unbranded"] }, imageUrls: ["https://a/1.jpg"], quantity: 2 });
check(item.condition === "NEW" && item.availability.shipToLocationAvailability.quantity === 2 && item.product.title.length <= 80, "the item is new, with its quantity and a title eBay takes");
const policies = { paymentPolicyId: "p1", returnPolicyId: "r1", fulfillmentPolicyId: "f1" };
const offer = L.offerBody({ sku, marketplaceId: "EBAY_US", categoryId: "20625", priceCents: 1299, currency: "USD", quantity: 2, policies, locationKey: "armada-default", description: "<p>x</p>" });
check(offer.format === "FIXED_PRICE" && offer.listingDuration === "GTC", "offers are fixed price and good 'til cancelled, as eBay requires");
check(eq(offer.pricingSummary.price, { value: "12.99", currency: "USD" }), "the price is sent as eBay's amount", offer.pricingSummary);
check(eq(offer.listingPolicies, policies) && offer.merchantLocationKey === "armada-default" && offer.availableQuantity === 2 && offer.categoryId === "20625", "the offer names the store's own policies, ship-from place, category and quantity");
check(L.storeCanList({ policies, locationKey: "armada-default", marketplaceId: "EBAY_US" }), "a finished setup can list");
check(!L.storeCanList({ policies: { paymentPolicyId: "p1" }, locationKey: "armada-default", marketplaceId: "EBAY_US" }), "missing policies: the store can't list yet");
check(!L.storeCanList({ policies, locationKey: null, marketplaceId: "EBAY_US" }), "no ship-from place: the store can't list yet");
check(L.listingQuantity(null) === L.EBAY_LISTING_QUANTITY && L.listingQuantity(1) === 1 && L.listingQuantity(0) === 0 && L.listingQuantity(500) === L.EBAY_LISTING_QUANTITY, "quantity is small, and never more than the supplier has");
check(L.CONTENT_LANGUAGE.EBAY_US === "en-US" && L.CONTENT_LANGUAGE.EBAY_GB === "en-GB" && L.CONTENT_LANGUAGE.EBAY_DE === "de-DE", "each marketplace's listing language");
check(L.listingUrl("production", "123") === "https://www.ebay.com/itm/123" && L.listingUrl("sandbox", "1").startsWith("https://www.sandbox.ebay.com/"), "listing links");

// ---------------------------------------------------------------- the selling limit

const lim = L.readSellingLimit({ amount: { value: "500", currency: "USD" }, quantity: 10 });
check(eq(lim, { quantity: 10, amountCents: 50000 }), "eBay's selling limit is read in items and cents", lim);
check(L.readSellingLimit(null) === null && L.readSellingLimit({}) === null, "no limit given: none assumed");
const items = Array.from({ length: 8 }, () => ({ priceCents: 2000, quantity: 2 }));
check(L.fitSellingLimit(items, { quantity: 10 }, { quantity: 0, amountCents: 0 }) === 5, "the item count caps how many go up", L.fitSellingLimit(items, { quantity: 10 }, { quantity: 0, amountCents: 0 }));
check(L.fitSellingLimit(items, { amountCents: 10000 }, { quantity: 0, amountCents: 0 }) === 2, "the money cap caps how many go up");
check(L.fitSellingLimit(items, { quantity: 10, amountCents: 50000 }, { quantity: 8, amountCents: 0 }) === 1, "what's already listed counts");
check(L.fitSellingLimit(items, null, { quantity: 999, amountCents: 0 }) === 8, "no limit known: everything goes");

// ---------------------------------------------------------------- refusals

const kind = (status, errors) => L.explainListingProblem(status, errors).kind;
check(kind(401, []) === "reconnect", "401: sign in again");
check(kind(400, [{ errorId: 25026, message: "Selling limit exceeded." }]) === "limit", "25026: selling limit");
check(kind(400, [{ errorId: 25018 }]) === "account", "25018: the account can't sell yet");
check(kind(400, [{ errorId: 25035 }]) === "setup" && kind(400, [{ errorId: 25012 }]) === "setup", "policies or ship-from place: the setup");
check(kind(500, []) === "busy" && kind(400, [{ errorId: 25001 }]) === "busy" && kind(429, []) === "busy", "eBay's side: try again");
check(kind(400, [{ errorId: 25015 }]) === "item" && kind(400, [{ errorId: 25005 }]) === "item", "pictures or category: this product only");
const odd = L.explainListingProblem(400, [{ errorId: 99999, longMessage: "Something eBay said" }]);
check(odd.kind === "item" && /Something eBay said/.test(odd.note), "anything else quotes eBay, for this product only", odd);
check(!/\b(API|token|JSON|endpoint)\b/i.test(Object.values({ a: L.explainListingProblem(401, []).note, b: L.LIMIT_NOTE, c: L.PRACTICE_OFF_EBAY }).join(" ")), "refusals are in plain words");
check(L.existingOfferId([{ errorId: 25002, parameters: [{ name: "offerId", value: "7000" }] }]) === "7000" && L.existingOfferId([]) === null, "an offer made twice is found by the id eBay names");

// ---------------------------------------------------------------- the bodies against the eBay stand-in

const U = (p) => new URL(`https://api.ebay.com${p}`);
const H = { "x-pd-proxy-content-language": "en-US" };
const ask = (method, path, body, headers = H) => mock.ebayListingAnswer(method, U(path), headers, body ? JSON.stringify(body) : "");
["p1", "r1", "f1"].forEach(mock.rememberPolicy);
const tree = ask("GET", "/commerce/taxonomy/v1/get_default_category_tree_id?marketplace_id=EBAY_US");
check(tree.body.categoryTreeId === "0", "stand-in: the category tree");
const sug = ask("GET", `/commerce/taxonomy/v1/category_tree/0/get_category_suggestions?q=${encodeURIComponent(L.categoryQuery(facts()))}`);
const cat = L.pickCategory(sug.body);
check(cat?.categoryId === "20625", "stand-in: a mug gets the mug category", cat);
const meta = ask("GET", `/commerce/taxonomy/v1/category_tree/0/get_item_aspects_for_category?category_id=${cat.categoryId}`).body.aspects;
const filled = L.aspectsFromFacts(meta, facts());
check(!filled.missing.length && filled.aspects.Type?.[0] === "Coffee Mug", "stand-in: its required details come from the facts", filled);
check(ask("PUT", `/sell/inventory/v1/inventory_item/${sku}`, {}, {}).body.errors[0].errorId === 25709, "stand-in: no Content-Language is refused, as eBay does");
const put = ask("PUT", `/sell/inventory/v1/inventory_item/${sku}`, L.inventoryItemBody({ title: facts().title, description: L.listingDescription(facts()), aspects: filled.aspects, imageUrls: L.imageUrls(facts().images), quantity: 2 }));
check(put.status === 204, "stand-in: the item is accepted", put);
const offerB = L.offerBody({ sku, marketplaceId: "EBAY_US", categoryId: cat.categoryId, priceCents: 2499, currency: "USD", quantity: 2, policies, locationKey: "armada-default", description: L.listingDescription(facts()) });
const made = ask("POST", "/sell/inventory/v1/offer", offerB);
check(made.status === 201 && made.body.offerId, "stand-in: the offer is made", made);
const twice = ask("POST", "/sell/inventory/v1/offer", offerB);
check(L.existingOfferId(twice.body.errors) === made.body.offerId, "stand-in: making it twice names the first one (25002)", twice.body);
const pub = ask("POST", `/sell/inventory/v1/offer/${made.body.offerId}/publish`);
check(pub.status === 200 && pub.body.listingId, "stand-in: the offer publishes with every field eBay requires", pub.body);
const noType = L.aspectsFromFacts(meta, facts({ title: "Speckled Stoneware Vessel", description: "", bullets: [], variant: null }));
const sku2 = L.skuFor("22222222-2222-2222-2222-222222222222");
ask("PUT", `/sell/inventory/v1/inventory_item/${sku2}`, L.inventoryItemBody({ title: "Vessel", description: "<p>x</p>", aspects: noType.aspects, imageUrls: ["https://a/1.jpg"], quantity: 2 }));
const o2 = ask("POST", "/sell/inventory/v1/offer", { ...offerB, sku: sku2 });
check(ask("POST", `/sell/inventory/v1/offer/${o2.body.offerId}/publish`).body.errors?.[0]?.errorId === 25029, "stand-in: a required detail left out is refused at publishing, as eBay does (so Armada never sends it)");
const w = ask("POST", `/sell/inventory/v1/offer/${made.body.offerId}/withdraw`);
check(w.status === 200 && w.body.listingId === pub.body.listingId, "stand-in: withdrawing ends the listing");
check(ask("DELETE", `/sell/inventory/v1/inventory_item/${sku}`).status === 204 && ask("GET", `/sell/inventory/v1/offer?sku=${sku}`).status === 404, "stand-in: deleting the item removes its offers");

// ---------------------------------------------------------------- the launch's steps

const fresh = C.freshLaunchSteps();
check(eq(fresh.map((s) => s.key), ["store", "checkout", "ebay", "facebook", "instagram", "posts", "ads"]), "the launch's steps, in order");
check(fresh.every((s) => s.state === "waiting"), "a new launch starts with every step waiting");
const set = (over) => fresh.map((s) => ({ ...s, state: over[s.key] ?? "done" }));
check(C.launchStatus(set({ checkout: "waiting" })) === "done", "checkout waiting on payments never holds the launch up");
check(C.launchStatus(set({ checkout: "waiting", ebay: "skipped" })) === "done", "a step that isn't for this shop counts as finished");
check(C.launchStatus(set({ posts: "working", facebook: "needs-you" })) === "working", "something working: the launch is working");
check(C.launchStatus(set({ facebook: "needs-you", posts: "waiting" })) === "needs_you", "nothing working and a press is the person's: needs you");
check(C.launchStatus(set({ ads: "failed" })) === "needs_you", "a stopped step needs the person's Try again");
check(C.launchStatus(set({ posts: "waiting" })) === "waiting", "only waiting left: waiting");
const retried = C.retrySteps(set({ ads: "failed", ebay: "needs-you" }));
check(retried.find((s) => s.key === "ads").state === "waiting" && retried.find((s) => s.key === "ebay").state === "needs-you" && retried.find((s) => s.key === "store").state === "done", "pressing again retries stopped steps and leaves the rest where they are");
check(eq(C.normalizeSteps([{ key: "ebay", label: "Old", state: "done" }]).map((s) => [s.key, s.state]), [["store", "waiting"], ["checkout", "waiting"], ["ebay", "done"], ["facebook", "waiting"], ["instagram", "waiting"], ["posts", "waiting"], ["ads", "waiting"]]), "saved steps are brought up to the current list");
const need = C.launchNeed("Fallow", set({ facebook: "needs-you" }).map((s) => (s.key === "facebook" ? { ...s, ask: "Make its Facebook Page", note: "No app is allowed…" } : s)));
check(need?.title === "Fallow: Make its Facebook Page", "Home's Needs you names the shop and the one press", need);
check(C.launchNeed("Fallow", set({ checkout: "waiting" })) === null, "a finished launch needs nothing");
check(/stopped/.test(C.launchNeed("Fallow", set({ ads: "failed" }))?.title ?? ""), "a stopped step shows on Home too");
check(C.SIGN_UP_PAGES.facebook === "https://www.facebook.com/pages/creation/" && C.SIGN_UP_PAGES.instagram === "https://www.instagram.com/accounts/emailsignup/", "sign-up presses open the platforms' own pages");
check(Object.values(C.STATE_WORDS).every((w) => /^[a-z ]+$/.test(w)), "every state has plain words for eyes and screen readers");

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
