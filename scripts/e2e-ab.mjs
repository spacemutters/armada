// End-to-end run of a headline test (an A/B test of a shop's home-page headline): the AI writes three
// other versions, the owner picks one and edits it, real shoppers in private windows are split between
// the two and each counted once, the owner's own visits aren't counted, practice visitors can be added
// and cleared, and making the new version the winner can be undone.
// Needs Armada running and an AI helper polling that same Armada. Takes about ten minutes, most of it
// the shop build.
// usage: node --env-file=.env.local scripts/e2e-ab.mjs <base-url> [--shop "idea"]
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
const fleetName = "AB test fleet";
const editedCta = "See the range";
const verdicts = ["The new version is winning", "The original is doing better", "No clear winner yet", "No real difference"];
const outDir = path.join(process.cwd(), ".shots", "ab");
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
const errors = [];
const listen = (p, who) => {
  p.on("pageerror", (e) => errors.push(`${who} pageerror: ${e.message}`));
  p.on("console", (m) => m.type() === "error" && errors.push(`${who} console: ${m.text()}`));
  // A confirm() before an irreversible button would otherwise hang the run; say yes and note it.
  p.on("dialog", (d) => {
    console.log(`  (${who} was asked “${d.message()}”, answering yes)`);
    d.accept().catch(() => {});
  });
};
const page = await browser.newPage();
listen(page, "owner");
const cdp = await page.createCDPSession();
await cdp.send("WebAuthn.enable");
await cdp.send("WebAuthn.addVirtualAuthenticator", {
  options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true },
});

const shot = async (name, full = true, p = page) => {
  const file = path.join(outDir, `${name}.png`);
  await p.screenshot({ path: file, fullPage: full });
  console.log("shot", file);
};
const step = (s) => console.log(`\n== ${s}`);
const checks = [];
const expect = (ok, what) => {
  checks.push({ ok: Boolean(ok), what });
  console.log(`${ok ? "PASS" : "FAIL"} ${what}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const firstLine = (e) => String(e?.message ?? e).split("\n")[0];

// Two kinds of text comparison. Headlines and button text are data, compared exactly once runs of
// whitespace are collapsed. Phrases the page says are matched ignoring case and curly apostrophes,
// because a label styled in capitals or typeset quotes is still the same words to a reader.
const squash = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const clean = (s) => squash(s).replace(/[\u2018\u2019]/g, "'").toLowerCase();
const has = (pageText, phrase) => clean(pageText).includes(clean(phrase));
const text = (p = page) => p.evaluate(() => document.body.innerText);
const h1 = (p = page) => p.$eval("h1", (el) => el.textContent).then(squash, () => "");

// Pages here refresh themselves while work is running, so "network idle" can come and go. Load, then
// give the network a moment to settle, and never treat a page that won't go quiet as a failure.
const settle = (p = page) => p.waitForNetworkIdle({ idleTime: 500, timeout: 20_000 }).catch(() => {});
const open = async (url, p = page) => {
  await p.goto(url, { waitUntil: "load", timeout: 60_000 });
  await settle(p);
};
const reload = async (p = page) => {
  try {
    await p.reload({ waitUntil: "load", timeout: 60_000 });
    await settle(p);
    return true;
  } catch (e) {
    console.log(`  (reload failed: ${firstLine(e)}, trying again)`);
    return false;
  }
};

// One poll of a build's status. A failed poll (this laptop's link to the database drops now and
// then, or the page refreshed under the request) is logged and skipped, not treated as the build failing.
const shopStatus = async (id) => {
  try {
    const r = await page.evaluate(async (i) => {
      const res = await fetch(`/api/shops/${i}`, { cache: "no-store" });
      return res.ok ? { ok: true, body: await res.json() } : { ok: false, status: res.status };
    }, id);
    if (!r.ok) console.log(`  (status poll got ${r.status}, trying again)`);
    return r.ok ? r.body : null;
  } catch (e) {
    console.log(`  (status poll failed: ${firstLine(e)}, trying again)`);
    return null;
  }
};

// Clicks the button whose text is `label`, preferring an exact match over one that contains it.
const clickButton = (label, p = page) =>
  p.evaluate((l) => {
    const norm = (s) => s.replace(/\s+/g, " ").trim();
    const all = [...document.querySelectorAll("button")];
    const b = all.find((x) => norm(x.textContent) === l) ?? all.find((x) => norm(x.textContent).includes(l));
    if (!b) return false;
    b.click();
    return true;
  }, label);

// Presses a button on the test page and waits until the page shows the result. Each button sends a
// form and the server sends the page back, sometimes as a full load and sometimes as an in-place
// refresh, so waiting on what the page shows works for both. `until` runs inside the page.
const press = async (label, until, ...args) => {
  if (!(await clickButton(label))) {
    console.log(`  there is no “${label}” button`);
    return false;
  }
  const done = await page.waitForFunction(until, { timeout: 90_000, polling: 500 }, ...args).then(
    () => true,
    (e) => {
      console.log(`  after “${label}” the page never showed the result: ${firstLine(e)}`);
      return false;
    },
  );
  await settle();
  return done;
};

// These run inside the page. The results are read from data attributes rather than the words around
// them, so rewording the page doesn't break the test.
const totalAtLeast = (min) => {
  const n = (s) => Number(document.querySelector(`[data-side="${s}"][data-visitors]`)?.getAttribute("data-visitors"));
  return n("a") + n("b") >= min;
};
const totalAtMost = (max) => {
  const n = (s) => Number(document.querySelector(`[data-side="${s}"][data-visitors]`)?.getAttribute("data-visitors"));
  return n("a") + n("b") <= max;
};
const pageSays = (phrase) =>
  document.body.innerText.replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, " ").toLowerCase().includes(phrase.toLowerCase());

// The test's numbers as the owner sees them, or null if they're missing or not whole numbers.
const results = async () => {
  const r = await page.evaluate(() => {
    const side = (s) => {
      const el = document.querySelector(`[data-side="${s}"][data-visitors]`);
      return el ? { visitors: Number(el.getAttribute("data-visitors")), adds: Number(el.getAttribute("data-adds")) } : null;
    };
    return { a: side("a"), b: side("b") };
  });
  const whole = (x) => x && Number.isInteger(x.visitors) && Number.isInteger(x.adds);
  if (!whole(r.a) || !whole(r.b)) {
    console.log("  (the results numbers are missing or not whole numbers:", JSON.stringify(r), ")");
    return null;
  }
  return { ...r, visitors: r.a.visitors + r.b.visitors, adds: r.a.adds + r.b.adds };
};
const show = (r) => (r ? `original ${r.a.visitors} visitors, ${r.a.adds} adds; new ${r.b.visitors} visitors, ${r.b.adds} adds` : "no numbers");

// Button labels mention practice visitors too, so this leaves them out and returns the other lines
// that say "practice".
const practiceLines = () =>
  page.evaluate(() => {
    let t = document.body.innerText;
    for (const b of document.querySelectorAll("button")) {
      const label = b.innerText.trim();
      if (label) t = t.split(label).join("");
    }
    return t
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => /practice/i.test(l));
  });

// ---------- shoppers ----------

// A shopper is a private browser context: its own cookies, no Armada session. Headless Chrome names
// itself in its user agent; a shopper should look like the plain Chrome a real person uses, so the
// shop's "is this a person" check sees what it would see in real life.
const shopperAgent = (await browser.userAgent()).replace("HeadlessChrome", "Chrome");
const openShoppers = new Set();
let shopperCount = 0;
const newShopper = async () => {
  const context = await browser.createBrowserContext();
  const p = await context.newPage();
  await p.setUserAgent({ userAgent: shopperAgent });
  listen(p, `shopper ${++shopperCount}`);
  const s = { context, page: p };
  openShoppers.add(s);
  return s;
};
const closeShopper = async (s) => {
  openShoppers.delete(s);
  await s.context.close().catch(() => {});
};
// A shop page reports a view or an add to Armada in the background after it loads. Waiting for that
// report to be answered means the count is saved before the owner's page reads it, and the context
// isn't closed with the report still in flight.
const waitForReport = (p) =>
  p.waitForResponse((r) => r.url().endsWith("/api/ab") && r.request().method() === "POST", { timeout: 15_000 }).then(
    () => true,
    () => false,
  );
// Opens the shop's home page as this shopper and returns the headline they saw. `counted` says
// whether a test is running, so a report should follow.
const visitHome = async (s, url, counted) => {
  const reported = counted ? waitForReport(s.page) : null;
  await open(url, s.page);
  if (reported && !(await reported)) console.log("  (didn't see this visit reported to Armada)");
  return h1(s.page);
};

let shopId = null;
let slug = null;

try {
  step("sign up");
  await page.goto(invite, { waitUntil: "networkidle0" });
  await page.type('input[placeholder="Davis"]', "Tester");
  await page.type('input[placeholder="My fleet"]', fleetName);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0", timeout: 60000 }), page.click('button[type="submit"]')]);
  console.log("landed on", page.url());

  step(`build a practice shop: “${shopIdea}”`);
  await open(`${base}/builder/new`);
  await page.type('input[name="niche"]', shopIdea);
  // The source choice only appears when there's more than one catalog; with just the practice catalog it's already chosen.
  if (await page.$('select[name="source"]')) await page.select('select[name="source"]', "practice");
  await page.select('select[name="productCount"]', "8");
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0", timeout: 60000 }), page.click('button[type="submit"]')]);
  shopId = new URL(page.url()).pathname.split("/").at(-1);
  if (!/^[0-9a-f-]{36}$/.test(shopId)) throw new Error(`the builder didn't open a shop page (${page.url()})`);
  console.log("shop page", page.url());
  // Ask the status endpoint rather than reloading, so the test never races the page's own refresh.
  const buildStarted = Date.now();
  let status = null;
  let lastLine = "";
  let aiPicked = 0;
  while (Date.now() - buildStarted < 9 * 60_000) {
    await sleep(5000);
    const s = await shopStatus(shopId);
    if (!s) continue;
    status = s;
    const running = (s.progress ?? []).filter((p) => p.state === "running" || p.state === "needs-you").map((p) => `${p.label}${p.note ? ` (${p.note})` : ""}`);
    const line = `${s.status}${running.length ? ` · ${running.join(", ")}` : ""}${s.helperOnline === false ? " · helper off" : ""}`;
    if (line !== lastLine) console.log(`  ${Math.round((Date.now() - buildStarted) / 1000)}s ${line}`);
    lastLine = line;
    // The build stops at "Choose your products" and waits for a person; this test lets the AI pick.
    if (s.status === "choosing" && aiPicked++ < 3) {
      await open(`${base}/builder/${shopId}`);
      console.log((await clickButton("Let the AI pick for me")) ? "  pressed “Let the AI pick for me”" : "  there is no “Let the AI pick for me” button");
      continue;
    }
    if (s.status === "ready" || s.status === "failed") break;
  }
  expect(status?.status === "ready", `the practice shop is ready (${status?.status ?? "no answer"}${status?.error ? `: ${status.error}` : ""})`);
  if (status?.status !== "ready") throw new Error("the shop never became ready, so there's no headline to test");

  const shopUrl = `${base}/builder/${shopId}`;
  const testPath = `/builder/${shopId}/test`;
  const testUrl = base + testPath;

  step("the shop page leads to the headline test");
  await open(shopUrl);
  await shot("01-shop-ready");
  const testLink = await page.evaluateHandle(() =>
    [...document.querySelectorAll("a")].find((a) => a.textContent.replace(/\s+/g, " ").includes("Test your headline")),
  );
  const testHref = await testLink.evaluate((a) => a?.getAttribute("href") ?? null);
  expect(testHref !== null && new URL(testHref, base).pathname === testPath, `the shop page has a “Test your headline” link to its test page (${testHref ?? "none"})`);
  if (testHref) {
    await testLink.evaluate((a) => a.click());
    await page.waitForFunction((p) => location.pathname === p, { timeout: 30_000 }, testPath).catch(() => {});
    await settle();
  }
  const clickedThrough = new URL(page.url()).pathname === testPath;
  expect(clickedThrough, "clicking it opens the test page");
  // Carry on from the test page either way, so one broken link doesn't hide everything after it.
  if (!clickedThrough) await open(testUrl);
  await shot("02-test-start");

  step("the AI writes three other headlines");
  const writing = await press(
    "Write three new versions",
    () => /writing three other headlines/i.test(document.body.innerText) || document.querySelectorAll('input[name="pick"]').length >= 3,
  );
  // The AI can finish before the first look (it did on the live site, in under the page's first
  // refresh), so either the writing message or the finished versions count as the right state.
  const writingNow = has(await text(), "Writing three other headlines");
  const alreadyWritten = (await page.$$('input[name="pick"]')).length >= 3;
  if (alreadyWritten && !writingNow) console.log("  (the versions were already written by the first look)");
  expect(writing && (writingNow || alreadyWritten), "the page says it's writing three other headlines, or they're already written");
  await shot("03-writing");
  // The page refreshes itself while the AI writes; reload on our own schedule as well, and let a
  // reload that fails be retried rather than end the run.
  const writeStarted = Date.now();
  let picks = [];
  while (Date.now() - writeStarted < 4 * 60_000) {
    await sleep(4000);
    if (!(await reload())) continue;
    picks = await page.$$eval('input[name="pick"]', (els) => els.map((e) => e.value)).catch(() => []);
    if (picks.length >= 3) break;
    const now = await text().catch(() => "");
    if (/couldn.t write the versions|wrong shape/i.test(now)) {
      console.log("  the writing stopped:", squash(now).slice(0, 300));
      break;
    }
  }
  console.log(`  ${picks.length} versions after ${Math.round((Date.now() - writeStarted) / 1000)}s`);
  expect(picks.length === 3 && ["0", "1", "2"].every((v) => picks.includes(v)), `three versions to choose from (${picks.join(", ") || "none"})`);
  if (!picks.includes("1")) throw new Error("there's no second version to choose, so the test can't go on");
  const aiLabels = (clean(await text()).match(/written by ai/g) ?? []).length;
  expect(aiLabels >= 3, `each version is labelled “Written by AI” (${aiLabels} labels)`);
  const candidates = (await page.$$eval("[data-candidate-headline]", (els) => els.map((e) => e.getAttribute("data-candidate-headline") || e.textContent))).map(squash);
  expect(candidates.length === 3 && candidates.every(Boolean), `each version shows its headline (${candidates.length} found)`);
  candidates.forEach((c, i) => console.log(`  version ${i + 1}: “${c}”`));
  await shot("04-versions");

  step("choose the second version and change its button");
  const HEADLINE = 'input[name="headline"]';
  const SUBHEAD = 'input[name="subhead"]';
  const CTA = 'input[name="cta"]';
  const field = (sel) => page.$eval(sel, (el) => el.value).catch(() => null);
  const checkedPick = await page.$eval('input[name="pick"]:checked', (el) => el.value).catch(() => null);
  const firstHeadline = squash(await field(HEADLINE));
  if (checkedPick !== null) {
    expect(firstHeadline === candidates[Number(checkedPick)], `the fields start out holding the chosen version (version ${Number(checkedPick) + 1})`);
  }
  if (firstHeadline === candidates[1]) console.log("  (the second version was already in the fields before choosing it)");
  // A click on the radio itself, so a styled card that hides the real input still gets chosen.
  await page.$eval('input[name="pick"][value="1"]', (el) => el.click());
  let headlineNow = "";
  for (let i = 0; i < 20 && headlineNow !== candidates[1]; i++) {
    await sleep(250);
    headlineNow = squash(await field(HEADLINE));
  }
  expect(headlineNow === candidates[1], `choosing the second version puts its headline in the field (“${headlineNow}”)`);
  expect((await field(SUBHEAD)) !== null, "the subhead is there to edit too");
  // Replace the button text outright, the way a person would: select it all, delete, type.
  if (await page.$(CTA)) {
    await page.focus(CTA);
    await page.$eval(CTA, (el) => el.select());
    await page.keyboard.press("Backspace");
    await page.type(CTA, editedCta);
  }
  const ctaNow = await field(CTA);
  expect(ctaNow === editedCta, `the button text can be changed (“${ctaNow}”)`);
  const newHeadline = headlineNow;
  await shot("05-chosen-and-edited");

  step("start the test");
  const started = await press("Start the test", () => Boolean(document.querySelector('[data-preview="b"]')));
  expect(started, "starting the test shows the two versions");
  if (!started) throw new Error("the test didn't start, so there's nothing to count");
  // textContent, not innerText: a preview may style its button in capitals, and the check is about
  // the words that were saved.
  const previews = await page.evaluate(() => {
    const t = (v) => document.querySelector(`[data-preview="${v}"]`)?.textContent ?? null;
    return { a: t("a"), b: t("b") };
  });
  expect(previews.a !== null && previews.b !== null, "both versions are previewed");
  expect(squash(previews.b).includes(editedCta), `the new version's preview keeps the changed button text “${editedCta}”`);
  expect(squash(previews.b).includes(newHeadline), "the new version's preview shows the chosen headline");
  const r0 = await results();
  expect(r0 !== null && r0.visitors === 0 && r0.adds === 0, `the results start at zero (${show(r0)})`);
  expect(has(await text(), "Too early to tell"), "the page says it's too early to tell");
  await shot("06-running");

  // The shop's address comes from the "See the original" link, and opening it as the owner shows the
  // original headline that shoppers in the other half should see.
  const originalHref = await page.evaluate(() => {
    const a = [...document.querySelectorAll("a")].find((x) => x.textContent.replace(/\s+/g, " ").includes("See the original"));
    return a ? a.getAttribute("href") : null;
  });
  const originalUrl = originalHref ? new URL(originalHref, base) : null;
  slug = originalUrl?.pathname.match(/^\/s\/([a-z0-9]+)\/?$/)?.[1] ?? null;
  expect(Boolean(slug) && originalUrl.searchParams.get("version") === "a", `“See the original” links to the shop's original version (${originalHref ?? "no link"})`);
  if (!slug) throw new Error("couldn't find the shop's address, so no shopper can visit it");
  const storefront = `${base}/s/${slug}`;
  await open(`${storefront}?version=a`);
  const originalHeadline = await h1();
  expect(Boolean(originalHeadline) && originalHeadline !== newHeadline, `the original and new headlines differ (“${originalHeadline}” and “${newHeadline}”)`);
  expect(squash(previews.a).includes(originalHeadline), "the original's preview shows the shop's current headline");

  step("the running test on a phone");
  await open(testUrl);
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await reload();
  await shot("07-running-mobile");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow <= 0, `no sideways scrolling on a 390px-wide phone (${overflow}px too wide)`);
  await page.setViewport({ width: 1440, height: 900 });
  await reload();

  step("six shoppers, each in their own private window");
  const versionOf = (h) => (h === originalHeadline ? "a" : h === newHeadline ? "b" : null);
  const seen = [];
  let buyer = null;
  for (let i = 1; i <= 6; i++) {
    const s = await newShopper();
    const headline = await visitHome(s, storefront, true);
    const cookie = (await s.context.cookies()).some((c) => c.name === "armada_v");
    expect(cookie, `shopper ${i} was given a visitor cookie`);
    const v = versionOf(headline);
    expect(v !== null, `shopper ${i} sees one of the two headlines (${v === "a" ? "the original" : v === "b" ? "the new one" : `“${headline}”`})`);
    seen.push(v);
    if (i === 1) {
      // The first shopper stays open to add something to their bag and to come back later.
      s.version = v;
      s.headline = headline;
      buyer = s;
      await shot("08-shopper-home", false, s.page);
    } else await closeShopper(s);
  }
  const sawA = seen.filter((v) => v === "a").length;
  const sawB = seen.filter((v) => v === "b").length;
  console.log(`  ${sawA} saw the original, ${sawB} saw the new one`);

  step("one shopper adds something to their bag");
  const bp = buyer.page;
  const PRODUCT_LINK = 'a[href*="/products/"]';
  const productHref = await bp.$eval(PRODUCT_LINK, (a) => a.href).catch(() => null);
  try {
    await Promise.all([bp.waitForNavigation({ timeout: 30_000 }), bp.click(PRODUCT_LINK)]);
  } catch (e) {
    console.log(`  (clicking the product didn't open it: ${firstLine(e)}; opening it directly)`);
    if (productHref) await bp.goto(productHref, { waitUntil: "load", timeout: 60_000 });
  }
  await settle(bp);
  expect(new URL(bp.url()).pathname.includes("/products/"), "the shopper reaches a product page");
  const bagReady = await bp
    .waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Add to bag"), { timeout: 30_000 })
    .then(
      () => true,
      () => false,
    );
  expect(bagReady, "the product page has an “Add to bag” button");
  const addReported = waitForReport(bp);
  await clickButton("Add to bag", bp);
  if (!(await addReported)) console.log("  (didn't see the add reported to Armada)");
  await sleep(2000);
  await shot("09-shopper-added", false, bp);

  step("the owner sees each shopper counted once");
  await open(testUrl);
  const r1 = await results();
  expect(r1?.visitors === 6, `six visitors counted (${show(r1)})`);
  expect(r1?.a.visitors === sawA && r1?.b.visitors === sawB, `each side counted the shoppers who saw it (${sawA} original, ${sawB} new)`);
  expect(r1?.adds === 1, `one add to bag counted (${r1?.adds ?? "none"})`);
  expect(buyer.version !== null && r1?.[buyer.version]?.adds === 1, "the add counted for the version that shopper saw");
  await shot("10-counted");

  step("the same shopper comes back twice more");
  const again = [await visitHome(buyer, storefront, true), await visitHome(buyer, storefront, true)];
  expect(
    again.every((h) => h === buyer.headline),
    `they see the same headline every time (${[buyer.headline, ...again].map((h) => `“${h}”`).join(", ")})`,
  );
  await closeShopper(buyer);
  await reload();
  const r2 = await results();
  expect(r2?.visitors === 6, `coming back doesn't count them again (${show(r2)})`);

  step("the owner's own visits aren't counted");
  await open(`${storefront}?version=b`);
  expect((await h1()) === newHeadline, "the owner can look at the new version");
  expect(has(await text(), "Your own visits aren't counted"), "the owner is told their own visits aren't counted");
  await shot("11-owner-sees-new", false);
  await open(testUrl);
  const r3 = await results();
  expect(r3?.visitors === 6, `the owner's visits weren't counted (${show(r3)})`);

  step("practice visitors");
  const practiceBefore = new Set(await practiceLines());
  const added = await press("Add 1,000 practice visitors", totalAtLeast, 1006);
  const r4 = await results();
  expect(added && r4?.visitors >= 1006, `1,000 practice visitors added (${show(r4)})`);
  const practiceLabel = (await practiceLines()).find((l) => !practiceBefore.has(l));
  expect(Boolean(practiceLabel), `the numbers say they include practice visitors (“${practiceLabel ?? "no such label"}”)`);
  await shot("12-practice-added");
  const cleared = await press("Clear practice visitors", totalAtMost, 6);
  const r5 = await results();
  expect(cleared && r5?.visitors === 6, `clearing them leaves the six real visitors (${show(r5)})`);
  await shot("13-practice-cleared");

  step("3,000 practice visitors, enough for a verdict");
  for (let i = 1; i <= 3; i++) {
    const before = (await results())?.visitors ?? 0;
    if (!(await press("Add 1,000 practice visitors", totalAtLeast, before + 1000))) console.log(`  round ${i} didn't add visitors`);
  }
  const r6 = await results();
  expect(r6?.a.visitors > 100 && r6?.b.visitors > 100, `both sides have well over 100 visitors (${show(r6)})`);
  const verdictText = await text();
  expect(!has(verdictText, "Too early to tell"), "it's no longer too early to tell");
  const verdict = verdicts.find((v) => has(verdictText, v));
  expect(Boolean(verdict), `the page gives a verdict (“${verdict ?? "none of the expected ones"}”)`);
  await shot("14-verdict");

  step("make the new version the winner");
  const won = await press("Make the new version the winner", pageSays, "The new version is now your headline.");
  expect(won, "the page says the new version is now the headline");
  await shot("15-winner");
  for (let i = 1; i <= 3; i++) {
    const s = await newShopper();
    const headline = await visitHome(s, storefront, false);
    expect(headline === newHeadline, `a new shopper (${i} of 3) sees the new headline (“${headline}”)`);
    if (i === 1) await shot("16-shopper-after-winner", false, s.page);
    await closeShopper(s);
  }

  step("put the original back");
  const undone = await press("Put the original back", pageSays, "The original is back.");
  expect(undone, "the page says the original is back");
  await shot("17-original-back");
  for (let i = 1; i <= 3; i++) {
    const s = await newShopper();
    const headline = await visitHome(s, storefront, false);
    expect(headline === originalHeadline, `a new shopper (${i} of 3) sees the original headline again (“${headline}”)`);
    await closeShopper(s);
  }
  const another = await page.evaluate(() =>
    [...document.querySelectorAll("button, a")].some((b) => b.textContent.replace(/\s+/g, " ").trim().includes("Test another headline")),
  );
  expect(another, "there's a “Test another headline” button");
} catch (e) {
  console.error("E2E FAILED:", e.message);
  await shot("99-failure").catch(() => {});
  process.exitCode = 1;
} finally {
  for (const s of openShoppers) await s.context.close().catch(() => {});
  console.log("\nbrowser errors:", errors.length ? errors.slice(0, 20).join("\n") : "none");
  const failed = checks.filter((c) => !c.ok);
  if (failed.length) console.log(`\nfailed:\n${failed.map((c) => `  ${c.what}`).join("\n")}`);
  console.log(`\n${checks.length - failed.length} of ${checks.length} checks passed`);
  if (failed.length) process.exitCode = 1;
  if (shopId) console.log(`\ntest shop: ${shopId}${slug ? ` (/s/${slug})` : ""}`);
  console.log(`workspace to delete: ${fleetName}`);
  await browser.close();
}
