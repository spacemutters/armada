// End-to-end run of one-click AI ads on a live Armada: sign up, build a practice shop, press
// "Make ads", wait for the AI (the ChatGPT tool, through the helper on this PC) to write them,
// create them paused, switch them on (practice), see practice results, then stop every ad.
// Needs the AI helper running. Makes a throwaway workspace ("Ads check"); delete it afterwards.
// usage: node --env-file=.env.local scripts/e2e-ads.mjs https://armada-pi.vercel.app
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const base = (process.argv[2] || "https://armada-pi.vercel.app").replace(/\/$/, "");
const outDir = path.join(process.cwd(), ".shots", "ads");
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
const shot = (name, full = true) => page.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: full });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const expect = (ok, what) => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${what}`);
};
const press = async (label) =>
  page.evaluate((l) => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.replace(/\s+/g, " ").trim().includes(l) && !x.disabled);
    if (!b) return false;
    b.click();
    return true;
  }, label);
const waitFor = (re, ms) => page.waitForFunction((s) => new RegExp(s).test(document.body.innerText), { timeout: ms }, re.source).then(() => true, () => false);

try {
  await page.goto(invite, { waitUntil: "networkidle0" });
  await page.type('input[placeholder="Davis"]', "Ads check");
  await page.type('input[placeholder="My fleet"]', "Ads check");
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0", timeout: 60000 }), page.click('button[type="submit"]')]);

  // A practice shop to advertise.
  await page.goto(`${base}/builder/new`, { waitUntil: "networkidle0" });
  await page.type('input[name="niche"]', "Minimalist desk setup for gamers");
  await page.select('select[name="productCount"]', "8");
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click('button[type="submit"]')]);
  const shopId = page.url().split("/").at(-1);
  let ready = false;
  for (let i = 0; i < 96 && !ready; i++) {
    await sleep(5000);
    const s = await page.evaluate(async (id) => (await fetch(`/api/shops/${id}`, { cache: "no-store" })).json().catch(() => null), shopId);
    if (s?.status === "failed") break;
    ready = s?.status === "ready";
  }
  expect(ready, "a practice shop was built to advertise");
  if (!ready) throw new Error("no shop, so nothing to advertise");

  // One press: make ads.
  await page.goto(`${base}/ads`, { waitUntil: "networkidle0" });
  await shot("01-ads-page");
  expect(await press("Make ads for"), "the Ads page offers \"Make ads for <shop>\"");
  await page.waitForFunction(() => /\/ads\/[0-9a-f-]{36}/.test(location.pathname), { timeout: 60000 }).catch(() => {});
  const adsUrl = page.url();
  expect(adsUrl.includes(`/ads/${shopId}`), "one press opens that shop's ads");
  let written = false;
  for (let i = 0; i < 60 && !written; i++) {
    await sleep(5000);
    await page.reload({ waitUntil: "networkidle0" }).catch(() => {});
    const t = await text();
    written = /Create these ads/.test(t) && !/The AI is writing ads/.test(t);
    if (i % 6 === 0) console.log(`  ${i * 5}s: ${/The AI is writing ads/.test(t) ? "writing" : "waiting"}`);
  }
  expect(written, "the AI wrote the ads within five minutes");
  await shot("02-written");
  const t2 = await text();
  expect(/Written by AI|written by AI/.test(t2), "the ads are labelled as written by AI");
  const cards = await page.$$eval("article", (els) => els.length);
  expect(cards >= 3, `there are several ad variations (${cards} cards)`);

  // Create them paused, then switch on (practice).
  expect(await press("Create these ads"), "Create these ads — paused");
  const created = await waitFor(/Switch on/, 60000);
  expect(created, "the ads are created switched off, with a Switch on button");
  await shot("03-created-paused");
  expect(await press("Switch on"), "Switch on");
  const on = await waitFor(/Pause these ads|Stop every ad in every shop/, 60000);
  expect(on, "the ads are on");
  await sleep(2000);
  await page.reload({ waitUntil: "networkidle0" });
  const t3 = await text();
  expect(/practice/i.test(t3) && /made up|made-up/i.test(t3), "practice results are labelled as made up");
  await shot("04-on");

  // Stop everything.
  expect(await press("Stop every ad in every shop"), "Stop every ad in every shop");
  const stopped = await waitFor(/Switched off|Stopped|stopped|Switch on/, 60000);
  expect(stopped, "every ad stops");
  await shot("05-stopped");
} catch (e) {
  console.error("E2E FAILED:", e.message);
  await shot("99-failure").catch(() => {});
  failed++;
} finally {
  console.log("browser errors:", errors.length ? errors.slice(0, 6).join(" | ") : "none");
  await browser.close();
  console.log(failed ? `${failed} failed` : "all passed");
  console.log("workspace to delete: Ads check");
  process.exitCode = failed ? 1 : 0;
}
