// The live check for real eBay listings, to run against a real connected eBay account through the
// same door the app uses (Armada's own eBay app, or the connection service's relay).
//
// By default it only reads: the account's standing with eBay (can it sell yet, its selling limit),
// whether its setup is finished (business policies, ship-from place), and, for one product, the
// category eBay suggests and which of the category's item details the product's own facts fill,
// and which it doesn't. Nothing is listed and nothing in Armada changes.
//
// With --publish it lists that one product for real (only a real supplier product, only when the
// account can sell and its setup is finished), prints the listing's address, then takes it down
// again after ten seconds (withdraw, then delete the item) unless --keep is given.
//
// usage: node --env-file=.env.local scripts/live-ebay-listing.mjs [--store <store id>] [--product <product id>]
//                                                                  [--title "Ceramic coffee mug, 12 oz"] [--publish [--keep]]
import fs from "node:fs";
import path from "node:path";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tryFile = (b) => ["", ".ts", ".tsx", "/index.ts"].map((e) => b + e).find((p) => fs.existsSync(p) && fs.statSync(p).isFile()) ?? null;
// Lets Node's own TypeScript support load the app's server code: "@/x" paths, extensionless
// imports, and "server-only" (which only means something inside Next).
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: pathToFileURL(path.join(ROOT, "node_modules", "server-only", "empty.js")).href, shortCircuit: true };
    if (specifier.startsWith("@/")) {
      const p = tryFile(path.join(ROOT, specifier.slice(2)));
      if (p) return { url: pathToFileURL(p).href, shortCircuit: true };
    }
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
      const b = path.join(path.dirname(fileURLToPath(context.parentURL)), specifier);
      const p = tryFile(b);
      if (p && p !== b) return { url: pathToFileURL(p).href, shortCircuit: true };
    }
    return next(specifier, context);
  },
});

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null);
const publish = process.argv.includes("--publish");
const keep = process.argv.includes("--keep");

const { asSystem } = await import("@/lib/db");
const { planEbayListing, publishEbayListing, endEbayListing, sellerStanding, ListingProblem } = await import("@/connectors/ebay/listing");
const core = await import("@/connectors/ebay/listing-core");
const { charm, MARKUP } = await import("@/lib/pricing");

const say = (label, value) => console.log(`${label.padEnd(26)} ${typeof value === "string" ? value : JSON.stringify(value)}`);
let exit = 0;
try {
  const storeId = arg("--store");
  const [store] = await asSystem(
    (tx) => tx`
      select id, workspace_id, name, status, currency, meta from armada.stores
      where platform = 'ebay' and mode = 'live' and status <> 'disconnected' ${storeId ? tx`and id = ${storeId}` : tx``}
      order by (status = 'connected') desc, created_at limit 1`,
  );
  if (!store) throw new Error("No live eBay account is connected in any workspace (or not the one given).");
  say("eBay account", `${store.meta.ebayUsername} (${store.name}, ${store.meta.marketplaceId}, ${store.meta.viaService ? "through the connection service" : "Armada's own eBay app"})`);
  const standing = await sellerStanding(store.workspaceId, store.meta.ebayUserId);
  say("Can sell", standing.canSell ? "yes" : "NO: eBay needs the seller's name, address and payouts first (ebay.com/sl/sell)");
  say("Selling limit", standing.sellingLimit ?? "none given");
  const ready = core.storeCanList(store.meta);
  say("Setup finished", ready ? `yes (policies ${Object.values(store.meta.policies ?? {}).join(", ")}; ships from ${store.meta.locationKey})` : `no (${(store.meta.setup?.steps ?? []).find((s) => s.state !== "done")?.label ?? "not started"})`);

  // The product: the one given, else the first real supplier product in that workspace, else a probe title.
  const productId = arg("--product");
  const [p] = await asSystem(
    (tx) => tx`
      select p.id, p.title, p.description, p.bullets, p.images, p.category, p.status, p.cost_cents, p.ship_cents, c.source, c.branded, c.stock, c.attributes
      from armada.products p join armada.catalog_items c on c.id = p.catalog_item_id
      where p.workspace_id = ${store.workspaceId} and ${productId ? tx`p.id = ${productId}` : tx`c.source in ('cj', 'aliexpress') and p.status = 'active'`}
      order by p.created_at desc limit 1`,
  );
  const title = arg("--title") ?? "Ceramic coffee mug, 12 oz";
  const facts = p
    ? {
        productId: p.id,
        title: p.title,
        description: p.description ?? "",
        bullets: p.bullets ?? [],
        category: p.category ?? "",
        images: p.images ?? [],
        source: p.source,
        imagined: false,
        branded: p.branded,
        materials: p.attributes?.[p.source]?.materials ?? [],
        variant: p.attributes?.[p.source]?.variants?.[0]?.key ?? null,
        stock: p.stock,
        status: p.status,
      }
    : { productId: "00000000-0000-0000-0000-000000000000", title, description: "", bullets: [], category: "", images: [], source: null, imagined: false, branded: false, materials: [], variant: null, stock: null, status: "active" };
  say("Product", p ? `${p.title} (${p.source})` : `no real supplier product in this workspace yet; probing with “${title}”`);
  say("Could it be listed", core.listingBlocker(facts) ?? "yes");

  const plan = await planEbayListing(store.workspaceId, { storeId: store.id, ebayUserId: store.meta.ebayUserId, marketplaceId: store.meta.marketplaceId, env: store.meta.env ?? "production", currency: store.currency, policies: store.meta.policies ?? {}, locationKey: store.meta.locationKey ?? null }, facts);
  say("Category eBay suggests", plan.category ?? "none");
  say("Details from its facts", plan.aspects);
  say("Details eBay needs", plan.missing.length ? `${plan.missing.join(", ")} (the product's facts don't say, so it would stay off eBay)` : "all given");
  say("Title", plan.title);
  say("Photos", `${plan.imageUrls.length}`);

  if (publish) {
    if (!p) throw new Error("--publish needs a real supplier product (CJ or AliExpress) in this workspace.");
    if (!standing.canSell) throw new Error("This eBay account can't sell yet; nothing was listed.");
    if (!ready) throw new Error("This eBay account's setup isn't finished; nothing was listed.");
    const price = charm(Math.max((p.costCents + p.shipCents) * MARKUP.mid * 1.1, 500), "mid");
    const listed = await publishEbayListing(store.workspaceId, { storeId: store.id, ebayUserId: store.meta.ebayUserId, marketplaceId: store.meta.marketplaceId, env: store.meta.env ?? "production", currency: store.currency, policies: store.meta.policies, locationKey: store.meta.locationKey }, facts, price, core.listingQuantity(facts.stock));
    say("LISTED", `${listed.url} (offer ${listed.offerId}, ${listed.categoryName}, $${(price / 100).toFixed(2)})`);
    if (!keep) {
      await new Promise((r) => setTimeout(r, 10_000));
      const ended = await endEbayListing(store.workspaceId, store.meta.ebayUserId, p.id);
      say("Taken down", `${ended.ended} listing(s) ended, item deleted`);
    }
  }
} catch (e) {
  exit = 1;
  console.log(`STOPPED: ${e instanceof ListingProblem ? `${e.message} (${e.kind})` : e.message}`);
} finally {
  // A moment for open connections to settle, then out (the database pool would otherwise wait).
  process.exitCode = exit;
  setTimeout(() => process.exit(exit), 300);
}
