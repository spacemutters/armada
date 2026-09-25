// Live check of the CJ box in Settings against the real CJ: a made-up key must come back refused,
// in plain words, and nothing must be saved. Makes a throwaway workspace; delete it afterwards.
// usage: node --env-file=.env.local scripts/check-cj-live.mjs https://armada-pi.vercel.app
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const base = (process.argv[2] || "https://armada-pi.vercel.app").replace(/\/$/, "");
const outDir = path.join(process.cwd(), ".shots", "cj-live");
fs.mkdirSync(outDir, { recursive: true });
const invite = execFileSync(process.execPath, ["--env-file=.env.local", "scripts/make-invite.mjs", base, "2"], { encoding: "utf8" }).trim().split(/\r?\n/).at(-1);

const browser = await puppeteer.launch({
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: true,
  defaultViewport: { width: 1440, height: 900 },
});
const page = await browser.newPage();
const cdp = await page.createCDPSession();
await cdp.send("WebAuthn.enable");
await cdp.send("WebAuthn.addVirtualAuthenticator", {
  options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true },
});
const text = () => page.evaluate(() => document.body.innerText);
let failed = 0;
const expect = (ok, what) => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${what}`);
};

try {
  await page.goto(invite, { waitUntil: "networkidle0" });
  await page.type('input[placeholder="Davis"]', "Live check");
  await page.type('input[placeholder="My fleet"]', "CJ live check");
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0", timeout: 60000 }), page.click('button[type="submit"]')]);

  await page.goto(`${base}/connections`, { waitUntil: "networkidle0" });
  expect(Boolean(await page.$('input[name="apiKey"]')), "Connections shows the CJ key box");
  await page.type('input[name="apiKey"]', "CJ0000000@api@00000000000000000000000000000000");
  const t0 = Date.now();
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => /^Connect CJ( again)?$/.test(b.textContent.trim())).click());
  await page.waitForFunction(() => /CJ is connected\.|didn't accept|CJ said:|Couldn't reach/.test(document.body.innerText), { timeout: 60000 }).catch(() => {});
  const after = await text();
  console.log(`  CJ answered in ${Date.now() - t0}ms`);
  expect(/CJ didn't accept that key|CJ said:/.test(after), "a made-up key is refused by the real CJ, in plain words");
  expect(!after.includes("CJ is connected."), "nothing was saved");
  await page.screenshot({ path: path.join(outDir, "connections-refused.png") });

  await page.goto(`${base}/products?tab=find&q=lamp`, { waitUntil: "networkidle0", timeout: 60000 });
  expect((await text()).includes("Connect CJ Dropshipping"), "Find products offers to connect CJ while it isn't connected");
  await page.goto(`${base}/builder/new`, { waitUntil: "networkidle0" });
  expect((await page.$eval('select[name="source"]', (s) => s.value)) === "practice", "the builder uses the practice catalog until CJ is connected");
} catch (e) {
  console.error("CHECK FAILED:", e.message);
  failed++;
} finally {
  await browser.close();
  console.log(failed ? `${failed} failed` : "all passed");
  process.exitCode = failed ? 1 : 0;
}
