// Offline checks for choosing products in the shop builder: the AI proposes twice the shop's count,
// the owner chooses exactly that count, and a shop waiting on its owner is never treated as stuck.
// No network, no database: the pure rules (lib/shops/types.ts) and the prompt and answer reader
// (lib/shops/prompts.ts) are loaded straight from Node, and the pipeline's database code is read as text.
// Prints one PASS/FAIL line per check and exits 1 on any FAIL.
//
//   node scripts/check-chooser.mjs
//
// What it proves:
// - the products step asks for 2 x N (8, 12, 16), capped by the real candidates found, with practice
//   items counting toward the total; the answer shape allows exactly that many and asks for "why";
// - the honesty rules still go to the AI, and the prompt still says to skip branded or poorly fitting items;
// - reading the answer keeps only real candidates the AI was shown (no made-up ids, repeats, other
//   sources, branded items or brand names in titles), ranks them in the AI's order, fills practice
//   shops with imagined items up to the target, and takes prices from the pricing rules, never the AI;
// - a choice is exactly N different proposal ids: wrong counts, unknown ids and repeats are refused;
// - "Let the AI pick for me" takes the AI's top N;
// - a shop waiting for its owner is never picked up by the stalled-build sweep, and no product is made
//   before the owner chooses.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);

let failures = 0;
let passes = 0;
function check(ok, label, detail) {
  if (ok) passes++;
  else failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${!ok && detail !== undefined ? ` (${typeof detail === "string" ? detail : JSON.stringify(detail)})` : ""}`);
}

// tsx lets this plain script load the TypeScript modules, "@/..." paths included.
(await import("tsx/esm/api")).register();
(await import("tsx/cjs/api")).register();
const load = (p) => import(new URL(`../${p}`, import.meta.url).href);

let rules, prompts, scoring;
try {
  [rules, prompts, scoring] = await Promise.all([load("lib/shops/types.ts"), load("lib/shops/prompts.ts"), load("lib/products/score-item.ts")]);
} catch (e) {
  console.log(`FAIL couldn't load the shop builder's code: ${e.message}`);
  process.exit(1);
}
const { proposalTarget, chooseCount, checkChoice, aiPicks, stalledCjStep, PROPOSAL_FACTOR } = rules;
const { productsAsk, ProductsAnswer, buildProposals, answerIds, SYSTEM } = prompts;
const { scoreCatalogItem } = scoring;

// ---------------------------------------------------------------- fixtures

let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const item = (over = {}) => ({
  id: uuid(),
  workspaceId: null,
  source: "practice",
  sourceId: `p-${n}`,
  title: `Linen pillow cover ${n}`,
  description: "Washed linen, 50 x 50 cm, hidden zip.",
  category: "Bedding",
  tags: [],
  images: [{ url: `https://images.example.com/${n}.jpg` }],
  costCents: 800 + n * 10,
  shipCents: 450,
  shipDaysMin: 6,
  shipDaysMax: 12,
  stock: 300,
  rating: "4.6",
  branded: false,
  retailSource: false,
  attributes: {},
  ...over,
});
const brief = (productCount, source = "practice") => ({ niche: "Calm bedroom and sleep goods", audience: "", country: "United States", priceFeel: "mid", productCount, look: "", source });
const collections = [
  { handle: "sleep", title: "Sleep", description: "For sleeping", keywords: ["pillow"], productIds: [] },
  { handle: "linen", title: "Linen", description: "Linen things", keywords: ["linen"], productIds: [] },
];
const bp = { brand: { name: "Loamwell", tagline: "Rest, simply", voice: "Calm", audience: "Light sleepers", alternativeNames: [], monogramIcon: "bed" }, collections };
const copy = (id, over = {}) => ({
  candidateId: id,
  collection: "Linen",
  title: "Washed linen pillow cover",
  description: "Washed linen with a hidden zip.",
  bullets: ["Washed linen", "50 x 50 cm", "Hidden zip"],
  seoTitle: "Washed linen pillow cover",
  seoDescription: "A washed linen pillow cover with a hidden zip.",
  why: "Soft washed linen suits a calm bedroom.",
  ...over,
});
const imagined = (over = {}) => ({
  collection: "Sleep",
  title: "Cotton sleep mask",
  category: "Sleep",
  description: "A cotton sleep mask.",
  bullets: ["Cotton", "Adjustable strap", "One size"],
  estimatedCostUsd: 3.5,
  icon: "bed",
  why: "Blocks light for light sleepers.",
  ...over,
});

// ---------------------------------------------------------------- how many to propose

check(PROPOSAL_FACTOR === 2, "the AI proposes twice the shop's count");
for (const count of [8, 12, 16]) {
  check(proposalTarget(count, 0, true) === count * 2, `practice shop of ${count}: proposes ${count * 2} (practice items fill in)`, proposalTarget(count, 0, true));
  check(proposalTarget(count, 60, false) === count * 2, `CJ shop of ${count} with 60 candidates: proposes ${count * 2}`, proposalTarget(count, 60, false));
}
check(proposalTarget(8, 10, false) === 10, "CJ shop of 8 with only 10 candidates: proposes 10, never more than exist", proposalTarget(8, 10, false));
check(proposalTarget(16, 3, true) === 32, "a practice shop with 3 candidates still proposes 32 (imagined items count toward it)");
check(chooseCount(8, 16) === 8 && chooseCount(12, 24) === 12 && chooseCount(16, 32) === 16, "the owner chooses the count they asked for");
check(chooseCount(8, 6) === 6, "the owner is never asked for more than were found");

// ---------------------------------------------------------------- the ask

for (const count of [8, 12, 16]) {
  const target = count * 2;
  const practice = productsAsk(brief(count), bp, [item(), item(), item()], true);
  const props = practice.schema.properties;
  check(practice.target === target, `practice ${count}: target is ${target}`, practice.target);
  check(props.products.maxItems === target && props.imagined.maxItems === target, `practice ${count}: the answer shape allows ${target} products and ${target} imagined`, [props.products.maxItems, props.imagined?.maxItems]);
  check(practice.prompt.includes(`You propose ${target}`) && practice.prompt.includes(`Propose ${target} products`), `practice ${count}: the prompt asks for ${target}`);
  check(practice.prompt.includes(`the first ${count} on their own`), `practice ${count}: the prompt asks for a balanced first ${count} (what "Let the AI pick" takes)`);
  check(practice.prompt.includes(`together hold ${target}`), `practice ${count}: imagined items count toward the ${target}`);
  const cjCands = Array.from({ length: 60 }, () => item({ source: "cj" }));
  const cj = productsAsk(brief(count, "cj"), bp, cjCands, false);
  check(cj.schema.properties.products.maxItems === target && !("imagined" in cj.schema.properties), `CJ ${count}: ${target} real products and no imagined ones`);
  check(cjCands.every((c) => cj.prompt.includes(c.id)), `CJ ${count}: every candidate id is in the prompt`);
}
{
  const few = productsAsk(brief(8, "cj"), bp, Array.from({ length: 10 }, () => item({ source: "cj" })), false);
  check(few.target === 10 && few.schema.properties.products.maxItems === 10, "CJ with 10 candidates: asks for 10", few.target);
  const s = productsAsk(brief(8), bp, [], true).schema;
  check(s.properties.products.items.required.includes("why") && s.properties.imagined.items.required.includes("why"), "every proposal must say why it fits");
  check(s.properties.products.items.additionalProperties === false && !("price" in s.properties.products.items.properties) && !("priceCents" in s.properties.products.items.properties), "the AI is never asked for a price");
  const p = productsAsk(brief(8), bp, [], true).prompt;
  check(/Skip anything that fits poorly, names a brand/.test(p), "the prompt still says to skip poor fits and branded items");
  check(/Never invented/.test(p) && /only facts from the candidate's data/.test(p), "the prompt still says to use only the data's facts");
  check(/Never invent facts/.test(SYSTEM) && /Never name a brand/.test(SYSTEM) && /Never invent a history/.test(SYSTEM), "the honesty rules still go to the AI");
}

// ---------------------------------------------------------------- reading the answer

{
  const real = Array.from({ length: 12 }, () => item());
  const branded = item({ branded: true, title: "Nike style pillow" });
  const otherSource = item({ source: "cj" });
  const notShown = item();
  const all = [...real, branded, otherSource, notShown];
  const byId = new Map(all.map((i) => [i.id, i]));
  const shown = [...real, branded, otherSource].map((i) => i.id);
  const raw = {
    products: [
      copy(real[0].id, { priceCents: 1, price: "$1" }),
      copy(real[0].id), // a repeat
      copy("not-an-id"),
      copy("00000000-0000-4000-8000-999999999999"), // well formed, but not a real candidate
      copy(branded.id),
      copy(otherSource.id),
      copy(notShown.id),
      copy(real[1].id, { title: "Pillow cover for iPhone fans" }), // names a brand
      ...real.slice(2).map((r) => copy(r.id, { collection: "Nowhere" })),
    ],
    imagined: Array.from({ length: 12 }, (_, i) => imagined({ title: `Practice item ${i + 1}`, icon: i === 0 ? "not-an-icon" : "bed", estimatedCostUsd: i === 1 ? 900 : 3.5 })),
  };
  const answer = ProductsAnswer.parse(raw);
  check(!("priceCents" in answer.products[0]) && !("price" in answer.products[0]), "a price in the AI's answer is thrown away");
  const ids = answerIds(answer, shown);
  check(!ids.includes("not-an-id") && !ids.includes(notShown.id) && new Set(ids).size === ids.length, "only well-formed ids the AI was shown are looked up, once each");

  let k = 0;
  const opts = { target: 16, allowImagined: true, source: "practice", priceFeel: "mid", collections, shown, newId: () => `10000000-0000-4000-8000-${String(++k).padStart(12, "0")}` };
  const props = buildProposals(answer, byId, opts);
  const realIds = props.filter((p) => p.catalogItemId).map((p) => p.catalogItemId);
  check(props.length === 16, "a practice shop of 8 gets 16 proposals", props.length);
  check(realIds.length === 11 && realIds[0] === real[0].id && realIds.slice(1).join() === real.slice(2).map((r) => r.id).join(), "real proposals keep the AI's order and drop the repeat and the brand-name title", realIds.length);
  check(![branded.id, otherSource.id, notShown.id, "not-an-id"].some((id) => realIds.includes(id)), "made-up, unseen, branded and other-supplier ids are dropped, not trusted");
  check(props.map((p) => p.rank).join() === Array.from({ length: 16 }, (_, i) => i + 1).join(), "ranks run 1 to 16, real candidates first");
  const im = props.filter((p) => p.imagined);
  check(im.length === 5 && im.every((p) => p.catalogItemId === null && p.image === null), "imagined items fill the rest, with no catalog row yet and no photo");
  check(im[0].icon === "package" && im[1].imagined.costCents === 50000, "an imagined item's unknown icon becomes the plain package, and its cost is capped");
  const expect = scoreCatalogItem(real[0], "mid");
  check(props[0].priceCents === expect.priceCents && props[0].score === expect.score, "prices and scores come from the pricing rules", [props[0].priceCents, expect.priceCents]);
  check(props[0].why === "Soft washed linen suits a calm bedroom." && props[0].collection === "linen", "each proposal keeps its why and its collection");
  check(props[1].collection === "sleep", "an unknown collection falls back to the first one");
  check(props[0].title === "Washed linen pillow cover" && props[0].bullets.length === 3 && props[0].seoDescription, "each proposal keeps its written copy");

  const cjItems = Array.from({ length: 6 }, () => item({ source: "cj", attributes: { cj: { checked: false } } }));
  const cjAnswer = ProductsAnswer.parse({ products: cjItems.map((c) => copy(c.id)), imagined: [imagined()] });
  const cjProps = buildProposals(cjAnswer, new Map(cjItems.map((c) => [c.id, c])), { ...opts, target: 16, allowImagined: false, source: "cj", shown: cjItems.map((c) => c.id) });
  check(cjProps.length === 6 && cjProps.every((p) => !p.imagined), "a CJ shop never gets imagined items");
  check(cjProps.every((p) => p.priceEstimated), "a CJ price is marked as an estimate until CJ confirms shipping");
  const capped = buildProposals(answer, byId, { ...opts, target: 4 });
  check(capped.length === 4, "never more proposals than the target", capped.length);
}

// ---------------------------------------------------------------- choosing

{
  const proposals = Array.from({ length: 16 }, (_, i) => ({ id: `p${i + 1}`, rank: i + 1 }));
  const shuffled = [...proposals].sort(() => Math.random() - 0.5);
  const ok = checkChoice(shuffled, ["p3", "p1", "p16", "p9", "p10", "p2", "p5", "p7"], 8);
  check(ok.ok && ok.ids.length === 8, "exactly 8 real proposals is a valid choice");
  const seven = checkChoice(proposals, ["p1", "p2", "p3", "p4", "p5", "p6", "p7"], 8);
  check(!seven.ok && /Choose exactly 8/.test(seven.problem), "7 of 8 is refused", seven);
  const nine = checkChoice(proposals, ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9"], 8);
  check(!nine.ok, "9 of 8 is refused");
  const unknown = checkChoice(proposals, ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "x99"], 8);
  check(!unknown.ok, "an id that wasn't proposed is refused");
  const dup = checkChoice(proposals, ["p1", "p1", "p2", "p3", "p4", "p5", "p6", "p7"], 8);
  check(!dup.ok && /twice/.test(dup.problem), "the same product twice is refused, even when the count is 8");
  const odd = checkChoice(proposals, [1, "p2", "p3", "p4", "p5", "p6", "p7", "p8"], 8);
  check(!odd.ok, "something that isn't an id is refused");
  check(!checkChoice(proposals, [], 8).ok, "choosing nothing is refused");
  const picks = aiPicks(shuffled, 8);
  check(picks.join() === "p1,p2,p3,p4,p5,p6,p7,p8", "“Let the AI pick for me” takes the AI's top 8, in its order", picks);
  check(aiPicks(proposals, 12).length === 12 && aiPicks(proposals, 16).length === 16, "and its top 12 or 16 for bigger shops");
}

// ---------------------------------------------------------------- waiting is not stuck

{
  const steps = (states) => Object.entries(states).map(([key, state]) => ({ key, state }));
  const cj = { source: "cj" };
  const waiting = steps({ concept: "done", products: "done", choose: "needs-you", check: "waiting", pages: "waiting" });
  check(stalledCjStep({ status: "choosing", brief: cj, progress: waiting, hasProducts: false }) === null, "a CJ shop waiting for its owner is not stuck");
  const mixed = steps({ concept: "done", products: "running", choose: "needs-you", check: "running", pages: "waiting" });
  check(
    stalledCjStep({ status: "building", brief: cj, progress: mixed, hasProducts: true }) === null &&
      stalledCjStep({ status: "building", brief: cj, progress: mixed, hasProducts: false }) === null,
    "a build with a step waiting on a person is never stuck, whatever else its steps say",
  );
  check(stalledCjStep({ status: "building", brief: cj, progress: steps({ concept: "done", products: "done", choose: "done", check: "running", pages: "waiting" }), hasProducts: true }) === "check", "a quiet shipping check is picked up again");
  check(stalledCjStep({ status: "building", brief: cj, progress: steps({ concept: "done", products: "running", choose: "waiting", check: "waiting", pages: "waiting" }), hasProducts: false }) === "search", "a quiet CJ search is picked up again");
  check(stalledCjStep({ status: "building", brief: cj, progress: steps({ concept: "done", products: "running", pages: "waiting" }), hasProducts: true }) === "check", "a build from before choosing existed still gets its shipping check");
  check(stalledCjStep({ status: "building", brief: { source: "practice" }, progress: steps({ products: "running" }), hasProducts: false }) === null, "practice shops have no CJ step to pick up");
  check(stalledCjStep({ status: "ready", brief: cj, progress: steps({ check: "running" }), hasProducts: true }) === null, "a finished shop is left alone");
}

// ---------------------------------------------------------------- the pipeline, read as text

{
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
  const src = strip(fs.readFileSync("lib/shops/pipeline.ts", "utf8"));
  const fn = (name) => {
    const at = src.search(new RegExp(`(async )?function ${name}\\b`));
    if (at < 0) return "";
    const next = src.slice(at + 10).search(/\n(export )?(async )?function |\nonJobFinished\(/);
    return next < 0 ? src.slice(at) : src.slice(at, at + 10 + next);
  };
  const sweep = fn("resumeStalledCjBuilds");
  check(/s\.status = 'building'/.test(sweep), "the stalled-build sweep only looks at shops still building");
  check(/not exists \(select 1 from jsonb_array_elements\(s\.progress\) p where p ->> 'state' = 'needs-you'\)/.test(sweep), "the sweep skips any build with a step waiting on a person");
  check(/stalledCjStep\(/.test(sweep), "the sweep asks stalledCjStep before resuming anything");
  const inserts = [...src.matchAll(/insert into armada\.products\b/g)].length;
  check(inserts === 1 && /insert into armada\.products\b/.test(fn("buildWithChosen")), "products are made in one place only: after the choice", inserts);
  const propose = fn("afterProducts");
  check(!/insert into/.test(propose) && /"choosing"/.test(propose) && /"needs-you"/.test(propose), "the products step saves proposals, waits as 'choosing', and makes nothing");
  check(/where id in \$\{tx\(ids\)\} and source = \$\{brief\.source\} and not branded/.test(propose), "the products step only looks up real, unbranded items from the shop's supplier");
  const choose = fn("chooseShopProducts");
  check(/for update/.test(choose) && /status !== "choosing"/.test(choose), "choosing locks the shop and only acts on a shop that is waiting");
  check(/checkChoice\(/.test(choose) && /aiPicks\(/.test(choose), "choosing checks the owner's picks, or takes the AI's top ones");
  const next = fn("buildWithChosen");
  check(/cjCheckChosen/.test(next) && /MIN_CJ_PRODUCTS/.test(next) && /shop\.pages/.test(next), "after choosing: CJ shops check shipping (at least 4 products), practice shops go to pages");
  check(/shop\.status !== "building"\) return/.test(src.slice(src.indexOf("onJobFinished("))), "an AI answer for a shop that isn't building (for example one waiting on its owner) is ignored");
  const actions = fs.readFileSync("app/(app)/builder/[id]/actions.ts", "utf8");
  check(/formData\.getAll\("pick"\)/.test(actions) && /\{ ai: true \}/.test(actions) && /role === "viewer"/.test(actions), "the page's actions pass the ticked cards, or the AI's pick, and refuse viewers");
  const migration = fs.readFileSync("supabase/migrations/0014_choose_products.sql", "utf8");
  check(/'building', 'choosing', 'ready'/.test(migration), "the database allows the 'choosing' status");
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
