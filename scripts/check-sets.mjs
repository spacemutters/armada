// Offline checks for sets, "goes well with" pairs and the premium brand price level. No network,
// no database. Prints one PASS/FAIL line per check and exits 1 on any FAIL.
//
//   node scripts/check-sets.mjs
//
// What it proves:
// - a set always costs less than its items at the shop's own prices, by about the stated amount,
//   and the "separately" figure is exactly their sum (no invented "was" price);
// - the AI can only put the shop's own products in sets and pairs; junk, repeats, one-item sets and
//   self-pairs are dropped, and the limits hold;
// - the bag takes a set's saving only for complete sets, once per item;
// - the premium brand level prices a $50 item near $400 in round numbers, and its terms (60-day
//   returns the shop pays for) reach the pages the AI writes;
// - the storefront never calls a pair "frequently bought together" or "popular".
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
let failures = 0;
const check = (ok, label, detail) => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${!ok && detail !== undefined ? ` (${typeof detail === "string" ? detail : JSON.stringify(detail)})` : ""}`);
};

(await import("tsx/esm/api")).register();
(await import("tsx/cjs/api")).register();
const load = (p) => import(new URL(`../${p}`, import.meta.url).href);
const sets = await load("lib/shops/sets.ts");
const pricing = await load("lib/pricing.ts");
const prompts = await load("lib/shops/prompts.ts");

// ---- set prices ----
for (const separate of [1998, 5998, 12999, 399, 250000, 101]) {
  const p = sets.setPrice(separate);
  check(p < separate && p > 0, `a set of $${(separate / 100).toFixed(2)} costs less than its items`, p);
  check(p >= Math.floor(separate * 0.85) || separate < 1000, `…and not far below the stated saving ($${(p / 100).toFixed(2)})`, p);
}
check(sets.setPrice(5998) % 100 === 99, "set prices end in .99 like the shop's other prices", sets.setPrice(5998));
check(sets.setPrice(78000, "whole") === 70000 && sets.setPrice(78000, "whole") % 500 === 0, "a premium brand's sets are round numbers too", sets.setPrice(78000, "whole"));

// ---- reading the AI's sets and pairs ----
const products = [
  { handle: "linen-sheet", priceCents: 9299 },
  { handle: "pillowcase", priceCents: 5899 },
  { handle: "eye-mask", priceCents: 3099 },
  { handle: "night-light", priceCents: 2799 },
];
const read = sets.readSetsAndPairings(
  {
    sets: [
      { title: "The whole bed", why: "Everything the bed needs, in one colour.", products: ["linen-sheet", "pillowcase"] },
      { title: "Same set again", why: "x", products: ["pillowcase", "linen-sheet"] },
      { title: "Lonely", why: "one item", products: ["eye-mask"] },
      { title: "Invented", why: "not ours", products: ["eye-mask", "gold-watch"] },
      { title: "Wind down", why: "For the last hour of the day.", products: ["eye-mask", "night-light", "eye-mask"] },
      { title: "Too many", why: "x", products: ["linen-sheet", "eye-mask"] },
      { title: "", why: "no title", products: ["night-light", "pillowcase"] },
    ],
    pairings: [
      { product: "linen-sheet", with: "pillowcase", why: "Cut from the same linen." },
      { product: "linen-sheet", with: "pillowcase", why: "repeat" },
      { product: "linen-sheet", with: "linen-sheet", why: "itself" },
      { product: "linen-sheet", with: "gold-watch", why: "not ours" },
      { product: "linen-sheet", with: "eye-mask", why: "For darker mornings." },
      { product: "linen-sheet", with: "night-light", why: "a third, over the limit" },
      { product: "eye-mask", with: "night-light", why: "" },
      "junk",
      null,
    ],
  },
  products,
);
check(read.sets.length === 3, "sets: repeats, one-item sets, unknown products and untitled sets are dropped; at most 3", read.sets.map((s) => s.title));
check(read.sets[0].separateCents === 9299 + 5899, "a set's 'separately' is exactly its items' own prices", read.sets[0].separateCents);
check(read.sets.every((s) => s.priceCents < s.separateCents), "every set costs less than its items");
check(JSON.stringify(read.sets[1].productHandles) === JSON.stringify(["eye-mask", "night-light"]), "a product appears once in a set", read.sets[1].productHandles);
check(new Set(read.sets.map((s) => s.handle)).size === read.sets.length, "set addresses are unique");
check((read.pairings["linen-sheet"] ?? []).length === 2, "pairs: at most 2 per product, no repeats, no self-pairs, only the shop's products", read.pairings["linen-sheet"]);
check(!read.pairings["eye-mask"], "a pair with no reason is dropped");
const empty = sets.readSetsAndPairings({}, products);
check(empty.sets.length === 0 && Object.keys(empty.pairings).length === 0, "no answer means no sets and no pairs");

// ---- the bag ----
const s1 = read.sets[0];
const save = sets.bagSetSavings(
  [
    { handle: "linen-sheet", qty: 2 },
    { handle: "pillowcase", qty: 1 },
  ],
  [s1],
);
check(save.length === 1 && save[0].times === 1 && save[0].savingCents === s1.separateCents - s1.priceCents, "one complete set in the bag saves the set's difference once", save);
check(sets.bagSetSavings([{ handle: "linen-sheet", qty: 3 }], [s1]).length === 0, "an incomplete set saves nothing");
const overlap = sets.bagSetSavings(
  [
    { handle: "eye-mask", qty: 1 },
    { handle: "night-light", qty: 1 },
    { handle: "linen-sheet", qty: 1 },
  ],
  [read.sets[1], { ...read.sets[2] }],
);
const used = overlap.flatMap((o) => (o.handle === read.sets[1].handle ? read.sets[1].productHandles : read.sets[2].productHandles));
check(used.filter((h) => h === "eye-mask").length <= 1, "an item counts toward one set at a time", overlap);

// ---- the premium brand level ----
const lux = pricing.retailPrice(5000, 550, "luxury");
check(lux >= 35000 && lux <= 42500, "a $50 item landing with shipping sells near $400 at the premium brand level", lux / 100);
check(lux % 500 === 0, "premium brand prices are round numbers", lux / 100);
check(pricing.retailPrice(300, 200, "luxury") >= 3900, "nothing sells for less than $39 at that level", pricing.retailPrice(300, 200, "luxury") / 100);
check(pricing.retailPrice(5000, 550, "mid") < lux / 2, "the level really is a different price band from mid-range");
const bp = {
  brand: { name: "Lull", voice: "calm" },
  collections: [{ handle: "sleep", title: "Sleep" }],
  facts: { country: "United States", deliveryMin: 7, deliveryMax: 14, handlingDays: 2, returnDays: 60, freeReturns: true },
};
const pagePrompt = prompts.pagesPrompt(bp, [
  { handle: "linen-sheet", title: "Linen sheet", collection: "Sleep" },
  { handle: "pillowcase", title: "Pillowcase", collection: "Sleep" },
]);
check(/within 60 days/.test(pagePrompt) && /shop pays for the return shipping/.test(pagePrompt), "the premium terms reach the pages the AI writes");
check(/linen-sheet: Linen sheet/.test(pagePrompt), "the pages step sees the shop's products by handle");
check(/never mention a price, a discount or savings/.test(pagePrompt) && /Never say "frequently bought together"/.test(pagePrompt), "the AI is told not to invent prices, savings or popularity");
const plain = prompts.pagesPrompt({ ...bp, facts: { ...bp.facts, returnDays: 30, freeReturns: undefined } }, []);
check(/customer pays return shipping/.test(plain) && !/sets:/.test(plain), "other levels keep their terms, and no products means no sets asked for");
check(prompts.pagesSchema.required.includes("sets") && prompts.pagesSchema.required.includes("pairings"), "the answer shape asks for sets and pairs");

// ---- honest words on the storefront ----
const storefront = ["app/s/[slug]/page.tsx", "app/s/[slug]/products/[handle]/page.tsx", "components/storefront/bag.tsx", "components/storefront/set-card.tsx"]
  .map((f) => fs.readFileSync(path.join(root, f), "utf8"))
  .join("\n");
check(!/frequently bought|customers also|popular|best ?seller|you save \d|was \$|compare at/i.test(storefront), "no popularity claims or invented 'was' prices on the storefront");
check(/separately/.test(storefront), "sets show what their items cost separately");

console.log(failures ? `\n${failures} check(s) failed` : "\nAll set, pair and premium level checks passed");
process.exit(failures ? 1 : 0);
