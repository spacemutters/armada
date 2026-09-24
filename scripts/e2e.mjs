// End-to-end run in real Chrome with a virtual passkey (Chrome's WebAuthn test authenticator),
// so sign-up and sign-in are exercised for real without anyone's fingerprint.
// usage: node --env-file=.env.local scripts/e2e.mjs <base-url> [--shop "idea"] [--fleet 24]
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const base = (process.argv[2] || "http://localhost:3000").replace(/\/$/, "");
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const shopIdea = arg("--shop", "Calm bedroom and sleep goods");
const fleetSize = arg("--fleet", "24");
const outDir = path.join(process.cwd(), ".shots");
fs.mkdirSync(outDir, { recursive: true });

const invite = execFileSync(process.execPath, ["--env-file=.env.local", "scripts/make-invite.mjs", base, "2"], { encoding: "utf8" })
  .trim()
  .split(/\r?\n/)
  .at(-1);

const browser = await puppeteer.launch({
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: true,
  defaultViewport: { width: 1440, height: 900 },
  args: ["--no-first-run", "--no-default-browser-check"],
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));

const cdp = await page.createCDPSession();
await cdp.send("WebAuthn.enable");
await cdp.send("WebAuthn.addVirtualAuthenticator", {
  options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true },
});

const shot = async (name, full = true) => {
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file, fullPage: full });
  console.log("shot", file);
};
const step = (s) => console.log(`\n== ${s}`);

try {
  step("setup link → passkey");
  await page.goto(invite, { waitUntil: "networkidle0" });
  await shot("01-setup", false);
  await page.type('input[placeholder="Davis"]', "Davis");
  await page.type('input[placeholder="My fleet"]', "Test fleet");
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0", timeout: 60000 }), page.click('button[type="submit"]')]);
  console.log("landed on", page.url());
  await shot("02-home-empty");

  step("practice fleet");
  await page.select("#count", fleetSize);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0", timeout: 120000 }),
    page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Start a practice fleet")).click()),
  ]);
  await shot("03-home-fleet");

  step("sign out, sign back in with the passkey");
  await page.evaluate(() => fetch("/api/auth/logout", { method: "POST" }));
  await page.goto(`${base}/welcome`, { waitUntil: "networkidle0" });
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0", timeout: 60000 }), page.click("button")]);
  console.log("after sign-in", page.url());

  for (const [name, url] of [
    ["04-stores", "/stores"],
    ["05-orders", "/orders"],
    ["06-products", "/products"],
    ["07-find", "/products?tab=find&q=knife,%20bottle,%20lamp"],
    ["08-ads", "/ads"],
    ["09-settings", "/settings"],
  ]) {
    await page.goto(base + url, { waitUntil: "networkidle0" });
    await shot(name);
  }

  step("list two products in three stores, preview, apply, undo");
  await page.goto(`${base}/products`, { waitUntil: "networkidle0" });
  const ids = await page.$$eval('input[name="ids"]', (els) => els.slice(0, 2).map((e) => e.value));
  await page.goto(`${base}/products/list?${ids.map((i) => `ids=${i}`).join("&")}`, { waitUntil: "networkidle0" });
  await page.$$eval('input[name="stores"]', (els) => els.slice(0, 3).forEach((e) => (e.checked = true)));
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click('button[type="submit"]')]);
  await shot("10-change-preview");
  const approve = await page.$$eval("button", (bs) => bs.findIndex((b) => b.textContent.includes("Approve")));
  if (approve >= 0) {
    await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Approve")).click())]);
    await shot("11-change-applied");
    await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Undo")).click())]);
    await shot("12-change-undone");
  } else console.log("nothing to approve (everything was already listed or skipped)");

  step(`build a shop: “${shopIdea}”`);
  await page.goto(`${base}/builder/new`, { waitUntil: "networkidle0" });
  await page.type('input[name="niche"]', shopIdea);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click('button[type="submit"]')]);
  const shopUrl = page.url();
  console.log("shop page", shopUrl);
  await shot("13-shop-building", false);
  // Ask the status endpoint rather than reloading, so the test never races the page's own refresh.
  const shopId = shopUrl.split("/").at(-1);
  const started = Date.now();
  let ready = false;
  while (Date.now() - started < 9 * 60_000) {
    await new Promise((r) => setTimeout(r, 5_000));
    const s = await page.evaluate(async (id) => (await fetch(`/api/shops/${id}`, { cache: "no-store" })).json(), shopId);
    const running = s.progress.filter((p) => p.state === "running").map((p) => p.label);
    console.log(`  ${Math.round((Date.now() - started) / 1000)}s ${s.status}${running.length ? ` · ${running.join(", ")}` : ""}${s.helperOnline ? "" : " · helper off"}`);
    if (s.status === "ready") {
      ready = true;
      break;
    }
    if (s.status === "failed") {
      console.log("  stopped:", s.error);
      break;
    }
  }
  console.log(ready ? `ready in ${Math.round((Date.now() - started) / 1000)}s` : "NOT READY");
  await page.goto(shopUrl, { waitUntil: "networkidle0" });
  await shot("14-shop-ready");
  if (ready) {
    const preview = await page.$eval('a[target="_blank"]', (a) => a.href);
    await page.goto(preview, { waitUntil: "networkidle0" });
    await page.evaluate(() => document.fonts.ready);
    await new Promise((r) => setTimeout(r, 1600));
    await shot("15-storefront-desktop");
    const productHref = await page.$eval('a[href*="/products/"]', (a) => a.href);
    await page.goto(productHref, { waitUntil: "networkidle0" });
    await shot("16-storefront-product");
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.goto(preview, { waitUntil: "networkidle0" });
    await new Promise((r) => setTimeout(r, 1600));
    await shot("17-storefront-mobile");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    console.log("mobile horizontal overflow px:", overflow);
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(shopUrl, { waitUntil: "networkidle0" });
    await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("practice store")).click())]);
    await shot("18-shop-in-practice-store");
  }
} catch (e) {
  console.error("E2E FAILED:", e.message);
  await shot("99-failure").catch(() => {});
  process.exitCode = 1;
} finally {
  console.log("\nbrowser errors:", errors.length ? errors.slice(0, 20).join("\n") : "none");
  await browser.close();
}
