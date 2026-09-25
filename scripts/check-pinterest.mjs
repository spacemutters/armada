// Offline checks for Pinterest through the connection service. No network, no account: a fake
// fetch stands in for the service's relay and records every request.
//
//   node scripts/check-pinterest.mjs
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

const p = await import("../connectors/social-accounts/pinterest.ts");

/** A fake Pinterest: answers by method and path, and keeps what was sent. */
function fakePinterest(routes) {
  const sent = [];
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    const key = `${init.method ?? "GET"} ${u.pathname}`;
    const body = init.body ? JSON.parse(init.body) : undefined;
    sent.push({ key, url, body });
    const answer = routes[key];
    const [status, json] = typeof answer === "function" ? answer(body, sent) : (answer ?? [404, { code: 404, message: "Not found" }]);
    return new Response(JSON.stringify(json), { status, headers: { "content-type": "application/json" } });
  };
  return { fetch, sent };
}

const slides = [1, 2, 3, 4, 5, 6].map((n) => ({ imageUrl: `https://armada.test/p/${n}.jpg`, alt: `Picture ${n}` }));

// ---- who the account is ----
{
  const f = fakePinterest({ "GET /v5/user_account": [200, { id: "549755885175", username: "lullroom", business_name: "Lull Room", account_type: "BUSINESS" }] });
  const me = await p.pinterestMe(f.fetch);
  report(me.username === "lullroom" && me.name === "Lull Room" && me.business === true, "the account's name, handle and business type");
  report(me.link === "https://www.pinterest.com/lullroom/", "the profile link");
  report(f.sent[0].url.startsWith("https://api.pinterest.com/v5/"), "requests go to Pinterest's v5 API");
  const g = fakePinterest({ "GET /v5/user_account": [200, { username: "sam", account_type: "PINNER" }] });
  const sam = await p.pinterestMe(g.fetch);
  report(sam.id === "sam" && sam.name === "sam" && sam.business === false, "a personal account without an id or business name");
}

// ---- the shop's board ----
{
  const f = fakePinterest({
    "GET /v5/boards": [200, { items: [{ id: "b1", name: "Recipes" }, { id: "b2", name: "Lull-Room" }], bookmark: null }],
  });
  const r = await p.boardForShop(f.fetch, "Lull Room", "Quiet things");
  report(r.board?.id === "b2" && !r.made, "a board already named for the shop is used (spacing and case don't matter)");
  report(!f.sent.some((s) => s.key === "POST /v5/boards"), "no new board when one is named for the shop");
}
{
  const f = fakePinterest({
    "GET /v5/boards": [200, { items: [{ id: "b1", name: "Recipes" }, { id: "b3", name: "Travel" }] }],
    "POST /v5/boards": (body) => [201, { id: "new1", name: body.name }],
  });
  const r = await p.boardForShop(f.fetch, "Lull Room", "Quiet things for slow mornings");
  const made = f.sent.find((s) => s.key === "POST /v5/boards");
  report(r.board?.id === "new1" && r.made, "otherwise Armada makes a board with the shop's name");
  report(made?.body.name === "Lull Room" && made.body.privacy === "PUBLIC" && made.body.description.startsWith("Quiet"), "the new board is public, with the tagline", made?.body);
}
{
  const one = fakePinterest({ "GET /v5/boards": [200, { items: [{ id: "only", name: "Stuff" }] }], "POST /v5/boards": [403, { code: 3, message: "Not permitted" }] });
  const r1 = await p.boardForShop(one.fetch, "Lull Room", "");
  report(r1.board?.id === "only", "when Pinterest won't make boards, the only board is used");
  const two = fakePinterest({ "GET /v5/boards": [200, { items: [{ id: "a", name: "A" }, { id: "b", name: "B" }] }], "POST /v5/boards": [403, { code: 3, message: "Not permitted" }] });
  const r2 = await p.boardForShop(two.fetch, "Lull Room", "");
  report(r2.board === null, "with several boards and no permission, no board is guessed");
  const dead = fakePinterest({ "GET /v5/boards": [200, { items: [] }], "POST /v5/boards": [401, { code: 2, message: "Authentication failed." }] });
  let threw = null;
  try {
    await p.boardForShop(dead.fetch, "Lull Room", "");
  } catch (e) {
    threw = e;
  }
  report(threw instanceof p.PinterestProblem && threw.status === 401, "lost access isn't hidden behind a board guess");
}
{
  let calls = 0;
  const f = fakePinterest({
    "GET /v5/boards": () => (++calls === 1 ? [200, { items: [{ id: "p1", name: "One" }], bookmark: "next" }] : [200, { items: [{ id: "p2", name: "Two" }] }]),
  });
  const boards = await p.pinterestBoards(f.fetch);
  report(boards.length === 2 && f.sent[1].url.includes("bookmark=next"), "boards are read page by page");
}

// ---- the pin ----
{
  const body = p.pinBody({ boardId: "b2", caption: "Slow mornings, soft light #cozy #home\nMore words here.", link: "https://lull.test", slides, carousel: true, fallbackTitle: "Lull Room" });
  report(body.board_id === "b2" && body.title === "Slow mornings, soft light", "the title is the caption's first line without hashtags", body.title);
  report(body.media_source.source_type === "multiple_image_urls" && body.media_source.items.length === 5, "a carousel has at most Pinterest's five pictures");
  report(body.media_source.items.every((i) => i.link === "https://lull.test" && i.url.startsWith("https://")), "every carousel picture links to the shop");
  report(body.link === "https://lull.test" && body.alt_text === "Picture 1", "the pin links to the shop and describes its first picture");
  const single = p.pinBody({ boardId: "b2", caption: "Hi", link: null, slides: slides.slice(0, 1), carousel: true, fallbackTitle: "Lull Room" });
  report(single.media_source.source_type === "image_url" && single.media_source.url === slides[0].imageUrl && !("link" in single), "one picture makes a single-picture pin; no link means none is sent");
  const long = p.pinBody({ boardId: "b", caption: "x".repeat(2000), link: "http://not-secure.test", slides, carousel: false, fallbackTitle: "L" });
  report(long.title.length <= 100 && long.description.length <= 800 && !("link" in long), "words are trimmed to Pinterest's limits, and only https links are sent");
  const tagsOnly = p.pinBody({ boardId: "b", caption: "#a #b", link: null, slides, carousel: false, fallbackTitle: "Lull Room" });
  report(tagsOnly.title === "Lull Room", "a caption of only hashtags takes the shop's name as its title");
}
{
  const f = fakePinterest({ "POST /v5/pins": [201, { id: "pin9" }] });
  const out = await p.publishPin(f.fetch, { boardId: "b2", caption: "Hello", link: "https://lull.test", slides, business: true, fallbackTitle: "L" });
  report(out.ok && out.externalId === "pin9" && out.url === "https://www.pinterest.com/pin/pin9/", "a business account posts a carousel pin and gets its link");
  report(f.sent.length === 1 && f.sent[0].body.media_source.source_type === "multiple_image_urls", "one request for the carousel");
}
{
  const f = fakePinterest({ "POST /v5/pins": (body) => (body.media_source.source_type === "multiple_image_urls" ? [400, { code: 1, message: "Carousel not allowed" }] : [201, { id: "pin10" }]) });
  const out = await p.publishPin(f.fetch, { boardId: "b2", caption: "Hello", link: null, slides, business: true, fallbackTitle: "L" });
  report(out.ok && out.externalId === "pin10" && f.sent.length === 2 && f.sent[1].body.media_source.source_type === "image_url", "a refused carousel goes out again as one picture");
}
{
  const f = fakePinterest({ "POST /v5/pins": [201, { id: "pin11" }] });
  await p.publishPin(f.fetch, { boardId: "b2", caption: "Hello", link: null, slides, business: false, fallbackTitle: "L" });
  report(f.sent[0].body.media_source.source_type === "image_url", "a personal account posts one picture straight away");
}
{
  const f = fakePinterest({ "POST /v5/pins": [401, { code: 2, message: "Authentication failed." }] });
  const out = await p.publishPin(f.fetch, { boardId: "b2", caption: "Hello", link: null, slides, business: true, fallbackTitle: "L" });
  report(!out.ok && out.reconnect === true && /Connect again/.test(out.problem), "lost access asks for Connect again", out);
  report(f.sent.length === 1, "lost access isn't retried as a single picture");
  const busy = fakePinterest({ "POST /v5/pins": [429, { code: 8, message: "Too many" }] });
  const b = await p.publishPin(busy.fetch, { boardId: "b2", caption: "x", link: null, slides, business: false, fallbackTitle: "L" });
  report(!b.ok && !b.reconnect && /slow down/.test(b.problem), "rate limits say to wait, not reconnect");
  const other = fakePinterest({ "POST /v5/pins": [400, { code: 1, message: "Image too small" }] });
  const o = await p.publishPin(other.fetch, { boardId: "b2", caption: "x", link: null, slides, business: false, fallbackTitle: "L" });
  report(o.problem === "Pinterest said: Image too small", "other refusals keep Pinterest's words");
}

// ---- wiring (read as text) ----
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const core = read("connectors/pipedream/core.ts");
report(/pinterest: "pinterest"/.test(core), "Pinterest connects through the service's approved app");
const connect = read("lib/social/accounts/connect.ts");
report(/pinterestStart[\s\S]{0,300}canConnect\(session\)[\s\S]{0,200}serviceOn\(\)/.test(connect), "only the owner or a manager connects, and only with the service on");
report(/secret: via,/.test(connect), "only which account it is at the service is kept, never a key");
report(/status: board \? "connected" : "needs_attention"/.test(connect), "no board means the card says what to do, not a silent guess");
const done = read("app/api/connect/service/[provider]/done/route.ts");
report(/provider === "pinterest"[\s\S]{0,200}pinterestFinishViaService/.test(done), "the service's return finishes Pinterest for the shop that pressed");
report(/serviceAccountIds\(state\.workspaceId, "pinterest"\)/.test(done), "a new Pinterest account is told apart from the shops' existing ones");
const index = read("lib/social/accounts/index.ts");
report(/acc\.platform === "pinterest"[\s\S]{0,900}send = relayFetch\(via\)/.test(index), "Pinterest posts go through the service's relay");
const actions = read("app/(app)/social/connect/actions.ts");
report(/serviceAccountIds\(session\.workspaceId, acc\.platform, acc\.id\)\)\.has\(via\.accountId\)/.test(actions), "disconnecting one shop keeps an account another shop still uses");
const client = read("connectors/social-accounts/pinterest.ts");
report((client.match(/\bfetch\(/g) ?? []).length === 1, "Pinterest has one door (one place that sends requests)");
report(/api\\\.pinterest\\\.com/.test(read("scripts/preflight.mjs")), "only connectors/ may call Pinterest (one-door rule)");
report(/'pinterest'/.test(read("supabase/migrations/0023_pinterest.sql")), "the database accepts Pinterest accounts");

console.log(failures ? `\n${failures} check(s) failed` : "\nAll Pinterest checks passed");
process.exit(failures ? 1 : 0);
