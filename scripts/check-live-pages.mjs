// Walks the signed-in pages added lately on a live Armada and checks each one really works:
// Connections, Plan and billing, opening a practice store in one press, the store's icon (chosen,
// then made by the AI helper), the fleet map showing it, the privacy page, and that a non-admin
// can't open Admin. Makes a throwaway workspace ("Pages check"); delete it afterwards.
// usage: node --env-file=.env.local scripts/check-live-pages.mjs https://armada-pi.vercel.app
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const base = (process.argv[2] || "https://armada-pi.vercel.app").replace(/\/$/, "");
const outDir = path.join(process.cwd(), ".shots", "pages");
fs.mkdirSync(outDir, { recursive: true });
const invite = execFileSync(process.execPath, ["--env-file=.env.local", "scripts/make-invite.mjs", base, "1"], { encoding: "utf8" }).trim().split(/\r?\n/).at(-1);

const browser = await puppeteer.launch({
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: true,
  defaultViewport: { width: 1440, height: 900 },
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(`console: ${m.text()}`));
const cdp = await page.createCDPSession();
await cdp.send("WebAuthn.enable");
await cdp.send("WebAuthn.addVirtualAuthenticator", {
  options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true },
});
const text = () => page.evaluate(() => document.body.innerText);
const shot = (name) => page.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const expect = (ok, what) => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${what}`);
};
const broken = (t) => /Application error|Internal Server Error|This page could not be found|Nothing here/i.test(t);
const visit = async (p, name, mustSay) => {
  const res = await page.goto(base + p, { waitUntil: "networkidle0", timeout: 60000 });
  const t = await text();
  await shot(name);
  expect(res.status() < 400 && !broken(t) && (!mustSay || mustSay.test(t)), `${p} opens (${res.status()})${mustSay ? ` and says ${mustSay}` : ""}`);
  return t;
};

try {
  await page.goto(invite, { waitUntil: "networkidle0" });
  await page.type('input[placeholder="Davis"]', "Pages check");
  await page.type('input[placeholder="My fleet"]', "Pages check");
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0", timeout: 60000 }), page.click('button[type="submit"]')]);

  const menu = await text();
  expect(/Connections/.test(menu) && /Plan and billing/.test(menu), "the menu has Connections and Plan and billing");
  expect(!/\bAdmin\b/.test(menu), "a non-admin doesn't see Admin in the menu");

  await visit("/connections", "connections", /Shopify[\s\S]*eBay[\s\S]*CJ Dropshipping[\s\S]*AliExpress/);
  // Find products still searches the practice catalog when no supplier is connected.
  const found = await visit("/products?tab=find&q=lamp", "find-products", /practice catalog/);
  expect(/sells around/.test(found), "a practice search for lamp shows priced results");
  await visit("/billing", "billing", /Practice[\s\S]*Starter[\s\S]*Growth[\s\S]*Fleet/);
  const adminRes = await page.goto(`${base}/admin`, { waitUntil: "networkidle0" });
  expect(adminRes.status() === 404 || /Nothing here|could not be found/i.test(await text()), "Admin is closed to a non-admin");
  await visit("/privacy", "privacy", /What Armada keeps/);

  // One press: open a practice store.
  await visit("/stores/new", "stores-new", /Practice/);
  const pressed = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /practice store/i.test(x.textContent));
    if (!b) return false;
    b.click();
    return true;
  });
  expect(pressed, "there's an Open a practice store button");
  await page.waitForFunction(() => /\/stores\/[0-9a-f-]{36}/.test(location.pathname), { timeout: 60000 }).catch(() => {});
  const storeUrl = page.url();
  expect(/\/stores\/[0-9a-f-]{36}/.test(storeUrl), `one press lands on the new store's page (${storeUrl})`);
  // The store page streams in behind a short loading state; wait for its icon box.
  await page.waitForFunction(() => /This store's icon|No icon yet/.test(document.body.innerText), { timeout: 30000 }).catch(() => {});
  await shot("practice-store");

  // Choose an icon by hand.
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Choose one")?.click());
  await sleep(300);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click('button[data-icon="coffee"]')]);
  const saved = await page
    .waitForFunction(() => /This store's icon/.test(document.body.innerText), { timeout: 30000 })
    .then(() => true, () => false);
  expect(saved, "choosing an icon saves it");

  // Have the AI make one (needs the AI helper on this PC).
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0" }),
    page.evaluate(() => [...document.querySelectorAll("button")].find((b) => /Make one with AI/.test(b.textContent))?.click()),
  ]);
  let made = false;
  for (let i = 0; i < 30 && !made; i++) {
    await sleep(3000);
    await page.reload({ waitUntil: "networkidle0" });
    made = !/Making one…|picking one/.test(await text());
  }
  expect(made, "the AI helper made an icon within 90 seconds");
  await shot("store-icon");

  const home = await visit("/", "home", /Your fleet/);
  const iconsOnMap = await page.$$eval('a[href^="/stores/"] svg', (els) => els.length);
  expect(iconsOnMap >= 1, `the fleet map shows the store's icon (${iconsOnMap})`);
  void home;
} catch (e) {
  console.error("CHECK FAILED:", e.message);
  failed++;
} finally {
  console.log("browser errors:", errors.length ? errors.slice(0, 6).join(" | ") : "none");
  await browser.close();
  console.log(failed ? `${failed} failed` : "all passed");
  console.log("workspace to delete: Pages check");
  process.exitCode = failed ? 1 : 0;
}
