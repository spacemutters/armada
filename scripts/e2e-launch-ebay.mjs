// Browser test of Launch on a real-supplier shop against the stand-ins (scripts/mock-pipedream.mjs,
// whose relay answers eBay's Inventory and Taxonomy calls through scripts/mock-ebay-listings.mjs):
// press Launch (twice, from two tabs), see each step land (the store, checkout waiting on payments,
// eBay waiting on one press to connect, Facebook and Instagram as one press each with the profile
// kit, posts waiting for an account, ads made and switched off), Home's Needs you, then connect eBay
// in one press and watch Launch finish the account's setup and list the real products for real
// (three listed, one eBay would need a detail its facts don't give, one naming a brand, one practice
// item left out), then undo it all from the change. Makes a throwaway workspace ("Launch eBay
// check") and a seeded CJ shop in it; delete the workspace afterwards.
//
// usage: node --env-file=.env.local scripts/e2e-launch-ebay.mjs http://localhost:3002 http://127.0.0.1:4610
//   with Armada built and started (next start -p 3002) with PIPEDREAM_API_BASE=<mock>,
//   PIPEDREAM_CLIENT_ID=mock-client, PIPEDREAM_CLIENT_SECRET=mock-secret, PIPEDREAM_PROJECT_ID=proj_Mock1,
//   APP_ORIGIN=<that address>, and the AI helper on (it writes the ads).
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";
import puppeteer from "puppeteer-core";

const base = (process.argv[2] || "http://localhost:3002").replace(/\/$/, "");
const mock = (process.argv[3] || "http://127.0.0.1:4610").replace(/\/$/, "");
const WS = "Launch eBay check";
const outDir = path.join(process.cwd(), ".shots", "launch-ebay");
fs.mkdirSync(outDir, { recursive: true });

const { SUPABASE_CA } = await import("../lib/db/supabase-ca.ts");
const sql = postgres(process.env.DATABASE_URL, {
  prepare: false,
  max: 1,
  host: process.env.DATABASE_HOSTADDR || undefined,
  ssl: { ca: SUPABASE_CA, servername: new URL(process.env.DATABASE_URL).hostname, rejectUnauthorized: true },
});
const system = (fn) => sql.begin(async (tx) => (await tx`select set_config('armada.system', 'on', true)`, fn(tx)));

let failed = 0;
const expect = (ok, what, detail) => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${what}${!ok && detail !== undefined ? ` (${typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 400)})` : ""}`);
};
const stats = async () => (await fetch(`${mock}/__stats`)).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- a real-supplier shop, seeded

const IMG = (slug) => `https://cdn.dummyjson.com/product-images/${slug}/1.webp`;
const PRODUCTS = [
  { key: "travel", title: "Black Aluminium Travel Mug, 12 oz", img: IMG("kitchen-accessories/black-aluminium-cup"), materials: ["Aluminium"], variant: "Black", cost: 520, ship: 410, collection: "mugs", bullets: ["Holds 12 oz", "Keeps coffee warm on the walk"] },
  { key: "glass", title: "Clear Glass Coffee Mug, 10 oz", img: IMG("kitchen-accessories/glass"), materials: ["Glass"], variant: "Clear", cost: 380, ship: 390, collection: "mugs", bullets: ["Heat-resistant glass", "Holds 10 oz"] },
  { key: "tree", title: "Wooden Mug Tree Stand", img: IMG("kitchen-accessories/mug-tree-stand"), materials: ["Wood"], variant: null, cost: 610, ship: 520, collection: "home", bullets: ["Holds six mugs"] },
  { key: "spatula", title: "Bamboo Spatula", img: IMG("kitchen-accessories/bamboo-spatula"), materials: ["Bamboo"], variant: null, cost: 180, ship: 260, collection: "home", bullets: ["Smooth bamboo", "Won't scratch pans"] },
  { key: "plate", title: "Corelle Style Dinner Plate", img: IMG("kitchen-accessories/plate"), materials: ["Glass"], variant: null, cost: 300, ship: 420, collection: "home", bullets: ["Dinner size"], branded: true },
  { key: "towel", title: "Linen Tea Towel", img: null, materials: [], variant: null, cost: 250, ship: 300, collection: "home", bullets: ["Linen"], imagined: true },
];

async function seedShop(workspaceId) {
  // Shop links are ten lowercase letters and digits, like the builder makes.
  const slug = `st${crypto.randomBytes(4).toString("hex")}`;
  return system(async (tx) => {
    const refs = [];
    for (const p of PRODUCTS) {
      const images = p.img ? [{ url: p.img, alt: p.title }] : [];
      const [c] = await tx`
        insert into armada.catalog_items (workspace_id, source, source_id, title, description, category, images, cost_cents, ship_cents, stock, branded, attributes)
        values (${workspaceId}, ${p.imagined ? "practice" : "cj"}, ${`seed-${slug}-${p.key}`}, ${p.title}, ${`${p.title}. ${p.bullets.join(". ")}.`}, 'Kitchen',
                ${tx.json(images)}, ${p.cost}, ${p.ship}, 200, ${Boolean(p.branded)},
                ${tx.json(p.imagined ? {} : { cj: { checked: true, materials: p.materials, variants: p.variant ? [{ key: p.variant }] : [] } })})
        returning id`;
      const [prod] = await tx`
        insert into armada.products (workspace_id, catalog_item_id, title, description, bullets, images, category, cost_cents, ship_cents, score, status)
        values (${workspaceId}, ${c.id}, ${p.title}, ${`${p.title}. ${p.bullets.join(". ")}.`}, ${tx.json(p.bullets)}, ${tx.json(images)}, 'Kitchen', ${p.cost}, ${p.ship}, 72, 'active')
        returning id`;
      const handle = p.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
      refs.push({ productId: prod.id, handle, collection: p.collection, priceCents: Math.ceil(((p.cost + p.ship) * 2.8) / 100) * 100 - 1, imagined: Boolean(p.imagined) });
    }
    const blueprint = {
      brand: { name: "Stillroom", alternativeNames: ["Kettle and Clay"], tagline: "Slow mornings, made at home.", voice: "Warm and plain", audience: "People who make their coffee by hand", monogramIcon: "coffee" },
      theme: { palette: { background: "#f7f4ef", surface: "#efe8dd", ink: "#1f1b16", muted: "#5b5248", accent: "#7a4a28", accentInk: "#ffffff" }, fonts: { display: "Fraunces", body: "Inter" }, contrastFixes: [] },
      hero: { headline: "Coffee, the slow way", subhead: "Mugs and tools for the first quiet cup of the day.", cta: "Shop the mugs" },
      valueProps: [
        { title: "Free delivery", body: "On every order." },
        { title: "30-day returns", body: "Change your mind? Send it back." },
        { title: "Chosen by hand", body: "Only what we'd use ourselves." },
      ],
      collections: [
        { handle: "mugs", title: "Mugs", description: "For the first cup.", keywords: ["mug"], productIds: refs.filter((r) => r.collection === "mugs").map((r) => r.productId) },
        { handle: "home", title: "Around the kitchen", description: "The rest of the ritual.", keywords: ["kitchen"], productIds: refs.filter((r) => r.collection === "home").map((r) => r.productId) },
      ],
      products: refs,
      pages: {
        about: "Stillroom sells a few good things for slow mornings.",
        faq: [{ question: "How long does delivery take?", answer: "About 7 to 14 business days." }],
        shipping: "Orders ship within 2 business days and arrive in 7 to 14.",
        contact: "Write to us any time.",
      },
      policies: { refund: "Returns within 30 days.", shipping: "Free delivery on every order." },
      announcement: "Free delivery on every order",
      footerBlurb: "A few good things for slow mornings.",
      seo: { title: "Stillroom", description: "Mugs and tools for slow mornings." },
      facts: { country: "United States", deliveryMin: 7, deliveryMax: 14, handlingDays: 2, returnDays: 30 },
    };
    const brief = { niche: "Slow coffee at home", audience: "", country: "United States", priceFeel: "mid", productCount: PRODUCTS.length, look: "", source: "cj" };
    const [shop] = await tx`
      insert into armada.shops (workspace_id, slug, status, niche, brief, blueprint, progress)
      values (${workspaceId}, ${slug}, 'ready', 'Slow coffee at home', ${tx.json(brief)}, ${tx.json(blueprint)}, '[]')
      returning id`;
    return { shopId: shop.id, slug, refs };
  });
}

// ---------------------------------------------------------------- the browser

const invite = execFileSync(process.execPath, ["--env-file=.env.local", "scripts/make-invite.mjs", base, "1"], { encoding: "utf8" }).trim().split(/\r?\n/).at(-1);
const browser = await puppeteer.launch({ executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", headless: true, defaultViewport: { width: 1440, height: 900 } });
const page = await browser.newPage();
const errors = [];
const watch = (p) => {
  p.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  p.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(`console: ${m.text()}`));
};
watch(page);
const cdp = await page.createCDPSession();
await cdp.send("WebAuthn.enable");
await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true } });
const shot = (p, name, full = true) => p.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: full });
const view = (shopId) => page.evaluate(async (id) => (await fetch(`/api/shops/${id}/launch`, { cache: "no-store" })).json(), shopId);
const stepOf = (v, key) => v?.steps?.find((s) => s.key === key);
const brief = (v) => v?.steps?.map((s) => `${s.key}:${s.state}`).join(" ") ?? "none";

try {
  await page.goto(invite, { waitUntil: "networkidle0" });
  await page.type('input[placeholder="Davis"]', "Launch check");
  await page.type('input[placeholder="My fleet"]', WS);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0", timeout: 60000 }), page.click('button[type="submit"]')]);
  const [ws] = await system((tx) => tx`select id from armada.workspaces where name = ${WS} order by created_at desc limit 1`);
  const { shopId, slug } = await seedShop(ws.id);
  console.log("seeded shop", shopId, slug);

  // ---- before the press (light first; dark is checked on its own below)
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
  await page.goto(`${base}/builder/${shopId}`, { waitUntil: "networkidle0" });
  await shot(page, "01-ready-shop", false);
  const buttons = await page.$$eval("button", (bs) => bs.map((b) => b.textContent.trim()));
  expect(buttons.filter((t) => t === "Launch").length >= 1, "the ready shop's page offers Launch", buttons);
  expect(/lists? .*eBay account|products listed on your eBay account/.test(await page.evaluate(() => document.body.innerText)), "the card says what one press does before it's pressed");

  // ---- pressed twice, from two tabs at once
  const page2 = await browser.newPage();
  watch(page2);
  await page2.goto(`${base}/builder/${shopId}`, { waitUntil: "networkidle0" });
  const press = (p) => p.evaluate(() => [...document.querySelectorAll("#launch button")].find((b) => b.textContent.trim() === "Launch").click());
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0", timeout: 60000 }), page2.waitForNavigation({ waitUntil: "networkidle0", timeout: 60000 }), press(page), press(page2)]);
  expect(page.url().endsWith("#launch"), "Launch lands on the launch view", page.url());
  await page2.close();
  const [{ n: rows }] = await system((tx) => tx`select count(*)::int as n from armada.shop_launches where shop_id = ${shopId}`);
  expect(rows === 1, "two presses make one launch");
  await shot(page, "02-launch-started", false);

  // ---- wait for everything that doesn't need a person (the ads need the AI helper)
  let v = null;
  const until = async (ok, ms, what) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      v = await view(shopId).catch(() => null);
      if (v && ok(v)) return true;
      await sleep(5000);
    }
    console.log(`  timed out waiting for ${what}: ${brief(v)}`);
    return false;
  };
  await until((x) => ["done", "failed"].includes(stepOf(x, "ads")?.state) && stepOf(x, "facebook")?.state === "needs-you", 9 * 60_000, "the ads and the social steps");
  console.log("  launch:", brief(v));
  expect(stepOf(v, "store")?.state === "done" && /\/s\//.test(stepOf(v, "store").note), "the shop's own store is done, with its address", stepOf(v, "store"));
  expect(stepOf(v, "checkout")?.state === "waiting" && stepOf(v, "checkout").note === "Switches on when payments are connected (Plan and billing).", "checkout waits on payments, in plain words", stepOf(v, "checkout"));
  const eb = stepOf(v, "ebay");
  expect(eb?.state === "needs-you" && eb.actions?.[0]?.href === "/api/connect/ebay/start?purpose=connect", "eBay is one press: Connect eBay", eb);
  const fb = stepOf(v, "facebook");
  expect(fb?.state === "needs-you" && fb.actions?.some((a) => a.href === "https://www.facebook.com/pages/creation/" && a.external) && fb.actions?.some((a) => a.href === `/api/connect/facebook_page/start?shop=${shopId}`), "Facebook: one press to Facebook's own Page maker, then Connect it", fb);
  const ig = stepOf(v, "instagram");
  expect(ig?.state === "needs-you" && ig.actions?.some((a) => a.href === "https://www.instagram.com/accounts/emailsignup/") && ig.actions?.some((a) => a.href === `/api/connect/instagram/start?shop=${shopId}`), "Instagram: one press to Instagram's own sign-up, then Connect it", ig);
  expect(v.kit?.name === "Stillroom" && v.kit.pageAbout.length <= 100 && v.kit.instagramBio.length <= 150 && /avatar\.png$/.test(v.kit.avatarUrl), "the profile kit rides with those steps", v.kit);
  expect(stepOf(v, "posts")?.state === "waiting" && /once Facebook or Instagram is connected/.test(stepOf(v, "posts").note), "posts wait for a real account", stepOf(v, "posts"));
  expect(stepOf(v, "ads")?.state === "done" && /switched off/.test(stepOf(v, "ads").note), "the ads are made and switched off", stepOf(v, "ads"));
  const [set] = await system((tx) => tx`select count(*)::int as n, max(status) as status from armada.ad_sets where shop_id = ${shopId}`);
  expect(set.n === 1 && set.status === "paused", "one ad set, paused", set);

  await page.reload({ waitUntil: "networkidle0" });
  await page.evaluate(() => document.querySelector("#launch")?.scrollIntoView());
  const pageText = await page.evaluate(() => document.querySelector("#launch")?.innerText ?? "");
  expect(/Make the Page on Facebook/.test(pageText) && /Connect it/.test(pageText) && /Page name/.test(pageText) && /Copy/.test(pageText) && /Download/.test(pageText), "the kit is on the page: copy and download, one tap each");
  const dl = await page.$eval('#launch a[download][href*="avatar.png"]', (a) => a.href).catch(() => null);
  const img = dl ? await fetch(dl) : null;
  expect(img?.ok && /image\/png/.test(img.headers.get("content-type") ?? ""), "the profile picture downloads", dl);
  await shot(page, "03-needs-you-desktop");
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);
  await shot(page, "04-needs-you-dark");
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.reload({ waitUntil: "networkidle0" });
  const phone = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    small: [...document.querySelectorAll("#launch a, #launch button")].filter((el) => el.getBoundingClientRect().height > 0 && el.getBoundingClientRect().height < 44).map((el) => el.textContent.trim()).slice(0, 5),
  }));
  expect(phone.overflow <= 0, "nothing wider than a phone", phone.overflow);
  expect(!phone.small.length, "every press on the launch is at least 44 tall on a phone", phone.small);
  await page.evaluate(() => document.querySelector("#launch")?.scrollIntoView());
  await shot(page, "05-needs-you-phone", false);
  await page.evaluate(() => window.scrollBy(0, 700));
  await shot(page, "05b-needs-you-phone-kit", false);
  await page.setViewport({ width: 1440, height: 900 });

  // ---- Home
  await page.goto(`${base}/`, { waitUntil: "networkidle0" });
  const home = await page.evaluate(() => document.body.innerText);
  expect(/Needs you/.test(home) && /Stillroom: (Connect eBay|Make its Facebook Page)/.test(home), "Home's Needs you lists the launch's one press", home.slice(0, 300));
  await shot(page, "06-home-needs-you");

  // ---- eBay in one press; Launch runs the setup and lists
  const before = await stats();
  await page.goto(`${base}/api/connect/ebay/start?purpose=connect`, { waitUntil: "networkidle0" });
  console.log("  after connecting eBay:", page.url().replace(base, ""));
  await page.goto(`${base}/builder/${shopId}#launch`, { waitUntil: "networkidle0" });
  await until((x) => ["done", "skipped", "failed"].includes(stepOf(x, "ebay")?.state), 4 * 60_000, "the eBay listings");
  const e = stepOf(v, "ebay");
  console.log("  eBay:", e?.state, "·", e?.note);
  expect(e?.state === "done" && /^3 listed on /.test(e.note ?? ""), "three real products are listed on eBay", e);
  const s = await stats();
  const live = s.ebayListings.live;
  expect(live.length === 3, "the stand-in has three live listings", live.map((l) => l.title));
  expect(live.every((l) => l.aspects?.Brand?.[0] === "Unbranded" && l.aspects?.Type?.length === 1), "each has Brand Unbranded and a Type from its own title", live.map((l) => l.aspects));
  expect(live.every((l) => l.policies?.paymentPolicyId && l.policies?.returnPolicyId && l.policies?.fulfillmentPolicyId && l.location === "armada-default"), "each uses the account's own policies and ship-from place");
  expect(live.every((l) => l.quantity === 2 && Number(l.price?.value) > 0 && l.price?.currency === "USD"), "each has a small quantity and a price", live.map((l) => [l.quantity, l.price]));
  expect(!live.some((l) => /Tree|Plate|Towel/.test(l.title)), "the one eBay needs more about, the branded one and the practice item never reached eBay", live.map((l) => l.title));
  expect(s.ebayListings.contentLanguageMissing === 0 && !s.ebayListings.refused.length, "eBay never refused a call (every call carried what eBay requires)", s.ebayListings.refused);
  expect(s.leakedKeys === 0 && s.badTargets.length === 0, "no key of Armada's went through the relay, and every target was allowed");
  const change = /\/changes\/([0-9a-f-]{36})/.exec(JSON.stringify(e.actions))?.[1];
  const items = await system((tx) => tx`select status, error from armada.change_items where change_set_id = ${change}`);
  expect(items.some((i) => i.status === "failed" && /eBay asks for its Type in Mugs, and the supplier's details don't say/.test(i.error ?? "")), "the mug stand is refused in plain words, not guessed", items);
  const [cs] = await system((tx) => tx`select status, params from armada.change_sets where id = ${change}`);
  expect(cs.params.skipped.some((x) => /brand/.test(x.reason)), "the branded product is left out by the listing rules", cs.params.skipped);
  expect(cs.params.skipped.some((x) => /Practice items can't go on real eBay/.test(x.reason)), "the practice item is left out, and the change says why", cs.params.skipped);
  const [{ n: listed }] = await system((tx) => tx`select count(*)::int as n from armada.listings l join armada.stores s on s.id = l.store_id where s.workspace_id = ${ws.id} and s.platform = 'ebay' and s.mode = 'live' and l.external_id is not null`);
  expect(listed === 3, "Armada records the three listings with eBay's listing ids", listed);
  await page.evaluate(() => document.querySelector("#launch")?.scrollIntoView());
  await shot(page, "07-ebay-listed");

  // ---- pressing on: more passes change nothing
  const publishBefore = s.ebayListings.publishCalls;
  await page.evaluate((id) => Promise.all([1, 2, 3, 4].map(() => fetch(`/api/shops/${id}/launch`, { method: "POST" }))), shopId);
  const s2 = await stats();
  expect(s2.ebayListings.offers === s.ebayListings.offers && s2.ebayListings.publishCalls === publishBefore, "four more passes at once list nothing twice", [s.ebayListings.offers, s2.ebayListings.offers, publishBefore, s2.ebayListings.publishCalls]);

  // ---- undo from the change
  await page.goto(`${base}/changes/${change}`, { waitUntil: "networkidle0" });
  await shot(page, "08-change");
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0", timeout: 120000 }),
    page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Undo this change")).click()),
  ]);
  const s3 = await stats();
  expect(s3.ebayListings.live.length === 0 && s3.ebayListings.ended >= 3 && s3.ebayListings.items === 0, "undo takes every listing down on eBay and removes the items", { live: s3.ebayListings.live.length, ended: s3.ebayListings.ended, items: s3.ebayListings.items });
  const [{ n: left }] = await system((tx) => tx`select count(*)::int as n from armada.listings l join armada.stores s on s.id = l.store_id where s.workspace_id = ${ws.id} and s.platform = 'ebay'`);
  expect(left === 0, "and out of Armada", left);
  await shot(page, "09-undone");
  void before;
} catch (err) {
  console.error("CHECK FAILED:", err.message);
  failed++;
  await shot(page, "99-failure").catch(() => {});
} finally {
  console.log("browser errors:", errors.length ? errors.slice(0, 6).join(" | ") : "none");
  await browser.close();
  await sql.end();
  console.log(failed ? `${failed} failed` : "all passed");
  console.log(`workspace to delete: ${WS}`);
  process.exitCode = failed ? 1 : 0;
}
