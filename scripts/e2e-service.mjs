// Browser test of one-click connections through the connection service, against the stand-in
// (scripts/mock-pipedream.mjs). Press Connect Shopify on Connections, pass through the service's
// page, land back connected with the store in Stores; then Continue to eBay on Open a new store and
// land on the store's setup with eBay's steps running through the relay; a declined approval comes
// back in plain words; disconnecting lets go of the account at the service too.
// Makes a throwaway workspace ("Service check"); delete it afterwards.
//
// usage: node --env-file=.env.local scripts/e2e-service.mjs http://localhost:3002 http://127.0.0.1:4610
//   with Armada running on that address with PIPEDREAM_API_BASE=<mock>, PIPEDREAM_CLIENT_ID=mock-client,
//   PIPEDREAM_CLIENT_SECRET=mock-secret, PIPEDREAM_PROJECT_ID=proj_Mock1, APP_ORIGIN=<that address>.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const base = (process.argv[2] || "http://localhost:3002").replace(/\/$/, "");
const mock = (process.argv[3] || "http://127.0.0.1:4610").replace(/\/$/, "");
const outDir = path.join(process.cwd(), ".shots", "service");
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
const stats = async () => (await fetch(`${mock}/__stats`)).json();
let failed = 0;
const expect = (ok, what) => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${what}`);
};
const clickText = async (selector, re) => {
  const handles = await page.$$(selector);
  for (const h of handles) {
    const t = await h.evaluate((el) => el.textContent ?? "");
    if (re.test(t)) {
      await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0", timeout: 60000 }), h.click()]);
      return true;
    }
  }
  return false;
};

try {
  await page.goto(invite, { waitUntil: "networkidle0" });
  await page.type('input[placeholder="Davis"]', "Service check");
  await page.type('input[placeholder="My fleet"]', "Service check");
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0", timeout: 60000 }), page.click('button[type="submit"]')]);

  // ---- Shopify ----
  await page.goto(`${base}/connections`, { waitUntil: "networkidle0" });
  await shot("01-connections");
  const before = await text();
  expect(/Shopify[\s\S]*Connect Shopify/.test(before), "Connections offers Connect Shopify (not Coming soon) with the service on");
  expect(!/yourstore\.myshopify\.com|Your store's address/i.test(before.split("eBay")[0]), "no store-address box: the service's page asks for that");
  const pressed = await clickText("a", /^\s*Connect Shopify\s*$/);
  expect(pressed, "pressed Connect Shopify");
  const afterUrl = page.url();
  const t1 = await text();
  await shot("02-shopify-connected");
  expect(/connected=shopify/.test(afterUrl), `came back to Connections connected (${afterUrl.replace(base, "")})`);
  expect(/Connected as Mock Store/.test(t1), "the banner names the store from Shopify");
  await page.goto(`${base}/stores`, { waitUntil: "networkidle0" });
  expect(/Mock Store/.test(await text()), "the store is in Stores");

  // ---- a declined approval ----
  await fetch(`${mock}/__deny-next`);
  await page.goto(`${base}/connections`, { waitUntil: "networkidle0" });
  await clickText("a", /Connect another store|Connect Shopify/);
  const t2 = await text();
  await shot("03-declined");
  expect(/You chose not to connect|Nothing was changed/.test(t2), "a declined approval comes back in plain words");

  // ---- eBay: open a new store ----
  await page.goto(`${base}/stores/new`, { waitUntil: "networkidle0" });
  await shot("04-open-store");
  const t3 = await text();
  expect(!/eBay isn't switched on/.test(t3), "Open a new store offers eBay");
  const ebayPressed = (await clickText("a", /Continue to eBay/)) || (await clickText("button", /Continue to eBay/));
  expect(ebayPressed, "pressed Continue to eBay");
  const ebayUrl = page.url();
  expect(/\/stores\/new\/setup\//.test(ebayUrl), `landed on the store's setup (${ebayUrl.replace(base, "")})`);
  // Setup runs in steps; give it a moment, then read the page.
  await new Promise((r) => setTimeout(r, 8000));
  await page.reload({ waitUntil: "networkidle0" });
  const t4 = await text();
  await shot("05-ebay-setup");
  expect(/mock_seller/.test(t4), "the setup names the eBay account read through the relay");

  // ---- the relay ----
  const s = await stats();
  expect(s.relayByApp.shopify >= 1 && s.relayByApp.ebay >= 2, `requests went through the relay (Shopify ${s.relayByApp.shopify ?? 0}, eBay ${s.relayByApp.ebay ?? 0})`);
  expect(s.leakedKeys === 0, "no key of Armada's went through the relay");
  expect(s.badTargets.length === 0, `every relay target was allowed (${s.badTargets.join(", ") || "none refused"})`);
  expect(s.envMissing === 0, "every service request named the environment");

  // ---- disconnect lets go at the service ----
  await page.goto(`${base}/connections`, { waitUntil: "networkidle0" });
  const deletesBefore = (await stats()).deletes;
  const disc = await page.$$("button");
  let opened = false;
  for (const b of disc) {
    const t = await b.evaluate((el) => el.textContent ?? "");
    if (/^\s*Disconnect\s*$/.test(t)) {
      await b.click();
      opened = true;
      break;
    }
  }
  if (opened) {
    // The second press is inside the short "Disconnect <name>?" note that the first press opens.
    await page.waitForSelector('form[aria-label^="Disconnect"] button[type="submit"]', { timeout: 5000 });
    await page.click('form[aria-label^="Disconnect"] button[type="submit"]');
    await new Promise((r) => setTimeout(r, 5000));
  }
  const deletesAfter = (await stats()).deletes;
  await shot("06-disconnected");
  expect(opened && deletesAfter > deletesBefore, `disconnecting deleted the account at the service (${deletesBefore} → ${deletesAfter})`);
} catch (e) {
  console.error("CHECK FAILED:", e.message);
  failed++;
} finally {
  console.log("browser errors:", errors.length ? errors.slice(0, 6).join(" | ") : "none");
  await browser.close();
  console.log(failed ? `${failed} failed` : "all passed");
  console.log("workspace to delete: Service check");
  process.exitCode = failed ? 1 : 0;
}
