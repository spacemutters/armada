// Offline checks for Armada's Stripe billing. No network, no real keys: every key and secret here is
// made up. Prints one PASS/FAIL line per check and exits 1 on any FAIL.
//
//   node scripts/check-stripe.mjs              the checks
//   node scripts/check-stripe.mjs --selftest   also plant a break in a scratch copy of each module and
//                                              confirm the checks catch it (proves they can fail)
//
// What it covers:
// - the notification signature check (connectors/stripe/signature.ts) against Stripe's documented
//   scheme, an independent HMAC, a fixed vector (cross-checked with OpenSSL), replay tolerance,
//   rolled secrets, the fake v0 scheme, and the raw body;
// - the form encoding Stripe's API takes (connectors/stripe/form.ts);
// - the plan data (lib/billing/plans.ts) and every Stripe request body built from it
//   (connectors/stripe/payloads.ts), plus reading Stripe's objects back;
// - the plan decisions (lib/billing/limits.ts): which plan a subscription means, and canUse's sentences;
// - a few rules about the code itself: Stripe is only called from connectors/stripe, the notification
//   route reads the raw body, the key is only stored sealed, nothing in billing logs.
//
// Needs only the .ts files (Node strips their types), so it runs anywhere, even without node_modules.

import { createHmac } from "node:crypto";
import fs from "node:fs";
import { registerHooks } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// lib/billing/plans.ts imports docs/pricing-plans.json the way the app's bundler does (no import
// attribute). Plain Node wants one, so hand Node the file as a module instead.
registerHooks({
  load(url, context, next) {
    if (url.startsWith("file:") && url.endsWith(".json") && !context.importAttributes?.type) {
      return { format: "module", source: `export default ${fs.readFileSync(fileURLToPath(url), "utf8")};`, shortCircuit: true };
    }
    return next(url, context);
  },
});

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILES = {
  signature: path.join(ROOT, "connectors", "stripe", "signature.ts"),
  form: path.join(ROOT, "connectors", "stripe", "form.ts"),
  payloads: path.join(ROOT, "connectors", "stripe", "payloads.ts"),
  plans: path.join(ROOT, "lib", "billing", "plans.ts"),
  limits: path.join(ROOT, "lib", "billing", "limits.ts"),
};
const load = (file) => import(pathToFileURL(file).href);

// ---------- tiny test kit ----------
function suite() {
  const results = [];
  const check = (label, ok, detail) => results.push({ label, ok: Boolean(ok), detail: ok ? undefined : detail });
  const equal = (label, got, want) => check(label, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  const throws = (label, fn) => {
    try {
      fn();
      check(label, false, "did not throw");
    } catch {
      check(label, true);
    }
  };
  return { results, check, equal, throws };
}

// Made-up values only.
const SECRET = "whsec_armada_check_secret";
const OTHER_SECRET = "whsec_some_other_secret";
const WS = "3f2b8c1e-6a4d-4e2f-9b7a-1c2d3e4f5a6b";
const hmac = (secret, t, body) => createHmac("sha256", secret).update(`${t}.${body}`, "utf8").digest("hex");

// ---------- signature ----------
function signatureChecks(sig, source) {
  const { check, equal, throws, results } = suite();
  const now = 1_790_000_000;
  const body = JSON.stringify({ id: "evt_1", object: "event", type: "invoice.paid", data: { object: { note: "café ☕ — ünïcode" } } });
  const good = hmac(SECRET, now, body);

  // A fixed answer, cross-checked with: printf '%s' '1700000000.{"id":"evt_1","object":"event"}' | openssl dgst -sha256 -hmac whsec_armada_check_secret
  equal("signature: fixed vector matches OpenSSL", sig.computeSignature(SECRET, 1700000000, JSON.stringify({ id: "evt_1", object: "event" })), "2b19e4f827474d753a521c30c33d6c7df740ebc7eb181fee6765781760a055d8");
  equal("signature: matches an independent HMAC-SHA256 over `${t}.${body}`", sig.computeSignature(SECRET, now, body), good);
  equal("signature: bytes and text give the same signature", sig.computeSignature(SECRET, now, new TextEncoder().encode(body)), good);

  equal("verify: a genuine notification passes", sig.verifySignature(body, `t=${now},v1=${good}`, SECRET, { now }), { ok: true, timestamp: now });
  equal("verify: the raw bytes pass too", sig.verifySignature(new TextEncoder().encode(body), `t=${now},v1=${good}`, SECRET, { now }).ok, true);
  equal("verify: Stripe's real header shape (with a v0 test signature) passes", sig.verifySignature(body, `t=${now},v1=${good},v0=${hmac("whsec_fake", now, body)}`, SECRET, { now }).ok, true);
  equal("verify: upper-case hex is accepted", sig.verifySignature(body, `t=${now},v1=${good.toUpperCase()}`, SECRET, { now }).ok, true);
  equal("verify: spaces around parts are tolerated", sig.verifySignature(body, ` t=${now} , v1=${good} `, SECRET, { now }).ok, true);

  equal("verify: one changed character in the body fails", sig.verifySignature(body.replace("evt_1", "evt_2"), `t=${now},v1=${good}`, SECRET, { now }).reason, "mismatch");
  equal("verify: the same JSON re-encoded (parsed and printed again) fails: the raw body is required", sig.verifySignature(JSON.stringify(JSON.parse(body), null, 2), `t=${now},v1=${good}`, SECRET, { now }).reason, "mismatch");
  equal("verify: signed with another secret fails", sig.verifySignature(body, `t=${now},v1=${hmac(OTHER_SECRET, now, body)}`, SECRET, { now }).reason, "mismatch");
  equal("verify: a changed timestamp fails (it's inside the signature)", sig.verifySignature(body, `t=${now + 1},v1=${good}`, SECRET, { now }).reason, "mismatch");
  equal("verify: only a v0 signature (a downgrade) fails", sig.verifySignature(body, `t=${now},v0=${good}`, SECRET, { now }).reason, "no_signature");
  equal("verify: a v2 scheme is ignored", sig.verifySignature(body, `t=${now},v2=${good}`, SECRET, { now }).reason, "no_signature");
  equal("verify: a truncated signature fails", sig.verifySignature(body, `t=${now},v1=${good.slice(0, 62)}`, SECRET, { now }).ok, false);
  equal("verify: no header fails", sig.verifySignature(body, null, SECRET, { now }).reason, "no_header");
  equal("verify: no timestamp fails", sig.verifySignature(body, `v1=${good}`, SECRET, { now }).reason, "no_timestamp");
  equal("verify: a non-numeric timestamp fails", sig.verifySignature(body, `t=abc,v1=${good}`, SECRET, { now }).reason, "no_timestamp");
  equal("verify: no secret fails", sig.verifySignature(body, `t=${now},v1=${good}`, "", { now }).reason, "no_secret");

  // Secret rolling: Stripe sends one v1 per active secret.
  equal("verify: rolled secret, ours listed second, passes", sig.verifySignature(body, `t=${now},v1=${hmac(OTHER_SECRET, now, body)},v1=${good}`, SECRET, { now }).ok, true);
  equal("verify: rolled secret, neither ours, fails", sig.verifySignature(body, `t=${now},v1=${hmac(OTHER_SECRET, now, body)},v1=${hmac("whsec_third", now, body)}`, SECRET, { now }).reason, "mismatch");

  // Replay window: 5 minutes, Stripe's default.
  equal("tolerance: 300 seconds", sig.SIGNATURE_TOLERANCE_SECONDS, 300);
  const old = now - 301;
  equal("replay: signed 301 seconds ago fails", sig.verifySignature(body, `t=${old},v1=${hmac(SECRET, old, body)}`, SECRET, { now }).reason, "outside_tolerance");
  const recent = now - 299;
  equal("replay: signed 299 seconds ago passes", sig.verifySignature(body, `t=${recent},v1=${hmac(SECRET, recent, body)}`, SECRET, { now }).ok, true);
  const future = now + 301;
  equal("replay: stamped 301 seconds in the future fails", sig.verifySignature(body, `t=${future},v1=${hmac(SECRET, future, body)}`, SECRET, { now }).reason, "outside_tolerance");
  const ancient = now - 86_400 * 30;
  equal("replay: a month-old notification fails", sig.verifySignature(body, `t=${ancient},v1=${hmac(SECRET, ancient, body)}`, SECRET, { now }).reason, "outside_tolerance");
  throws("tolerance: 0 is refused (it would switch the replay check off)", () => sig.verifySignature(body, `t=${now},v1=${good}`, SECRET, { now, toleranceSeconds: 0 }));
  equal("verify: uses the real clock when not told the time", sig.verifySignature(body, sig.signatureHeader(SECRET, Math.floor(Date.now() / 1000), body), SECRET).ok, true);

  // Constant time: a timing leak can't be seen in a result, so read the code.
  const code = source.replace(/\/\/.*$/gm, "");
  check("constant time: signatures are compared with timingSafeEqual", /timingSafeEqual\(\s*got\s*,\s*expected\s*\)/.test(code), "no timingSafeEqual(got, expected) in signature.ts");
  // Comparing lengths first is fine (a length isn't secret); comparing the signature values with == is not.
  const plain = /\b(sig|got|expected|signatures?)\b(?!\.length)\s*[!=]={1,2}|[!=]={1,2}\s*\b(sig|got|expected|signatures?)\b(?!\.length)/.exec(code);
  check("constant time: no plain == comparison of signatures", !plain && !/\.equals\(/.test(code), `found “${plain?.[0] ?? ".equals("}”`);
  return results;
}

// ---------- form encoding ----------
function formChecks(form) {
  const { equal, throws, results } = suite();
  equal(
    "form: nested objects, indexed arrays, booleans; null and undefined left out",
    form.formEncode({ a: { b: "c" }, list: ["x", "y"], items: [{ price: "p", quantity: 1 }], skip: undefined, none: null, flag: true, off: false }),
    "a%5Bb%5D=c&list%5B0%5D=x&list%5B1%5D=y&items%5B0%5D%5Bprice%5D=p&items%5B0%5D%5Bquantity%5D=1&flag=true&off=false",
  );
  const url = "https://armada-pi.vercel.app/billing?checkout=done&session={CHECKOUT_SESSION_ID}";
  equal("form: a URL with ? & and {} survives the round trip", new URLSearchParams(form.formEncode({ success_url: url })).get("success_url"), url);
  equal("form: spaces and accents survive", new URLSearchParams(form.formEncode({ name: "Armada Growth — café" })).get("name"), "Armada Growth — café");
  equal("form: empty object sends nothing", form.formEncode({ metadata: {} }), "");
  throws("form: NaN is refused", () => form.formEncode({ unit_amount: NaN }));
  return results;
}

// ---------- plans ----------
function planChecks(plans) {
  const { check, equal, results } = suite();
  const { PLANS, PAID_PLANS, FREE_PLAN_KEY, lookupKey, parseLookupKey, priceSpecs, plansVersion } = plans;
  const keys = PLANS.map((p) => p.key);
  equal("plans: keys are unique", new Set(keys).size, keys.length);
  // Plan keys are saved as keys inside JSON, and the database client camel-cases JSON keys: "fleet_plus" would come back "fleetPlus".
  check("plans: keys are plain lowercase letters", keys.every((k) => /^[a-z]+$/.test(k)), keys.join(", "));
  equal("plans: the free plan is Practice and comes first", [PLANS[0].key, PLANS[0].monthlyCents, PLANS[0].yearlyCents, FREE_PLAN_KEY], ["practice", 0, 0, "practice"]);
  equal("plans: exactly one free plan", PLANS.filter((p) => p.monthlyCents === 0).length, 1);
  check("plans: cheapest first", PLANS.every((p, i) => i === 0 || p.monthlyCents >= PLANS[i - 1].monthlyCents), "plans aren't in price order");
  for (const p of PAID_PLANS) {
    check(`plans: ${p.name} prices are whole cents, at least Stripe's $0.50`, Number.isInteger(p.monthlyCents) && Number.isInteger(p.yearlyCents) && p.monthlyCents >= 50 && p.yearlyCents >= 50, `${p.monthlyCents} / ${p.yearlyCents}`);
    check(`plans: ${p.name} yearly costs less than 12 months`, p.yearlyCents < p.monthlyCents * 12 && p.yearlyCents >= p.monthlyCents, `${p.yearlyCents} vs ${p.monthlyCents * 12}`);
    check(`plans: ${p.name} trial is 0 to 730 days`, Number.isInteger(p.trialDays) && p.trialDays >= 0 && p.trialDays <= 730, String(p.trialDays));
  }
  for (const p of PLANS) {
    check(`plans: ${p.name} has "includes" sentences, none repeated`, p.includes.length >= 1 && p.includes.every((s) => s.trim().length > 0) && new Set(p.includes).size === p.includes.length, JSON.stringify(p.includes));
    check(`plans: ${p.name} sets every limit, each a whole number or null`, plans.LIMIT_FEATURES.every((f) => p.limits[f] === null || (Number.isInteger(p.limits[f]) && p.limits[f] >= 0)), JSON.stringify(p.limits));
    check(`plans: ${p.name} has a tagline`, typeof p.tagline === "string" && p.tagline.length > 10, p.tagline);
    check(`plans: ${p.name} trial limits are never looser than the plan`, Object.entries(p.trialLimits).every(([f, v]) => v === null || p.limits[f] === null || v <= p.limits[f]), JSON.stringify(p.trialLimits));
  }
  for (const p of PAID_PLANS) check(`plans: ${p.name} sends Stripe at most 15 features`, p.includes.length <= 15, String(p.includes.length));
  const inf = (v) => (v === null ? Infinity : v);
  equal("plans: five limits", [...plans.LIMIT_FEATURES], ["stores", "products", "shopBuildsPerMonth", "headlineTests", "seats"]);
  for (const f of plans.LIMIT_FEATURES) {
    check(`plans: a dearer plan never allows fewer ${f}`, PLANS.every((p, i) => i === 0 || inf(p.limits[f]) >= inf(PLANS[i - 1].limits[f])), PLANS.map((p) => p.limits[f]).join(" < "));
  }
  // The pricing file is the source: every number here must be exactly what it says.
  const file = JSON.parse(fs.readFileSync(path.join(ROOT, "docs", "pricing-plans.json"), "utf8"));
  for (const fp of file.plans) {
    const p = PLANS.find((x) => x.key === fp.key);
    equal(
      `plans: ${fp.name} matches docs/pricing-plans.json`,
      p && [p.name, p.monthlyCents, p.yearlyCents, p.limits.stores, p.limits.products, p.limits.shopBuildsPerMonth, p.limits.headlineTests, p.limits.seats, p.trialDays, p.includes, p.trialLimits.shopBuildsPerMonth ?? null],
      [fp.name, Math.round(fp.monthlyUsd * 100), Math.round(fp.yearlyUsd * 100), fp.limits.stores, fp.limits.products, fp.limits.shopBuildsPerMonth, fp.limits.headlineTests, fp.limits.seats, fp.trialDays, fp.includes, fp.trialLimits?.shopBuilds ?? null],
    );
  }
  equal("plans: every plan in the file, and no others", PLANS.map((p) => p.key).sort(), file.plans.map((p) => p.key).sort());
  const bad = (mutate) => {
    const copy = structuredClone(file);
    mutate(copy);
    try {
      plans.plansFromPricing(copy);
      return false;
    } catch {
      return true;
    }
  };
  check("pricing file: an unknown plan is refused", bad((f) => (f.plans[1].key = "enterprise")), "accepted");
  check("pricing file: a missing limit is refused (never read as unlimited)", bad((f) => delete f.plans[1].limits.products), "accepted");
  check("pricing file: fractions of a cent are refused", bad((f) => (f.plans[1].monthlyUsd = 29.005)), "accepted");
  check("pricing file: another currency is refused", bad((f) => (f.currency = "eur")), "accepted");
  equal("plans: exactly one recommended plan", PLANS.filter((p) => p.recommended).length, 1);
  check("plans: at most 10 paid plans (the customer billing page's limit)", PAID_PLANS.length <= 10, String(PAID_PLANS.length));
  const specs = priceSpecs();
  equal("prices: one per paid plan per interval", specs.length, PAID_PLANS.length * 2);
  equal("prices: lookup keys are unique", new Set(specs.map((s) => s.lookupKey)).size, specs.length);
  check("prices: lookup keys fit Stripe's 200 characters", specs.every((s) => s.lookupKey.length <= 200), "too long");
  const growth = PLANS.find((p) => p.key === "growth");
  equal("prices: lookup key carries plan, interval and amount", lookupKey(growth, "month"), `armada_growth_month_${growth.monthlyCents}usd`);
  check("prices: every lookup key reads back to its plan and interval", specs.every((s) => JSON.stringify(parseLookupKey(s.lookupKey)) === JSON.stringify({ plan: s.plan.key, interval: s.interval })), "round trip failed");
  equal("prices: a stranger's lookup key isn't read as a plan", parseLookupKey("pro_monthly"), null);
  // A price change must make a new Stripe Price (a new lookup key), never an edit of the old one.
  const changed = PLANS.map((p) => (p.key === "growth" ? { ...p, monthlyCents: p.monthlyCents + 1000 } : p));
  const changedPaid = changed.filter((p) => p.monthlyCents > 0);
  const before = new Map(specs.map((s) => [`${s.plan.key}/${s.interval}`, s.lookupKey]));
  const after = priceSpecs(changedPaid);
  const moved = after.filter((s) => before.get(`${s.plan.key}/${s.interval}`) !== s.lookupKey).map((s) => `${s.plan.key}/${s.interval}`);
  equal("prices: changing Growth's monthly price changes exactly that lookup key", moved, ["growth/month"]);
  check("prices: and the setup fingerprint notices", plansVersion(changedPaid) !== plansVersion(), "fingerprint unchanged");
  return results;
}

// ---------- Stripe request bodies ----------
const decode = (form, params) => Object.fromEntries(new URLSearchParams(form.formEncode(params)));

function payloadChecks(p, form, plans) {
  const { check, equal, results } = suite();
  const { PLANS, priceSpecs } = plans;
  const growth = PLANS.find((x) => x.key === "growth");

  check("version: pinned to a dated release", /^\d{4}-\d{2}-\d{2}\.[a-z]+$/.test(p.STRIPE_API_VERSION), p.STRIPE_API_VERSION);
  equal("version: the one checked against Stripe's changelog", p.STRIPE_API_VERSION, "2026-08-26.dahlia");

  // Products and prices
  const prod = decode(form, p.newProductParams(growth));
  equal("product: Armada's own id, name, and plan in metadata", [prod.id, prod.name, prod["metadata[armada]"], prod["metadata[armada_plan]"]], ["armada_growth", "Armada Growth", "billing", "growth"]);
  equal("product: features come from the plan", prod["marketing_features[0][name]"], p.featureName(growth.includes[0]));
  check("product: every feature fits Stripe's 80 characters", Object.entries(prod).filter(([k]) => k.startsWith("marketing_features")).every(([, v]) => v.length > 0 && v.length <= 80), "too long");
  const s81 = "CJ Dropshipping connection with real costs and shipping checked for each product.";
  equal("feature: one character over loses only its full stop", p.featureName(s81), s81.slice(0, -1));
  const long = p.featureName("A very long sentence about everything the plan includes, which goes on well past what Stripe allows in one feature line.");
  check("feature: a long sentence is cut at a word, with an ellipsis", long.length <= 80 && long.endsWith("…") && !/\s…$/.test(long) && long.startsWith("A very long sentence"), long);
  equal("feature: a short sentence is untouched", p.featureName("No card needed."), "No card needed.");
  check("product: the fallback has no id", !("id" in decode(form, p.newProductParams(growth, false))), "id present");
  const spec = priceSpecs().find((s) => s.plan.key === "growth" && s.interval === "year");
  const price = decode(form, p.priceParams(spec, "prod_test_x"));
  equal(
    "price: product, amount, currency, yearly, lookup key, metadata",
    [price.product, price.unit_amount, price.currency, price["recurring[interval]"], price.lookup_key, price["metadata[armada_plan]"], price["metadata[armada_interval]"]],
    ["prod_test_x", String(growth.yearlyCents), "usd", "year", `armada_growth_year_${growth.yearlyCents}usd`, "growth", "year"],
  );
  check("price: the lookup key only moves when asked", !("transfer_lookup_key" in price) && decode(form, p.priceParams(spec, "prod_x", { transferLookupKey: true })).transfer_lookup_key === "true", "transfer_lookup_key wrong");
  check("price: an existing matching price is recognised", p.priceMatches({ unit_amount: growth.yearlyCents, currency: "usd", recurring: { interval: "year", interval_count: 1 }, type: "recurring" }, spec), "match failed");
  check("price: a price with another amount is not", !p.priceMatches({ unit_amount: growth.yearlyCents + 1, currency: "usd", recurring: { interval: "year" } }, spec), "wrong match");
  check("price: a monthly price doesn't pass for yearly", !p.priceMatches({ unit_amount: growth.yearlyCents, currency: "usd", recurring: { interval: "month" } }, spec), "wrong match");

  // Customer portal
  const portal = decode(form, p.portalConfigParams({ products: [{ product: "prod_a", prices: ["price_1", "price_2"] }], returnUrl: "https://armada-pi.vercel.app/billing" }));
  equal(
    "portal: plan switching limited to Armada's prices, cancel at period end, card and invoices on",
    [
      portal["features[subscription_update][enabled]"],
      portal["features[subscription_update][default_allowed_updates][0]"],
      portal["features[subscription_update][products][0][product]"],
      portal["features[subscription_update][products][0][prices][1]"],
      portal["features[subscription_cancel][mode]"],
      portal["features[payment_method_update][enabled]"],
      portal["features[invoice_history][enabled]"],
      portal.default_return_url,
      portal["metadata[armada]"],
    ],
    ["true", "price", "prod_a", "price_2", "at_period_end", "true", "true", "https://armada-pi.vercel.app/billing", "billing"],
  );
  check("portal: headline fits Stripe's 60 characters", (portal["business_profile[headline]"] ?? "").length <= 60, portal["business_profile[headline]"]);
  const many = Array.from({ length: 12 }, (_, i) => ({ product: `prod_${i}`, prices: [`price_${i}`] }));
  check("portal: never more than 10 products", !(`features[subscription_update][products][10][product]` in decode(form, p.portalConfigParams({ products: many, returnUrl: "https://x" }))), "sent 11+");

  // Notification address
  const hook = decode(form, p.webhookParams("https://armada-pi.vercel.app/api/stripe/webhook"));
  const events = Object.keys(hook).filter((k) => k.startsWith("enabled_events[")).map((k) => hook[k]);
  equal("webhook: exactly the six events billing needs", events.sort(), ["checkout.session.completed", "customer.subscription.created", "customer.subscription.deleted", "customer.subscription.updated", "invoice.paid", "invoice.payment_failed"]);
  equal("webhook: address and pinned version", [hook.url, hook.api_version, hook["metadata[armada]"]], ["https://armada-pi.vercel.app/api/stripe/webhook", p.STRIPE_API_VERSION, "billing"]);
  equal("webhook: the path the route lives at", p.WEBHOOK_PATH, "/api/stripe/webhook");
  check("webhook: the route file exists at that path", fs.existsSync(path.join(ROOT, "app", ...p.WEBHOOK_PATH.split("/").filter(Boolean), "route.ts")), "missing route.ts");

  // Checkout
  const base = { workspaceId: WS, plan: growth, interval: "month", priceId: "price_growth_m", trialDays: 14, email: "owner@example.com", origin: "https://armada-pi.vercel.app" };
  const co = decode(form, p.checkoutParams(base));
  equal(
    "checkout: subscription mode, one of the plan's price, workspace in reference and metadata",
    [co.mode, co["line_items[0][price]"], co["line_items[0][quantity]"], co.client_reference_id, co["metadata[workspace_id]"], co["subscription_data[metadata][workspace_id]"], co["subscription_data[metadata][plan_key]"]],
    ["subscription", "price_growth_m", "1", WS, WS, WS, "growth"],
  );
  equal("checkout: back to /billing, with Stripe's session placeholder intact", [co.success_url, co.cancel_url], ["https://armada-pi.vercel.app/billing?checkout=done&session={CHECKOUT_SESSION_ID}", "https://armada-pi.vercel.app/billing?checkout=cancelled"]);
  equal("checkout: first plan gets its free days", co["subscription_data[trial_period_days]"], "14");
  check("checkout: no trial means the field is left out (Stripe wants at least 1)", !("subscription_data[trial_period_days]" in decode(form, p.checkoutParams({ ...base, trialDays: 0 }))), "sent trial_period_days=0");
  equal("checkout: a new customer is identified by email", [co.customer_email, co.customer], ["owner@example.com", undefined]);
  const again = decode(form, p.checkoutParams({ ...base, customerId: "cus_test_1" }));
  equal("checkout: a returning customer reuses their Stripe customer, not the email", [again.customer, again.customer_email], ["cus_test_1", undefined]);
  check("checkout: no ui_mode sent (its values were renamed in 2026's release; the hosted page is the default)", !("ui_mode" in co), "ui_mode sent");
  equal("checkout: promotion codes allowed", co.allow_promotion_codes, "true");

  // Portal sessions
  const sw = decode(form, p.portalSessionParams({ customerId: "cus_1", configurationId: "bpc_1", returnUrl: "https://armada-pi.vercel.app/billing", flow: { type: "switch", subscriptionId: "sub_1", itemId: "si_1", priceId: "price_2" } }));
  equal(
    "portal session: switching plan goes straight to Stripe's confirm step",
    [sw.customer, sw.configuration, sw["flow_data[type]"], sw["flow_data[subscription_update_confirm][subscription]"], sw["flow_data[subscription_update_confirm][items][0][id]"], sw["flow_data[subscription_update_confirm][items][0][price]"], sw["flow_data[after_completion][type]"], sw["flow_data[after_completion][redirect][return_url]"]],
    ["cus_1", "bpc_1", "subscription_update_confirm", "sub_1", "si_1", "price_2", "redirect", "https://armada-pi.vercel.app/billing"],
  );
  const cancel = decode(form, p.portalSessionParams({ customerId: "cus_1", returnUrl: "https://x/billing", flow: { type: "cancel", subscriptionId: "sub_1" } }));
  equal("portal session: moving to Practice is Stripe's cancel step", [cancel["flow_data[type]"], cancel["flow_data[subscription_cancel][subscription]"]], ["subscription_cancel", "sub_1"]);
  check("portal session: plain Manage billing has no flow", !Object.keys(decode(form, p.portalSessionParams({ customerId: "cus_1", returnUrl: "https://x" }))).some((k) => k.startsWith("flow_data")), "flow sent");

  // Reading Stripe's objects (2026 shapes: the period lives on each subscription item)
  const item = (price, extra = {}) => ({ id: "si_1", object: "subscription_item", current_period_start: 1_790_000_000, current_period_end: 1_792_592_000, price, ...extra });
  const armadaPrice = { id: "price_g_m", object: "price", lookup_key: `armada_growth_month_${growth.monthlyCents}usd`, metadata: { armada: "billing", armada_plan: "growth", armada_interval: "month" }, recurring: { interval: "month", interval_count: 1 }, unit_amount: growth.monthlyCents, currency: "usd" };
  const sub = (over = {}) => ({ id: "sub_1", object: "subscription", customer: "cus_1", status: "active", cancel_at_period_end: false, cancel_at: null, trial_end: null, livemode: false, metadata: { workspace_id: WS, plan_key: "growth", interval: "month" }, items: { object: "list", data: [item(armadaPrice)] }, ...over });
  const snap = p.readSubscription(sub());
  equal(
    "read subscription: plan, interval, item, period end from the item, workspace",
    [snap?.planKey, snap?.interval, snap?.itemId, snap?.currentPeriodEnd?.toISOString() ?? null, snap?.workspaceId, snap?.customerId, snap?.status, snap?.cancelAtPeriodEnd],
    ["growth", "month", "si_1", new Date(1_792_592_000_000).toISOString(), WS, "cus_1", "active", false],
  );
  equal("read subscription: plan from the lookup key when metadata is missing", p.readSubscription(sub({ items: { data: [item({ ...armadaPrice, metadata: {} })] } })).planKey, "growth");
  equal("read subscription: plan from saved price ids when nothing else says", p.readSubscription(sub({ metadata: {}, items: { data: [item({ id: "price_known", recurring: { interval: "year" }, metadata: {} })] } }), { price_known: { plan: "fleet", interval: "year" } }).planKey, "fleet");
  equal("read subscription: a stranger's subscription has no plan", p.readSubscription(sub({ metadata: {}, items: { data: [item({ id: "price_other", recurring: { interval: "month" }, metadata: {} })] } })).planKey, null);
  equal("read subscription: a cancel date means it ends at period end", p.readSubscription(sub({ cancel_at: 1_792_592_000 })).cancelAtPeriodEnd, true);
  equal("read subscription: a finished cancellation isn't 'ending' any more", p.readSubscription(sub({ status: "canceled", cancel_at: 1_792_592_000 })).cancelAtPeriodEnd, false);
  equal("read subscription: expanded customer object", p.readSubscription(sub({ customer: { id: "cus_x", object: "customer" } })).customerId, "cus_x");
  equal("read subscription: a bad workspace id is ignored", p.readSubscription(sub({ metadata: { workspace_id: "'; drop table" } })).workspaceId, null);
  equal("read subscription: not a subscription", p.readSubscription({ object: "invoice", id: "in_1" }), null);
  equal("invoice: subscription from parent.subscription_details", p.invoiceSubscriptionId({ parent: { type: "subscription_details", subscription_details: { subscription: "sub_9" } } }), "sub_9");
  equal("invoice: expanded subscription", p.invoiceSubscriptionId({ parent: { subscription_details: { subscription: { id: "sub_8" } } } }), "sub_8");
  equal("invoice: older top-level field still read", p.invoiceSubscriptionId({ subscription: "sub_7" }), "sub_7");
  equal("invoice: a one-off invoice has none", p.invoiceSubscriptionId({ parent: null }), null);
  const cs = p.readCheckoutSession({ id: "cs_test_1", object: "checkout.session", mode: "subscription", status: "complete", client_reference_id: WS, subscription: "sub_1", customer: "cus_1", metadata: {} });
  equal("checkout session: workspace, subscription, customer, complete", [cs.workspaceId, cs.subscriptionId, cs.customerId, cs.complete], [WS, "sub_1", "cus_1", true]);
  equal("checkout session: workspace from metadata when the reference is missing", p.readCheckoutSession({ id: "cs_1", object: "checkout.session", metadata: { workspace_id: WS } }).workspaceId, WS);

  // Keys and errors
  const fakeKey = (prefix) => prefix + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4";
  equal("key: a restricted test key", p.checkKeyFormat(fakeKey("rk_test_")), { ok: true, mode: "test", restricted: true });
  equal("key: a secret live key, with spaces around it", p.checkKeyFormat(`  ${fakeKey("sk_live_")}\n`), { ok: true, mode: "live", restricted: false });
  equal("key: publishable key is turned away", p.checkKeyFormat(fakeKey("pk_live_")), { ok: false, problem: "publishable" });
  equal("key: a signing secret is turned away", p.checkKeyFormat("whsec_" + "a".repeat(32)), { ok: false, problem: "webhook_secret" });
  equal("key: nonsense is turned away", p.checkKeyFormat("hello"), { ok: false, problem: "format" });
  equal("key: empty", p.checkKeyFormat("   "), { ok: false, problem: "empty" });
  const rak = "The provided key 'rk_test_*********abcd' does not have the required permissions for this endpoint on account 'acct_123'. Having the 'rak_plan_write' permission would allow this request to continue.";
  equal("errors: a missing permission is named as Stripe's key screen names it", p.missingPermission(rak), { resource: "Prices", access: "Write", code: "plan_write" });
  equal("errors: webhook permission", p.missingPermission("Having the 'rak_webhook_write' permission would allow").resource, "Webhook Endpoints");
  const said = p.describeStripeProblem({ status: 403, message: rak });
  check("errors: the owner is told which permission to add", said.includes("set Prices to Write"), said);
  check("errors: a rejected key says so", p.describeStripeProblem({ status: 401, type: "authentication_error", message: "Invalid API Key provided: rk_test_A1b2" }).includes("didn't accept"), "wrong words");
  const leaked = p.describeStripeProblem({ status: 400, message: `No such price for key ${fakeKey("sk_live_")} and whsec_abcdef123` });
  check("errors: a key or signing secret in Stripe's words is never repeated", !/sk_live_|whsec_/.test(leaked), leaked);
  check("errors: busy and unreachable are told apart", p.describeStripeProblem({ status: 503 }).includes("busy") && p.describeStripeProblem({ status: 0, type: "network_error" }).includes("reach"), "wrong words");
  return results;
}

// ---------- plan decisions ----------
function limitChecks(limits, plans) {
  const { equal, results } = suite();
  const { PLANS } = plans;
  const byKey = (k) => PLANS.find((p) => p.key === k);
  const now = Date.parse("2026-09-24T12:00:00Z");
  const day = 86_400_000;
  const row = (over) => ({ planKey: "growth", status: "active", interval: "month", currentPeriodEnd: new Date(now + 20 * day), cancelAtPeriodEnd: false, trialEnd: null, paymentFailedAt: null, ...over });
  const s = (r) => limits.standingFrom(r, PLANS, now);

  equal("standing: no subscription is Practice, free", [s(null).plan.key, s(null).paying, s(null).status], ["practice", false, "free"]);
  equal("standing: active Growth renews at period end", [s(row()).plan.key, s(row()).paying, s(row()).renewsAt?.toISOString()], ["growth", true, new Date(now + 20 * day).toISOString()]);
  const trial = s(row({ status: "trialing", trialEnd: new Date(now + 5 * day) }));
  equal("standing: a free trial shows its end", [trial.plan.key, trial.trialEndsAt?.toISOString()], ["growth", new Date(now + 5 * day).toISOString()]);
  const ending = s(row({ cancelAtPeriodEnd: true }));
  equal("standing: cancelled keeps the plan until the end, no renewal", [ending.plan.key, ending.renewsAt, ending.endsAt?.toISOString()], ["growth", null, new Date(now + 20 * day).toISOString()]);
  equal("standing: a failed payment keeps the plan, flagged", [s(row({ status: "past_due" })).plan.key, s(row({ status: "past_due" })).paymentProblem], ["growth", true]);
  for (const status of ["canceled", "unpaid", "incomplete", "incomplete_expired", "paused"]) equal(`standing: ${status} falls back to Practice`, s(row({ status })).plan.key, "practice");
  equal("standing: renewal news 2 days late still counts", s(row({ currentPeriodEnd: new Date(now - 2 * day) })).plan.key, "growth");
  equal("standing: 4 days past the period with no news falls back", s(row({ currentPeriodEnd: new Date(now - 4 * day) })).plan.key, "practice");
  equal("standing: an unknown plan key is Practice", s(row({ planKey: "enterprise" })).plan.key, "practice");

  const d = (plan, feature, wanted, opts) => limits.decide(byKey(plan), feature, wanted, PLANS, opts);
  const starter = byKey("starter");
  const growth = byKey("growth");
  equal(
    "canUse: Practice can't connect a real store; Starter is the way up",
    d("practice", "stores", 1),
    { ok: false, reason: `Your Practice plan doesn't include real stores. Starter includes ${starter.limits.stores} real stores.`, upgradeTo: "starter", limit: 0, wanted: 1 },
  );
  equal("canUse: products in real stores have a limit too", d("starter", "products", starter.limits.products + 1).upgradeTo, "growth");

  // Free trials: the pricing file caps shop builds during a trial.
  const trialCap = growth.trialLimits.shopBuildsPerMonth;
  if (trialCap != null) {
    equal("trial: the standing uses the trial's cap", trial.limits.shopBuildsPerMonth, Math.min(trialCap, growth.limits.shopBuildsPerMonth ?? Infinity));
    equal("trial: other limits stay the plan's", trial.limits.stores, growth.limits.stores);
    equal("trial: after the trial, the full limit", s(row({ status: "active" })).limits.shopBuildsPerMonth, growth.limits.shopBuildsPerMonth);
    equal("trial: builds within the cap are fine", d("growth", "shopBuildsPerMonth", trialCap, { onTrial: true }).ok, true);
    equal(
      "trial: one past the cap says when the rest comes, and doesn't push an upgrade that wouldn't help",
      d("growth", "shopBuildsPerMonth", trialCap + 1, { onTrial: true }),
      { ok: false, reason: `During the free trial, Growth includes ${trialCap} shop builds. You get ${growth.limits.shopBuildsPerMonth} shop builds a month once the trial ends.`, upgradeTo: null, limit: trialCap, wanted: trialCap + 1 },
    );
    equal("trial: past the plan's own limit still points up", d("growth", "shopBuildsPerMonth", growth.limits.shopBuildsPerMonth + 1, { onTrial: true }).upgradeTo, "fleet");
  }
  equal("canUse: Starter's last store is fine", d("starter", "stores", starter.limits.stores).ok, true);
  equal("canUse: one past Starter points to the cheapest plan that fits", d("starter", "stores", starter.limits.stores + 1).upgradeTo, "growth");
  equal("canUse: far past Growth skips to Fleet", d("starter", "stores", growth.limits.stores + 1).upgradeTo, "fleet");
  const top = PLANS[PLANS.length - 1];
  if (top.limits.stores !== null) {
    const over = d(top.key, "stores", top.limits.stores + 1);
    equal("canUse: past the biggest plan says so, with nowhere to go", [over.ok, over.upgradeTo, over.reason.endsWith("That's the most any plan includes.")], [false, null, true]);
  }
  // No plan is unlimited today, so try a made-up one.
  const roomy = PLANS.map((p) => (p.key === "fleet" ? { ...p, limits: { ...p.limits, shopBuildsPerMonth: null } } : p));
  const roomyFleet = roomy.find((p) => p.key === "fleet");
  equal("canUse: no limit means yes, said plainly", limits.decide(roomyFleet, "shopBuildsPerMonth", 100_000, roomy), { ok: true, reason: "Your Fleet plan has no limit on shop builds a month.", upgradeTo: null, limit: null, wanted: 100_000 });
  equal("canUse: an unlimited plan above is suggested as having no limit", limits.decide(byKey("growth"), "shopBuildsPerMonth", 100_000, roomy).reason.endsWith("Fleet has no limit."), true);
  equal("canUse: people, in a sentence", d("starter", "seats", starter.limits.seats + 1).reason, `Your Starter plan includes ${starter.limits.seats} people. Growth includes ${growth.limits.seats} people.`);
  equal("canUse: one of something reads as one", limits.describeLimit("seats", 1), "1 person");
  return results;
}

// ---------- rules about the code ----------
function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".next", ".git", ".shots", "scripts"].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(e.name)) out.push(p);
  }
  return out;
}
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, "/");

/** Takes the files as {path, text} so the check itself can be tested with a planted file. */
function codeRules(files) {
  const { check, results } = suite();
  const text = (p) => files.find((f) => f.path === p)?.text ?? "";
  const outside = files.filter((f) => !f.path.startsWith("connectors/") && /api\.stripe\.com/.test(f.text)).map((f) => f.path);
  check("code: only connectors/stripe talks to Stripe", outside.length === 0, `Stripe called from ${outside.join(", ")}`);
  const billing = files.filter((f) => /^(lib\/billing|app\/\(app\)\/billing|app\/api\/stripe)\//.test(f.path));
  const fetching = billing.filter((f) => /\bfetch\(/.test(f.text)).map((f) => f.path);
  check("code: billing code never sends requests itself", fetching.length === 0, `fetch() in ${fetching.join(", ")}`);
  const stripeFetch = files.filter((f) => f.path.startsWith("connectors/stripe/") && /\bfetch\(/.test(f.text)).map((f) => f.path);
  check("code: in connectors/stripe, only client.ts sends requests", stripeFetch.every((p) => p === "connectors/stripe/client.ts") && (text("connectors/stripe/client.ts").match(/\bfetch\(/g) ?? []).length === 1, `fetch() in ${stripeFetch.join(", ")}`);
  const route = text("app/api/stripe/webhook/route.ts").replace(/\/\/.*$/gm, "");
  const rawAt = Math.max(route.indexOf("request.arrayBuffer()"), route.indexOf("request.text()"));
  const verifyAt = route.indexOf("verifySignature(");
  const parseAt = route.indexOf("JSON.parse(");
  check("code: the notification route reads the raw body, checks the signature, then parses", rawAt >= 0 && verifyAt > rawAt && parseAt > verifyAt && !/request\.json\(\)/.test(route), `raw ${rawAt}, verify ${verifyAt}, parse ${parseAt}`);
  // Every insert into billing_settings must seal its first two values: the key and the signing secret.
  const inserts = files.filter((f) => /insert into armada\.billing_settings/.test(f.text));
  const unsealedInsert = inserts.filter((f) => !/insert into armada\.billing_settings\s*\([^)]*\)\s*values\s*\(\s*true,\s*\$\{seal\([^)]*\)\},\s*\$\{seal\([^)]*\)\}/.test(f.text)).map((f) => f.path);
  check("code: the key and signing secret are only stored sealed", inserts.length > 0 && unsealedInsert.length === 0, inserts.length ? `insert without seal() in ${unsealedInsert.join(", ")}` : "no insert found");
  const unsealed = files.filter((f) => /(secret_key|webhook_secret)\s*=\s*\$\{(?!seal\()/.test(f.text)).map((f) => f.path);
  check("code: nothing writes the key or secret unsealed", unsealed.length === 0, unsealed.join(", "));
  // lib/billing/plans.ts reads docs/pricing-plans.json, which holds the pricing research (margins,
  // competitors). A browser-side file that imports it for values would ship all of that to every visitor.
  const clientPlans = files
    .filter((f) => /^\s*["']use client["']/.test(f.text) && /^\s*import\s+(?!type\b)[^;]*from\s+["'][^"']*(lib\/billing\/plans|docs\/pricing-plans\.json)["']/m.test(f.text))
    .map((f) => f.path);
  check("code: nothing that runs in the browser imports the plans (the pricing research stays on the server)", clientPlans.length === 0, clientPlans.join(", "));
  const logging = files.filter((f) => /^(connectors\/stripe|lib\/billing)\//.test(f.path) && /console\./.test(f.text)).map((f) => f.path);
  check("code: Stripe and billing code log nothing (so a key can't end up in a log)", logging.length === 0, logging.join(", "));
  return results;
}

// ---------- run ----------
// A suite that throws counts as one failed check, so a break that crashes a check is still caught.
function guarded(name, fn) {
  try {
    return fn();
  } catch (e) {
    return [{ label: `${name}: the checks themselves crashed`, ok: false, detail: e.message }];
  }
}

async function everything(mods, sources, files) {
  return [
    ...guarded("signature", () => signatureChecks(mods.signature, sources.signature)),
    ...guarded("form", () => formChecks(mods.form)),
    ...guarded("plans", () => planChecks(mods.plans)),
    ...guarded("payloads", () => payloadChecks(mods.payloads, mods.form, mods.plans)),
    ...guarded("limits", () => limitChecks(mods.limits, mods.plans)),
    ...guarded("code", () => codeRules(files)),
  ];
}

let mods;
try {
  mods = Object.fromEntries(await Promise.all(Object.entries(FILES).map(async ([k, f]) => [k, await load(f)])));
} catch (e) {
  console.log(`FAIL couldn't load the billing code: ${e.message}`);
  process.exit(1);
}
const sources = Object.fromEntries(Object.entries(FILES).map(([k, f]) => [k, fs.readFileSync(f, "utf8")]));
const files = walk(ROOT).map((p) => ({ path: rel(p), text: fs.readFileSync(p, "utf8") }));

const results = await everything(mods, sources, files);
let failures = 0;
for (const r of results) {
  if (!r.ok) failures++;
  console.log(`${r.ok ? "PASS" : "FAIL"} ${r.label}${r.detail ? ` (${r.detail})` : ""}`);
}
if (mods.plans.PRICING_STATUS && !/^approved/i.test(mods.plans.PRICING_STATUS)) console.log(`NOTE docs/pricing-plans.json says: "${mods.plans.PRICING_STATUS}"`);

// Each plant breaks one thing in a scratch copy of one module; the checks above must notice.
const PLANTS = [
  ["signature", "no replay window", (s) => s.replace(/if \(Math\.abs\(now - parsed\.timestamp\) > tolerance\)[^\n]*\n/, "")],
  ["signature", "accepts the fake v0 scheme", (s) => s.replace('} else if (key === "v1") {', '} else if (key === "v1" || key === "v0") {')],
  ["signature", "signs the body without the timestamp", (s) => s.replace('mac.update(`${timestamp}.`, "utf8");', "")],
  ["signature", "plain comparison instead of constant time", (s) => s.replace("timingSafeEqual(got, expected)", "got.equals(expected)")],
  ["signature", "tolerance 0 allowed", (s) => s.replace(/if \(!\(tolerance > 0\)\) throw[^\n]*\n/, "")],
  ["signature", "trusts the first v1 only", (s) => s.replace("for (const sig of parsed.signatures) {", "for (const sig of parsed.signatures.slice(0, 1)) {")],
  ["form", "arrays without indexes", (s) => s.replace("`${name}[${i}]`", "`${name}[]`")],
  ["payloads", "checkout forgets the workspace", (s) => s.replace("client_reference_id: input.workspaceId,", "")],
  ["payloads", "trial of 0 days sent", (s) => s.replace("trial_period_days: input.trialDays > 0 ? input.trialDays : undefined,", "trial_period_days: input.trialDays,")],
  ["payloads", "notification address not pinned to a version", (s) => s.replace("api_version: STRIPE_API_VERSION,", "")],
  ["payloads", "period end read from the subscription, not its items", (s) => s.replace("const periodEnds = items.map((i) => i.current_period_end)", "const periodEnds = [s.current_period_end]")],
  ["payloads", "a key in Stripe's message is repeated", (s) => s.replace('.replace(/\\b(sk|rk|pk)_(test|live)_[A-Za-z0-9*]+/g, "your key")', "")],
  ["limits", "no grace for late renewal news", (s) => s.replace("new Date(sub.currentPeriodEnd).getTime() + GRACE_MS > now", "new Date(sub.currentPeriodEnd).getTime() > now")],
  ["limits", "the trial's shop-build cap is ignored", (s) => s.replace("if (!onTrial) return plan.limits;", "return plan.limits;")],
  ["limits", "past_due loses the plan", (s) => s.replace('export const ENTITLED = ["trialing", "active", "past_due"] as const;', 'export const ENTITLED = ["trialing", "active"] as const;')],
  ["limits", "suggests the biggest plan instead of the cheapest that fits", (s) => s.replace("plans.find((p, i) => i > rank", "[...plans].reverse().find((p, i) => plans.length - 1 - i > rank")],
  ["files", "a page calls Stripe directly", null],
  ["files", "the route parses before checking", null],
  ["files", "the key is stored as readable text", null],
  ["files", "the plan picker imports the plans in the browser", null],
];

if (process.argv.includes("--selftest")) {
  console.log("\nselftest: planting one break at a time");
  const cleanFails = new Set(results.filter((r) => !r.ok).map((r) => r.label));
  if (cleanFails.size) console.log(`(the untouched code already fails ${cleanFails.size} check(s); those can't count as catching anything)`);
  let missed = 0;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "armada-stripe-selftest-"));
  try {
    for (const [i, [target, name, plant]] of PLANTS.entries()) {
      let broken;
      if (target === "files") {
        let planted = files;
        if (name === "a page calls Stripe directly") planted = [...files, { path: "app/(app)/billing/planted.ts", text: 'await fetch("https://api.stripe.com/v1/customers")' }];
        else if (name === "the plan picker imports the plans in the browser")
          planted = files.map((f) => (f.path === "app/(app)/billing/plan-picker.tsx" ? { ...f, text: f.text.replace('import { formatMoney } from "@/lib/money";', 'import { formatMoney } from "@/lib/money";\nimport { PLANS } from "@/lib/billing/plans";') } : f));
        else if (name === "the key is stored as readable text") planted = files.map((f) => (f.path === "lib/billing/settings.ts" ? { ...f, text: f.text.replace("${seal(c.key)}", "${c.key}") } : f));
        else planted = files.map((f) => (f.path === "app/api/stripe/webhook/route.ts" ? { ...f, text: f.text.replace("verifySignature(raw,", "JSON.parse(\"{}\"); verifySignature(raw,").replace(/event = JSON\.parse\([^;]*;/, "") } : f));
        broken = codeRules(planted);
      } else {
        const changed = plant(sources[target]);
        if (changed === sources[target]) {
          console.log(`BROKEN ${name}: the plant didn't apply (the code it targets moved)`);
          missed++;
          continue;
        }
        const file = path.join(dir, `${target}-${i}.ts`);
        fs.writeFileSync(file, changed);
        const m = { ...mods, [target]: await load(file) };
        broken = await everything(m, { ...sources, [target]: changed }, files);
      }
      // Only checks that pass on the untouched code count as catching a plant.
      const caught = broken.filter((r) => !r.ok && !cleanFails.has(r.label));
      console.log(`${caught.length ? "caught" : "MISSED"} ${name}${caught.length ? ` (${caught[0].label})` : ""}`);
      if (!caught.length) missed++;
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  if (missed) failures++;
  console.log(missed ? `\n${missed} planted break(s) not caught` : "\nevery planted break was caught");
}

console.log(failures ? `\n${failures} check(s) failed` : `\nall ${results.length} checks pass`);
process.exit(failures ? 1 : 0);
