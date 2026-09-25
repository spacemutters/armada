// End-to-end run in real Chrome with a virtual passkey (Chrome's WebAuthn test authenticator),
// so sign-up and sign-in are exercised for real without anyone's fingerprint.
// usage: node --env-file=.env.local scripts/e2e.mjs <base-url> [--shop "idea"] [--fleet 24] [--price budget|mid|premium|luxury]
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
const priceLevel = arg("--price", "mid");
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
  // The change page streams in after a short "Loading changes"; wait for the real content.
  await page.waitForFunction(() => /Waiting for you|Applied|Nothing to change/i.test(document.body.innerText), { timeout: 30000 }).catch(() => {});
  await shot("10-change-preview");
  // Approving is press-and-hold (a quick click deliberately does nothing), so hold it like a person.
  const holdPress = async (label) => {
    const handle = await page.evaluateHandle((l) => [...document.querySelectorAll("button")].find((b) => b.textContent.includes(l)) ?? null, label);
    const el = handle.asElement();
    if (!el) return false;
    const box = await el.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await new Promise((r) => setTimeout(r, 1600));
    await page.mouse.up();
    return true;
  };
  const waitForText = (re, ms = 30000) => page.waitForFunction((s) => new RegExp(s, "i").test(document.body.innerText), { timeout: ms }, re.source).then(() => true, () => false);
  if (await holdPress("Approve and apply")) {
    const applied = await waitForText(/applied|done/);
    console.log(applied ? "approved and applied" : "APPROVE DID NOT APPLY");
    if (!applied) process.exitCode = 1;
    await shot("11-change-applied");
    if (await holdPress("Undo")) {
      const undone = await waitForText(/undone|put back|undid/);
      console.log(undone ? "undone" : "UNDO DID NOT WORK");
      if (!undone) process.exitCode = 1;
      await shot("12-change-undone");
    } else {
      console.log("NO UNDO BUTTON after applying");
      process.exitCode = 1;
    }
  } else console.log("nothing to approve (everything was already listed or skipped)");

  step(`build a shop: “${shopIdea}”`);
  await page.goto(`${base}/builder/new`, { waitUntil: "networkidle0" });
  await page.type('input[name="niche"]', shopIdea);
  await page.select('select[name="priceFeel"]', priceLevel);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click('button[type="submit"]')]);
  const shopUrl = page.url();
  console.log("shop page", shopUrl);
  await shot("13-shop-building", false);
  // Ask the status endpoint rather than reloading, so the test never races the page's own refresh.
  const shopId = shopUrl.split("/").at(-1);
  const status = () => page.evaluate(async (id) => (await fetch(`/api/shops/${id}`, { cache: "no-store" })).json(), shopId).catch(() => null);
  const fail = (what) => {
    console.log(`CHOOSER PROBLEM: ${what}`);
    process.exitCode = 1;
  };
  // The build stops at "Choose your products" and waits for a person. Choose like one: tap the first
  // N cards by hand, watching the count and the build button on the way, then press build.
  const chooseByHand = async () => {
    await page.goto(shopUrl, { waitUntil: "networkidle0" });
    await page.waitForSelector("label[data-proposal]", { timeout: 30_000 });
    await shot("13b-chooser");
    // On a phone: two columns and nothing wider than the screen.
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.reload({ waitUntil: "networkidle0" });
    await shot("13b-chooser-phone", false);
    const phone = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      columns: new Set([...document.querySelectorAll("label[data-proposal]")].slice(0, 4).map((l) => Math.round(l.getBoundingClientRect().left))).size,
    }));
    console.log(`  chooser on a phone: ${phone.columns} columns, ${phone.overflow}px sideways overflow`);
    if (phone.overflow > 0 || phone.columns !== 2) fail("the chooser doesn't fit a phone in two columns");
    await page.setViewport({ width: 1440, height: 900 });
    await page.reload({ waitUntil: "networkidle0" });
    await page.waitForSelector("label[data-proposal]", { timeout: 30_000 });
    const cards = await page.$$("label[data-proposal]");
    const counter = () => page.evaluate(() => document.body.innerText.match(/(\d+) of (\d+) chosen/)?.slice(1).map(Number) ?? null);
    const buildDisabled = () =>
      page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Build the shop with these"))?.disabled ?? null);
    const tap = async (card) => {
      await card.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await card.click();
    };
    const [, need] = (await counter()) ?? [0, 0];
    console.log(`  the chooser shows ${cards.length} products; choose ${need}`);
    // The AI is asked for twice the count; it may leave out a poor fit, but there must be a real choice.
    if (!need || cards.length <= need) fail(`expected more than ${need} cards, found ${cards.length}`);
    else if (cards.length !== need * 2) console.log(`  (the AI proposed ${cards.length}, not ${need * 2})`);
    if ((await buildDisabled()) !== true) fail("the build button works before anything is chosen");
    for (let i = 0; i < need - 1; i++) await tap(cards[i]);
    if (JSON.stringify(await counter()) !== JSON.stringify([need - 1, need]) || (await buildDisabled()) !== true) fail(`at ${need - 1} chosen the count or the button is wrong`);
    await tap(cards[need - 1]);
    if (JSON.stringify(await counter()) !== JSON.stringify([need, need]) || (await buildDisabled()) !== false) fail(`at ${need} chosen the count or the button is wrong`);
    // One too many turns the button off again; untick it and it comes back.
    await tap(cards[need]);
    if ((await buildDisabled()) !== true || !/too many/i.test(await page.evaluate(() => document.body.innerText))) fail("choosing one too many didn't stop the build button");
    await tap(cards[need]);
    const checked = await page.$$eval('input[name="pick"]', (els) => els.map((e) => e.checked));
    if (checked.filter(Boolean).length !== need || !checked.slice(0, need).every(Boolean)) fail("the ticked cards aren't the first ones tapped");
    await shot("13c-chooser-chosen");
    await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Build the shop with these")).click());
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const s = await status();
      if (s && s.status !== "choosing") return true;
    }
    fail("pressing build didn't carry the build on");
    return false;
  };
  const started = Date.now();
  let ready = false;
  let chose = false;
  while (Date.now() - started < 10 * 60_000) {
    await new Promise((r) => setTimeout(r, 5_000));
    const s = await status();
    if (!s) continue;
    const running = s.progress.filter((p) => p.state === "running" || p.state === "needs-you").map((p) => p.label);
    console.log(`  ${Math.round((Date.now() - started) / 1000)}s ${s.status}${running.length ? ` · ${running.join(", ")}` : ""}${s.helperOnline ? "" : " · helper off"}`);
    if (s.status === "choosing") {
      if (chose) break; // chose once already and it's still waiting: chooseByHand said why
      chose = true;
      console.log((await chooseByHand()) ? "  chose by hand; the build carries on" : "  CHOOSING FAILED");
      continue;
    }
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
