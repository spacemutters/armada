// Screenshots public pages (storefronts) in headless Chrome at desktop and phone widths.
// usage: node scripts/shoot.mjs <url> <name> [more url name pairs...]
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const pairs = [];
for (let i = 2; i < process.argv.length; i += 2) pairs.push([process.argv[i], process.argv[i + 1]]);
const outDir = path.join(process.cwd(), ".shots");
fs.mkdirSync(outDir, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: true,
  args: ["--no-first-run", "--no-default-browser-check"],
});
try {
  for (const [url, name] of pairs) {
    for (const [label, vp] of [
      ["desktop", { width: 1440, height: 900 }],
      ["phone", { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }],
    ]) {
      const page = await browser.newPage();
      await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
      await page.setViewport(vp);
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("requestfailed", (r) => errors.push(`request failed: ${r.url()}`));
      page.on("response", (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`));
      await page.goto(url, { waitUntil: "networkidle0", timeout: 60000 });
      await page.evaluate(() => document.fonts.ready);
      await new Promise((r) => setTimeout(r, 1800));
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      const file = path.join(outDir, `${name}-${label}.png`);
      await page.screenshot({ path: file, fullPage: true });
      console.log(file, `overflow ${overflow}px`, errors.length ? `issues: ${errors.join(" | ")}` : "no issues");
      await page.close();
    }
  }
} finally {
  await browser.close();
}
