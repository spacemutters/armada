// Offline checks for Instagram in one press through Composio. No network, no account.
//
//   node scripts/check-composio.mjs
//
// Prints one PASS/FAIL line per check and exits 1 on any FAIL.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;
const report = (ok, label, detail) => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${!ok && detail !== undefined ? ` (${JSON.stringify(detail)})` : ""}`);
};

const p = await import("../connectors/composio/parse.ts");

// ---- answers ----
report(JSON.stringify(p.dataOf({ data: { id: "1" } })) === '{"id":"1"}', "tool data as an object");
report(p.dataOf({ data: '{"id":"178"}' }).id === "178", "tool data sent as JSON text");
report(p.dataOf({ data: "plain" }).value === "plain", "tool data sent as plain text");
report(p.toolOk({ successful: true }).ok === true, "a successful tool call");
const refused = p.toolOk({ successful: false, error: "Application request limit reached" });
report(!refused.ok && /limit/.test(refused.problem), "a refused tool call keeps the platform's words");
report(!p.toolOk(null).ok, "no answer is a refusal");
report(p.idIn({ id: "17895695668004550" }) === "17895695668004550", "container id from id");
report(p.idIn({ creation_id: "42" }) === "42", "container id from creation_id");
report(p.idIn({ data: { id: 7 } }) === "7", "container id nested, as a number");
report(p.idIn({}) === null, "no id means none");
const me = p.igUserOf({ data: { id: "1784", username: "lull.room", name: "Lull Room" } });
report(me?.id === "1784" && me.username === "lull.room", "the Instagram account from its info");
report(p.igUserOf({ username: "x" }) === null, "no id means no account");
const link = p.linkOf({ redirect_url: "https://connect.composio.dev/link/lk_1", connected_account_id: "ca_1", link_token: "lk_1" });
report(link?.redirectUrl.startsWith("https://") && link.connectedAccountId === "ca_1", "the hosted sign-in link and its connection");
report(p.linkOf({ redirect_url: "http://evil.example", connected_account_id: "ca_1" }) === null, "only an https sign-in page is followed");
report(p.accountStatusOf({ status: "active" }) === "ACTIVE", "connection status read case-blind");
const cfg = p.managedConfigIn({ items: [
  { id: "ac_other", toolkit: { slug: "gmail" }, is_composio_managed: true },
  { id: "ac_custom", toolkit: { slug: "instagram" }, is_composio_managed: false },
  { id: "ac_managed", toolkit: { slug: "instagram" }, is_composio_managed: true, status: "ENABLED" },
] }, "instagram");
report(cfg === "ac_managed", "the managed Instagram setup is found, not a custom or other one", cfg);
report(p.managedConfigIn({ items: [{ id: "ac_off", toolkit: { slug: "instagram" }, is_composio_managed: true, status: "DISABLED" }] }, "instagram") === null, "a switched-off setup isn't used");

// ---- wiring (read as text) ----
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const connect = read("lib/social/accounts/connect.ts");
report(/composioInstagramFinish[\s\S]{0,400}consumeState\([\s\S]{0,200}samePerson\(state, person\)/.test(connect), "the Instagram return uses up a one-time state and must be the same person");
report(/waitUntilActive\(connectedAccountId\)/.test(connect), "Armada saves Instagram only once Composio says it's active");
report(/secret: \{ composio: \{ connectedAccountId, userId \} \}/.test(connect), "only which connection it is is kept, never a key");
const index = read("lib/social/accounts/index.ts");
report(/acc\.secret\?\.composio[\s\S]{0,400}postInstagramCarousel/.test(index), "Instagram posts from these accounts go through Composio");
const client = read("connectors/composio/client.ts");
report((client.match(/\bfetch\(/g) ?? []).length === 1, "Composio has one door (one place that sends requests)");
report(/urls\.length < 2/.test(client) && /slice\(0, 10\)/.test(client), "carousels stay within Instagram's 2 to 10 pictures");
report(/backend\\\.composio\\\.dev/.test(read("scripts/preflight.mjs")), "only connectors/ may call Composio (one-door rule)");

console.log(failures ? `\n${failures} check(s) failed` : "\nAll Composio checks passed");
process.exit(failures ? 1 : 0);
