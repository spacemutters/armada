// End-to-end run of one-click AI ads on a live Armada: sign up, build a practice shop, press
// "Make ads", wait for the AI (the ChatGPT tool, through the helper on this PC) to write them and for
// ChatGPT to make their pictures, check every ad has real pictures and every carousel at least four
// cards, create them paused, switch them on (practice), see practice results, then stop every ad.
// Then "Make an ad with AI" on one product: carousel posts with at least four slides, with pictures.
// Needs the AI helper running. Makes a throwaway workspace ("Ads check"); delete it afterwards.
// usage: node --env-file=.env.local scripts/e2e-ads.mjs https://armada-pi.vercel.app [--no-posts]
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const base = (process.argv[2] || "https://armada-pi.vercel.app").replace(/\/$/, "");
const withPosts = !process.argv.includes("--no-posts");
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
const started = Date.now();
const since = () => `${Math.round((Date.now() - started) / 1000)}s`;
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

/**
 * Every ad preview's pictures on the page: each composed picture fetched for real (cards off to the
 * side load lazily, so the page alone can't tell), and the placeholders still waiting.
 */
const adPictures = () => settled(() => readAdPictures());
/** Retries a page read that the page's own refresh (every few seconds while pictures are made) cut off. */
async function settled(read, tries = 4) {
  for (let i = 0; ; i++) {
    try {
      return await read();
    } catch (e) {
      if (i >= tries || !/detached Frame|Execution context was destroyed|context.*destroyed/i.test(e.message)) throw e;
      await page.waitForNetworkIdle({ idleTime: 500, timeout: 15000 }).catch(() => {});
    }
  }
}
const readAdPictures = () =>
  page.evaluate(async () => {
    // Every ad preview, in the draft cards and in the grid of created ads alike.
    const figs = [...document.querySelectorAll('figure[aria-label^="How it looks"]')];
    const srcs = [...new Set(figs.flatMap((f) => [...f.querySelectorAll("img")]).map((i) => i.src).filter((u) => /\/api\/ads\/picture\//.test(u)))];
    const waiting = figs.flatMap((f) => [...f.querySelectorAll('[role="img"]')]).map((e) => e.getAttribute("aria-label"));
    const results = await Promise.all(
      srcs.map(async (u) => {
        const r = await fetch(u).catch(() => null);
        const b = r ? new Uint8Array(await r.arrayBuffer()) : new Uint8Array();
        return r?.ok && r.headers.get("content-type") === "image/jpeg" && b[0] === 0xff && b[1] === 0xd8 ? null : u;
      }),
    );
    return {
      pictures: srcs.length,
      loaded: results.filter((x) => x === null).length,
      broken: results.filter(Boolean).slice(0, 3),
      waiting,
      icons: figs.flatMap((f) => [...f.querySelectorAll("svg.lucide")]).filter((s) => s.getBoundingClientRect().width > 60).length,
    };
  });

try {
  await page.goto(invite, { waitUntil: "networkidle0" });
  await page.type('input[placeholder="Davis"]', "Ads check");
  await page.type('input[placeholder="My fleet"]', "Ads check");
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0", timeout: 60000 }), page.click('button[type="submit"]')]);

  // A practice shop to advertise.
  await page.goto(`${base}/builder/new`, { waitUntil: "networkidle0" });
  await page.type('input[name="niche"]', "Pour-over coffee gear for small kitchens");
  await page.select('select[name="productCount"]', "8");
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click('button[type="submit"]')]);
  const shopId = page.url().split("/").at(-1);
  let ready = false;
  let aiPicked = 0;
  for (let i = 0; i < 108 && !ready; i++) {
    await sleep(5000);
    const s = await page.evaluate(async (id) => (await fetch(`/api/shops/${id}`, { cache: "no-store" })).json().catch(() => null), shopId).catch(() => null);
    if (s?.status === "failed") break;
    // The build stops at "Choose your products" and waits for a person; this run lets the AI pick.
    if (s?.status === "choosing" && aiPicked++ < 3) {
      await page.goto(`${base}/builder/${shopId}`, { waitUntil: "networkidle0" });
      expect(await press("Let the AI pick for me"), "the build waits for a choice, and “Let the AI pick for me” carries it on");
      continue;
    }
    ready = s?.status === "ready";
  }
  expect(ready, `a practice shop was built to advertise (${since()})`);
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
    if (i % 6 === 0) console.log(`  ${since()}: ${/Writing ads for/.test(t) ? "writing" : "waiting"}`);
  }
  expect(written, `the AI wrote the ads (${since()})`);
  await shot("02-written");
  const t2 = await text();
  expect(/Written by AI|written by AI/.test(t2), "the ads are labelled as written by AI");
  const cards = await page.$$eval("article[data-variation]", (els) => els.length);
  expect(cards >= 3, `there are several ad variations (${cards} ads)`);
  const early = await adPictures();
  expect(early.icons === 0, "no preview shows a big icon while pictures are being made");
  expect(early.waiting.length === 0 || early.waiting.every((w) => /Making this picture|Waiting for the AI helper|About to/.test(w ?? "")), `pictures being made say so in plain words (${early.waiting.length} waiting)`);

  // The pictures: ChatGPT makes them after the words (about a minute each, two at a time).
  const pictureStart = Date.now();
  let pics = early;
  for (let i = 0; i < 90; i++) {
    pics = await adPictures();
    if (pics.waiting.length === 0 && pics.pictures > 0 && pics.loaded === pics.pictures) break;
    if (i % 4 === 0) console.log(`  ${since()}: ${pics.loaded} pictures shown, ${pics.waiting.length} still being made`);
    await sleep(10000);
    await page.reload({ waitUntil: "networkidle0" }).catch(() => {});
  }
  const pictureSeconds = Math.round((Date.now() - pictureStart) / 1000);
  expect(pics.waiting.length === 0 && pics.pictures > 0 && pics.loaded === pics.pictures && !pics.broken.length,
    `every ad preview shows real pictures (${pics.loaded} shown, ${pics.waiting.length} waiting, ${pics.broken.length} broken) about ${pictureSeconds}s after the words`);
  const perAd = await settled(() => page.$$eval("article[data-variation]", (els) =>
    els.map((a) => {
      const m = /Carousel · (\d+) cards/.exec(a.innerText);
      return { carousel: Boolean(m), cards: m ? Number(m[1]) : 1, pictures: new Set([...a.querySelectorAll('figure img[src*="/api/ads/picture/"]')].map((i) => i.src.split("?")[0])).size };
    }),
  ));
  console.log(`  ads: ${perAd.map((a) => (a.carousel ? `carousel of ${a.cards}` : "single")).join(", ")}`);
  expect(perAd.some((a) => a.carousel), "at least one ad is a carousel");
  expect(perAd.filter((a) => a.carousel).every((a) => a.cards >= 4), "every carousel has at least four cards");
  expect(perAd.every((a) => a.pictures >= (a.carousel ? a.cards : 1)), "every ad has its own pictures (one per card for a carousel)");
  const t3 = await text();
  expect(/Practice ad/.test(t3), "practice ads say so on the previews");
  // A picture itself: a real JPEG at the platform's size.
  const probe = await settled(() => page.evaluate(async () => {
    const img = document.querySelector('article[data-variation] figure img[src*="shape=square"]');
    if (!img) return null;
    const res = await fetch(img.src);
    const b = new Uint8Array(await res.arrayBuffer());
    return { type: res.headers.get("content-type"), cache: res.headers.get("cache-control"), bytes: b.length, jpeg: b[0] === 0xff && b[1] === 0xd8 };
  }));
  expect(probe?.jpeg && probe.type === "image/jpeg" && /immutable/.test(probe.cache ?? ""), `a card picture is a JPEG cached for good (${probe ? `${Math.round(probe.bytes / 1024)} KB` : "none"})`);
  await shot("03-pictures-ready");
  const first = await page.$("article[data-variation]");
  if (first) await first.screenshot({ path: path.join(outDir, "03a-first-ad.png") });
  const carouselAd = await page.evaluateHandle(() => [...document.querySelectorAll("article[data-variation]")].find((a) => /Carousel ·/.test(a.innerText)) ?? null);
  if (carouselAd.asElement()) await carouselAd.asElement().screenshot({ path: path.join(outDir, "03b-carousel-ad.png") });
  // The pictures list and "Make again".
  const opened = await page.evaluate(() => {
    const b = [...document.querySelectorAll("article[data-variation] button")].find((x) => /^Pictures/.test(x.textContent.trim()));
    if (!b) return false;
    b.click();
    return true;
  });
  await sleep(600);
  const remakeButtons = await page.$$eval("article[data-variation] button", (bs) => bs.filter((b) => /Make again/.test(b.textContent)).length);
  expect(opened && remakeButtons > 0, `each ad lists its pictures, with Make again on the ones made with AI (${remakeButtons})`);
  if (first) await first.screenshot({ path: path.join(outDir, "03c-pictures-list.png") });
  // Phone and dark appearance.
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await page.reload({ waitUntil: "networkidle0" });
  await shot("04-phone", false);
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);
  await page.setViewport({ width: 1440, height: 900 });
  await page.reload({ waitUntil: "networkidle0" });
  if ((await page.$("article[data-variation]")) !== null) await (await page.$("article[data-variation]")).screenshot({ path: path.join(outDir, "05-dark-ad.png") });
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
  await page.reload({ waitUntil: "networkidle0" });

  // Create them paused, then switch on (practice).
  expect(await press("Create these ads"), "Create these ads — paused");
  // Wait for the real Switch on button (the hint under Create also says "Switch on").
  const created = await page
    .waitForFunction(() => [...document.querySelectorAll("button")].some((b) => /^\s*Switch on\s*$/.test(b.textContent) && !b.disabled), { timeout: 120000 })
    .then(() => true, () => false);
  expect(created, "the ads are created switched off, with a Switch on button");
  await shot("06-created-paused");
  expect(await press("Switch on"), "Switch on");
  const on = await waitFor(/Pause these ads|Stop every ad in every shop/, 60000);
  expect(on, "the ads are on");
  await sleep(2000);
  await page.reload({ waitUntil: "networkidle0" });
  const t4 = await text();
  expect(/practice/i.test(t4) && /made up|made-up/i.test(t4), "practice results are labelled as made up");
  const livePics = (await adPictures()).loaded;
  expect(livePics > 0, `the created ads keep their pictures (${livePics})`);
  await shot("07-on");

  // Stop everything.
  expect(await press("Stop every ad in every shop"), "Stop every ad in every shop");
  const stopped = await waitFor(/Switched off|Stopped|stopped|Switch on/, 60000);
  expect(stopped, "every ad stops");
  await shot("08-stopped");

  if (withPosts) {
    // "Make an ad with AI" on one product: carousel posts about it, with pictures.
    await page.goto(`${base}/products`, { waitUntil: "networkidle0" });
    const productHref = await page.evaluate(() => [...document.querySelectorAll('a[href^="/products/"]')].map((a) => a.getAttribute("href")).find((h) => /\/products\/[0-9a-f-]{36}$/.test(h)) ?? null);
    expect(Boolean(productHref), "the shop's products are listed");
    if (!productHref) throw new Error("no product to make posts about");
    await page.goto(base + productHref, { waitUntil: "networkidle0" });
    expect(await press("Make an ad with AI"), "a product offers “Make an ad with AI”");
    await page.waitForFunction(() => location.pathname === "/social", { timeout: 60000 }).catch(() => {});
    const postsStart = Date.now();
    let posts = [];
    for (let i = 0; i < 90; i++) {
      await sleep(10000);
      await page.reload({ waitUntil: "networkidle0" }).catch(() => {});
      // Slides past the first load lazily, so each one is fetched for real.
      posts = await settled(() => page.$$eval("article[id^='post-']", (els) =>
        Promise.all(
          els.map(async (a) => {
            const srcs = [...a.querySelectorAll('figure img[src*="/api/social/slide/"]')].map((i) => i.src);
            const ok = await Promise.all(srcs.map((u) => fetch(u).then((r) => r.ok && /image\/(jpeg|png)/.test(r.headers.get("content-type") ?? ""), () => false)));
            return {
              slides: Number(/(\d+) slides/.exec(a.innerText)?.[1] ?? 0),
              making: /Making this slide's picture|About to make this slide's picture|Waiting for the AI helper/.test(a.querySelector("figure")?.innerText ?? ""),
              loaded: ok.filter(Boolean).length,
            };
          }),
        ),
      ));
      const writing = /Writing \d+ ads for/.test(await settled(() => text()));
      if (!writing && posts.length && posts.every((p) => !p.making && p.loaded >= p.slides)) break;
      if (i % 3 === 0) console.log(`  ${since()}: ${writing ? "writing posts" : `${posts.length} posts, ${posts.filter((p) => p.making).length} making pictures`}`);
    }
    const postSeconds = Math.round((Date.now() - postsStart) / 1000);
    expect(posts.length >= 1, `the AI wrote carousel posts about the product (${posts.length}, ${postSeconds}s with pictures)`);
    expect(posts.length > 0 && posts.every((p) => p.slides >= 4), `every carousel post has at least four slides (${posts.map((p) => p.slides).join(", ")})`);
    expect(posts.length > 0 && posts.every((p) => !p.making && p.loaded >= p.slides), "every slide is drawn, with its pictures made");
    const scenes = await page.$$eval("article[id^='post-'] button", (bs) => bs.filter((b) => /Pictures made with AI/.test(b.textContent)).length);
    expect(scenes > 0, `posts have pictures made with AI, listed with Make again (${scenes} posts)`);
    await shot("09-posts");
    const firstPost = await page.$("article[id^='post-']");
    if (firstPost) await firstPost.screenshot({ path: path.join(outDir, "09a-first-post.png") });
    // Save each slide of the first post, to look at.
    const slideSrcs = await page.$$eval("article[id^='post-']:first-of-type figure img[src*='/api/social/slide/']", (is) => is.map((i) => i.src));
    for (const [i, src] of slideSrcs.entries()) {
      const buf = await page.evaluate(async (u) => Array.from(new Uint8Array(await (await fetch(u)).arrayBuffer())), src);
      fs.writeFileSync(path.join(outDir, `10-slide-${i + 1}.jpg`), Buffer.from(buf));
    }
  }
} catch (e) {
  console.error("E2E FAILED:", e.message);
  await shot("99-failure").catch(() => {});
  failed++;
} finally {
  console.log("browser errors:", errors.length ? errors.slice(0, 6).join(" | ") : "none");
  await browser.close();
  console.log(failed ? `${failed} failed` : "all passed", `(${since()})`);
  console.log("workspace to delete: Ads check");
  process.exitCode = failed ? 1 : 0;
}
