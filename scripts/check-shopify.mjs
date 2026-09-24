// Offline checks for the Shopify connection. No network, no database, no settings needed.
//
//   node scripts/check-shopify.mjs             run every check, one PASS/FAIL line each, exit 1 on any FAIL
//   node scripts/check-shopify.mjs --selftest  also break each wiring rule on purpose and confirm its check fires
//
// 1. Store addresses: what people type turns into the permanent yourstore.myshopify.com address,
//    and everything else is refused (Shopify's rule, anchored at both ends).
// 2. Shopify's signatures: the approval callback's hmac (hex over the sorted query) against the
//    known answer in Shopify's own documentation, and the webhook signature (base64 over the raw
//    body), each with tampered, wrong-key and malformed cases that must be refused.
// 3. Wiring: the callback checks Shopify's signature before using the one-time state, and the
//    browser and person before trading the code; webhooks check the signature before touching
//    anything and answer 401 when it's wrong; stored access is sealed; no file outside
//    connectors/ calls a Shopify store.
import { createHmac } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
let failures = 0;
function report(ok, label, detail) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${!ok && detail ? ` (${detail})` : ""}`);
}

let address, verify, config;
try {
  address = await import("../connectors/shopify/address.ts");
  verify = await import("../connectors/shopify/verify.ts");
  config = await import("../connectors/shopify/config.ts");
} catch (e) {
  console.log(`FAIL couldn't load the Shopify code: ${e.message}`);
  process.exit(1);
}
const { normalizeShopAddress, isShopDomain } = address;
const { verifyQueryHmac, verifyWebhookHmac, timestampIsFresh, signedMessages } = verify;
const { missingScopes, SHOPIFY_SCOPES, SHOPIFY_API_VERSION } = config;

// ---------- 1. store addresses ----------
const accepted = [
  ["yourstore", "yourstore.myshopify.com"],
  ["YourStore", "yourstore.myshopify.com"],
  ["  yourstore.myshopify.com  ", "yourstore.myshopify.com"],
  ["yourstore.myshopify.com.", "yourstore.myshopify.com"],
  ["https://yourstore.myshopify.com/admin/products?x=1", "yourstore.myshopify.com"],
  ["HTTP://YOURSTORE.MYSHOPIFY.COM", "yourstore.myshopify.com"],
  ["admin.shopify.com/store/yourstore", "yourstore.myshopify.com"],
  ["https://admin.shopify.com/store/your-store-2/settings/domains", "your-store-2.myshopify.com"],
  ["yourstore.myshopify.com:443", "yourstore.myshopify.com"],
  ["a", "a.myshopify.com"],
];
for (const [input, want] of accepted) {
  const r = normalizeShopAddress(input);
  report(r.ok && r.shop === want, `address "${input}" becomes ${want}`, JSON.stringify(r));
}
const refused = [
  ["", "empty"],
  ["   ", "empty"],
  ["yourstore.com", "custom_domain"],
  ["www.yourstore.com", "custom_domain"],
  ["yourstore.myshopify.com.attacker.example", "custom_domain"],
  ["evil.example/yourstore.myshopify.com", "custom_domain"],
  ["yourstore.myshopify.com@evil.example", "custom_domain"],
  ["your store", "invalid"],
  ["-yourstore", "invalid"],
  ["your_store", "invalid"],
  ["www.yourstore.myshopify.com", "invalid"],
  ["x".repeat(301), "invalid"],
];
for (const [input, reason] of refused) {
  const r = normalizeShopAddress(input);
  report(!r.ok && r.reason === reason, `address "${input.length > 40 ? input.slice(0, 20) + "…" : input}" is refused (${reason})`, JSON.stringify(r));
}
const strict = [
  ["yourstore.myshopify.com", true],
  ["your-store-2.myshopify.com", true],
  ["YOURSTORE.myshopify.com", false],
  ["yourstore.myshopify.com\n", false],
  ["yourstore.myshopify.com.evil.example", false],
  [".myshopify.com", false],
  ["yourstore.myshopify.co", false],
  ["yourstore/admin.myshopify.com", false],
  [null, false],
];
for (const [input, want] of strict) report(isShopDomain(input) === want, `strict check: ${JSON.stringify(input)} is ${want ? "a store address" : "refused"}`);

// ---------- 2a. the approval callback's signature ----------
// Shopify's own documented example (the "hush" secret): the message
// code=0907a61c0c8d55e99db179b68161bc00&shop=some-shop.myshopify.com&state=0.6784241404160823&timestamp=1337178173
// signs to 700e2dad…c4bf. A known answer from Shopify, not computed by the code under test.
const DOC_HMAC = "700e2dadb827fcc8609e9d5ce208b2e9cdaab9df07390d2cbca10d7c328fc4bf";
const docQuery = `code=0907a61c0c8d55e99db179b68161bc00&hmac=${DOC_HMAC}&shop=some-shop.myshopify.com&state=0.6784241404160823&timestamp=1337178173`;
report(verifyQueryHmac(new URLSearchParams(docQuery), "hush"), "callback: Shopify's documented example verifies");
report(
  verifyQueryHmac(new URLSearchParams(`timestamp=1337178173&state=0.6784241404160823&shop=some-shop.myshopify.com&hmac=${DOC_HMAC}&code=0907a61c0c8d55e99db179b68161bc00`), "hush"),
  "callback: parameter order doesn't matter",
);
report(verifyQueryHmac(new URLSearchParams(docQuery.replace(DOC_HMAC, DOC_HMAC.toUpperCase())), "hush"), "callback: capital letters in the signature are fine");
report(!verifyQueryHmac(new URLSearchParams(docQuery.replace("some-shop", "other-shop")), "hush"), "callback: a changed store address is refused");
report(!verifyQueryHmac(new URLSearchParams(docQuery.replace("1337178173", "1337178174")), "hush"), "callback: a changed timestamp is refused");
report(!verifyQueryHmac(new URLSearchParams(docQuery + "&extra=1"), "hush"), "callback: an added parameter is refused");
report(!verifyQueryHmac(new URLSearchParams(docQuery), "hush2"), "callback: the wrong secret is refused");
report(!verifyQueryHmac(new URLSearchParams(docQuery), ""), "callback: no secret is refused");
report(!verifyQueryHmac(new URLSearchParams(docQuery.replace(`hmac=${DOC_HMAC}&`, "")), "hush"), "callback: a missing signature is refused");
report(!verifyQueryHmac(new URLSearchParams(docQuery.replace(DOC_HMAC, DOC_HMAC.slice(0, 63))), "hush"), "callback: a cut-short signature is refused");
report(!verifyQueryHmac(new URLSearchParams(docQuery.replace(DOC_HMAC, "z".repeat(64))), "hush"), "callback: a signature that isn't hex is refused");
report(!verifyQueryHmac(new URLSearchParams(docQuery + "&shop=some-shop.myshopify.com"), "hush"), "callback: a repeated parameter is refused");
report(verifyQueryHmac({ code: "0907a61c0c8d55e99db179b68161bc00", hmac: DOC_HMAC, shop: "some-shop.myshopify.com", state: "0.6784241404160823", timestamp: "1337178173" }, "hush"), "callback: works from a plain object too");

// A `host` value with "=" and "/" is where the documented raw form and Shopify's library's
// form-encoded form differ; a signature made either way must verify, and only with the right secret.
const hostParams = { code: "abc123", host: "YWRtaW4uc2hvcGlmeS5jb20vc3RvcmUvYQ==/x", shop: "a.myshopify.com", state: "s_t-a", timestamp: "1700000000" };
const rawMsg = Object.entries(hostParams).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join("&");
const encMsg = new URLSearchParams(Object.entries(hostParams).sort(([a], [b]) => (a < b ? -1 : 1))).toString();
report(rawMsg !== encMsg && signedMessages(hostParams).length === 2, "callback: both ways of writing out a host value are considered");
const sign = (m, s = "k") => createHmac("sha256", s).update(m).digest("hex");
report(verifyQueryHmac(new URLSearchParams({ ...hostParams, hmac: sign(rawMsg) }), "k"), "callback: signed over the values as they are, verifies");
report(verifyQueryHmac(new URLSearchParams({ ...hostParams, hmac: sign(encMsg) }), "k"), "callback: signed over the form-encoded values, verifies");
report(!verifyQueryHmac(new URLSearchParams({ ...hostParams, hmac: sign(rawMsg, "other") }), "k"), "callback: signed with another secret, refused");

// ---------- 2b. webhook signatures ----------
const body = JSON.stringify({ id: 1, name: "Test store", domain: "a.myshopify.com" });
const hook = (b, s = "whsec") => createHmac("sha256", s).update(b).digest("base64");
report(verifyWebhookHmac(Buffer.from(body), hook(body), "whsec"), "webhook: a correctly signed body verifies (raw bytes)");
report(verifyWebhookHmac(body, hook(body), "whsec"), "webhook: a correctly signed body verifies (text)");
report(verifyWebhookHmac(new Uint8Array(Buffer.from(body)), ` ${hook(body)} `, "whsec"), "webhook: spaces around the header are ignored");
report(!verifyWebhookHmac(body.replace("Test", "Best"), hook(body), "whsec"), "webhook: a changed body is refused");
report(!verifyWebhookHmac(JSON.stringify(JSON.parse(body), null, 2), hook(body), "whsec"), "webhook: the same data re-serialized is refused (the raw bytes are what's signed)");
report(!verifyWebhookHmac(body, hook(body, "other"), "whsec"), "webhook: the wrong secret is refused");
report(!verifyWebhookHmac(body, null, "whsec"), "webhook: a missing header is refused");
report(!verifyWebhookHmac(body, "", "whsec"), "webhook: an empty header is refused");
report(!verifyWebhookHmac(body, hook(body).slice(0, 20), "whsec"), "webhook: a cut-short header is refused");
report(!verifyWebhookHmac(body, createHmac("sha256", "whsec").update(body).digest("hex"), "whsec"), "webhook: a hex header (wrong encoding) is refused");
report(!verifyWebhookHmac(body, "not base64!!", "whsec"), "webhook: a header that isn't base64 is refused");
report(!verifyWebhookHmac(body, hook(body), ""), "webhook: no secret is refused");

// ---------- 2c. timestamps and permissions ----------
const now = Date.UTC(2026, 8, 24, 12);
const sec = (ms) => String(Math.floor(ms / 1000));
report(timestampIsFresh(sec(now), 3600, now), "timestamp: now is fresh");
report(timestampIsFresh(sec(now - 59 * 60_000), 3600, now), "timestamp: 59 minutes ago is fresh");
report(!timestampIsFresh(sec(now - 61 * 60_000), 3600, now), "timestamp: 61 minutes ago is refused");
report(!timestampIsFresh(sec(now + 10 * 60_000), 3600, now), "timestamp: 10 minutes in the future is refused");
report(!timestampIsFresh("12ab", 3600, now) && !timestampIsFresh(null, 3600, now), "timestamp: junk is refused");

report(missingScopes(SHOPIFY_SCOPES.join(",")).length === 0, "permissions: the full list is complete");
report(missingScopes(SHOPIFY_SCOPES.filter((s) => s.startsWith("write_")).concat("read_locations").join(",")).length === 0, "permissions: write ones cover their read ones");
report(missingScopes(SHOPIFY_SCOPES.filter((s) => s !== "write_orders").join(",")).join() === "write_orders", "permissions: a missing one is named");
report(/^\d{4}-(01|04|07|10)$/.test(SHOPIFY_API_VERSION), `permissions: the pinned version ${SHOPIFY_API_VERSION} is a quarterly release`);

// ---------- 3. wiring ----------
const read = (p) => (fs.existsSync(path.join(ROOT, p)) ? fs.readFileSync(path.join(ROOT, p), "utf8") : "");
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".next", ".git", ".shots"].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(e.name)) out.push(p);
  }
  return out;
}

const WIRING = {
  "callback-order": {
    what: "the callback checks Shopify's signature, then uses up the state, then checks browser and person, then trades the code",
    run: (src) => {
      const t = stripComments(src["app/api/connect/shopify/callback/route.ts"]);
      const at = (re) => t.search(re);
      const hmac = at(/verifyQueryHmac\(/);
      const state = at(/consumeState\(/);
      const cookie = at(/sameText\(cookie, state\)/);
      const person = at(/session\.memberId !== consumed\.memberId/);
      const trade = at(/completeShopifyConnection\(/);
      if ([hmac, state, cookie, person, trade].some((i) => i < 0)) return "a step is missing";
      return hmac < state && state < cookie && cookie < trade && person < trade ? null : "the steps are out of order";
    },
  },
  "webhook-signature": {
    what: "both Shopify notice routes check the signature first and answer 401 when it's wrong",
    run: (src) => {
      for (const f of ["app/api/connect/shopify/uninstalled/route.ts", "app/api/connect/shopify/compliance/route.ts"]) {
        const t = stripComments(src[f]);
        const check = t.search(/if \(!verifyWebhookHmac\([^)]*\)[^)]*\)\) return new Response\(null, \{ status: 401 \}\)/);
        const firstUse = t.search(/shopifyRemovedArmada\(|shopifyPrivacyNotice\(|JSON\.parse\(/);
        if (check < 0) return `${f} doesn't refuse a bad signature with 401`;
        if (firstUse >= 0 && firstUse < check) return `${f} uses the notice before checking its signature`;
      }
      return null;
    },
  },
  "start-signature": {
    what: "the start route checks Shopify's signature and a fresh timestamp when Shopify opens it",
    run: (src) => {
      const t = stripComments(src["app/api/connect/shopify/start/route.ts"]);
      return /verifyQueryHmac\(q, app\.clientSecret\)/.test(t) && /timestampIsFresh\(/.test(t) ? null : "a launch from Shopify isn't checked";
    },
  },
  "sealed-access": {
    what: "Shopify access is only ever stored sealed",
    run: (src) => {
      const t = src["connectors/shopify/client.ts"];
      const inserts = [...t.matchAll(/insert into armada\.credentials[\s\S]*?values\s*\(([\s\S]*?)\)\s*on conflict/g)];
      if (!inserts.length) return "no credential insert found";
      if (inserts.some((m) => !/\$\{seal\(/.test(m[1]))) return "a credential insert isn't sealed";
      if ([...t.matchAll(/set\s+secret\s*=\s*\$\{([^}]*)\}/g)].some((m) => !/^seal\(/.test(m[1]))) return "a credential update isn't sealed";
      return null;
    },
  },
  "one-door": {
    what: "only connectors/ talks to a Shopify store",
    run: (src) => {
      const bad = Object.entries(src)
        .filter(([f]) => !f.startsWith("connectors/"))
        .filter(([, t]) => /myshopify\.com\/admin|\/admin\/oauth\/|\/admin\/api\/\d{4}-\d{2}/.test(stripComments(t)))
        .map(([f]) => f);
      return bad.length ? `Shopify calls in ${bad.join(", ")}` : null;
    },
  },
};

function sources() {
  const out = {};
  for (const p of walk(ROOT)) {
    const rel = path.relative(ROOT, p).replace(/\\/g, "/");
    if (rel.startsWith("scripts/")) continue;
    out[rel] = fs.readFileSync(p, "utf8");
  }
  return out;
}

const src = sources();
for (const [name, c] of Object.entries(WIRING)) {
  const problem = c.run(src);
  report(!problem, `wiring ${name}: ${c.what}`, problem);
}

// Break each wiring rule on purpose (in memory) and confirm its check notices.
if (process.argv.includes("--selftest")) {
  const plants = {
    "callback-order": (s) => ({
      ...s,
      "app/api/connect/shopify/callback/route.ts": s["app/api/connect/shopify/callback/route.ts"].replace(/if \(!verifyQueryHmac\(q, app\.clientSecret\)\) return fail\(request, "link"\);/, ""),
    }),
    "webhook-signature": (s) => ({
      ...s,
      "app/api/connect/shopify/uninstalled/route.ts": s["app/api/connect/shopify/uninstalled/route.ts"].replace("{ status: 401 }", "{ status: 200 }"),
    }),
    "start-signature": (s) => ({ ...s, "app/api/connect/shopify/start/route.ts": s["app/api/connect/shopify/start/route.ts"].replace("timestampIsFresh(", "Boolean(") }),
    "sealed-access": (s) => ({ ...s, "connectors/shopify/client.ts": s["connectors/shopify/client.ts"].replace("${seal(secret)}", "${JSON.stringify(secret)}") }),
    "one-door": (s) => ({ ...s, "lib/planted.ts": 'export const x = (shop: string) => fetch(`https://${shop}/admin/api/2026-07/graphql.json`);\n' }),
  };
  for (const [name, plant] of Object.entries(plants)) {
    const broken = plant(src);
    const changed = Object.keys(broken).some((k) => broken[k] !== src[k]);
    const problem = WIRING[name].run(broken);
    report(changed && Boolean(problem), `selftest ${name}: a planted break is caught`, changed ? "the planted break went unnoticed" : "the plant didn't change anything");
  }
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall Shopify checks pass");
process.exit(failures ? 1 : 0);
