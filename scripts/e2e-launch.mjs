// Browser test of Launch on the live site with a practice shop: build one (the AI helper on Davis's
// computer does the AI work), press Launch, and check each step lands where it should: the shop's
// own store, checkout waiting on payments, eBay saying practice items can't go on real eBay, practice
// Facebook and Instagram accounts made by themselves, the first week of posts written and scheduled
// on them, and the ads made and switched off. Pressing again changes nothing. Screenshots in light,
// dark and on a phone. Makes a throwaway workspace ("Launch check"); delete it afterwards.
//
// usage: node --env-file=.env.local scripts/e2e-launch.mjs https://armada-pi.vercel.app [--shop "idea"] [--watch]
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";
import puppeteer from "puppeteer-core";

const base = (process.argv[2] || "https://armada-pi.vercel.app").replace(/\/$/, "");
const idea = process.argv.includes("--shop") ? process.argv[process.argv.indexOf("--shop") + 1] : "Tea for slow evenings";
const WS = "Launch check";
const outDir = path.join(process.cwd(), ".shots", "launch");
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const invite = execFileSync(process.execPath, ["--env-file=.env.local", "scripts/make-invite.mjs", base, "2"], { encoding: "utf8" }).trim().split(/\r?\n/).at(-1);
const browser = await puppeteer.launch({ executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", headless: true, defaultViewport: { width: 1440, height: 900 } });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(`console: ${m.text()}`));
const cdp = await page.createCDPSession();
await cdp.send("WebAuthn.enable");
await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true } });
await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
const shot = (name, full = false) => page.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: full });
const stepOf = (v, key) => v?.steps?.find((s) => s.key === key);
const brief = (v) => v?.steps?.map((s) => `${s.key}:${s.state}`).join(" ") ?? "none";

try {
  await page.goto(invite, { waitUntil: "networkidle0" });
  await page.type('input[placeholder="Davis"]', "Launch check");
  await page.type('input[placeholder="My fleet"]', WS);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0", timeout: 60000 }), page.click('button[type="submit"]')]);

  // ---- a practice shop, built by the AI
  await page.goto(`${base}/builder/new`, { waitUntil: "networkidle0" });
  await page.type('input[name="niche"]', idea);
  await page.select('select[name="productCount"]', "8");
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click('button[type="submit"]')]);
  const shopUrl = page.url();
  const shopId = shopUrl.split("/").at(-1).split(/[?#]/)[0];
  console.log("building", shopId);
  const status = () => page.evaluate(async (id) => (await fetch(`/api/shops/${id}`, { cache: "no-store" })).json(), shopId).catch(() => null);
  const started = Date.now();
  let ready = false;
  while (Date.now() - started < 12 * 60_000) {
    await sleep(5000);
    const s = await status();
    if (!s) continue;
    if (s.status === "choosing") {
      // Let the AI pick, in one press.
      await page.goto(shopUrl, { waitUntil: "networkidle0" });
      await Promise.all([
        page.waitForNavigation({ waitUntil: "networkidle0", timeout: 120000 }),
        page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Let the AI pick")).click()),
      ]);
      console.log(`  ${Math.round((Date.now() - started) / 1000)}s the AI picked the products`);
      continue;
    }
    if (s.status === "ready") {
      ready = true;
      break;
    }
    if (s.status === "failed") {
      console.log("  the build stopped:", s.error);
      break;
    }
  }
  expect(ready, `the practice shop is built (${Math.round((Date.now() - started) / 1000)}s)`);
  if (!ready) throw new Error("no shop to launch");

  // ---- the press
  await page.goto(shopUrl, { waitUntil: "networkidle0" });
  const header = await page.$$eval("header button", (bs) => bs.map((b) => b.textContent.trim()));
  expect(header.includes("Launch"), "the ready shop's page has Launch as its main button", header);
  expect(/practice Facebook and Instagram accounts/.test(await page.evaluate(() => document.querySelector("#launch")?.innerText ?? "")), "before the press, the card says what a practice launch does");
  await shot("01-ready-before-launch");
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0", timeout: 60000 }),
    page.evaluate(() => [...document.querySelectorAll("#launch button")].find((b) => b.textContent.trim() === "Launch").click()),
  ]);
  expect(page.url().endsWith("#launch"), "Launch lands on the launch view", page.url());
  await sleep(4000);
  await page.evaluate(() => document.querySelector("#launch")?.scrollIntoView());
  await shot("02-launch-working");

  // ---- walk away: nobody watches the launch page, so only the helper's once-a-minute sweep carries
  // it on (the read below never moves it). --watch keeps the page open instead.
  if (!process.argv.includes("--watch")) await page.goto(`${base}/`, { waitUntil: "networkidle0" });
  let v = null;
  const end = Date.now() + 25 * 60_000;
  let last = "";
  while (Date.now() < end) {
    v = await page.evaluate(async (id) => (await fetch(`/api/shops/${id}/launch`, { cache: "no-store" })).json(), shopId).catch(() => null);
    const now = brief(v);
    if (now !== last) console.log(`  ${Math.round((Date.now() - started) / 1000)}s ${v?.status} · ${now}`);
    last = now;
    if (v?.status === "done") break;
    if (v && !v.steps.some((s) => s.state === "working") && v.status !== "working") break;
    await sleep(5000);
  }
  expect(v?.status === "done", process.argv.includes("--watch") ? "the whole launch finishes by itself" : "the whole launch finishes by itself with nobody on its page", brief(v));
  expect(stepOf(v, "store")?.state === "done", "the shop's own store is done");
  expect(stepOf(v, "checkout")?.state === "waiting" && stepOf(v, "checkout").note === "Switches on when payments are connected (Plan and billing).", "checkout waits on payments, in plain words", stepOf(v, "checkout"));
  const eb = stepOf(v, "ebay");
  expect(eb?.state === "skipped" && /practice items can't go on real eBay/.test(eb.note ?? ""), "eBay explains that practice items can't go on real eBay", eb);
  expect(stepOf(v, "facebook")?.state === "done" && /practice Facebook account/.test(stepOf(v, "facebook").note ?? ""), "a practice Facebook account is made by itself", stepOf(v, "facebook"));
  expect(stepOf(v, "instagram")?.state === "done" && /practice Instagram account/.test(stepOf(v, "instagram").note ?? ""), "a practice Instagram account is made by itself", stepOf(v, "instagram"));
  const posts = stepOf(v, "posts");
  expect(posts?.state === "done" && /scheduled on the practice/.test(posts.note ?? ""), "the first week of posts is written and scheduled on the practice accounts", posts);
  const ads = stepOf(v, "ads");
  expect(ads?.state === "done" && /switched off/.test(ads.note ?? ""), "the ads are made and switched off", ads);

  // ---- what's in the database
  const [db] = await system(
    (tx) => tx`
      select (select count(*)::int from armada.social_accounts where shop_id = ${shopId} and kind = 'practice') as practice_accounts,
             (select count(*)::int from armada.social_accounts where shop_id = ${shopId} and kind = 'real') as real_accounts,
             (select count(*)::int from armada.social_runs where shop_id = ${shopId} and kind = 'week') as week_runs,
             (select count(*)::int from armada.social_posts where shop_id = ${shopId} and status = 'scheduled') as scheduled,
             (select count(*)::int from armada.ad_sets where shop_id = ${shopId}) as ad_sets,
             (select string_agg(status, ',') from armada.ad_sets where shop_id = ${shopId}) as ad_status,
             (select count(*)::int from armada.listings l join armada.stores s on s.id = l.store_id where s.mode = 'live' and l.product_id in
                (select (p ->> 'productId')::uuid from armada.shops, jsonb_array_elements(blueprint -> 'products') p where id = ${shopId})) as live_listings,
             (select count(*)::int from armada.audit_log where detail ->> 'shopId' = ${shopId} and action like 'launch.%') as audit_rows`,
  );
  console.log("  database:", JSON.stringify(db));
  expect(db.practice_accounts === 3 && db.real_accounts === 0, "three practice accounts (Facebook, Instagram, Pinterest), no real ones", db);
  expect(db.week_runs === 1 && db.scheduled >= 1, "one week of posts, scheduled", db);
  expect(db.ad_sets === 1 && db.ad_status === "paused", "one ad set, switched off", db);
  expect(db.live_listings === 0, "nothing listed on any real marketplace", db);
  expect(db.audit_rows >= 4, "each step is in the audit log", db.audit_rows);

  // ---- pressing on changes nothing
  await page.evaluate((id) => Promise.all([1, 2, 3].map(() => fetch(`/api/shops/${id}/launch`, { method: "POST" }))), shopId);
  const [again] = await system(
    (tx) => tx`
      select (select count(*)::int from armada.social_runs where shop_id = ${shopId} and kind = 'week') as week_runs,
             (select count(*)::int from armada.ad_sets where shop_id = ${shopId}) as ad_sets,
             (select count(*)::int from armada.social_accounts where shop_id = ${shopId}) as accounts`,
  );
  expect(again.week_runs === 1 && again.ad_sets === 1 && again.accounts === 2, "more passes make nothing twice", again);

  // ---- how it looks (back on the shop's page, which the walk-away left)
  await page.goto(shopUrl, { waitUntil: "networkidle0" });
  await page.evaluate(() => document.querySelector("#launch")?.scrollIntoView());
  expect(/Launched\. Everything Armada can do for this shop is done\./.test(await page.evaluate(() => document.querySelector("#launch")?.innerText ?? "")), "the page says it's launched");
  await shot("03-launched-light");
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);
  await shot("04-launched-dark");
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.reload({ waitUntil: "networkidle0" });
  await page.evaluate(() => document.querySelector("#launch")?.scrollIntoView());
  expect(Boolean(await page.$("#launch")), "the phone check is looking at the launch");
  const phone = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    small: [...document.querySelectorAll("#launch a, #launch button")].filter((el) => el.getBoundingClientRect().height > 0 && el.getBoundingClientRect().height < 44).map((el) => el.textContent.trim()),
  }));
  expect(phone.overflow <= 0 && !phone.small.length, "on a phone: nothing sideways, every press 44 tall", phone);
  await shot("05-launched-phone");
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${base}/social?shop=${shopId}`, { waitUntil: "networkidle0" });
  await shot("06-posts-scheduled", true);
  await page.goto(`${base}/ads/${shopId}`, { waitUntil: "networkidle0" });
  await shot("07-ads-switched-off", true);
  await page.goto(`${base}/`, { waitUntil: "networkidle0" });
  expect(!/Launch|launch/.test((await page.evaluate(() => document.body.innerText)).split("Needs you")[1]?.slice(0, 300) ?? ""), "a finished launch asks nothing on Home");
  await shot("08-home");
} catch (err) {
  console.error("CHECK FAILED:", err.message);
  failed++;
  await shot("99-failure", true).catch(() => {});
} finally {
  console.log("browser errors:", errors.length ? errors.slice(0, 6).join(" | ") : "none");
  await browser.close();
  await sql.end();
  console.log(failed ? `${failed} failed` : "all passed");
  console.log(`workspace to delete: ${WS}`);
  process.exitCode = failed ? 1 : 0;
}
