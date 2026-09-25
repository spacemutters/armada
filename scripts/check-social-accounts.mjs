// Checks for social accounts.
//
// Offline (the default): sign-in addresses and one-time state handling through the real connect
// flows, bio lengths per platform, the practice publish path, and the exact order of calls for
// Instagram carousels, Facebook multi-photo posts and TikTok photo posts, against a fake fetch and a
// fake database. Nothing leaves this computer.
//
// --live: the same code against the real database, in a throwaway workspace that is deleted at the
// end: a practice account is made, listed, posted to (and the post recorded), then disconnected;
// plus row-level security, one-time states and the real-account gates. Calls no platform.
//
//   node scripts/check-social-accounts.mjs
//   node --env-file=.env.local scripts/check-social-accounts.mjs --live
//
// Prints one "ok" or "FAIL" line per check and exits 1 on any FAIL.
import { registerHooks } from "node:module";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const LIVE = process.argv.includes("--live");

// ---------- load the app's TypeScript straight from source ----------
// "@/..." is the project root; "server-only" is a marker; offline, the database, the one-time state
// store and shop lookups are replaced by the in-memory fakes below.
const fake = (code) => `data:text/javascript,${encodeURIComponent(code)}`;
const FAKES = LIVE ? { "server-only": fake("") } : {
  "server-only": fake(""),
  "@/lib/db": fake(`
    export const withWorkspace = (ws, fn) => globalThis.__db.run(ws, fn);
    export const asSystem = (fn) => globalThis.__db.run(null, fn);
    export const unscoped = () => { throw new Error("unscoped in test"); };`),
  "@/lib/connections/state": fake(`
    export const createState = (...a) => globalThis.__state.create(...a);
    export const consumeState = (...a) => globalThis.__state.consume(...a);`),
  "@/lib/shops/queries": fake(`
    export const getShop = async (ws, id) => globalThis.__shops.find((s) => s.workspaceId === ws && s.id === id) ?? null;
    export const listShops = async (ws) => globalThis.__shops.filter((s) => s.workspaceId === ws);`),
};
registerHooks({
  resolve(specifier, context, next) {
    if (FAKES[specifier]) return { url: FAKES[specifier], shortCircuit: true };
    if (specifier.startsWith("@/")) specifier = pathToFileURL(path.join(ROOT, specifier.slice(2))).href;
    try {
      return next(specifier, context);
    } catch (e) {
      if (!specifier.startsWith(".") && !specifier.startsWith("file:")) throw e;
      for (const ext of [".ts", ".tsx", "/index.ts"]) {
        try {
          return next(specifier + ext, context);
        } catch {}
      }
      throw e;
    }
  },
});

let failed = 0;
function check(name, ok, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && detail ? `: ${detail}` : ""}`);
}
const load = (p) => import(pathToFileURL(path.join(ROOT, p)).href);

if (LIVE) {
  await liveRun();
  console.log(failed ? `\n${failed} live check${failed === 1 ? "" : "s"} failed.` : "\nAll live social account checks passed.");
  process.exit(failed ? 1 : 0);
}

process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
process.env.APP_ORIGIN = "https://armada.test";
process.env.META_APP_ID = "1234567890";
process.env.META_APP_SECRET = "meta-app-secret-for-tests";
process.env.META_SOCIAL_CONFIG_ID = "cfg-555";
process.env.TIKTOK_CLIENT_KEY = "tt-client-key";
process.env.TIKTOK_CLIENT_SECRET = "tt-client-secret";
process.env.TIKTOK_VERIFY_FILE = "tiktokAbc123.txt";
process.env.TIKTOK_VERIFY_TEXT = "tiktok-developers-site-verification=xyz";

// =====================================================================================
// Live: the real database, a throwaway workspace, no platform calls
// =====================================================================================
async function liveRun() {
  if (!process.env.DATABASE_URL || !process.env.ENCRYPTION_KEY) {
    check("DATABASE_URL and ENCRYPTION_KEY are set (run with --env-file=.env.local)", false);
    return;
  }
  // Real platform settings are switched off for this run, so nothing can reach Meta or TikTok.
  for (const k of ["META_APP_ID", "META_APP_SECRET", "META_SOCIAL_CONFIG_ID", "TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"]) delete process.env[k];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    throw new Error(`the live check must not call out: ${url}`);
  };

  const db = await load("lib/db/index.ts");
  const store = await load("lib/social/accounts/store.ts");
  const index = await load("lib/social/accounts/index.ts");
  const state = await load("lib/connections/state.ts");
  const config = await load("lib/social/accounts/config.ts");

  const slug = `sc${crypto.randomBytes(5).toString("hex")}`;
  let ws = null;
  try {
    const made = await db.asSystem(async (tx) => {
      const [w] = await tx`insert into armada.workspaces (name) values ('Social accounts check (delete me)') returning id`;
      const [m] = await tx`insert into armada.members (workspace_id, display_name, role) values (${w.id}, 'Check', 'owner') returning id`;
      const blueprint = {
        brand: { name: "Check Shop", alternativeNames: [], tagline: "A shop made by the social accounts check.", voice: "plain", audience: "nobody", monogramIcon: "leaf" },
        theme: { palette: { background: "#ffffff", surface: "#ffffff", ink: "#111111", muted: "#555555", accent: "#224466", accentInk: "#ffffff" }, fonts: { display: "Inter", body: "Inter" }, contrastFixes: [] },
      };
      const [s] = await tx`
        insert into armada.shops (workspace_id, slug, status, niche, brief, blueprint)
        values (${w.id}, ${slug}, 'ready', 'check', ${tx.json({ source: "cj" })}, ${tx.json(blueprint)}) returning id`;
      return { ws: w.id, member: m.id, shop: s.id };
    });
    ws = made.ws;
    const { member, shop } = made;
    check("A throwaway workspace, owner and ready shop were made", Boolean(ws && member && shop));

    // Practice connect.
    const accountId = await store.createPracticeAccount(ws, member, { id: shop, name: "Check Shop", handle: "checkshop" }, "instagram");
    const again = await store.createPracticeAccount(ws, member, { id: shop, name: "Check Shop", handle: "checkshop" }, "instagram");
    check("Making a practice Instagram account saves one row (pressing twice doesn't make a second)", accountId === again, `${accountId} vs ${again}`);

    // socialAccountsFor returns it.
    const accounts = await index.socialAccountsFor(ws, shop);
    const mine = accounts.find((a) => a.id === accountId);
    check(
      "socialAccountsFor returns it as a practice account that takes carousels",
      accounts.length === 1 && mine?.platform === "instagram" && mine.status === "practice" && mine.canPostCarousel === true && mine.handle === "checkshop" && mine.shopId === shop && mine.workspaceId === ws,
      JSON.stringify(accounts),
    );

    // Row-level security: another workspace sees nothing and can't post to it.
    const otherWs = crypto.randomUUID();
    const seen = await index.socialAccountsFor(otherWs, shop);
    const foreign = await index.publishCarousel(otherWs, accountId, { caption: "x", slides: [{ imageUrl: "https://armada.test/a.jpg", alt: "" }] });
    check("Another workspace can't see the account or post to it", seen.length === 0 && foreign.ok === false, JSON.stringify(foreign));

    // publishCarousel succeeds and is recorded.
    const started = Date.now();
    const result = await index.publishCarousel(ws, accountId, {
      caption: "A practice carousel from the live check",
      slides: [
        { imageUrl: "/api/social/slide/00000000-0000-4000-8000-000000000000/1.jpg?v=abc", alt: "First slide" },
        { imageUrl: "https://example.com/two.jpg", alt: "Second slide" },
      ],
    });
    const took = Date.now() - started;
    check("publishCarousel on the practice account succeeds at once", result.ok === true && /^practice:[0-9a-f-]{36}$/.test(result.externalId ?? "") && took < 5000, JSON.stringify(result));
    const recorded = await store.practicePostsFor(ws, [accountId]);
    const post = recorded.posts[0];
    check(
      "The practice post is recorded with its caption and pictures (addresses made absolute)",
      recorded.counts[accountId] === 1 &&
        post?.caption === "A practice carousel from the live check" &&
        post.slides.length === 2 &&
        /^https?:\/\/[^/]+\/api\/social\/slide\//.test(post.slides[0].imageUrl) &&
        post.slides[1].alt === "Second slide" &&
        result.externalId === `practice:${post.id}`,
      JSON.stringify(recorded),
    );
    const counts = await store.accountCountsByShop(ws);
    check("The shop list counts it as one practice account", counts[shop]?.practice === 1 && counts[shop]?.connected === 0, JSON.stringify(counts));

    // A real account's access is stored sealed; posting to it is refused while the platform is switched off.
    const realId = await db.withWorkspace(ws, (tx) =>
      store.saveRealAccount(tx, ws, {
        shopId: shop,
        platform: "facebook",
        name: "Check Page",
        handle: null,
        externalId: "1234",
        secret: { pageToken: "NOT-A-REAL-PAGE-ACCESS" },
        meta: { pageId: "1234" },
        memberId: member,
      }),
    );
    const raw = await db.asSystem((tx) => tx`select secret, status, kind from armada.social_accounts where id = ${realId}`);
    const opened = await db.withWorkspace(ws, (tx) => store.loadAccountWithSecret(tx, realId));
    check(
      "A real account's access is stored sealed and opens back",
      raw[0]?.status === "connected" && !Buffer.from(raw[0].secret).toString("utf8").includes("NOT-A-REAL") && opened?.secret?.pageToken === "NOT-A-REAL-PAGE-ACCESS",
    );
    const off = await index.publishCarousel(ws, realId, { caption: "x", slides: [{ imageUrl: "https://armada.test/a.jpg", alt: "" }] });
    check("Posting to a real account while Facebook isn't switched on is refused in plain words", off.ok === false && /switched off/.test(off.problem ?? ""), JSON.stringify(off));
    let refused = false;
    try {
      await db.withWorkspace(ws, (tx) => tx`insert into armada.social_accounts (workspace_id, shop_id, platform, kind, status) values (${ws}, ${shop}, 'tiktok', 'real', 'connected')`);
    } catch {
      refused = true;
    }
    check("The database refuses a real account with no sealed access", refused);

    // One-time states under the social labels.
    const s = await state.createState(ws, member, config.STATE_PROVIDER.instagram, "connect", { shopId: shop });
    const wrong = await state.consumeState(s, config.STATE_PROVIDER.tiktok);
    const first = await state.consumeState(s, config.STATE_PROVIDER.instagram);
    const second = await state.consumeState(s, config.STATE_PROVIDER.instagram);
    check(
      "A social one-time state works once, only for its own platform",
      wrong === null && first?.workspaceId === ws && first?.memberId === member && first?.detail.shopId === shop && second === null,
    );

    // Disconnect.
    const removedByHelper = await store.removeAccount(ws, member, realId, false);
    check("Someone who may only use practice accounts can't disconnect the real one", removedByHelper === null);
    const removed = await store.removeAccount(ws, member, accountId, true);
    const after = await index.socialAccountsFor(ws, shop);
    const left = await db.asSystem((tx) => tx`select count(*)::int as n from armada.practice_social_posts where account_id = ${accountId}`);
    const audit = await db.asSystem((tx) => tx`select action from armada.audit_log where workspace_id = ${ws} order by id`);
    check(
      "Disconnecting removes the practice account and its practice posts, and the audit log has each step",
      removed?.id === accountId && after.every((a) => a.id !== accountId) && left[0].n === 0 &&
        ["social.practice_created", "social.connected", "social.removed"].every((a) => audit.some((r) => r.action === a)),
      JSON.stringify({ after, left, audit }),
    );
  } catch (e) {
    check("The live run finished without an error", false, e.stack || e.message);
  } finally {
    if (ws) {
      await db.asSystem((tx) => tx`delete from armada.workspaces where id = ${ws}`);
      const gone = await db.asSystem((tx) => tx`select (select count(*) from armada.workspaces where id = ${ws})::int as w, (select count(*) from armada.social_accounts where workspace_id = ${ws})::int as a`);
      check("The throwaway workspace and everything in it is deleted", gone[0].w === 0 && gone[0].a === 0, JSON.stringify(gone));
    }
    globalThis.fetch = realFetch;
    await db.unscoped().end({ timeout: 5 });
  }
}

let meta, tiktok, kitMod, relayMod, publishMod, config, connect, store, index, cryptoMod;
try {
  meta = await load("connectors/social-accounts/meta.ts");
  tiktok = await load("connectors/social-accounts/tiktok.ts");
  kitMod = await load("lib/social/accounts/kit.ts");
  relayMod = await load("lib/social/accounts/relay.ts");
  publishMod = await load("lib/social/accounts/publish.ts");
  config = await load("lib/social/accounts/config.ts");
  connect = await load("lib/social/accounts/connect.ts");
  store = await load("lib/social/accounts/store.ts");
  index = await load("lib/social/accounts/index.ts");
  cryptoMod = await load("lib/crypto.ts");
} catch (e) {
  console.log(`FAIL couldn't load the social accounts code: ${e.stack || e.message}`);
  process.exit(1);
}

// ---------- fakes ----------
/** A fake fetch that answers from a list of [matcher, answer] rules and records every call. */
function fakeFetch(rules) {
  const calls = [];
  const f = async (url, init = {}) => {
    const method = init.method ?? "GET";
    const body = init.body instanceof URLSearchParams ? Object.fromEntries(init.body) : typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    const u = new URL(url);
    const call = { method, url, host: u.host, path: u.pathname, query: Object.fromEntries(u.searchParams), body, headers: init.headers ?? {} };
    calls.push(call);
    for (const rule of rules) {
      if (rule.used && rule.once) continue;
      if (rule.method && rule.method !== method) continue;
      if (!rule.match(call)) continue;
      rule.used = true;
      const answer = typeof rule.answer === "function" ? rule.answer(call) : rule.answer;
      const status = answer.status ?? 200;
      const payload = answer.raw ?? JSON.stringify(answer.json ?? {});
      return new Response(payload, { status, headers: { "content-type": answer.type ?? "application/json" } });
    }
    return new Response(JSON.stringify({ error: { message: `no fake for ${method} ${u.pathname}`, code: 999 } }), { status: 500 });
  };
  f.calls = calls;
  return f;
}
const on = (method, test, answer, once = false) => ({ method, match: typeof test === "string" ? (c) => c.path.endsWith(test) : test, answer, once });

/** In-memory database: records every query and answers the few shapes the connect and publish code asks for. */
function fakeDb() {
  const db = { queries: [], accounts: [], choices: [], practice: [], n: 0 };
  const route = (text, values) => {
    db.queries.push({ text, values });
    if (/insert into armada\.social_accounts/.test(text)) {
      const [ws, shopId, platform] = values;
      const kind = /'practice'/.test(text) ? "practice" : "real";
      let row = db.accounts.find((a) => a.shopId === shopId && a.platform === platform && a.kind === kind);
      if (!row) {
        row = { id: `acc-${++db.n}`, workspaceId: ws, shopId, platform, kind };
        db.accounts.push(row);
      }
      Object.assign(row, { values, text });
      return [{ id: row.id }];
    }
    if (/insert into armada\.social_page_choices/.test(text)) {
      const row = { id: `choice-${++db.n}`, values };
      db.choices.push(row);
      return [{ id: row.id }];
    }
    if (/insert into armada\.practice_social_posts/.test(text)) {
      const row = { id: `post-${++db.n}`, values };
      db.practice.push(row);
      return [{ id: row.id }];
    }
    if (/secret from armada\.social_accounts where id/.test(text)) return db.loadRow ? [db.loadRow] : [];
    return [];
  };
  const tx = (first, ...values) => {
    if (Array.isArray(first) && first.raw) return Promise.resolve(route(first.join("?"), values));
    return { list: first };
  };
  tx.json = (v) => v;
  tx.unsafe = (s) => ({ unsafe: s });
  db.run = async (ws, fn) => fn(tx);
  return db;
}

function fakeStates() {
  const rows = [];
  return {
    rows,
    async create(workspaceId, memberId, provider, purpose, detail) {
      const s = crypto.randomBytes(12).toString("base64url");
      rows.push({ s, workspaceId, memberId, provider, purpose, detail, used: false, expires: Date.now() + 15 * 60_000 });
      return s;
    },
    async consume(state, provider) {
      const r = rows.find((x) => x.s === state && x.provider === provider && !x.used && x.expires > Date.now());
      if (!r) return null;
      r.used = true;
      return { workspaceId: r.workspaceId, memberId: r.memberId, provider, purpose: r.purpose, detail: r.detail };
    },
  };
}

const WS = "11111111-1111-4111-8111-111111111111";
const SHOP = "22222222-2222-4222-8222-222222222222";
const session = { memberId: "33333333-3333-4333-8333-333333333333", workspaceId: WS, workspaceName: "Test", role: "owner", name: "Owner" };
const shop = {
  id: SHOP,
  workspaceId: WS,
  slug: "abc123xyz",
  niche: "kitchen tools",
  storeId: null,
  blueprint: {
    brand: { name: "Salt & Sage", alternativeNames: [], tagline: "Kitchen things that earn their place on the counter.", voice: "warm", audience: "home cooks", monogramIcon: "cooking-pot" },
    footerBlurb: "Small-batch kitchen tools, chosen one at a time and shipped from people who cook.",
    hero: { headline: "h", subhead: "Tools that last longer than the recipe.", cta: "Shop" },
    valueProps: [{ title: "Built to last", body: "" }, { title: "Free returns", body: "" }, { title: "Ships in 2 days", body: "" }],
    theme: { palette: { background: "#f6f2ea", surface: "#fbf8f2", ink: "#1f1b16", muted: "#5d554a", accent: "#2f5d50", accentInk: "#f7f4ee" }, fonts: { display: "Fraunces", body: "Inter" }, contrastFixes: [] },
  },
};
globalThis.__shops = [shop];

// =====================================================================================
// 1. Sign-in addresses
// =====================================================================================
{
  const u = new URL(meta.metaLoginUrl({ appId: "1234", configId: "cfg-9", redirectUri: "https://armada.test/api/connect/facebook_page/callback", state: "s1" }));
  check(
    "Meta sign-in opens facebook.com's dialog for the current Graph version",
    u.host === "www.facebook.com" && u.pathname === `/${meta.GRAPH_VERSION}/dialog/oauth` && /^v\d+\.0$/.test(meta.GRAPH_VERSION),
    u.toString(),
  );
  check(
    "Meta sign-in sends app id, callback, state, the Login for Business setup id and asks for a code (no scope list)",
    u.searchParams.get("client_id") === "1234" &&
      u.searchParams.get("redirect_uri") === "https://armada.test/api/connect/facebook_page/callback" &&
      u.searchParams.get("state") === "s1" &&
      u.searchParams.get("config_id") === "cfg-9" &&
      u.searchParams.get("response_type") === "code" &&
      !u.searchParams.has("scope"),
    u.search,
  );
  const t = new URL(tiktok.tiktokLoginUrl({ clientKey: "ck", redirectUri: "https://armada.test/api/connect/tiktok/callback", state: "s2" }));
  check(
    "TikTok sign-in opens TikTok's v2 authorize page with client key, scopes, code, callback and state",
    t.host === "www.tiktok.com" &&
      t.pathname === "/v2/auth/authorize/" &&
      t.searchParams.get("client_key") === "ck" &&
      t.searchParams.get("scope") === "user.info.basic,user.info.profile,video.upload" &&
      t.searchParams.get("response_type") === "code" &&
      t.searchParams.get("redirect_uri") === "https://armada.test/api/connect/tiktok/callback" &&
      t.searchParams.get("state") === "s2",
    t.toString(),
  );
  check(
    "Callback addresses are the three connect routes on the public origin",
    config.callbackUrl("facebook_page") === "https://armada.test/api/connect/facebook_page/callback" &&
      config.callbackUrl("instagram") === "https://armada.test/api/connect/instagram/callback" &&
      config.callbackUrl("tiktok") === "https://armada.test/api/connect/tiktok/callback",
  );
  const labels = Object.values(config.STATE_PROVIDER);
  check("Each connect route has its own one-time state label", new Set(labels).size === 3 && labels.every((l) => l.startsWith("social_")), labels.join(","));
  check(
    "Kit pictures and the TikTok picture prefix are public addresses under /api/social-kit/",
    config.kitImageUrl("abc123xyz", "avatar") === "https://armada.test/api/social-kit/abc123xyz/avatar.png" &&
      config.tiktokPicturePrefix() === "https://armada.test/api/social-kit/" &&
      relayMod.relayPath("k", "https://x.test/a.png").startsWith("/api/social-kit/r/"),
  );
}

// =====================================================================================
// 2. One-time state through the real connect flows (fake Meta, fake TikTok, fake database)
// =====================================================================================
const origFetch = globalThis.fetch;
{
  globalThis.__db = fakeDb();
  globalThis.__state = fakeStates();
  const db = globalThis.__db;

  const pageWithIg = { id: "p1", name: "Salt & Sage", username: "saltandsage", link: "https://www.facebook.com/saltandsage", access_token: "PAGE-TOKEN-1", tasks: ["CREATE_CONTENT", "MANAGE"], instagram_business_account: { id: "ig1", username: "saltandsage", name: "Salt & Sage" } };
  const f = fakeFetch([
    on("GET", (c) => c.path.endsWith("/oauth/access_token") && c.query.code === "CODE-1", { json: { access_token: "SHORT-USER", expires_in: 3600 } }),
    on("GET", (c) => c.path.endsWith("/oauth/access_token") && c.query.grant_type === "fb_exchange_token", { json: { access_token: "LONG-USER", expires_in: 5184000 } }),
    on("GET", "/me/accounts", { json: { data: [pageWithIg] } }),
    on("GET", (c) => c.path.endsWith("/p1") && /about/.test(c.query.fields ?? ""), { json: { about: "", website: "", picture: { data: { is_silhouette: true } } } }),
    on("POST", (c) => c.path.endsWith("/p1") && c.body?.about !== undefined, { json: { success: true } }),
    on("POST", "/p1/picture", { json: { success: true } }),
    on("POST", "/p1/photos", { json: { id: "cover-photo-1" } }),
    on("POST", (c) => c.path.endsWith("/p1") && c.body?.cover, { json: { success: true } }),
  ]);
  globalThis.fetch = f;

  const start = await connect.metaStart(session, "facebook_page", SHOP);
  const su = new URL(start);
  const st = globalThis.__state.rows.at(-1);
  check(
    "Facebook press makes a one-time state for this workspace, person and shop, then opens Meta's sign-in",
    su.host === "www.facebook.com" && su.searchParams.get("state") === st?.s && st.provider === "social_facebook_page" && st.workspaceId === WS && st.memberId === session.memberId && st.detail.shopId === SHOP,
    start,
  );

  const back = await connect.metaFinish("facebook_page", new URL(`https://armada.test/api/connect/facebook_page/callback?code=CODE-1&state=${st.s}`), session);
  const fbRow = db.accounts.find((a) => a.platform === "facebook" && a.kind === "real");
  const igRow = db.accounts.find((a) => a.platform === "instagram" && a.kind === "real");
  check("Coming back from Meta connects the Page and its linked Instagram account", back === `/social/connect?shop=${SHOP}&done=facebook` && Boolean(fbRow) && Boolean(igRow), back);
  const sealed = fbRow?.values.find((v) => Buffer.isBuffer(v));
  check(
    "The Page's access is stored sealed, never as readable text",
    Boolean(sealed) && !sealed.toString("utf8").includes("PAGE-TOKEN-1") && cryptoMod.open(sealed).pageToken === "PAGE-TOKEN-1" && cryptoMod.open(sealed).userToken === "LONG-USER",
  );
  const exchange = f.calls.find((c) => c.query.code === "CODE-1");
  check(
    "The code is traded with the same callback address and the app secret",
    exchange?.query.redirect_uri === "https://armada.test/api/connect/facebook_page/callback" && exchange?.query.client_secret === "meta-app-secret-for-tests" && exchange?.query.client_id === "1234567890",
  );
  const accountsCall = f.calls.find((c) => c.path.endsWith("/me/accounts"));
  check(
    "Page calls carry appsecret_proof made from the access and the app secret",
    accountsCall?.query.appsecret_proof === crypto.createHmac("sha256", "meta-app-secret-for-tests").update("LONG-USER").digest("hex"),
  );
  const aboutCall = f.calls.find((c) => c.method === "POST" && c.path.endsWith("/p1") && c.body?.about !== undefined);
  check(
    "The empty Page gets the kit's description (100 characters at most) and the shop's link",
    Boolean(aboutCall) && aboutCall.body.about.length <= 100 && aboutCall.body.website === "https://armada.test/s/abc123xyz",
    JSON.stringify(aboutCall?.body),
  );
  const pic = f.calls.find((c) => c.path.endsWith("/p1/picture"));
  const coverUpload = f.calls.find((c) => c.path.endsWith("/p1/photos"));
  const coverSet = f.calls.find((c) => c.method === "POST" && c.path.endsWith("/p1") && c.body?.cover);
  check(
    "The Page gets the kit's profile picture and cover (uploaded unpublished, then set as the cover)",
    pic?.body.picture === "https://armada.test/api/social-kit/abc123xyz/avatar.png" &&
      coverUpload?.body.url === "https://armada.test/api/social-kit/abc123xyz/cover.png" &&
      coverUpload?.body.published === "false" &&
      coverSet?.body.cover === "cover-photo-1",
  );

  const replay = await connect.metaFinish("facebook_page", new URL(`https://armada.test/api/connect/facebook_page/callback?code=CODE-1&state=${st.s}`), session);
  check("A state works once: replaying the callback is refused", replay === "/social/connect?problem=expired", replay);

  const st2Url = new URL(await connect.metaStart(session, "facebook_page", SHOP));
  const wrong = await connect.metaFinish("instagram", new URL(`https://armada.test/api/connect/instagram/callback?code=X&state=${st2Url.searchParams.get("state")}`), session);
  check("A Facebook state can't be used on the Instagram callback", wrong === "/social/connect?problem=expired", wrong);

  const forged = await connect.metaFinish("facebook_page", new URL("https://armada.test/api/connect/facebook_page/callback?code=X&state=made-up"), session);
  check("A made-up state is refused", forged === "/social/connect?problem=expired", forged);

  const st3 = new URL(await connect.metaStart(session, "facebook_page", SHOP)).searchParams.get("state");
  const cancelled = await connect.metaFinish("facebook_page", new URL(`https://armada.test/api/connect/facebook_page/callback?error=access_denied&error_reason=user_denied&state=${st3}`), session);
  check("Closing Meta's window comes back as cancelled, with nothing saved", cancelled === `/social/connect?shop=${SHOP}&problem=cancelled&p=facebook`, cancelled);

  const viewer = await connect.metaStart({ ...session, role: "viewer" }, "facebook_page", SHOP);
  check("Only the owner or a manager can start a connection", viewer === `/social/connect?shop=${SHOP}&problem=role`, viewer);

  // Several Pages: the person picks one in Armada; the Pages' access waits sealed.
  const f2 = fakeFetch([
    on("GET", (c) => c.path.endsWith("/oauth/access_token") && c.query.code, { json: { access_token: "SHORT-2" } }),
    on("GET", (c) => c.path.endsWith("/oauth/access_token"), { json: { access_token: "LONG-2" } }),
    on("GET", "/me/accounts", {
      json: {
        data: [
          { id: "pa", name: "Another shop", access_token: "TA", tasks: ["CREATE_CONTENT"] },
          { id: "pb", name: "Old page", access_token: "TB", tasks: ["CREATE_CONTENT"], instagram_business_account: { id: "igb", username: "oldpage" } },
        ],
      },
    }),
  ]);
  globalThis.fetch = f2;
  const st4 = new URL(await connect.metaStart(session, "facebook_page", SHOP)).searchParams.get("state");
  const choose = await connect.metaFinish("facebook_page", new URL(`https://armada.test/api/connect/facebook_page/callback?code=C2&state=${st4}`), session);
  const choiceRow = db.choices.at(-1);
  const choiceSecret = choiceRow?.values.find((v) => Buffer.isBuffer(v));
  check(
    "With several Pages and no name match, Armada asks which Page, keeping their access sealed",
    choose === `/social/connect?shop=${SHOP}&choose=facebook` && Boolean(choiceSecret) && !choiceSecret.toString("utf8").includes("TA") && cryptoMod.open(choiceSecret).pages.length === 2,
    choose,
  );

  // Instagram press with no Page that has Instagram linked.
  const f3 = fakeFetch([
    on("GET", (c) => c.path.endsWith("/oauth/access_token") && c.query.code, { json: { access_token: "S3" } }),
    on("GET", (c) => c.path.endsWith("/oauth/access_token"), { json: { access_token: "L3" } }),
    on("GET", "/me/accounts", { json: { data: [{ id: "pa", name: "Salt & Sage", access_token: "TA", tasks: ["CREATE_CONTENT"] }] } }),
  ]);
  globalThis.fetch = f3;
  const st5 = new URL(await connect.metaStart(session, "instagram", SHOP)).searchParams.get("state");
  const notLinked = await connect.metaFinish("instagram", new URL(`https://armada.test/api/connect/instagram/callback?code=C3&state=${st5}`), session);
  check("Instagram press with a Page but no linked Instagram account says exactly that", notLinked === `/social/connect?shop=${SHOP}&problem=notlinked&p=instagram`, notLinked);

  // TikTok.
  const f4 = fakeFetch([
    on("POST", "/v2/oauth/token/", { json: { access_token: "TT-ACCESS", refresh_token: "TT-REFRESH", open_id: "open-1", scope: "user.info.basic,user.info.profile,video.upload", expires_in: 86400, refresh_expires_in: 31536000 } }),
    on("GET", "/v2/user/info/", { json: { data: { user: { open_id: "open-1", display_name: "Salt & Sage", username: "saltandsage" } }, error: { code: "ok" } } }),
  ]);
  globalThis.fetch = f4;
  const tStart = new URL(await connect.tiktokStart(session, SHOP));
  const tState = globalThis.__state.rows.at(-1);
  check("TikTok press makes its own one-time state and opens TikTok's sign-in", tStart.host === "www.tiktok.com" && tStart.searchParams.get("state") === tState.s && tState.provider === "social_tiktok");
  const tBack = await connect.tiktokFinish(new URL(`https://armada.test/api/connect/tiktok/callback?code=TC&scopes=user.info.basic&state=${tState.s}`), session);
  const tRow = db.accounts.find((a) => a.platform === "tiktok" && a.kind === "real");
  const tokenCall = f4.calls.find((c) => c.path === "/v2/oauth/token/");
  const tSealed = tRow?.values.find((v) => Buffer.isBuffer(v));
  check(
    "Coming back from TikTok trades the code (form: key, secret, code, grant, callback) and saves the account sealed",
    tBack === `/social/connect?shop=${SHOP}&done=tiktok` &&
      tokenCall?.body.client_key === "tt-client-key" &&
      tokenCall?.body.client_secret === "tt-client-secret" &&
      tokenCall?.body.grant_type === "authorization_code" &&
      tokenCall?.body.redirect_uri === "https://armada.test/api/connect/tiktok/callback" &&
      cryptoMod.open(tSealed).refreshToken === "TT-REFRESH" &&
      !tSealed.toString("utf8").includes("TT-ACCESS"),
    tBack,
  );
  const tReplay = await connect.tiktokFinish(new URL(`https://armada.test/api/connect/tiktok/callback?code=TC&state=${tState.s}`), session);
  check("A TikTok state works once", tReplay === "/social/connect?problem=expired", tReplay);

  // The browser that comes back must be signed in as the person who pressed the button.
  const before = db.accounts.length;
  const other = { ...session, memberId: "55555555-5555-4555-8555-555555555555" };
  const s6 = new URL(await connect.metaStart(session, "facebook_page", SHOP)).searchParams.get("state");
  const s6Back = await connect.metaFinish("facebook_page", new URL(`https://armada.test/api/connect/facebook_page/callback?code=CODE-1&state=${s6}`), other);
  const s7 = new URL(await connect.metaStart(session, "instagram", SHOP)).searchParams.get("state");
  const s7Back = await connect.metaFinish("instagram", new URL(`https://armada.test/api/connect/instagram/callback?code=CODE-1&state=${s7}`), null);
  const s8 = new URL(await connect.tiktokStart(session, SHOP)).searchParams.get("state");
  const s8Back = await connect.tiktokFinish(new URL(`https://armada.test/api/connect/tiktok/callback?code=TC&state=${s8}`), { ...session, workspaceId: "66666666-6666-4666-8666-666666666666" });
  check(
    "A callback in a browser signed in as someone else, or not signed in, connects nothing",
    [s6Back, s7Back, s8Back].every((b) => b === "/social/connect?problem=browser") && db.accounts.length === before,
    [s6Back, s7Back, s8Back].join(" | "),
  );

  // TikTok approved without the permission to send posts: saved as needing the person, and said so.
  const f5 = fakeFetch([
    on("POST", "/v2/oauth/token/", { json: { access_token: "TT-A2", refresh_token: "TT-R2", open_id: "open-1", scope: "user.info.basic", expires_in: 86400, refresh_expires_in: 31536000 } }),
    on("GET", "/v2/user/info/", { json: { data: { user: { open_id: "open-1", display_name: "Salt & Sage" } }, error: { code: "ok" } } }),
  ]);
  globalThis.fetch = f5;
  const s9 = new URL(await connect.tiktokStart(session, SHOP)).searchParams.get("state");
  const s9Back = new URL(await connect.tiktokFinish(new URL(`https://armada.test/api/connect/tiktok/callback?code=TC2&state=${s9}`), session), "https://armada.test");
  const t2 = db.accounts.find((a) => a.platform === "tiktok" && a.kind === "real");
  check(
    "TikTok approved without posting permission is saved as needing the person, with a signed explanation",
    s9Back.searchParams.get("problem") === "platform" &&
      t2?.values.includes("needs_attention") &&
      config.readNote(s9Back.searchParams.get("why"), s9Back.searchParams.get("ws"))?.includes("leave every box ticked"),
    s9Back.toString(),
  );

  // A platform's refusal shown on the page must be words Armada wrote.
  const note = config.signedNote("Facebook didn't accept it: the Page is restricted.");
  check(
    "Explanations in the address are signed; edited or made-up ones are not shown",
    config.readNote(note.why, note.ws) === note.why &&
      config.readNote("Call 555-0100 to fix your account", note.ws) === null &&
      config.readNote(note.why + "!", note.ws) === null &&
      config.readNote(note.why, undefined) === null,
  );
}

// =====================================================================================
// 3. Bio lengths per platform
// =====================================================================================
{
  const { LIMITS, buildKit, bioFor, fit, usernameIdeas, kitBrand } = kitMod;
  const long = "x".repeat(40) + " " + "Kitchen things that earn their place on the counter, chosen one at a time by people who actually cook every single day of the week";
  const brands = [
    kitBrand(shop.blueprint, "kitchen"),
    { name: "A", tagline: long, footerBlurb: long, subhead: long, points: ["Built to last", "Free returns", "Ships fast"] },
    { name: "Émile & Søn", tagline: "Lamps 💡 that make evenings feel slower and kinder, in every room of the house 🌙", footerBlurb: "", subhead: "", points: [] },
    { name: "", tagline: "", footerBlurb: "", subhead: "", points: [] },
  ];
  let allFit = true;
  let detail = "";
  for (const b of brands) {
    const k = buildKit(b, "https://armada.test/s/abc");
    const lens = { instagram: k.instagram.bio.length, tiktok: k.tiktok.bio.length, facebook: k.facebook.about.length };
    if (lens.instagram > LIMITS.instagram.bio || lens.tiktok > LIMITS.tiktok.bio || lens.facebook > LIMITS.facebook.about) {
      allFit = false;
      detail = JSON.stringify(lens);
    }
  }
  check(`Every bio fits: Instagram ${LIMITS.instagram.bio}, TikTok ${LIMITS.tiktok.bio}, Facebook description ${LIMITS.facebook.about}`, allFit, detail);
  check("Limits match the platforms' published numbers", LIMITS.instagram.bio === 150 && LIMITS.tiktok.bio === 80 && LIMITS.facebook.about === 100);
  const ig = bioFor("instagram", brands[0]);
  check("Instagram bio is the tagline plus the shop's points on a second line when they fit", ig.startsWith("Kitchen things that earn their place on the counter.\n") && ig.includes("Built to last") && ig.length <= 150, JSON.stringify(ig));
  check("TikTok bio uses the tagline whole when it fits", bioFor("tiktok", brands[0]) === "Kitchen things that earn their place on the counter.");
  check("Facebook description uses the footer line when it fits in 100", bioFor("facebook", brands[0]) === brands[0].footerBlurb);
  const cut = fit(long, 80);
  check("Cutting stops at a word, never mid-word or on a comma", cut.length <= 80 && !/[,\s]$/.test(cut) && long.startsWith(cut) && long[cut.length] === " ", JSON.stringify(cut));
  check("Emoji count double, so a fit here always fits there", fit("🌙".repeat(60), 80).length <= 80);
  const names = [...usernameIdeas("Salt & Sage", "instagram"), ...usernameIdeas("Émile & Søn Lighting Company of Portland", "tiktok")];
  check(
    "Username ideas use only letters, numbers, dots and underscores, within length, never ending in a dot",
    names.length >= 2 && names.every((n) => /^[a-z0-9._]+$/.test(n) && !/[.]$/.test(n)) && usernameIdeas("Émile & Søn Lighting Company of Portland", "tiktok").every((n) => n.length <= 24),
    names.join(","),
  );
}

// =====================================================================================
// 4. The practice publish path
// =====================================================================================
{
  const f = fakeFetch([]);
  const recorded = [];
  const r = await publishMod.publishTo(
    { platform: "instagram", kind: "practice", status: "practice", externalId: null, access: null },
    { caption: "Hello", slides: [{ imageUrl: "https://armada.test/s1.jpg", alt: "one" }, { imageUrl: "https://armada.test/s2.jpg", alt: "two" }] },
    { fetch: f, sleep: async () => {}, recordPractice: async (p) => (recorded.push(p), "pp1"), pictureUrl: (u) => u },
  );
  check("A practice account records the post and says it went out, instantly", r.ok && r.externalId === "practice:pp1" && recorded.length === 1 && recorded[0].slides.length === 2, JSON.stringify(r));
  check("A practice post never calls a platform", f.calls.length === 0);

  // Through the real publishCarousel, with the account loaded from the (fake) database.
  globalThis.__db = fakeDb();
  globalThis.__db.loadRow = { id: "acc-p", workspaceId: WS, shopId: SHOP, platform: "tiktok", kind: "practice", name: "Salt & Sage", handle: "saltandsage", status: "practice", secret: null, meta: {} };
  globalThis.fetch = fakeFetch([]);
  const r2 = await index.publishCarousel(WS, "44444444-4444-4444-8444-444444444444", { caption: "Relative slides", slides: [{ imageUrl: "/api/social/slide/1.jpg", alt: "a" }] });
  const saved = globalThis.__db.practice[0];
  check(
    "publishCarousel on a practice account stores the post (slides made absolute) and returns ok",
    r2.ok && r2.externalId?.startsWith("practice:") && saved && JSON.stringify(saved.values).includes("https://armada.test/api/social/slide/1.jpg") && globalThis.fetch.calls.length === 0,
    JSON.stringify(r2),
  );
  const q0 = globalThis.__db.queries.length;
  await store.removeAccount(WS, session.memberId, "44444444-4444-4444-8444-444444444444", false);
  const removal = globalThis.__db.queries.slice(q0).find((q) => /delete from armada\.social_accounts/.test(q.text));
  check("Someone who may only use practice accounts can't disconnect a real one", Boolean(removal) && /kind = 'practice'/.test(removal.text), removal?.text);
  const accs = await index.socialAccountsFor(WS, "not-a-uuid");
  check("socialAccountsFor ignores a malformed shop id", Array.isArray(accs) && accs.length === 0);
  check("After a practice post, the posts screen is told it stayed in Armada", index.afterPublishNote("instagram", "practice")?.includes("practice"));
}

// =====================================================================================
// 5. Carousel call sequences against a fake fetch
// =====================================================================================
const slides3 = [1, 2, 3].map((i) => ({ imageUrl: `https://armada.test/slide${i}.png`, alt: `Slide ${i}` }));
const relayed = (u) => `https://armada.test/api/social-kit/r/sig/${Buffer.from(u).toString("base64url")}.jpg`;
{
  let polls = 0;
  const f = fakeFetch([
    on("GET", "/ig1/content_publishing_limit", { json: { data: [{ quota_usage: 3, config: { quota_total: 100 } }] } }),
    on("POST", (c) => c.path.endsWith("/ig1/media") && c.body.is_carousel_item === "true", (c) => ({ json: { id: `item-${c.body.alt_text.slice(-1)}` } })),
    on("GET", (c) => /\/item-\d$/.test(c.path), () => ({ json: { status_code: polls++ === 0 ? "IN_PROGRESS" : "FINISHED" } })),
    on("POST", (c) => c.path.endsWith("/ig1/media") && c.body.media_type === "CAROUSEL", { json: { id: "carousel-1" } }),
    on("GET", "/carousel-1", { json: { status_code: "FINISHED" } }),
    on("POST", "/ig1/media_publish", { json: { id: "media-9" } }),
    on("GET", "/media-9", { json: { permalink: "https://www.instagram.com/p/abc/" } }),
  ]);
  const sleeps = [];
  const r = await publishMod.publishTo(
    { platform: "instagram", kind: "real", status: "connected", externalId: "ig1", access: { pageToken: "PT" } },
    { caption: "Three things", slides: slides3 },
    { fetch: f, sleep: async (ms) => void sleeps.push(ms), appSecret: "sec", recordPractice: async () => "x", pictureUrl: relayed },
  );
  const seq = f.calls.map((c) => `${c.method} ${c.path.replace(/^\/v\d+\.0/, "")}${c.body?.is_carousel_item ? " item" : ""}${c.body?.media_type ? ` ${c.body.media_type}` : ""}`);
  const expected = [
    "GET /ig1/content_publishing_limit",
    "POST /ig1/media item",
    "POST /ig1/media item",
    "POST /ig1/media item",
    "GET /item-1",
    "GET /item-1",
    "GET /item-2",
    "GET /item-3",
    "POST /ig1/media CAROUSEL",
    "GET /carousel-1",
    "POST /ig1/media_publish",
    "GET /media-9",
  ];
  check("Instagram carousel: item containers, their status, the carousel container, its status, publish, link", JSON.stringify(seq) === JSON.stringify(expected), seq.join(" | "));
  const items = f.calls.filter((c) => c.body?.is_carousel_item);
  const car = f.calls.find((c) => c.body?.media_type === "CAROUSEL");
  check(
    "Instagram gets each picture through Armada's JPEG address, with alt text; the caption goes on the carousel only",
    items.every((c, i) => c.body.image_url === relayed(slides3[i].imageUrl) && c.body.alt_text === `Slide ${i + 1}` && !c.body.caption) &&
      car.body.children === "item-1,item-2,item-3" &&
      car.body.caption === "Three things",
  );
  check("Instagram publish uses the carousel container and returns the post's link", r.ok && r.externalId === "media-9" && r.url === "https://www.instagram.com/p/abc/" && f.calls.find((c) => c.path.endsWith("/media_publish"))?.body.creation_id === "carousel-1", JSON.stringify(r));
  check("Waiting on Instagram sleeps between status checks instead of hammering", sleeps.length === 1 && sleeps[0] >= 1000, sleeps.join(","));
  check("Every Instagram call carries the Page access and appsecret_proof", f.calls.every((c) => (c.query.access_token ?? c.body?.access_token) === "PT" && (c.query.appsecret_proof ?? c.body?.appsecret_proof) === crypto.createHmac("sha256", "sec").update("PT").digest("hex")));
  check("All Meta calls go to graph.facebook.com", f.calls.every((c) => c.host === "graph.facebook.com"));
}
{
  const f = fakeFetch([
    on("GET", "/content_publishing_limit", { json: { data: [] } }),
    on("POST", "/ig1/media", { json: { id: "single-1" } }),
    on("GET", "/single-1", { json: { status_code: "FINISHED" } }),
    on("POST", "/media_publish", { json: { id: "m1" } }),
    on("GET", "/m1", { json: {} }),
  ]);
  const r = await meta.publishInstagramCarousel({ fetch: f }, { igId: "ig1", token: "PT", caption: "One", slides: [slides3[0]] }, { sleep: async () => {} });
  const create = f.calls.find((c) => c.path.endsWith("/ig1/media"));
  check("One picture goes to Instagram as a single-image post with its caption", r.ok && create.body.caption === "One" && !create.body.is_carousel_item && !create.body.media_type, JSON.stringify(create?.body));
}
{
  const f = fakeFetch([
    on("GET", "/content_publishing_limit", { json: { data: [] } }),
    on("POST", "/ig1/media", (c) => ({ json: { id: c.body.media_type ? "car" : `it-${c.body.image_url.slice(-5, -4)}` } })),
    on("GET", () => true, { json: { status_code: "FINISHED" } }),
    on("POST", "/media_publish", { json: { id: "m2" } }),
  ]);
  const longAlt = "A long description of the picture. ".repeat(40) + "🌙";
  await meta.publishInstagramCarousel({ fetch: f }, { igId: "ig1", token: "PT", caption: "x", slides: [{ imageUrl: "https://a.test/1.jpg", alt: longAlt }, { imageUrl: "https://a.test/2.jpg", alt: "" }] }, { sleep: async () => {} });
  const items = f.calls.filter((c) => c.body?.is_carousel_item);
  check(
    "Instagram alt text is kept within its 1000 characters, and an empty one is left out",
    items.length === 2 && items[0].body.alt_text.length <= 1000 && longAlt.startsWith(items[0].body.alt_text) && items[1].body.alt_text === undefined,
    String(items[0]?.body.alt_text?.length),
  );
  check("Cutting text never splits an emoji", meta.clip("ab🌙", 3) === "ab" && meta.clip("ab🌙", 4) === "ab🌙");
}
{
  const f = fakeFetch([]);
  const many = Array.from({ length: 11 }, (_, i) => ({ imageUrl: `https://x.test/${i}.jpg`, alt: "" }));
  const r = await meta.publishInstagramCarousel({ fetch: f }, { igId: "ig1", token: "PT", caption: "", slides: many }, { sleep: async () => {} });
  check("More than 10 pictures is refused before calling Instagram", !r.ok && /up to 10/.test(r.problem) && f.calls.length === 0, r.problem);
}
{
  const f = fakeFetch([
    on("GET", "/content_publishing_limit", { json: { data: [] } }),
    on("POST", "/ig1/media", { json: { id: "bad-1" } }),
    on("GET", "/bad-1", { json: { status_code: "ERROR", status: "Error: image format" } }),
  ]);
  const r = await meta.publishInstagramCarousel({ fetch: f }, { igId: "ig1", token: "PT", caption: "x", slides: [slides3[0]] }, { sleep: async () => {} });
  check("A picture Instagram can't use comes back as a plain sentence", !r.ok && /JPEG/.test(r.problem) && !r.reconnect, r.problem);
}
{
  const f = fakeFetch([on("GET", "/content_publishing_limit", { status: 400, json: { error: { message: "Error validating access token", code: 190, type: "OAuthException" } } })]);
  const r = await meta.publishInstagramCarousel({ fetch: f }, { igId: "ig1", token: "PT", caption: "x", slides: slides3 }, { sleep: async () => {} });
  check("Expired access (Meta code 190) asks for connecting again", !r.ok && r.reconnect === true && /Connect again/.test(r.problem), JSON.stringify(r));
}
{
  const f = fakeFetch([on("GET", "/content_publishing_limit", { json: { data: [{ quota_usage: 100, config: { quota_total: 100 } }] } })]);
  const r = await meta.publishInstagramCarousel({ fetch: f }, { igId: "ig1", token: "PT", caption: "x", slides: slides3 }, { sleep: async () => {} });
  check("Instagram's 100-a-day limit is said plainly before posting", !r.ok && /100 posts a day/.test(r.problem) && f.calls.length === 1, r.problem);
}
{
  let n = 0;
  const f = fakeFetch([
    on("POST", "/pg1/photos", () => ({ json: { id: `photo-${++n}` } })),
    on("POST", "/pg1/feed", { json: { id: "pg1_777" } }),
    on("GET", "/pg1_777", { json: { permalink_url: "https://www.facebook.com/pg1/posts/777" } }),
  ]);
  const r = await publishMod.publishTo(
    { platform: "facebook", kind: "real", status: "connected", externalId: "pg1", access: { pageToken: "PT" } },
    { caption: "Two", slides: slides3.slice(0, 2) },
    { fetch: f, sleep: async () => {}, recordPractice: async () => "x", pictureUrl: relayed },
  );
  const seq = f.calls.map((c) => `${c.method} ${c.path.replace(/^\/v\d+\.0/, "")}`);
  const feed = f.calls.find((c) => c.path.endsWith("/feed"));
  const photos = f.calls.filter((c) => c.path.endsWith("/photos"));
  check("Facebook: each picture uploaded unpublished, then one post attaching them", JSON.stringify(seq) === JSON.stringify(["POST /pg1/photos", "POST /pg1/photos", "POST /pg1/feed", "GET /pg1_777"]), seq.join(" | "));
  check(
    "Facebook pictures keep their own addresses and alt text; the post attaches both by id",
    photos.every((c, i) => c.body.url === slides3[i].imageUrl && c.body.published === "false" && c.body.alt_text_custom === `Slide ${i + 1}`) &&
      JSON.parse(feed.body["attached_media[0]"]).media_fbid === "photo-1" &&
      JSON.parse(feed.body["attached_media[1]"]).media_fbid === "photo-2" &&
      feed.body.message === "Two",
  );
  check("Facebook returns the post's link", r.ok && r.url === "https://www.facebook.com/pg1/posts/777", JSON.stringify(r));
}
{
  let polls = 0;
  const f = fakeFetch([
    on("POST", "/v2/post/publish/content/init/", { json: { data: { publish_id: "pub-1" }, error: { code: "ok" } } }),
    on("POST", "/v2/post/publish/status/fetch/", () => ({ json: { data: { status: polls++ ? "SEND_TO_USER_INBOX" : "PROCESSING_DOWNLOAD" }, error: { code: "ok" } } })),
  ]);
  const sleeps = [];
  const r = await publishMod.publishTo(
    { platform: "tiktok", kind: "real", status: "connected", externalId: "open-1", access: { accessToken: "TTA" } },
    { caption: "First line\nMore words", slides: slides3 },
    { fetch: f, sleep: async (ms) => void sleeps.push(ms), recordPractice: async () => "x", pictureUrl: relayed },
  );
  const init = f.calls[0];
  check(
    "TikTok: photo post sent to the inbox, pulled from Armada's JPEG addresses, then its status checked",
    init.path === "/v2/post/publish/content/init/" &&
      init.body.post_mode === "MEDIA_UPLOAD" &&
      init.body.media_type === "PHOTO" &&
      init.body.source_info.source === "PULL_FROM_URL" &&
      init.body.source_info.photo_cover_index === 0 &&
      JSON.stringify(init.body.source_info.photo_images) === JSON.stringify(slides3.map((s) => relayed(s.imageUrl))) &&
      init.body.post_info.title === "First line" &&
      init.body.post_info.description === "First line\nMore words" &&
      init.headers.Authorization === "Bearer TTA" &&
      f.calls.filter((c) => c.path.endsWith("/status/fetch/")).length === 2 &&
      f.calls.every((c) => c.host === "open.tiktokapis.com"),
    JSON.stringify(init.body),
  );
  check("TikTok returns ok with its publish id once the post reaches the inbox", r.ok && r.externalId === "pub-1" && sleeps.length === 1, JSON.stringify(r));
  check("TikTok's note tells the person to finish in the app", /TikTok inbox/.test(index.afterPublishNote("tiktok", "connected") ?? ""));
}
{
  const f = fakeFetch([
    on("POST", "/content/init/", { json: { data: { publish_id: "pub-2" }, error: { code: "ok" } } }),
    on("POST", "/status/fetch/", { json: { data: { status: "FAILED", fail_reason: "photo_pull_failed" }, error: { code: "ok" } } }),
  ]);
  const r = await tiktok.publishTikTokPhotos(f, { token: "T", caption: "x", photoUrls: ["https://armada.test/a.jpg"] }, { sleep: async () => {} });
  check("A picture TikTok couldn't download comes back as a plain sentence", !r.ok && /JPEG or WebP/.test(r.problem), r.problem);
  const f2 = fakeFetch([on("POST", "/content/init/", { status: 401, json: { error: { code: "access_token_invalid", message: "bad" } } })]);
  const r2 = await tiktok.publishTikTokPhotos(f2, { token: "T", caption: "x", photoUrls: ["https://armada.test/a.jpg"] }, { sleep: async () => {} });
  check("TikTok refusing the access asks for connecting again", !r2.ok && r2.reconnect === true, JSON.stringify(r2));
  const r3 = await tiktok.publishTikTokPhotos(f2, { token: "T", caption: "x", photoUrls: Array(36).fill("https://a.test/x.jpg") }, { sleep: async () => {} });
  check("More than 35 pictures is refused before calling TikTok", !r3.ok && /35/.test(r3.problem));
}
{
  const f = fakeFetch([on("POST", "/v2/oauth/token/", { json: { access_token: "NEW-A", refresh_token: "NEW-R", open_id: "o", scope: "video.upload", expires_in: 86400, refresh_expires_in: 31536000 } })]);
  const now = Date.UTC(2026, 8, 24);
  const r = await tiktok.refreshTikTokToken(f, { clientKey: "k", clientSecret: "s", refreshToken: "OLD-R", now });
  check(
    "TikTok renewal sends the renewal code and keeps the new one TikTok returns",
    f.calls[0].body.grant_type === "refresh_token" && f.calls[0].body.refresh_token === "OLD-R" && r.refreshToken === "NEW-R" && r.expiresAt.getTime() === now + 86400_000,
  );
  check(
    "TikTok access is renewed when it has under five minutes left",
    tiktok.needsRefresh(new Date(now + 60_000), now) && !tiktok.needsRefresh(new Date(now + 3_600_000), now) && tiktok.needsRefresh(null, now),
  );
}

// =====================================================================================
// 6. Page setup fills only what's empty; relay addresses can't be forged
// =====================================================================================
{
  const f = fakeFetch([
    on("GET", "/pg", { json: { about: "Our own words", website: "", cover: { id: "c9" }, picture: { data: { is_silhouette: false } } } }),
    on("POST", "/pg", { json: { success: true } }),
  ]);
  const r = await meta.setupPage({ fetch: f }, "pg", "PT", { about: "Kit words", website: "https://s.test", pictureUrl: "https://a/p.png", coverUrl: "https://a/c.png", overwrite: false });
  const post = f.calls.find((c) => c.method === "POST");
  check(
    "A Page that already has words, a picture and a cover keeps them; only the empty website is filled",
    JSON.stringify(r.done) === '["website"]' && r.kept.includes("about") && r.kept.includes("picture") && r.kept.includes("cover") && post.body.about === undefined && post.body.website === "https://s.test",
    JSON.stringify(r),
  );
  const f2 = fakeFetch([
    on("GET", "/pg", { json: { about: "Old" } }),
    on("POST", "/pg/picture", { status: 400, json: { error: { message: "(#200) Requires MANAGE task", code: 200 } } }),
    on("POST", "/pg/photos", { json: { id: "ph" } }),
    on("POST", "/pg", { json: { success: true } }),
  ]);
  const r2 = await meta.setupPage({ fetch: f2 }, "pg", "PT", { about: "New", website: "https://s.test", pictureUrl: "https://a/p.png", coverUrl: "https://a/c.png", overwrite: true });
  check("Replacing with the kit writes everything, and one refusal doesn't stop the rest", r2.done.includes("about") && r2.done.includes("cover") && r2.failed.length === 1 && r2.failed[0].part === "picture", JSON.stringify(r2));
}
{
  const secret = crypto.randomBytes(32);
  const p = relayMod.relayPath(secret, "https://armada.test/api/social/slide.png?x=1");
  const [, , , , sig, enc] = p.split("/");
  check("A relay address reads back to the original picture", relayMod.readRelay(secret, sig, enc) === "https://armada.test/api/social/slide.png?x=1", p);
  const tampered = Buffer.from("https://evil.test/x.png").toString("base64url") + ".jpg";
  check("A relay address for a picture Armada didn't sign is refused", relayMod.readRelay(secret, sig, tampered) === null && relayMod.readRelay(crypto.randomBytes(32), sig, enc) === null);
  const img = (type) => fakeFetch([on("GET", () => true, { raw: "IMGBYTES", type })]);
  const passJpeg = await relayMod.relayImage(img("image/jpeg"), "https://a.test/x.jpg", null);
  const refusePng = await relayMod.relayImage(img("image/png"), "https://a.test/x.png", null);
  const convert = await relayMod.relayImage(img("image/png"), "https://a.test/x.png", async () => new Uint8Array([0xff, 0xd8]));
  const notImage = await relayMod.relayImage(img("text/html"), "https://a.test/x", null);
  check(
    "The relay passes JPEGs, converts other pictures when it can, and refuses what the platforms would",
    passJpeg.status === 200 && passJpeg.type === "image/jpeg" && refusePng.status === 415 && convert.status === 200 && convert.type === "image/jpeg" && notImage.status === 415,
  );
}

// =====================================================================================
// 7. Only connectors/ talks to the platforms
// =====================================================================================
{
  const HOSTS = /(graph\.facebook\.com|open\.tiktokapis\.com|api\.instagram\.com|graph\.instagram\.com|tiktok\.com\/v2\/auth|facebook\.com\/v\d+\.\d+\/dialog)/;
  const walk = (dir) =>
    fs.existsSync(dir)
      ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]))
      : [];
  const mine = [
    ...walk(path.join(ROOT, "lib/social/accounts")),
    ...walk(path.join(ROOT, "app/(app)/social/connect")),
    ...walk(path.join(ROOT, "components/social-connect")),
    ...walk(path.join(ROOT, "app/api/connect/facebook_page")),
    ...walk(path.join(ROOT, "app/api/connect/instagram")),
    ...walk(path.join(ROOT, "app/api/connect/tiktok")),
    ...walk(path.join(ROOT, "app/api/social-kit")),
  ].filter((p) => /\.(ts|tsx)$/.test(p));
  const bad = mine.filter((p) => HOSTS.test(fs.readFileSync(p, "utf8")));
  check("Platform addresses appear only under connectors/social-accounts", mine.length > 10 && bad.length === 0, bad.map((p) => path.relative(ROOT, p)).join(", "));

  // Plain words on the social page, the same list the build check uses for main screens.
  const BANNED = /\b(API|APIs|OAuth|webhooks?|GraphQL|JSON|endpoints?|schema|SQL|env var|tokens?|CLI|RLS|row-level|UUID|payload|backend)\b/;
  const screens = [...walk(path.join(ROOT, "app/(app)/social/connect")), ...walk(path.join(ROOT, "components/social-connect"))].filter((p) => p.endsWith(".tsx"));
  const words = [];
  for (const f of screens) {
    const text = fs.readFileSync(f, "utf8");
    // Text between tags (also when an expression follows it), sentences in quotes, and in template strings.
    const visible = [...text.matchAll(/[>}]([^<>{}]+)(?=[<{])/g)].map((x) => x[1])
      .concat([...text.matchAll(/"([^"\n]*\s[^"\n]*)"/g)].map((x) => x[1]))
      .concat([...text.matchAll(/`([^`]*\s[^`]*)`/g)].map((x) => x[1]));
    for (const v of visible) {
      if (/className|text-\[|px-|py-|min-h|grid-cols|rounded|flex|border|bg-|hover:/.test(v)) continue;
      const hit = v.match(BANNED);
      if (hit) words.push(`${path.relative(ROOT, f)}: "${hit[0]}" in "${v.trim().slice(0, 50)}"`);
    }
  }
  check("The social page uses plain words (no OAuth, API, token…)", screens.length >= 5 && words.length === 0, words.slice(0, 4).join("; "));

  // Every brand icon the shop builder can pick has a drawing for the profile picture.
  const art = [...fs.readFileSync(path.join(ROOT, "lib/shops/style.ts"), "utf8").match(/ART_ICONS = \[([\s\S]*?)\] as const/)[1].matchAll(/"([a-z0-9-]+)"/g)].map((m) => m[1]);
  const { MONOGRAM_ICONS } = await load("lib/social/accounts/monogram-icons.ts");
  const missingIcons = art.filter((a) => !MONOGRAM_ICONS[a]);
  check("Every shop icon has a drawing for the profile picture", art.length > 50 && missingIcons.length === 0, missingIcons.join(", "));
}

globalThis.fetch = origFetch;
console.log(failed ? `\n${failed} check${failed === 1 ? "" : "s"} failed.` : "\nAll social account checks passed.");
process.exit(failed ? 1 : 0);
