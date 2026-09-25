// Screenshots of the glass layer (the sidebar, the phone's tab bar and top bar, the sticky action
// bars) over a practice fleet, in light and dark, at desktop and phone widths, for a person to look
// at. Makes a throwaway workspace ("Glass check"); delete it afterwards.
// usage: node --env-file=.env.local scripts/shoot-glass.mjs <base-url>
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const base = (process.argv[2] || "http://localhost:3002").replace(/\/$/, "");
const outDir = path.join(process.cwd(), ".shots", "glass");
fs.mkdirSync(outDir, { recursive: true });
const invite = execFileSync(process.execPath, ["--env-file=.env.local", "scripts/make-invite.mjs", base, "1"], { encoding: "utf8" }).trim().split(/\r?\n/).at(-1);

const browser = await puppeteer.launch({ executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", headless: true, defaultViewport: { width: 1440, height: 900 } });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const cdp = await page.createCDPSession();
await cdp.send("WebAuthn.enable");
await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true } });

await page.goto(invite, { waitUntil: "networkidle0" });
await page.type('input[placeholder="Davis"]', "Glass check");
await page.type('input[placeholder="My fleet"]', "Glass check");
await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0", timeout: 60000 }), page.click('button[type="submit"]')]);
await page.select("#count", "24");
await Promise.all([
  page.waitForNavigation({ waitUntil: "networkidle0", timeout: 120000 }),
  page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Start a practice fleet")).click()),
]);

const views = [
  ["desktop", { width: 1440, height: 900, isMobile: false, hasTouch: false }],
  ["phone", { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }],
];
const pages = [
  ["home", "/"],
  ["products", "/products"],
  ["orders", "/orders"],
];
for (const scheme of ["light", "dark"]) {
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: scheme }]);
  for (const [vname, vp] of views) {
    await page.setViewport(vp);
    for (const [pname, url] of pages) {
      await page.goto(base + url, { waitUntil: "networkidle0" });
      // Scroll a little so content sits beneath the floating bars, the way people see them.
      await page.evaluate(() => window.scrollTo(0, 260));
      await new Promise((r) => setTimeout(r, 400));
      await page.screenshot({ path: path.join(outDir, `${pname}-${vname}-${scheme}.png`) });
    }
  }
}
// The same with less transparency asked for: the glass must turn opaque.
// Puppeteer's own list doesn't know this setting yet, so it's asked of Chrome directly.
await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-transparency", value: "reduce" }, { name: "prefers-color-scheme", value: "light" }] });
await page.setViewport(views[1][1]);
await page.goto(`${base}/products`, { waitUntil: "networkidle0" });
const opaque = await page.evaluate(() => getComputedStyle(document.querySelector("nav.glass, .glass")).backdropFilter);
console.log("reduced transparency, backdrop filter:", opaque);
await page.screenshot({ path: path.join(outDir, "products-phone-reduced-transparency.png") });
console.log("browser errors:", errors.length ? errors.slice(0, 5).join(" | ") : "none");
await browser.close();
console.log(`shots in ${outDir}; workspace to delete: Glass check`);
