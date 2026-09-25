// A stand-in for Pipedream Connect, for testing one-click connections without an account.
// Answers in Pipedream's documented shapes: the service token, Connect tokens with a Connect Link,
// the hosted connect page (which "approves" at once and sends the browser back), accounts per user,
// and the relay, which answers as a small Shopify store and a small eBay seller would.
//
// usage: node scripts/mock-pipedream.mjs [port]
//   then run Armada with PIPEDREAM_API_BASE=http://127.0.0.1:<port> (and settings for client id
//   "mock-client", secret "mock-secret", any proj_ id).
// GET /__stats shows what arrived; /__deny-next makes the next connect page fail like a decline.
import http from "node:http";
import crypto from "node:crypto";

const PORT = Number(process.argv[2] || 4610);
const CLIENT = { id: "mock-client", secret: "mock-secret" };
const PROJECT = "proj_Mock1";
const serviceTokens = new Set();
const connectTokens = new Map(); // ctok -> { externalUserId, success, error }
const accounts = []; // { id, externalUserId, app, createdAt, updatedAt, healthy }
const stats = { tokens: 0, connectTokens: 0, pages: 0, relays: 0, relayByApp: {}, leakedKeys: 0, badTargets: [], deletes: 0, envMissing: 0 };
let denyNext = false;
let shopCount = 0;

const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(body === undefined ? "" : JSON.stringify(body));
};
const readBody = (req) =>
  new Promise((r) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => r(b));
  });
const authed = (req) => serviceTokens.has((req.headers.authorization ?? "").replace(/^Bearer /, ""));

function shopAnswer(account, body) {
  const q = JSON.parse(body || "{}").query ?? "";
  if (/shop\s*\{/.test(q) && /myshopifyDomain/.test(q)) {
    return {
      data: {
        shop: {
          id: `gid://shopify/Shop/${account.n}`,
          name: `Mock Store ${account.n}`,
          myshopifyDomain: `mock-store-${account.n}.myshopify.com`,
          currencyCode: "USD",
          primaryDomain: { host: `mock-store-${account.n}.myshopify.com` },
          billingAddress: { countryCodeV2: "US" },
          plan: { partnerDevelopment: true },
        },
      },
      extensions: { cost: { requestedQueryCost: 1, throttleStatus: { currentlyAvailable: 1000, restoreRate: 50 } } },
    };
  }
  return { data: {} };
}

function ebayAnswer(method, url) {
  const p = url.pathname;
  if (p.startsWith("/commerce/identity/v1/user")) {
    return {
      userId: "mockEbayUser1",
      username: "mock_seller",
      registrationMarketplaceId: "EBAY_US",
      accountType: "INDIVIDUAL",
      individualAccount: {
        firstName: "Mock",
        lastName: "Seller",
        registrationAddress: { addressLine1: "1 Main St", city: "Lakeland", stateOrProvince: "FL", postalCode: "33801", country: "US" },
      },
    };
  }
  if (p.endsWith("/privilege")) return { sellerRegistrationCompleted: true, sellingLimit: { amount: { value: "5000", currency: "USD" }, quantity: 100 } };
  if (p.endsWith("/get_opted_in_programs")) return { programs: [{ programType: "SELLING_POLICY_MANAGEMENT" }] };
  if (p.includes("get_shipping_services")) {
    return { shippingServices: [{ shippingService: "USPSPriority", shippingCarrier: "USPS", description: "USPS Priority Mail", domesticService: true, internationalService: false, validForSellingFlow: true, shippingCategory: "EXPEDITED", minShippingTime: 1, maxShippingTime: 3 }] };
  }
  if (method === "GET" && /_policy$/.test(p)) return {};
  if (method === "POST" && /_policy$/.test(p)) {
    const kind = p.split("/").pop();
    const idKey = { fulfillment_policy: "fulfillmentPolicyId", payment_policy: "paymentPolicyId", return_policy: "returnPolicyId" }[kind] ?? "id";
    return { [idKey]: `${kind}-${crypto.randomUUID().slice(0, 6)}`, name: "Armada" };
  }
  return null;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const body = await readBody(req);

  if (url.pathname === "/__stats") return send(res, 200, { ...stats, accounts });
  if (url.pathname === "/__deny-next") {
    denyNext = true;
    return send(res, 200, { ok: true });
  }

  if (req.method === "POST" && url.pathname === "/v1/oauth/token") {
    const j = JSON.parse(body || "{}");
    if (j.grant_type !== "client_credentials" || j.client_id !== CLIENT.id || j.client_secret !== CLIENT.secret) return send(res, 401, { error: "invalid_client" });
    const token = `pdtok_${crypto.randomUUID()}`;
    serviceTokens.add(token);
    stats.tokens++;
    return send(res, 200, { access_token: token, token_type: "Bearer", expires_in: 3600 });
  }

  let m = url.pathname.match(/^\/v1\/connect\/(proj_[A-Za-z0-9]+)\/tokens$/);
  if (req.method === "POST" && m) {
    if (!authed(req)) return send(res, 401, { error: "unauthorized" });
    if (!req.headers["x-pd-environment"]) stats.envMissing++;
    const j = JSON.parse(body || "{}");
    const token = `ctok_${crypto.randomBytes(16).toString("hex")}`;
    connectTokens.set(token, { externalUserId: j.external_user_id, success: j.success_redirect_uri, error: j.error_redirect_uri });
    stats.connectTokens++;
    return send(res, 200, {
      token,
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
      connect_link_url: `http://127.0.0.1:${PORT}/_static/connect.html?token=${token}&connectLink=true`,
    });
  }

  if (url.pathname === "/_static/connect.html") {
    stats.pages++;
    const t = connectTokens.get(url.searchParams.get("token") ?? "");
    const app = url.searchParams.get("app");
    if (!t || !["shopify", "ebay", "tiktok_ads_manager", "google_ads", "printful_oauth", "printify"].includes(app ?? "")) return send(res, 400, { error: "bad link" });
    if (denyNext) {
      denyNext = false;
      res.writeHead(302, { location: t.error });
      return res.end();
    }
    const now = new Date().toISOString();
    accounts.push({ id: `apn_${crypto.randomBytes(4).toString("hex")}`, externalUserId: t.externalUserId, app, createdAt: now, updatedAt: now, healthy: true, n: ++shopCount });
    res.writeHead(302, { location: t.success });
    return res.end();
  }

  m = url.pathname.match(/^\/v1\/connect\/(proj_[A-Za-z0-9]+)\/projects\/info$/);
  if (req.method === "GET" && m) {
    if (!authed(req)) return send(res, 401, { error: "unauthorized" });
    if (m[1] !== PROJECT) return send(res, 404, { error: "project not found" });
    return send(res, 200, { id: PROJECT, name: "Armada", environment: req.headers["x-pd-environment"] ?? null });
  }

  m = url.pathname.match(/^\/v1\/connect\/(proj_[A-Za-z0-9]+)\/users\/([^/]+)\/accounts$/);
  if (req.method === "GET" && m) {
    if (!authed(req)) return send(res, 401, { error: "unauthorized" });
    const ext = decodeURIComponent(m[2]);
    // Like Pipedream: a user who has never connected anything doesn't exist yet.
    if (!accounts.some((a) => a.externalUserId === ext)) return send(res, 404, { error: "external user not found" });
    const app = url.searchParams.get("app");
    const list = accounts
      .filter((a) => a.externalUserId === ext && (!app || a.app === app))
      .map((a) => ({ id: a.id, name: null, external_id: a.externalUserId, healthy: a.healthy, dead: false, app: { name_slug: a.app }, created_at: a.createdAt, updated_at: a.updatedAt }));
    return send(res, 200, { data: list });
  }

  m = url.pathname.match(/^\/v1\/connect\/(proj_[A-Za-z0-9]+)\/accounts\/([^/]+)$/);
  if (req.method === "DELETE" && m) {
    if (!authed(req)) return send(res, 401, { error: "unauthorized" });
    const i = accounts.findIndex((a) => a.id === m[2]);
    if (i >= 0) accounts.splice(i, 1);
    stats.deletes++;
    return send(res, 204);
  }

  m = url.pathname.match(/^\/v1\/connect\/(proj_[A-Za-z0-9]+)\/proxy\/([A-Za-z0-9_-]+)$/);
  if (m) {
    if (!authed(req)) return send(res, 401, { error: "unauthorized" });
    stats.relays++;
    if (req.headers["x-shopify-access-token"] || req.headers["x-pd-proxy-authorization"] || req.headers["x-pd-proxy-x-shopify-access-token"]) stats.leakedKeys++;
    const account = accounts.find((a) => a.id === url.searchParams.get("account_id") && a.externalUserId === url.searchParams.get("external_user_id"));
    if (!account) return send(res, 404, { error: "account not found" });
    const target = Buffer.from(m[2], "base64url").toString("utf8");
    stats.relayByApp[account.app] = (stats.relayByApp[account.app] ?? 0) + 1;
    if (account.app === "shopify") {
      // Shopify has an address per store, so only a path is accepted.
      if (!target.startsWith("/admin/")) {
        stats.badTargets.push(target);
        return send(res, 400, { error: "use a relative path for this app" });
      }
      return send(res, 200, shopAnswer(account, body));
    }
    const t = new URL(target);
    // The other apps' own domains, answering who the account is.
    const ALLOWED = { tiktok_ads_manager: ["business-api.tiktok.com"], google_ads: ["googleads.googleapis.com", "www.googleapis.com"], printful_oauth: ["api.printful.com"], printify: ["api.printify.com"] };
    if (ALLOWED[account.app]) {
      if (!ALLOWED[account.app].includes(t.hostname)) {
        stats.badTargets.push(target);
        return send(res, 403, { error: "domain not allowed" });
      }
      if (t.hostname === "api.printful.com" && t.pathname === "/stores") return send(res, 200, { code: 200, result: [{ id: 1, name: "Mock Print Studio" }] });
      if (t.hostname === "api.printify.com" && t.pathname === "/v1/shops.json") return send(res, 200, [{ id: 7, title: "Mock Printify Shop" }]);
      if (t.hostname === "business-api.tiktok.com") return send(res, 200, { code: 0, data: { display_name: "Mock TikTok Ads", email: "ads@example.com" } });
      return send(res, 200, {});
    }
    if (!["api.ebay.com", "apiz.ebay.com"].includes(t.hostname)) {
      stats.badTargets.push(target);
      return send(res, 403, { error: "domain not allowed" });
    }
    const answer = ebayAnswer(req.method, t);
    if (answer === null) return send(res, 204);
    return send(res, 200, answer);
  }

  send(res, 404, { error: "not found" });
});

server.listen(PORT, "127.0.0.1", () => console.log(`mock Pipedream on http://127.0.0.1:${PORT}`));
