// Browser test of the admin's switch for one-click connections, against the stand-in
// (scripts/mock-pipedream.mjs): a wrong secret is refused in plain words and nothing is kept; the
// right values switch it on and Shopify offers Connect; Switch off puts it back. Makes a throwaway
// workspace ("Service admin check") and makes its person an admin; delete it afterwards.
//
// The switch is kept for all of Armada, so this run switches it off again at the end, whatever happens.
//
// usage: node --env-file=.env.local scripts/e2e-service-admin.mjs http://localhost:3002
//   with Armada running there with PIPEDREAM_API_BASE=<mock> and no PIPEDREAM_CLIENT_ID set.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";
import puppeteer from "puppeteer-core";

const base = (process.argv[2] || "http://localhost:3002").replace(/\/$/, "");
const outDir = path.join(process.cwd(), ".shots", "service");
fs.mkdirSync(outDir, { recursive: true });
const { SUPABASE_CA } = await import("../lib/db/supabase-ca.ts");
const url = process.env.DATABASE_URL;
const sql = postgres(url, { prepare: false, max: 1, host: process.env.DATABASE_HOSTADDR || undefined, ssl: { ca: SUPABASE_CA, servername: new URL(url).hostname, rejectUnauthorized: true } });
// Armada's row rules hide these tables from everyone but the system, so every query here runs as it.
const asSystem = (fn) =>
  sql.begin(async (tx) => {
    await tx`select set_config('armada.system', 'on', true)`;
    return fn(tx);
  });
const rowCount = async () => asSystem(async (tx) => (await tx`select count(*)::int as n from armada.connection_service`)[0].n);

const before = await rowCount();
if (before) {
  console.log("A connection service is already switched on for Armada; this test would replace it. Stopping.");
  await sql.end();
  process.exit(2);
}

const invite = execFileSync(process.execPath, ["--env-file=.env.local", "scripts/make-invite.mjs", base, "1"], { encoding: "utf8" }).trim().split(/\r?\n/).at(-1);
const browser = await puppeteer.launch({ executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", headless: true, defaultViewport: { width: 1440, height: 900 } });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(`console: ${m.text()}`));
const cdp = await page.createCDPSession();
await cdp.send("WebAuthn.enable");
await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true } });
const text = () => page.evaluate(() => document.body.innerText);
const shot = (name) => page.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: true });
let failed = 0;
const expect = (ok, what) => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${what}`);
};
const fill = async (name, value) => {
  await page.$eval(`[name="${name}"]`, (el) => (el.value = ""));
  await page.type(`[name="${name}"]`, value);
};
const pressAndWait = async (label, until) => {
  const buttons = await page.$$("button");
  for (const b of buttons) {
    if ((await b.evaluate((el) => (el.textContent ?? "").trim())) === label) {
      await b.click();
      await page.waitForFunction(until, { timeout: 30000 }).catch(() => {});
      return true;
    }
  }
  return false;
};

try {
  await page.goto(invite, { waitUntil: "networkidle0" });
  await page.type('input[placeholder="Davis"]', "Service admin check");
  await page.type('input[placeholder="My fleet"]', "Service admin check");
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0", timeout: 60000 }), page.click('button[type="submit"]')]);
  const made = await asSystem(
    (tx) => tx`
      update armada.members set is_admin = true
      where display_name = 'Service admin check' and workspace_id = (select id from armada.workspaces where name = 'Service admin check' order by created_at desc limit 1)
      returning id`,
  );
  if (made.length !== 1) throw new Error("couldn't make the test person an admin");

  await page.goto(`${base}/connections`, { waitUntil: "networkidle0" });
  await shot("11-admin-off");
  const t0 = await text();
  expect(/One-click connections[\s\S]*Off/.test(t0), "the admin sees One-click connections, switched off");
  expect(/Shopify[\s\S]{0,400}Coming soon/.test(t0), "Shopify is Coming soon while it's off");

  await fill("projectId", "proj_Mock1");
  await fill("clientId", "mock-client");
  await fill("clientSecret", "wrong-secret");
  await pressAndWait("Switch on", () => /didn.t accept|Paste them again/.test(document.body.innerText));
  const t1 = await text();
  await shot("12-admin-wrong");
  expect(/didn.t accept Armada.s Client ID and secret/.test(t1), "a wrong secret is refused in plain words");
  expect((await rowCount()) === 0, "nothing is kept after a refusal");

  const kept = await page.evaluate(() => [document.querySelector('[name="projectId"]')?.value, document.querySelector('[name="clientId"]')?.value, document.querySelector('[name="clientSecret"]')?.value]);
  expect(kept[0] === "proj_Mock1" && kept[1] === "mock-client", `what was typed is still there to fix (${kept[0]}, ${kept[1]})`);
  expect(!kept[2], "the refused secret isn't left on the page");
  await fill("clientSecret", "mock-secret");
  await pressAndWait("Switch on", () => /Switched on/.test(document.body.innerText));
  const t2 = await text();
  expect(/Switched on/.test(t2), "the right values switch it on");
  expect((await rowCount()) === 1, "the settings are kept");
  const [row] = await asSystem((tx) => tx`select client_secret from armada.connection_service`);
  expect(row && !Buffer.from(row.clientSecret ?? row.client_secret).toString("utf8").includes("mock-secret"), "the secret is kept sealed, not as readable text");
  await page.goto(`${base}/connections`, { waitUntil: "networkidle0" });
  await shot("13-admin-on");
  const t3 = await text();
  expect(/Connect Shopify/.test(t3), "Shopify now offers Connect");
  expect(/On, testing/.test(t3), "the switch says it's on, for testing");

  await pressAndWait("Switch off", () => /Switched off/.test(document.body.innerText));
  expect((await rowCount()) === 0, "Switch off removes the settings");
  await page.goto(`${base}/connections`, { waitUntil: "networkidle0" });
  expect(/Shopify[\s\S]{0,400}Coming soon/.test(await text()), "Shopify is back to Coming soon");
} catch (e) {
  console.error("CHECK FAILED:", e.message);
  failed++;
} finally {
  await asSystem((tx) => tx`delete from armada.connection_service`);
  console.log("browser errors:", errors.length ? errors.slice(0, 6).join(" | ") : "none");
  await browser.close();
  await sql.end();
  console.log(failed ? `${failed} failed` : "all passed");
  console.log("workspace to delete: Service admin check");
  process.exitCode = failed ? 1 : 0;
}
