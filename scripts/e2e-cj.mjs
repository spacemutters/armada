// End-to-end run of the CJ connection against the stand-in CJ server (scripts/mock-cj.mjs):
// a refused key, a good key, a live CJ search, adding products (checked with CJ afterwards),
// and a whole shop built from CJ products. Needs Armada running with CJ_BASE_URL pointing at the mock
// and an AI helper polling that same Armada.
// usage: node --env-file=.env.local scripts/e2e-cj.mjs <base-url> [--mock http://127.0.0.1:4599] [--shop "idea"] [--count 2]
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const base = (process.argv[2] || "http://localhost:3000").replace(/\/$/, "");
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const mock = arg("--mock", "http://127.0.0.1:4599");
const shopIdea = arg("--shop", "Kitchen tools and cookware for small kitchens");
const shopCount = Number(arg("--count", "1"));
const outDir = path.join(process.cwd(), ".shots", "cj");
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
const text = () => page.evaluate(() => document.body.innerText);
const checks = [];
const expect = (ok, what) => {
  checks.push({ ok, what });
  console.log(`${ok ? "PASS" : "FAIL"} ${what}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// One poll of a build's status. A failed poll (this laptop's link to the database drops now and
// then) is logged and skipped, not treated as the build failing.
const shopStatus = async (id) => {
  const r = await page.evaluate(async (i) => {
    const res = await fetch(`/api/shops/${i}`, { cache: "no-store" });
    return res.ok ? { ok: true, body: await res.json() } : { ok: false, status: res.status };
  }, id);
  if (!r.ok) console.log(`  (status poll got ${r.status}, trying again)`);
  return r.ok ? r.body : null;
};

try {
  step("sign up");
  await page.goto(invite, { waitUntil: "networkidle0" });
  await page.type('input[placeholder="Davis"]', "Tester");
  await page.type('input[placeholder="My fleet"]', "CJ test fleet");
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0", timeout: 60000 }), page.click('button[type="submit"]')]);
  const workspaceHint = page.url();
  console.log("landed on", workspaceHint);

  // CJ connects on the Connections page: paste the key, press Connect CJ, and the answer appears in place.
  const connectCj = async (key) => {
    await page.goto(`${base}/connections`, { waitUntil: "networkidle0" });
    await page.$eval('input[name="apiKey"]', (el) => (el.value = ""));
    await page.type('input[name="apiKey"]', key);
    await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => /^Connect CJ( again)?$/.test(b.textContent.trim())).click());
    await page
      .waitForFunction(() => /CJ is connected\.|didn't accept|CJ said:|allowance|Couldn't reach/.test(document.body.innerText), { timeout: 60000 })
      .catch(() => {});
    await new Promise((r) => setTimeout(r, 1500));
    return text();
  };

  step("a refused key");
  expect((await connectCj("CJ-THIS-KEY-IS-WRONG-99")).includes("CJ didn't accept that key"), "a wrong key gets a plain refusal");
  await shot("01-bad-key", false);

  step("the right key");
  const afterConnect = await connectCj(`CJ-MOCK-GOOD-KEY-${Date.now()}`);
  expect(afterConnect.includes("CJ is connected."), "a good key connects");
  if (!afterConnect.includes("CJ is connected.")) throw new Error("CJ didn't connect, so nothing after this would test CJ");
  await page.reload({ waitUntil: "networkidle0" });
  expect((await text()).includes("Mock Test Shop"), "shows the CJ account it's connected as");
  await shot("02-connected", false);

  step("search CJ");
  const t0 = Date.now();
  await page.goto(`${base}/products?tab=find&q=${encodeURIComponent("knife, pan, spoon")}`, { waitUntil: "networkidle0", timeout: 90000 });
  console.log(`  search took ${Date.now() - t0}ms`);
  const found = await page.$$eval('input[name="catalogIds"]', (els) => els.length);
  const findText = await text();
  expect(found > 0, `CJ search returns products (${found})`);
  expect(findText.includes("Searching CJ Dropshipping's real catalog"), "the page says it is searching CJ");
  expect(findText.includes("shipping estimated"), "unchecked results say their shipping is estimated");
  await shot("03-find-cj");

  step("CJ's access runs out mid-use, then CJ says it's busy");
  // Results must come from CJ itself, not the practice catalog the page falls back to.
  const cjResults = async () =>
    (await text()).includes("Searching CJ Dropshipping's real catalog") ? await page.$$eval('input[name="catalogIds"]', (els) => els.length) : 0;
  const before = await (await fetch(`${mock}/__stats`)).json();
  await fetch(`${mock}/__expire`);
  await page.goto(`${base}/products?tab=find&q=wok`, { waitUntil: "networkidle0", timeout: 90000 });
  const renewedCount = ((await (await fetch(`${mock}/__stats`)).json()).byPath["/authentication/refreshAccessToken"] ?? 0) - (before.byPath["/authentication/refreshAccessToken"] ?? 0);
  expect((await cjResults()) > 0 && renewedCount === 1, `a CJ search still works after CJ's access ran out (renewed ${renewedCount} time)`);
  await fetch(`${mock}/__busy?n=2`);
  await page.goto(`${base}/products?tab=find&q=pot`, { waitUntil: "networkidle0", timeout: 90000 });
  const busyNow = (await (await fetch(`${mock}/__stats`)).json()).busySent;
  expect((await cjResults()) > 0 && busyNow - before.busySent === 2, "a CJ search still works when CJ is busy twice in a row");
  await fetch(`${mock}/__points?n=1`);
  await page.goto(`${base}/products?tab=find&q=lamp`, { waitUntil: "networkidle0", timeout: 90000 });
  expect((await text()).includes("allowance for this account is used up"), "running out of CJ's daily allowance says so plainly, without retrying");
  await page.goto(`${base}/connections`, { waitUntil: "networkidle0" });
  const settingsNow = await text();
  expect(settingsNow.includes("Mock Test Shop") && !settingsNow.includes("Needs you"), "the connection still reads as connected, not needing attention");

  step("add three products; CJ checks them afterwards");
  await page.goto(`${base}/products?tab=find&q=${encodeURIComponent("knife, pan, spoon")}`, { waitUntil: "networkidle0", timeout: 90000 });
  await page.$$eval('input[name="catalogIds"]:not([disabled])', (els) => els.slice(0, 3).forEach((e) => (e.checked = true)));
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0", timeout: 60000 }), page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Add chosen")).click())]);
  expect((await text()).includes("Added 3 products"), "three products added");
  let confirmed = false;
  for (let i = 0; i < 12 && !confirmed; i++) {
    await sleep(3000);
    await page.reload({ waitUntil: "networkidle0" });
    confirmed = !(await text()).includes("shipping not confirmed by CJ yet");
  }
  expect(confirmed, "CJ confirmed shipping for the added products within 36 seconds");
  await shot("04-added-confirmed");

  step(`build ${shopCount} ${shopCount > 1 ? "shops at once" : "shop"} from CJ: “${shopIdea}”`);
  await page.goto(`${base}/builder/new`, { waitUntil: "networkidle0" });
  const sourceValue = await page.$eval('select[name="source"]', (s) => s.value);
  expect(sourceValue === "cj", "the builder defaults to CJ once connected");
  await page.type('input[name="niche"]', shopIdea);
  await page.select('select[name="productCount"]', "8");
  await page.select('select[name="count"]', String(shopCount));
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click('button[type="submit"]')]);
  const shopIds =
    shopCount > 1
      ? await page.$$eval('a[href^="/builder/"]', (as) => [...new Set(as.map((a) => a.getAttribute("href").split("/").at(-1)).filter((id) => /^[0-9a-f-]{36}$/.test(id)))])
      : [page.url().split("/").at(-1)];
  expect(shopIds.length === shopCount, `${shopCount} ${shopCount > 1 ? "builds" : "build"} started`);
  const started = Date.now();
  const statuses = new Map();
  let lastLine = "";
  while (Date.now() - started < 14 * 60_000) {
    await sleep(5000);
    for (const id of shopIds) {
      const s = await shopStatus(id);
      if (s) statuses.set(id, s);
    }
    if (statuses.size < shopIds.length) continue;
    const line = [...statuses.values()]
      .map((s) => {
        const running = s.progress.filter((p) => p.state === "running").map((p) => `${p.label}${p.note ? ` (${p.note})` : ""}`);
        return `${s.status}${running.length ? ` · ${running.join(", ")}` : ""}`;
      })
      .join("  |  ");
    if (line !== lastLine) console.log(`  ${Math.round((Date.now() - started) / 1000)}s ${line}`);
    lastLine = line;
    if ([...statuses.values()].every((s) => s.status === "ready" || s.status === "failed")) break;
  }
  for (const [id, s] of statuses) {
    expect(s.status === "ready", `CJ shop ${id.slice(0, 8)} is ready (${s.status}${s.error ? `: ${s.error}` : ""})`);
    const note = s.progress.find((p) => p.key === "products")?.note ?? "";
    console.log("  products step:", note);
    expect(/shipping confirmed by CJ/.test(note), "its kept products all had shipping confirmed by CJ");
  }
  console.log(`  all done in ${Math.round((Date.now() - started) / 1000)}s`);
  const shopUrl = `${base}/builder/${shopIds[0]}`;
  const status = statuses.get(shopIds[0]);
  await page.goto(shopUrl, { waitUntil: "networkidle0" });
  await shot("05-shop");

  if (status?.status === "ready") {
    const preview = await page.$eval('a[target="_blank"]', (a) => a.href);
    await page.goto(preview, { waitUntil: "networkidle0" });
    await page.evaluate(() => document.fonts.ready);
    // Photos load lazily: scroll through so every one is asked for, then check none failed.
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 500) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 120));
      }
      window.scrollTo(0, 0);
    });
    await sleep(1500);
    const broken = await page.$$eval("img", (els) => els.filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.src));
    expect(broken.length === 0, `every storefront photo loads (${broken.length} didn't${broken.length ? `: ${broken.slice(0, 3).join(", ")}` : ""})`);
    expect((await text()).includes("Checkout turns on when it's published to Shopify"), "the footer calls a CJ shop a preview, not practice");
    await shot("06-storefront");
    const productHref = await page.$eval('a[href*="/products/"]', (a) => a.href);
    await page.goto(productHref, { waitUntil: "networkidle0" });
    await sleep(800);
    await shot("07-storefront-product");
    const imgs = await page.$$eval("img", (els) => els.filter((i) => i.naturalWidth > 0).length);
    expect(imgs > 0, `the product page shows real supplier photos (${imgs})`);
  }

  step("an idea CJ has almost nothing for stops with a plain reason instead of a thin shop");
  await page.goto(`${base}/builder/new`, { waitUntil: "networkidle0" });
  await page.type('input[name="niche"]', "Replacement ribbons for vintage typewriters");
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click('button[type="submit"]')]);
  const thinId = page.url().split("/").at(-1);
  let thin = null;
  for (let i = 0; i < 60; i++) {
    await sleep(5000);
    thin = (await shopStatus(thinId)) ?? thin;
    if (thin && thin.status !== "building") break;
  }
  console.log(`  ${thin?.status}: ${thin?.error}`);
  expect(
    thin?.status === "failed" && /needs at least 4|had nothing for this idea|didn't find products that fit/.test(thin?.error ?? ""),
    "a thin idea stops with a plain reason",
  );
  await page.goto(`${base}/builder/${thinId}`, { waitUntil: "networkidle0" });
  await shot("08-thin-idea", false);

  step("CJ's speed limit");
  const stats = await (await fetch(`${mock}/__stats`)).json();
  console.log("  mock CJ:", JSON.stringify(stats));
  expect(stats.tooFast === 0, `no call broke CJ's one-a-second limit (${stats.tooFast} of ${stats.calls} did), even though CJ reported a limit of 100 a second`);
  expect(stats.searchesWithoutCategory === 0, `every search asked CJ for category names (${stats.searchesWithoutCategory} didn't)`);
  expect(stats.pointsOutSent === 1, `the out-of-allowance answer wasn't retried (${stats.pointsOutSent} sent)`);
} catch (e) {
  console.error("E2E FAILED:", e.message);
  await shot("99-failure").catch(() => {});
  process.exitCode = 1;
} finally {
  console.log("\nbrowser errors:", errors.length ? errors.slice(0, 20).join("\n") : "none");
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length} of ${checks.length} checks passed`);
  if (failed.length) process.exitCode = 1;
  await browser.close();
}
