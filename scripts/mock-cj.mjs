// A stand-in for CJ Dropshipping's API v2, for testing Armada's CJ connection without a real key.
// Answers in CJ's documented shapes, using DummyJSON's sample products as the catalog, and
// enforces CJ's one-call-a-second limit (answering 1600200 like CJ does) so the speed lane is tested too.
// usage: node scripts/mock-cj.mjs [port]      then run Armada with CJ_BASE_URL=http://127.0.0.1:<port>/api2.0/v1
// It accepts any key starting CJ-MOCK-GOOD-KEY-, each one a separate CJ account with its own limit.
// GET /__stats shows calls and limit breaches; /__expire and /__busy?n= simulate CJ's bad moments.
import http from "node:http";
import crypto from "node:crypto";

const PORT = Number(process.argv[2] || 4599);
const GOOD_KEY_PREFIX = "CJ-MOCK-GOOD-KEY-";
const PREFIX = "/api2.0/v1";

const res0 = await fetch("https://dummyjson.com/products?limit=0");
const catalog = (await res0.json()).products;
console.log(`mock CJ: ${catalog.length} sample products loaded`);

// access or refresh token → the API key (account) it belongs to
const tokens = new Map();
const refreshTokens = new Map();
const stats = { calls: 0, tooFast: 0, busySent: 0, pointsOutSent: 0, searchesWithoutCategory: 0, byPath: {}, gaps: [] };
const lastCall = new Map();
let busyLeft = 0;
let pointsOutLeft = 0;

const ok = (data) => ({ code: 200, result: true, message: "Success", data, requestId: crypto.randomUUID() });
const fail = (code, message) => ({ code, result: false, message, data: null, requestId: crypto.randomUUID() });
const hash = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const money = (n) => (Math.round(n * 100) / 100).toFixed(2);
const pidOf = (p) => `MOCK-${String(p.id).padStart(4, "0")}-${hash(p.title).toString(16).toUpperCase()}`;
const byPid = new Map(catalog.map((p) => [pidOf(p), p]));

const STOP = new Set(["and", "for", "the", "with", "set", "kit", "your", "gear", "goods"]);
const words = (s) => String(s ?? "").toLowerCase().match(/[a-z]{3,}/g)?.filter((w) => !STOP.has(w)) ?? [];

function listItem(p) {
  const cost = p.price * 0.28;
  const pid = pidOf(p);
  return {
    id: pid,
    nameEn: p.title,
    sku: `CJ${hash(pid) % 1e8}`,
    bigImage: p.thumbnail,
    sellPrice: p.id % 3 === 0 ? `${money(cost)}-${money(cost * 1.12)}` : money(cost),
    listedNum: hash(pid) % 900,
    warehouseInventoryNum: (p.stock ?? 0) * 10,
    threeCategoryName: p.category.replace(/-/g, " "),
    oneCategoryName: p.category,
    description: `<p>${p.description}</p><p><img src="${p.thumbnail}"></p>`,
    addMarkStatus: p.id % 4 === 0 ? 1 : 0,
    supplierName: "Mock Supplier",
  };
}

function search(keyword, size) {
  const want = words(keyword);
  if (!want.length) return [];
  return catalog
    .map((p) => {
      const hay = new Set(words(`${p.title} ${p.category} ${(p.tags ?? []).join(" ")}`));
      return { p, score: want.filter((w) => hay.has(w) || hay.has(w.replace(/s$/, ""))).length };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, size)
    .map((x) => listItem(x.p));
}

function detail(pid) {
  const p = byPid.get(pid);
  if (!p) return null;
  const li = listItem(p);
  const cost = p.price * 0.28;
  return {
    pid,
    productNameEn: p.title,
    productSku: li.sku,
    bigImage: p.thumbnail,
    productImageSet: p.images ?? [],
    productWeight: Math.round((p.weight ?? 1) * 100),
    categoryName: `Home > ${p.category.replace(/-/g, " ")}`,
    materialNameEnSet: ["Mixed"],
    packingNameEnSet: ["Box"],
    description: li.description,
    sellPrice: li.sellPrice,
    suggestSellPrice: `${money(p.price)}`,
    listedNum: li.listedNum,
    variants: [
      { vid: `${pid}-V1`, variantSku: `${li.sku}-1`, variantKey: "Standard", variantSellPrice: Number(money(cost)), variantImage: p.thumbnail },
      { vid: `${pid}-V2`, variantSku: `${li.sku}-2`, variantKey: "Large", variantSellPrice: Number(money(cost * 1.12)), variantImage: p.thumbnail },
    ],
  };
}

function freight(vid) {
  const p = byPid.get(String(vid).replace(/-V\d+$/, ""));
  if (!p || p.id % 11 === 0) return []; // some products CJ can't ship: Armada must leave them out
  const base = 3.2 + (p.id % 5) * 0.7;
  const days = [["6", "11"], ["8", "15"], ["12", "20"]][p.id % 3];
  return [
    { logisticName: "CJPacket Ordinary", logisticPrice: Number(money(base)), logisticAging: `${days[0]}-${days[1]}`, totalPostageFee: base },
    { logisticName: "USPS+", logisticPrice: Number(money(base + 2.4)), logisticAging: "5-8", totalPostageFee: base + 2.4 },
  ];
}

function tokenData(account) {
  const access = `mock-access-${crypto.randomBytes(12).toString("hex")}`;
  const refresh = `mock-refresh-${crypto.randomBytes(12).toString("hex")}`;
  tokens.set(access, account);
  refreshTokens.set(refresh, account);
  // CJ's tokens last 180 days, both kinds.
  const in180 = new Date(Date.now() + 180 * 86400_000).toISOString();
  return { openId: 1234567, accessToken: access, accessTokenExpiryDate: in180, refreshToken: refresh, refreshTokenExpiryDate: in180, createDate: new Date().toISOString() };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const send = (body, status = 200) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (url.pathname === "/__stats") return send({ ...stats, gaps: undefined, smallestGapMs: stats.gaps.length ? Math.min(...stats.gaps) : null });
  // Test switches: make every access token stop working, or answer "busy" to the next n calls.
  if (url.pathname === "/__expire") {
    tokens.clear();
    return send({ expired: true });
  }
  if (url.pathname === "/__busy") {
    busyLeft = Number(url.searchParams.get("n") || 1);
    return send({ busyLeft });
  }
  // Out of API points for the next n calls: CJ answers HTTP 429 with code 429.
  if (url.pathname === "/__points") {
    pointsOutLeft = Number(url.searchParams.get("n") || 1);
    return send({ pointsOutLeft });
  }
  if (!url.pathname.startsWith(PREFIX)) return send(fail(404, "Not found"), 404);
  const path = url.pathname.slice(PREFIX.length);
  let body = {};
  if (req.method === "POST") {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    } catch {
      return send(fail(1600300, "Param error"));
    }
  }

  // CJ's limit: about one call a second per account. The account is the API key behind the call.
  const account =
    path === "/authentication/getAccessToken"
      ? String(body.apiKey ?? "")
      : path === "/authentication/refreshAccessToken"
        ? (refreshTokens.get(body.refreshToken) ?? "unknown")
        : (tokens.get(req.headers["cj-access-token"]) ?? "unknown");
  const now = Date.now();
  const last = lastCall.get(account) ?? 0;
  stats.calls++;
  stats.byPath[path] = (stats.byPath[path] ?? 0) + 1;
  if (last) stats.gaps.push(now - last);
  if (last && now - last < 1000) {
    stats.tooFast++;
    console.log(`  too fast: ${path} ${now - last}ms after the last call`);
    return send(fail(1600200, "Too Many Requests, QPS limit is 1 time/1second"));
  }
  lastCall.set(account, now);
  if (busyLeft > 0) {
    busyLeft--;
    stats.busySent++;
    return send(fail(1600200, "Too Many Requests, QPS limit is 1 time/1second"));
  }
  if (pointsOutLeft > 0 && !path.startsWith("/authentication/")) {
    pointsOutLeft--;
    stats.pointsOutSent++;
    return send(fail(429, "Insufficient API points"), 429);
  }

  if (path === "/authentication/getAccessToken") {
    if (!String(body.apiKey ?? "").startsWith(GOOD_KEY_PREFIX)) return send(fail(1600005, "apiKey is wrong"));
    return send(ok(tokenData(account)));
  }
  if (path === "/authentication/refreshAccessToken") {
    if (!refreshTokens.has(body.refreshToken)) return send(fail(1600003, "Invalid Refresh Token"));
    return send(ok(tokenData(account)));
  }
  if (!tokens.has(req.headers["cj-access-token"])) return send(fail(1600001, "Invalid API key or access token"));

  if (path === "/setting/get") {
    // qpsLimit 100 is what CJ's own documentation example shows; Armada must not believe it.
    return send(ok({ openId: 1234567, openName: "Mock Test Shop", openEmail: "test@example.com", setting: { qpsLimit: 100, quotaLimits: [] }, isSandbox: true }));
  }
  if (path === "/product/listV2") {
    const size = Math.min(100, Number(url.searchParams.get("size") || 20));
    // Category names come back only when asked for with features=enable_category, as on CJ.
    const withCategory = url.searchParams.getAll("features").includes("enable_category");
    if (!withCategory) stats.searchesWithoutCategory++;
    const list = search(url.searchParams.get("keyWord"), size).map((p) =>
      withCategory ? p : { ...p, threeCategoryName: undefined, oneCategoryName: undefined },
    );
    console.log(`  search "${url.searchParams.get("keyWord")}": ${list.length}`);
    return send(ok({ pageSize: size, pageNumber: 1, totalRecords: list.length, totalPages: 1, content: [{ productList: list, relatedCategoryList: [], keyWord: url.searchParams.get("keyWord") }] }));
  }
  if (path === "/product/query") {
    const d = detail(url.searchParams.get("pid"));
    return send(d ? ok(d) : fail(1602001, "Product not found"));
  }
  if (path === "/logistic/freightCalculate") {
    return send(ok(freight(body.products?.[0]?.vid)));
  }
  return send(fail(1600100, `mock has no ${path}`));
});

server.listen(PORT, "127.0.0.1", () => console.log(`mock CJ listening on http://127.0.0.1:${PORT}${PREFIX}`));
