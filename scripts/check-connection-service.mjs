// Offline checks for one-click connections through the connection service (Pipedream Connect).
// No network, no account.
//
//   node scripts/check-connection-service.mjs
//
// Prints one PASS/FAIL line per check and exits 1 on any FAIL.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;
function report(ok, label, detail) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? ` (${detail})` : ""}`);
}

const core = await import("../connectors/pipedream/core.ts");

// ---- settings ----
report(core.checkPdSettings({ clientId: "abc", clientSecret: "def", projectId: "proj_A1b2", environment: "development" }) === null, "good settings pass");
report(/Project ID/.test(core.checkPdSettings({ clientId: "abc", clientSecret: "def", projectId: "project-1", environment: "development" }) ?? ""), "a Project ID without proj_ is refused in plain words");
report(/space/.test(core.checkPdSettings({ clientId: "a b", clientSecret: "def", projectId: "proj_A1", environment: "production" }) ?? ""), "a pasted space is caught");
report(/Testing or Live/.test(core.checkPdSettings({ clientId: "a", clientSecret: "b", projectId: "proj_A1", environment: "staging" }) ?? ""), "only testing or live");
report(/Client secret/.test(core.checkPdSettings({ clientId: "a", clientSecret: " ", projectId: "proj_A1", environment: "production" }) ?? ""), "an empty secret is caught");

// ---- addresses ----
const target = "https://api.ebay.com/sell/account/v1/fulfillment_policy?marketplace_id=EBAY_US";
const p = core.relayPath("proj_X1", target, "armada-ws 1", "apn_9");
const b64 = p.split("/proxy/")[1].split("?")[0];
report(Buffer.from(b64, "base64url").toString("utf8") === target, "relay address carries the exact target, URL-safe base64");
report(!/[+/=]/.test(b64), "no +, / or = in the encoded target");
const q = new URLSearchParams(p.split("?")[1]);
report(q.get("external_user_id") === "armada-ws 1" && q.get("account_id") === "apn_9", "relay address names the user and the account");
report(p.startsWith("/v1/connect/proj_X1/proxy/"), "relay address is under the project");
const shopPath = core.relayPath("proj_X1", "/admin/api/2026-07/graphql.json", "u", "a");
report(Buffer.from(shopPath.split("/proxy/")[1].split("?")[0], "base64url").toString() === "/admin/api/2026-07/graphql.json", "Shopify goes as a path, so the service fills in the store's own address");
const page = core.connectPageUrl("https://pipedream.com/_static/connect.html?token=ctok_1&connectLink=true", "shopify");
report(new URL(page).searchParams.get("app") === "shopify" && new URL(page).searchParams.get("token") === "ctok_1", "connect page names the platform and keeps the token");

// ---- headers ----
const h = core.relayHeaders({ Authorization: "Bearer x", "X-Shopify-Access-Token": "y", Accept: "application/json", Cookie: "c", "Content-Language": "en-US", "x-pd-proxy-keep": "1" });
report(!Object.keys(h).some((k) => /authorization|access-token|cookie/i.test(k)), "Armada never sends its own keys or cookies through the relay");
report(h["x-pd-proxy-accept"] === "application/json" && h["x-pd-proxy-content-language"] === "en-US" && h["x-pd-proxy-keep"] === "1", "other headers go through with the relay's prefix");

// ---- accounts ----
const now = Date.parse("2026-09-25T12:00:00Z");
const listed = core.readAccounts({
  data: [
    { id: "apn_old", app: { name_slug: "shopify" }, created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z", healthy: true },
    { id: "apn_new", app: { name_slug: "shopify" }, created_at: "2026-09-25T11:58:00Z", updated_at: "2026-09-25T11:58:00Z", healthy: true },
    { id: "apn_dead", app: { name_slug: "shopify" }, created_at: "2026-09-25T11:59:00Z", dead: true },
    { id: "apn_ebay", app: { name_slug: "ebay" }, created_at: "2026-09-25T11:59:30Z" },
    { nope: true },
  ],
});
report(listed.length === 4, "accounts read from { data: [...] }, junk dropped", `${listed.length}`);
report(core.readAccounts([{ id: "apn_1" }]).length === 1, "accounts read from a bare list");
report(core.pickNewAccount(listed, "shopify", new Set(["apn_old"]), now)?.id === "apn_new", "the newest Shopify account Armada doesn't know yet is picked");
report(core.pickNewAccount(listed, "ebay", new Set(), now)?.id === "apn_ebay", "only the platform's own accounts count");
const again = core.readAccounts([{ id: "apn_same", app: { name_slug: "ebay" }, created_at: "2026-08-01T00:00:00Z", updated_at: "2026-09-25T11:55:00Z", healthy: true }]);
report(core.pickNewAccount(again, "ebay", new Set(["apn_same"]), now)?.id === "apn_same", "connecting the same account again is recognised when it was just refreshed");
report(core.pickNewAccount(again, "ebay", new Set(["apn_same"]), now + 3_600_000) === null, "an old refresh isn't taken for a new connection");
report(core.pickNewAccount(listed.filter((a) => a.id === "apn_dead"), "shopify", new Set(), now) === null, "a dead account is never picked");

// ---- what's kept ----
report(core.isViaService({ via: "pipedream", accountId: "apn_1", externalUserId: "armada-x" }), "a service credential is recognised");
report(!core.isViaService({ accessToken: "shpat_x" }), "Armada's own access isn't mistaken for one");
report(core.externalUserFor("abc") === "armada-abc", "the service's user id is per workspace");

// ---- wiring (read as text) ----
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const shopify = read("connectors/shopify/client.ts");
report(/typeof access !== "string"[\s\S]{0,400}relay\(/.test(shopify), "Shopify requests for service stores go through the relay");
report(/completeShopifyViaService[\s\S]{0,2000}seal\(account\)/.test(shopify), "a Shopify store connected through the service keeps only which account it is, sealed");
const ebay = read("connectors/ebay/client.ts");
report(/isViaService\(stored\)[\s\S]{0,300}ebayRequestVia/.test(ebay), "eBay calls for service accounts go through the relay");
const done = read("app/api/connect/service/[provider]/done/route.ts");
report(/session\.workspaceId !== state\.workspaceId \|\| session\.memberId !== state\.memberId/.test(done), "the return only finishes in the browser and as the person that started it");
report(/consumeState\(/.test(done), "the return uses up a one-time state");
const client = read("connectors/pipedream/client.ts");
report(/seal\(s\.clientSecret\)/.test(client), "the service's secret is kept sealed");
report((client.match(/\bfetch\(/g) ?? []).length === 1, "the service has one door (one place that sends requests)");

console.log(failures ? `\n${failures} check(s) failed` : "\nAll connection service checks passed");
process.exit(failures ? 1 : 0);
