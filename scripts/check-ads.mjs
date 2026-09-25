// Offline checks for one-press AI ads. No database, no network, no ad account.
//
//   node scripts/check-ads.mjs
//
// 1. The practice simulator: its numbers are sane (spend never passes the cap, every step of the
//    funnel is no bigger than the one before, rates land where the model says), repeatable, and
//    labelled as practice everywhere.
// 2. Every payload Armada would send Meta to create something is PAUSED, and nothing else in the
//    Meta connector can switch an ad on except switchOn(), which only a person's press reaches.
// 3. The "ads.write" answer shape: a sample answer passes the JSON schema (checked by an independent
//    validator here, and by ajv when it's installed), broken answers fail it, and the tidy-up step
//    maps products back, drops invented ones and keeps every number in bounds.
//
// Prints one PASS/FAIL line per check and exits 1 on any FAIL.
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;
function report(ok, label, detail) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? ` (${detail})` : ""}`);
}

let sim, payloads, schema;
try {
  sim = await import("../lib/ads/simulator.ts");
  payloads = await import("../connectors/meta-ads/payloads.ts");
  schema = await import("../lib/ads/schema.ts");
} catch (e) {
  console.log(`FAIL couldn't load the ads code: ${e.message}`);
  process.exit(1);
}

// =====================================================================================
// 1. Practice simulator
// =====================================================================================
{
  const { simulateDay, practiceStrengths, practiceDaysDue, PRACTICE_MODEL: M, PRACTICE_LABEL, PRACTICE_MODEL_LINES, hashSeed } = sim;

  /** Runs a whole practice set the way lib/ads/sets.ts syncPractice does. */
  function runSet({ seed, days, dailyCents, capCents = dailyCents * days, ads = 4, avgOrderCents = 3500 }) {
    const strengths = practiceStrengths(seed, ads);
    const list = strengths.map((strength, i) => ({ id: `ad${i}`, strength }));
    let spent = 0;
    const byDay = [];
    for (let d = 1; d <= days; d++) {
      const rows = simulateDay({ seed, dayIndex: d, totalDays: days, dailyBudgetCents: dailyCents, capCents, spentSoFarCents: spent, avgOrderCents, ads: list });
      spent += rows.reduce((s, r) => s + r.spendCents, 0);
      byDay.push(rows);
      if (spent >= capCents) break;
    }
    return { byDay, rows: byDay.flat(), spent, strengths, list };
  }
  const sum = (rows, k) => rows.reduce((s, r) => s + r[k], 0);

  const a = runSet({ seed: "set-a", days: 7, dailyCents: 1000 });
  report(a.spent <= 7000, "practice spend never passes the cap", `$${(a.spent / 100).toFixed(2)} of $70`);
  report(a.spent >= 7000 * 0.85, "practice spend uses most of the budget", `$${(a.spent / 100).toFixed(2)} of $70`);
  report(a.rows.every((r) => r.practice === true), "every practice row is marked practice");
  const ints = ["impressions", "reach", "clicks", "addToCarts", "purchases", "spendCents", "salesCents"];
  report(a.rows.every((r) => ints.every((k) => Number.isInteger(r[k]) && r[k] >= 0)), "every practice number is a whole number, zero or more");
  report(
    a.rows.every((r) => r.reach <= r.impressions && r.clicks <= r.impressions && r.addToCarts <= r.clicks && r.purchases <= r.addToCarts),
    "each funnel step is no bigger than the one before (shown ≥ reached, shown ≥ visits ≥ added ≥ sales)",
  );
  report(a.rows.every((r) => r.salesCents === r.purchases * 3500), "money in is sales × the shop's average price");

  // Rates, over many sets so the wobble averages out.
  let imp = 0, clk = 0, spend = 0, atc = 0, buy = 0, reach = 0;
  for (let i = 0; i < 300; i++) {
    const r = runSet({ seed: `many-${i}`, days: 7, dailyCents: 2000 }).rows;
    imp += sum(r, "impressions");
    clk += sum(r, "clicks");
    spend += sum(r, "spendCents");
    atc += sum(r, "addToCarts");
    buy += sum(r, "purchases");
    reach += sum(r, "reach");
  }
  const cpm = (spend / imp) * 1000;
  report(Math.abs(cpm - M.costPerThousandCents) / M.costPerThousandCents < 0.06, "cost per 1,000 views matches the stated model", `$${(cpm / 100).toFixed(2)} vs $${(M.costPerThousandCents / 100).toFixed(2)}`);
  const ctr = clk / imp;
  // Strength averages 1; the first two of seven days run at the learning factor.
  const expectedCtr = M.clickRate * ((M.learningDays * M.learningFactor + (7 - M.learningDays)) / 7);
  report(ctr > 0.004 && ctr < 0.025, "visit rate is in the range small shops see (0.4% to 2.5%)", `${(ctr * 100).toFixed(2)}%`);
  report(Math.abs(ctr - expectedCtr) / expectedCtr < 0.15, "visit rate matches the stated model", `${(ctr * 100).toFixed(2)}% vs ${(expectedCtr * 100).toFixed(2)}%`);
  const addRate = atc / clk;
  report(Math.abs(addRate - M.addToBagRate) / M.addToBagRate < 0.1, "add-to-bag rate matches the stated model", `${(addRate * 100).toFixed(1)}%`);
  const buyRate = buy / clk;
  const expectedBuy = M.addToBagRate * M.buyOfAdders;
  report(Math.abs(buyRate - expectedBuy) / expectedBuy < 0.15, "buy rate matches the stated model", `${(buyRate * 100).toFixed(2)}% of visits vs ${(expectedBuy * 100).toFixed(2)}%`);
  const costPerSale = spend / Math.max(1, buy);
  report(costPerSale > 1500 && costPerSale < 15000, "cost per sale is believable for cold traffic ($15 to $150)", `$${(costPerSale / 100).toFixed(2)}`);
  report(reach <= imp && reach > imp / 3, "people reached is fewer than times shown, but not wildly fewer", `${reach} reached, ${imp} shown`);

  // Repeatable, but not the same for every set.
  const again = runSet({ seed: "set-a", days: 7, dailyCents: 1000 });
  report(JSON.stringify(again.rows) === JSON.stringify(a.rows), "the same set always gets the same practice numbers");
  const other = runSet({ seed: "set-b", days: 7, dailyCents: 1000 });
  report(JSON.stringify(other.rows) !== JSON.stringify(a.rows), "different sets get different practice numbers");

  // A low cap stops spending early.
  const capped = runSet({ seed: "set-c", days: 7, dailyCents: 1000, capCents: 2500 });
  report(capped.spent <= 2500 && capped.byDay.length <= 3, "a lower cap stops practice spending early", `$${(capped.spent / 100).toFixed(2)} over ${capped.byDay.length} days`);
  const lastDay = simulateDay({ seed: "x", dayIndex: 1, totalDays: 7, dailyBudgetCents: 1000, capCents: 7000, spentSoFarCents: 7000, avgOrderCents: 3000, ads: [{ id: "a", strength: 1 }] });
  report(lastDay.every((r) => r.spendCents === 0 && r.impressions === 0), "nothing is spent once the cap is reached");

  // Budget leans to the stronger ads as days pass.
  const strong = a.list.reduce((x, y) => (y.strength > x.strength ? y : x));
  const weak = a.list.reduce((x, y) => (y.strength < x.strength ? y : x));
  const share = (rows, id) => rows.find((r) => r.variationId === id).spendCents / Math.max(1, sum(rows, "spendCents"));
  report(share(a.byDay.at(-1), strong.id) > share(a.byDay[0], strong.id) && share(a.byDay.at(-1), weak.id) < share(a.byDay[0], weak.id), "more of the budget goes to the ad that pulls best as days pass");

  const s = practiceStrengths("set-a", 50);
  report(s.every((x) => x >= M.strength[0] && x <= M.strength[1]), "each ad's made-up pull stays between 0.7 and 1.3");
  report(hashSeed("abc") === hashSeed("abc") && hashSeed("abc") !== hashSeed("abd"), "seeds are stable and distinct");

  // The practice clock.
  const now = Date.parse("2026-09-24T12:00:00Z");
  report(practiceDaysDue(null, now, 0, 7) === 0, "the practice clock runs nothing while switched off");
  report(practiceDaysDue(new Date(now - 3.5 * 60_000), now, 0, 7) === 3, "the practice clock runs one day per minute", `${practiceDaysDue(new Date(now - 3.5 * 60_000), now, 0, 7)} days after 3.5 minutes`);
  report(practiceDaysDue(new Date(now - 60 * 60_000), now, 0, 7) === 7, "the practice clock never runs past the last day");

  // Labelled, and the words match the numbers.
  report(/practice/i.test(PRACTICE_LABEL) && /made-up/i.test(PRACTICE_LABEL) && /not real/i.test(PRACTICE_LABEL), "the practice label says practice, made up, not real", PRACTICE_LABEL);
  const words = PRACTICE_MODEL_LINES.join(" ");
  report(
    words.includes(`$${(M.costPerThousandCents / 100).toFixed(0)}`) && words.includes(`${(M.clickRate * 100).toFixed(1)}%`) && words.includes(`${Math.round(M.addToBagRate * 100)}%`),
    "the model explained on screen uses the model's own numbers",
  );
}

// =====================================================================================
// 2. Everything Armada asks Meta to create is PAUSED
// =====================================================================================
{
  const { campaignPayload, adSetPayload, creativePayload, adPayload, budgetPayload, META_STATUS_PAUSED } = payloads;
  const plan = {
    name: "Armada · Test shop · Sep 24",
    countries: ["US"],
    ageMin: 25,
    ageMax: 54,
    interests: [{ id: "6003", name: "Home cooking" }],
    lifetimeBudgetMinor: 7000,
    startTime: new Date("2026-09-24T12:00:00Z"),
    endTime: new Date("2026-10-01T12:00:00Z"),
    pageId: "123",
    instagramUserId: "456",
  };
  const single = {
    variationId: "11111111-2222-3333-4444-555555555555",
    format: "single",
    primaryText: "A linen throw for cool evenings on the porch.",
    headline: "Stonewashed linen throw",
    description: "Ships in 7-12 days",
    callToAction: "SHOP_NOW",
    link: "https://shop.example/products/linen-throw",
    imageHash: "hash-1",
    cards: [],
  };
  const carousel = {
    ...single,
    variationId: "99999999-2222-3333-4444-555555555555",
    format: "carousel",
    link: "https://shop.example",
    imageHash: undefined,
    cards: [1, 2, 3].map((i) => ({ link: `https://shop.example/products/p${i}`, headline: `Card ${i}`, description: `$${i}0.00`, imageHash: `hash-${i}` })),
  };

  const campaign = campaignPayload(plan);
  const adSet = adSetPayload(plan, "c1");
  const ads = [single, carousel].map((ad) => adPayload(plan, ad, "s1", "cr1"));
  const creatives = [single, carousel].map((ad) => creativePayload(plan, ad));
  const creates = [
    ["campaign", campaign],
    ["ad set", adSet],
    ...ads.map((p, i) => [`ad ${i + 1}`, p]),
  ];

  report(META_STATUS_PAUSED === "PAUSED", "Meta's paused status is spelled the way Meta expects");
  for (const [what, p] of creates) report(p.status === "PAUSED", `the ${what} is created PAUSED`, `status ${JSON.stringify(p.status)}`);
  report(creatives.every((c) => !("status" in c)), "ad creatives carry no on/off status of their own");
  const everything = JSON.stringify([campaign, adSet, ...ads, ...creatives, budgetPayload(9000, new Date())]);
  report(!/ACTIVE|ENABLE/.test(everything), "no create or budget payload anywhere says ACTIVE or ENABLE");
  report(!("status" in budgetPayload(9000, new Date())), "a budget change never touches on/off");

  report(campaign.objective === "OUTCOME_TRAFFIC" && adSet.optimization_goal === "LINK_CLICKS" && adSet.billing_event === "IMPRESSIONS", "traffic campaigns pair with link-click optimisation, as Meta requires");
  report(Array.isArray(campaign.special_ad_categories) && campaign.is_adset_budget_sharing_enabled === false, "campaigns state their special ad categories and budget sharing (required since v24.0)");
  report(adSet.lifetime_budget === 7000 && adSet.end_time && adSet.start_time, "the ad set's lifetime budget is the hard spending cap, with an end date");
  report(adSet.targeting.targeting_automation?.advantage_audience === 0 && adSet.targeting.geo_locations.countries[0] === "US", "targeting states the audience explicitly");
  const cs = creatives[1].object_story_spec;
  report(
    cs.link_data.child_attachments.length === 3 && cs.link_data.child_attachments.every((c) => c.link && c.name && c.image_hash && c.call_to_action?.value?.link === c.link),
    "a carousel sends one card per product, each with its own link, headline and photo",
  );
  report(cs.page_id === "123" && cs.instagram_user_id === "456", "creatives name the Facebook Page and the Instagram account");
  report(creatives[0].object_story_spec.link_data.image_hash === "hash-1" && !creatives[0].object_story_spec.link_data.child_attachments, "a single-photo ad sends one photo and no cards");

  // The connector itself: only payload builders reach create(), create() refuses anything not paused,
  // and the one "on" word lives inside switchOn().
  const dir = path.join(ROOT, "connectors", "meta-ads");
  const read = (f) => fs.readFileSync(path.join(dir, f), "utf8");
  const index = read("index.ts");
  const client = read("client.ts");
  const createCalls = [...index.matchAll(/\bcreate\(token, [^,]+, "(\w+)", (\w+)\(/g)];
  const allCreates = (index.match(/\bcreate\(/g) ?? []).length;
  report(
    createCalls.length === allCreates && createCalls.length === 4 && createCalls.every((m) => /^(campaign|adSet|creative|ad)Payload$/.test(m[2])),
    "every create call in the Meta connector uses a payload builder",
    createCalls.map((m) => `${m[1]}←${m[2]}`).join(", "),
  );
  report(/edge !== "adcreatives" && payload\.status !== META_STATUS_PAUSED\)\s*\{\s*[^}]*throw/.test(client), "create() refuses to send anything that isn't paused");
  const onWords = [...fs.readdirSync(dir)].flatMap((f) => (fs.readFileSync(path.join(dir, f), "utf8").match(/["'`]ACTIVE["'`]/g) ?? []).map(() => f));
  report(onWords.length === 1 && onWords[0] === "client.ts", "Meta's word for 'on' appears exactly once in the connector", onWords.join(", "));
  const uses = [...client.matchAll(/\bSWITCHED_ON\b/g)].map((m) => m.index);
  const fnStart = client.indexOf("export async function switchOn(");
  const fnEnd = client.indexOf("\n}\n", fnStart);
  report(uses.length >= 2 && uses.slice(1).every((i) => i > fnStart && i < fnEnd), "it is used only inside switchOn()");
  const actions = fs.readFileSync(path.join(ROOT, "app", "(app)", "ads", "actions.ts"), "utf8");
  const libSets = fs.readFileSync(path.join(ROOT, "lib", "ads", "sets.ts"), "utf8");
  report(/export async function switchOnAction[\s\S]{0,200}await spender\(\)/.test(actions), "switching on needs a press by the owner or a manager");
  report(!/switchOn\(/.test(fs.readFileSync(path.join(ROOT, "lib", "ads", "jobs.ts"), "utf8")) && !/\.switchOn\(/.test(libSets.replace(/export async function switchOn[\s\S]*?\n}\n/, "")), "nothing but the Switch on press calls a platform's switchOn");
  for (const stub of ["google-ads", "tiktok-ads"]) {
    const t = fs.readFileSync(path.join(ROOT, "connectors", stub, "index.ts"), "utf8");
    report(!/fetch\(/.test(t) && /coming soon/i.test(t), `the ${stub.replace("-ads", "")} stub never calls out and says coming soon`);
  }
}

// =====================================================================================
// 3. The "ads.write" answer shape
// =====================================================================================
{
  const { adsWriteSchema, adRewriteSchema, adItemSchema, toDrafts, toOneDraft, LIMITS, BUDGET, CTAS } = schema;

  /** A small, independent JSON Schema checker for the keywords the ads schema uses. */
  function validate(s, v, at = "answer") {
    const errs = [];
    const type = (x) => (Array.isArray(x) ? "array" : x === null ? "null" : Number.isInteger(x) ? "integer" : typeof x);
    const t = type(v);
    if (s.type && !(s.type === t || (s.type === "number" && t === "integer"))) return [`${at}: expected ${s.type}, got ${t}`];
    if (s.enum && !s.enum.includes(v)) errs.push(`${at}: ${JSON.stringify(v)} is not one of ${s.enum.join(", ")}`);
    if (s.type === "object") {
      for (const k of s.required ?? []) if (!(k in v)) errs.push(`${at}: missing ${k}`);
      for (const k of Object.keys(v)) {
        if (s.properties?.[k]) errs.push(...validate(s.properties[k], v[k], `${at}.${k}`));
        else if (s.additionalProperties === false) errs.push(`${at}: unexpected ${k}`);
      }
    }
    if (s.type === "array") {
      if (s.minItems != null && v.length < s.minItems) errs.push(`${at}: fewer than ${s.minItems} items`);
      if (s.maxItems != null && v.length > s.maxItems) errs.push(`${at}: more than ${s.maxItems} items`);
      v.forEach((x, i) => errs.push(...validate(s.items, x, `${at}[${i}]`)));
    }
    return errs;
  }

  const sample = {
    plan: "Four calm ads for a small linen shop: one standout throw, two carousels of sets, and one for slow weekend mornings.",
    audience: { description: "People furnishing a calm home who like natural materials.", ageMin: 25, ageMax: 54, interests: ["interior design", "linen", "slow living"] },
    budget: { dailyAmount: 15, days: 7, reasoning: "At $15 a day for a week, each ad gets enough views to show which one brings visits. Products cost $30 to $90, so one sale covers a good part of it." },
    ads: [
      { idea: "One standout product and what it does", format: "single", primaryText: "A stonewashed linen throw that softens with every wash.", headline: "Stonewashed linen throw", description: "Returns within 30 days", callToAction: "SHOP_NOW", products: ["p1"], cards: [] },
      {
        idea: "A small set that belongs together",
        format: "carousel",
        primaryText: "Three pieces for a quieter bedroom.",
        headline: "The bedroom set",
        description: "",
        callToAction: "SHOP_NOW",
        products: ["p1", "p2", "p3"],
        cards: [
          { product: "p1", headline: "Linen throw", description: "$64.00" },
          { product: "p2", headline: "Waffle pillowcase", description: "$28.00" },
          { product: "p3", headline: "Oak bedside tray", description: "$42.00" },
        ],
      },
      {
        idea: "A carousel that loses its made-up products",
        format: "carousel",
        primaryText: "Things for slow mornings.",
        headline: "Slow mornings",
        description: "",
        callToAction: "LEARN_MORE",
        products: ["p2", "p9"],
        cards: [
          { product: "p2", headline: "Waffle pillowcase", description: "$28.00" },
          { product: "p9", headline: "Invented item", description: "$1.00" },
        ],
      },
      { idea: "Who it's for", format: "single", primaryText: "x".repeat(400), headline: "y".repeat(80), description: "z".repeat(60), callToAction: "ORDER_NOW", products: ["p3"], cards: [] },
    ],
  };

  const errs = validate(adsWriteSchema, sample);
  report(errs.length === 0, "a sample answer passes the ads.write schema", errs.slice(0, 3).join("; "));
  report(validate(adRewriteSchema, { ad: sample.ads[1] }).length === 0, "a sample single-ad answer passes the write-again schema");

  const bad = [
    ["too few ads", { ...sample, ads: sample.ads.slice(0, 2) }],
    ["an unknown button", { ...sample, ads: [{ ...sample.ads[0], callToAction: "BUY_NOW_50_OFF" }, ...sample.ads.slice(1)] }],
    ["an extra field", { ...sample, discount: "20%" }],
    ["a missing budget", { ...sample, budget: undefined }],
    ["a carousel with 11 cards", { ...sample, ads: [{ ...sample.ads[1], cards: Array(11).fill(sample.ads[1].cards[0]) }, ...sample.ads.slice(1)] }],
  ];
  for (const [what, v] of bad) report(validate(adsWriteSchema, JSON.parse(JSON.stringify(v))).length > 0, `the schema refuses an answer with ${what}`);

  // Strict answer shapes (what structured-output engines need): every object lists all its fields as required and allows no others.
  const loose = [];
  (function walk(s, at) {
    if (s.type === "object") {
      const keys = Object.keys(s.properties ?? {});
      if (s.additionalProperties !== false || keys.some((k) => !(s.required ?? []).includes(k))) loose.push(at);
      for (const k of keys) walk(s.properties[k], `${at}.${k}`);
    }
    if (s.type === "array") walk(s.items, `${at}[]`);
  })(adsWriteSchema, "answer");
  report(loose.length === 0, "every object in the schema is strict (all fields required, no extras)", loose.join(", "));
  report(adItemSchema.properties.callToAction.enum.join() === CTAS.join(), "the buttons the AI may choose are the ones the database accepts");

  // Optional second opinion from ajv, when it happens to be installed.
  try {
    const Ajv = createRequire(import.meta.url)("ajv");
    const ajv = new Ajv({ allErrors: true });
    const ok = ajv.validate(adsWriteSchema, sample);
    const refused = !ajv.validate(adsWriteSchema, { ...sample, ads: sample.ads.slice(0, 2) });
    report(ok && refused, "ajv agrees: the sample passes and a broken answer fails", ok ? "" : ajv.errorsText());
  } catch {
    console.log("skip ajv isn't installed; the built-in checker above covers the schema");
  }

  // Tidying the answer.
  const refs = ["id-1", "id-2", "id-3", "id-4"];
  const photoless = new Set(["id-4"]);
  const d = toDrafts(sample, refs, (id) => !photoless.has(id));
  report(d && d.ads.length === 4, "all four sample ads come through", d ? `${d.ads.length}` : "no draft");
  report(d.ads[0].productIds.join() === "id-1" && d.ads[1].cards.map((c) => c.productId).join() === "id-1,id-2,id-3", "p1, p2 … map back to the shop's product ids in order");
  report(d.ads[2].format === "single" && d.ads[2].productIds.join() === "id-2" && d.ads[2].cards.length === 0, "an invented product is dropped, and a carousel left with one card becomes a single-photo ad");
  report(d.ads[3].primaryText.length <= LIMITS.primaryText && d.ads[3].headline.length <= LIMITS.headline && d.ads[3].description.length <= LIMITS.description, "words are clipped to what the platforms show");
  report(d.dailyBudgetCents === 1500 && d.days === 7 && d.audience.ageMin === 25 && d.audience.ageMax === 54, "the budget and ages come through as written when in bounds");
  const wild = toDrafts({ ...sample, budget: { dailyAmount: 5000, days: 400, reasoning: "x" }, audience: { ...sample.audience, ageMin: 3, ageMax: 120 } }, refs);
  report(wild.dailyBudgetCents === BUDGET.maxDaily * 100 && wild.days === BUDGET.maxDays && wild.audience.ageMin === 18 && wild.audience.ageMax === 65, "an out-of-bounds budget, length or age is pulled back in", `$${wild.dailyBudgetCents / 100} × ${wild.days} days, ages ${wild.audience.ageMin}-${wild.audience.ageMax}`);
  const onlyPhotoless = toDrafts({ ...sample, ads: [{ ...sample.ads[0], products: ["p4"] }] }, refs, (id) => !photoless.has(id));
  report(onlyPhotoless === null, "for real ads, products without a photo can't be used");
  report(toDrafts({ nonsense: true }, refs) === null && toDrafts(null, refs) === null, "an answer in the wrong shape gives nothing, not a half-made ad");
  const one = toOneDraft({ ad: sample.ads[1] }, refs);
  report(one && one.format === "carousel" && one.cards.length === 3, "a written-again ad comes through the same way");
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall ads checks pass");
process.exit(failures ? 1 : 0);
