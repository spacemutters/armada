// Offline checks for the AI carousel posts (lib/social/posts). Prints one PASS/FAIL line per check
// and exits 1 on any FAIL.
//
//   node scripts/check-social-posts.mjs            the checks, no network and no database
//   node scripts/check-social-posts.mjs --render   also draws sample slides with the real slide
//                                                  drawer (needs the internet for fonts and a photo)
//                                                  and saves them under the system temp folder
//
// What it proves:
// - the answer schema the AI gets accepts a good week of posts and rejects the ways an answer goes
//   wrong (a photo it wasn't offered, fewer than four slides, extra fields, a day outside the week),
//   and the reader keeps what it can trust and drops the rest (sales hashtags, emoji, exclamation
//   marks, a third scene for ChatGPT to make);
// - the prompt carries the shop builder's honesty rules word for word and never a photo address;
// - every slide's words read at 4.5:1 or better: on the shop's background, on its accent, and over
//   ANY photo under the veil (checked against thousands of pixel colours, and shown to fail when the
//   veil is made lighter than the computed least);
// - the sweep picks due posts only (and schedule.ts's SQL says the same thing), oldest first;
// - suggested times land on the right day and hour in the shoppers' zone, across a clock change;
// - a slide's address changes when anything drawn changes, and only then.

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);

let failures = 0;
function report(ok, label, detail) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? ` (${detail})` : ""}`);
}

// tsx lets this plain script load the TypeScript modules, "@/..." paths included.
// Both halves: the project's .ts files load as CommonJS, and their "@/..." imports need the CJS hook too.
(await import("tsx/esm/api")).register();
(await import("tsx/cjs/api")).register();
const load = (p) => import(new URL(`../${p}`, import.meta.url).href);

let schema, prompt, contrastMod, color, due, time, design, shopPrompts;
try {
  [schema, prompt, contrastMod, color, due, time, design, shopPrompts] = await Promise.all([
    load("lib/social/posts/schema.ts"),
    load("lib/social/posts/prompt.ts"),
    load("lib/social/posts/contrast.ts"),
    load("lib/color.ts"),
    load("lib/social/posts/due.ts"),
    load("lib/social/posts/time.ts"),
    load("lib/social/posts/design.ts"),
    load("lib/shops/prompts.ts"),
  ]);
} catch (e) {
  console.log(`FAIL couldn't load the posts code: ${e.message}`);
  process.exit(1);
}

// ---------- a small JSON Schema checker (the keywords the answer schema uses) ----------

function validate(s, v, at = "answer") {
  const errs = [];
  const typeOk = {
    object: (x) => x !== null && typeof x === "object" && !Array.isArray(x),
    array: Array.isArray,
    string: (x) => typeof x === "string",
    integer: Number.isInteger,
    number: (x) => typeof x === "number" && Number.isFinite(x),
    boolean: (x) => typeof x === "boolean",
  };
  if (s.type && !typeOk[s.type](v)) return [`${at} should be ${s.type}`];
  if (s.enum && !s.enum.includes(v)) errs.push(`${at} "${v}" isn't one of the allowed values`);
  if (s.minimum != null && v < s.minimum) errs.push(`${at} is below ${s.minimum}`);
  if (s.maximum != null && v > s.maximum) errs.push(`${at} is above ${s.maximum}`);
  if (s.type === "array") {
    if (s.minItems != null && v.length < s.minItems) errs.push(`${at} has ${v.length} items, fewer than ${s.minItems}`);
    if (s.maxItems != null && v.length > s.maxItems) errs.push(`${at} has ${v.length} items, more than ${s.maxItems}`);
    if (s.items) v.forEach((x, i) => errs.push(...validate(s.items, x, `${at}[${i}]`)));
  }
  if (s.type === "object") {
    for (const k of s.required ?? []) if (!(k in v)) errs.push(`${at}.${k} is missing`);
    for (const [k, x] of Object.entries(v)) {
      if (s.properties?.[k]) errs.push(...validate(s.properties[k], x, `${at}.${k}`));
      else if (s.additionalProperties === false) errs.push(`${at}.${k} isn't allowed`);
    }
  }
  return errs;
}

// ---------- sample shop ----------

const products = [
  { id: "11111111-1111-4111-8111-111111111111", title: "Cotton percale sheet set", collection: "bedding", bullets: ["Cotton percale weave", "Fitted sheet, flat sheet and pillowcases"], description: "A crisp, plain weave.", images: [{ url: "https://cdn.example.com/sheets-1.jpg" }, { url: "https://cdn.example.com/sheets-2.jpg" }], imagined: false },
  { id: "22222222-2222-4222-8222-222222222222", title: "Modern table lamp", collection: "light", bullets: ["Suited to a nightstand"], description: "", images: [{ url: "https://cdn.example.com/lamp-1.webp" }, { url: "http://insecure.example.com/x.jpg" }], imagined: false },
  { id: "33333333-3333-4333-8333-333333333333", title: "Blackout curtain panel", collection: "light", bullets: ["Sold as a single panel"], description: "", images: [], imagined: true },
];
const refs = prompt.photoRefs(products);
const keys = Object.keys(refs);
report(
  keys.join(",") === "P1-1,P1-2,P2-1" && refs["P2-1"].productId === products[1].id,
  "photos get short names, and only https photos are offered",
  keys.join(","),
);

const slide = (headline, line, photo, scene = "") => ({ headline, line, photo, scene });
const post = (angle, slides, day = 2, time = "19:30", extra = {}) => ({
  angle,
  slides,
  caption: "Percale is a plain cotton weave. It feels cool and crisp.\n\nMachine washable, and sold as a set.",
  hashtags: ["bedroomideas", "#percale", "cottonsheets"],
  day,
  time,
  ...extra,
});
const week = {
  posts: [
    post("Percale sheets up close", [slide("Cool, crisp percale", "A plain cotton weave.", "P1-1"), slide("The whole set", "Fitted, flat and pillowcases.", "P1-2"), slide("Made for warm nights", "", "scene", "an open window at dusk over a made bed, linen curtains moving"), slide("Evenfall", "Bedding chosen for rest.", "none")], 1, "20:00"),
    post("Light for the last hour", [slide("A lamp for the nightstand", "Low, even light.", "P2-1"), slide("Read, then rest", "", "none"), slide("One page more", "", "none"), slide("Evenfall", "", "none")], 2),
    post("How to make the room darker", [slide("Darker mornings", "One panel per window side.", "scene", "a dim bedroom at 6 a.m., a thin line of light at the window edge"), slide("Pair it with the lamp", "", "P2-1"), slide("Sleep past sunrise", "", "none"), slide("Evenfall", "", "none")], 3),
    post("A bedtime routine", [slide("Three steps before bed", "", "none"), slide("Lamp low", "", "P2-1"), slide("Sheets cool", "", "P1-1"), slide("Evenfall", "", "none")], 5),
    post("What's in the sheet set", [slide("What you get", "", "P1-2"), slide("Fitted and flat", "", "none"), slide("Two pillowcases", "", "none"), slide("Evenfall", "", "none")], 6, "08:15"),
  ],
};
const carousel = schema.carouselSchema(keys, schema.POSTS_PER_WEEK);
const goodErrs = validate(carousel, week);
report(goodErrs.length === 0, "a good week of posts passes the answer schema", goodErrs.slice(0, 2).join("; "));

const bad = (label, mutate) => {
  const copy = structuredClone(week);
  mutate(copy);
  const errs = validate(carousel, copy);
  report(errs.length > 0, `the schema rejects ${label}`, errs[0] ?? "no error found");
};
bad("a photo it wasn't offered", (w) => (w.posts[0].slides[0].photo = "P9-1"));
bad("a post with only two slides", (w) => w.posts[1].slides.splice(2));
bad("a post with three slides", (w) => w.posts[1].slides.splice(3));
bad("a slide without its scene field", (w) => delete w.posts[0].slides[0].scene);
bad("a post with nine slides", (w) => (w.posts[1].slides = Array.from({ length: 9 }, () => slide("x", "", "none"))));
bad("an extra field", (w) => (w.posts[0].price = "$20"));
bad("a day outside the week", (w) => (w.posts[2].day = 9));
bad("four posts when five were asked for", (w) => w.posts.pop());
bad("a missing caption", (w) => delete w.posts[3].caption);

// The reader: what's kept, what's dropped.
const read = schema.readCarouselAnswer(week, keys, schema.POSTS_PER_WEEK);
report(read.posts.length === 5 && read.notes.length === 0, "the reader keeps all five good posts", `${read.posts.length} posts, ${read.notes.length} notes`);
report(read.posts[0].slides[0].photo === "P1-1" && read.posts[0].slides[3].photo === null && read.posts[0].slides[3].scene === null, "photo names map through, and \"none\" means a text-only slide");
report(read.posts[0].slides[2].photo === null && /open window at dusk/.test(read.posts[0].slides[2].scene ?? ""), "a \"scene\" slide keeps what its ChatGPT picture shows, and no product photo");
report(read.posts[0].hour === 20 && read.posts[0].minute === 0 && read.posts[0].day === 1, "day and time are read", `${read.posts[0].day} ${read.posts[0].hour}:${read.posts[0].minute}`);

const messy = {
  posts: [
    post(
      "Big sale!!! 🔥",
      [slide("Buy now!!! 🛏️", "Only today!", "P7-3"), slide("Crisp percale", "A plain weave.", "P1-1"), slide("  ", "", "none"), slide("Folded at the foot", "", "none"), slide("Evenfall", "", "none")],
      12,
      "6:30 pm",
      { hashtags: ["#sale", "Free Shipping", "#Sleep Well", "sleepwell", "percale", "#123", "giveaway2026", "bedroom"] },
    ),
    post("Too short", [slide("One", "", "none"), slide("Two", "", "none")]),
    "not a post",
    post("Three slides", [slide("a", "", "none"), slide("b", "", "none"), slide("c", "", "none")]),
    post("Extra", [slide("a", "", "none"), slide("b", "", "none"), slide("c", "", "none"), slide("d", "", "none")]),
  ],
};
const m = schema.readCarouselAnswer(messy, keys, 2);
const p0 = m.posts[0];
report(m.posts.length === 2 && m.posts[1].angle === "Extra", "the reader drops posts under four slides and anything unreadable, and never returns more than asked", `${m.posts.length} posts`);
report(p0 && !/[!🔥🛏]/u.test(p0.angle + p0.slides.map((s) => s.headline + s.line).join("")), "emoji and exclamation marks are taken out", p0?.slides[0].headline);
report(p0 && p0.slides.length === 4 && p0.slides[0].photo === null, "a slide naming a photo it wasn't offered stays, words only; a blank slide goes", p0?.slides.map((s) => s.photo).join(","));
report(p0 && p0.hashtags.join(" ") === "SleepWell percale bedroom", "sales, freebie and number hashtags are dropped; repeats and spaces are fixed", p0?.hashtags.join(" "));
report(p0 && p0.day === 7 && p0.hour === 18 && p0.minute === 30, "a day past the week is held to 7, and \"6:30 pm\" reads as 18:30", p0 && `${p0.day} ${p0.hour}:${p0.minute}`);
report(m.notes.some((n) => /wasn't offered/.test(n)) && m.notes.some((n) => /fewer than 4/.test(n)), "the reader says what it left out", m.notes.join(" | "));
report(schema.MIN_SLIDES >= 4 && schema.MAX_SLIDES <= 8, `carousels have ${schema.MIN_SLIDES} to ${schema.MAX_SLIDES} slides`);

// Scenes: ChatGPT makes at most MAX_SCENES_PER_POST per post; a scene with nothing described stays words only.
const scenic = schema.readCarouselAnswer(
  { posts: [post("Scenes", [slide("One", "", "scene", "a porch at dusk"), slide("Two", "", "scene", "a kitchen at dawn"), slide("Three", "", "scene", "a hallway at noon"), slide("Four", "", "scene", "  "), slide("Evenfall", "", "none")])] },
  keys,
  1,
);
const sc = scenic.posts[0]?.slides ?? [];
report(sc.filter((x) => x.scene).length === schema.MAX_SCENES_PER_POST && sc[2].scene === null && sc[3].scene === null && scenic.notes.some((n) => /more than 2 scenes/.test(n)),
  `at most ${schema.MAX_SCENES_PER_POST} scene pictures per post; a third, or an empty one, stays words only`, sc.map((x) => (x.scene ? "scene" : "words")).join(","));
report(schema.readCarouselAnswer({ nope: 1 }, keys, 5).posts.length === 0 && schema.readCarouselAnswer(null, keys, 5).posts.length === 0, "an answer in the wrong shape gives no posts");
report(
  schema.tidyCaption("Line one.\n\n\n\nLine two!  #cozy #sheets") === "Line one.\n\nLine two.",
  "captions keep their paragraphs and lose trailing hashtags",
  JSON.stringify(schema.tidyCaption("Line one.\n\n\n\nLine two!  #cozy #sheets")),
);
report(schema.fullCaption("Words.", ["a", "b"]) === "Words.\n\n#a #b", "the caption goes out with its hashtags after a blank line");

// The prompt: the shop builder's honesty rules, the facts, and no photo addresses.
const bp = {
  brand: { name: "Evenfall", alternativeNames: [], tagline: "Bedroom goods for an easier night", voice: "Quiet and plain.", audience: "Light sleepers.", monogramIcon: "bed" },
  theme: { palette: { background: "#eef1f4", surface: "#e1e7ec", ink: "#1c2733", muted: "#4a5866", accent: "#2f4a68", accentInk: "#fafafb" }, fonts: { display: "Newsreader", body: "Karla" }, contrastFixes: [] },
  valueProps: [{ title: "A short range", body: "Chosen for the bedroom." }],
  collections: [{ handle: "bedding", title: "Bedding", description: "", keywords: [], productIds: [] }, { handle: "light", title: "Light", description: "", keywords: [], productIds: [] }],
  facts: { country: "United States", deliveryMin: 7, deliveryMax: 14, handlingDays: 2, returnDays: 30 },
};
const practiceRefs = prompt.photoRefs(products, { practice: true });
report(practiceRefs["P3-1"]?.item === true && practiceRefs["P3-1"].url === null && Object.keys(practiceRefs).join(",") === "P1-1,P1-2,P2-1,P3-1",
  "in a practice shop, a practice item without a photo is offered as its one picture (made with ChatGPT); real photos are unchanged");
report(!prompt.photoRefs(products, { practice: false })["P3-1"], "outside a practice shop, a product without a photo is never offered a made-up picture");
const text = prompt.carouselPrompt({ bp, practice: true, products, refs: practiceRefs, count: 5, platforms: ["instagram", "facebook"], earlierAngles: ["Sheets up close"], takenDays: [2], zoneLabel: "US Eastern time" });
report(/P3-1 \(a practice item: Armada makes its one picture\)/.test(text) && /"scene"/.test(text) && /never shows one/.test(text) && /at most 2 slides per post/.test(text) && new RegExp(`${schema.MIN_SLIDES} to ${schema.MAX_SLIDES} slides`).test(text),
  "the prompt offers the practice item's picture, explains scenes (never a product) and asks for four to eight slides");
report(prompt.SYSTEM === shopPrompts.SYSTEM && /Never invent facts/.test(prompt.SYSTEM), "the job uses the shop builder's honesty rules word for word");
report(!/https?:\/\//.test(text), "the prompt never shows the AI a photo address");
report(
  /No prices, discounts, sales/.test(text) && /Returns are accepted within 30 days/.test(text) && /P1-1, P1-2/.test(text) && /\[practice item\]/.test(text) && /Sheets up close/.test(text) && /already have a post[^.]*: 2/.test(text),
  "the prompt carries the facts, the photo names, the practice label, earlier ideas and taken days",
);

// ---------- contrast ----------

const { contrast, mix } = color;
const palettes = {
  "Evenfall (light, serif)": bp.theme.palette,
  "Ridgeline (dark)": { background: "#121614", surface: "#1b201d", ink: "#e8ece9", muted: "#a3aca6", accent: "#c9a86a", accentInk: "#121614" },
  "bright accent": { background: "#fbf7f0", surface: "#f3ece0", ink: "#231c14", muted: "#6b5d4c", accent: "#b8321f", accentInk: "#fffaf4" },
  "washed-out (ink too close to background)": { background: "#9a9a9a", surface: "#a5a5a5", ink: "#7a7a7a", muted: "#8a8a8a", accent: "#888888", accentInk: "#8f8f8f" },
};

let seed = 0x2545f491;
const rand = () => ((seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0) / 4294967296);
const pixels = ["#000000", "#ffffff", "#808080", "#ff0000", "#00ff00", "#0000ff", "#ffff00", "#00ffff", "#ff00ff"];
for (let i = 0; i < 6000; i++) pixels.push("#" + [0, 1, 2].map(() => Math.floor(rand() * 256).toString(16).padStart(2, "0")).join(""));
const worstOver = (textHex, scrim, alpha) => Math.min(...pixels.map((px) => contrast(textHex, mix(px, scrim, alpha))));

for (const [name, p] of Object.entries(palettes)) {
  const c = contrastMod.slideColors(p);
  const page = Math.min(contrast(c.page.text, c.page.ground), contrast(c.page.soft, c.page.ground));
  const loud = Math.min(contrast(c.loud.text, c.loud.ground), contrast(c.loud.soft, c.loud.ground));
  const o = c.overPhoto;
  const measured = Math.min(worstOver(o.text, o.scrim, o.alpha), worstOver(o.soft, o.scrim, o.alpha));
  report(page >= 4.5 && loud >= 4.5, `${name}: words on the background and on the accent read at 4.5:1 or better`, `${page.toFixed(2)} and ${loud.toFixed(2)}`);
  report(
    o.worstText >= 4.5 && o.worstSoft >= 4.5 && measured >= 4.5 - 0.05,
    `${name}: words over any photo read at 4.5:1 or better under a ${Math.round(o.alpha * 100)}% veil`,
    `computed ${Math.min(o.worstText, o.worstSoft).toFixed(2)}, lowest of ${pixels.length} photo colours ${measured.toFixed(2)}`,
  );
  const least = contrastMod.scrimAlpha(o.text, o.scrim);
  const thin = Math.max(0, least - 0.03);
  report(worstOver(o.text, o.scrim, thin) < 4.5, `${name}: the check has teeth: a veil lighter than the least (${Math.round(thin * 100)}%) fails over some photo`);
}
report(contrastMod.worstContrastOverPhoto("#777777", "#000000", 0) === 1, "text the same brightness as some photo pixel counts as unreadable without a veil");

// ---------- the sweep: due posts only ----------

const now = Date.parse("2026-09-24T18:00:00Z");
const at = (min) => new Date(now + min * 60_000).toISOString();
const posts = [
  { id: "due-old", status: "scheduled", scheduledAt: at(-30), rewriting: false },
  { id: "due-now", status: "scheduled", scheduledAt: at(0), rewriting: false },
  { id: "later", status: "scheduled", scheduledAt: at(1), rewriting: false },
  { id: "draft", status: "draft", scheduledAt: null, rewriting: false },
  { id: "draft-with-old-time", status: "draft", scheduledAt: at(-60), rewriting: false },
  { id: "posted", status: "posted", scheduledAt: at(-120), rewriting: false },
  { id: "failed", status: "failed", scheduledAt: at(-10), rewriting: false },
  { id: "being-rewritten", status: "scheduled", scheduledAt: at(-5), rewriting: true },
  { id: "posting", status: "posting", scheduledAt: at(-2), rewriting: false, postingStartedAt: at(-1) },
  { id: "lost", status: "posting", scheduledAt: at(-40), rewriting: false, postingStartedAt: at(-16) },
];
report(due.pickDue(posts, now).join(",") === "due-old,due-now", "the sweep picks only scheduled posts whose time has come, oldest first", due.pickDue(posts, now).join(","));
const many = Array.from({ length: 15 }, (_, i) => ({ id: `p${i}`, status: "scheduled", scheduledAt: at(-i), rewriting: false }));
const picked = due.pickDue(many, now);
report(picked.length === due.PER_SWEEP && picked[0] === "p14" && !picked.includes("p0"), `one sweep sends at most ${due.PER_SWEEP}, the longest-waiting first`);
report(posts.filter((p) => due.isLost(p, now)).map((p) => p.id).join(",") === "lost", `a post stuck sending for over ${due.LOST_AFTER_MINUTES} minutes is marked, and only that one`);

const scheduleSrc = readFileSync(path.join(root, "lib/social/posts/schedule.ts"), "utf8").replace(/\s+/g, " ");
report(
  /status = 'scheduled' and scheduled_at <= now\(\) and not rewriting/.test(scheduleSrc) && /order by scheduled_at limit \$\{PER_SWEEP\} for update skip locked/.test(scheduleSrc),
  "schedule.ts's SQL claims by the same rule, oldest first, and skips rows another server holds",
);
report(/filter\(\(id\) => !results\[id\]\?\.ok\)/.test(scheduleSrc) && /results = results \|\| /.test(scheduleSrc), "an account that already has the post is never sent it again, and each result is saved as it arrives");

// ---------- suggested times ----------

const nyNow = new Date("2026-09-24T22:00:00Z"); // 6 pm in New York
const s1 = time.suggestedMoment(nyNow, 1, 18, 30, "America/New_York");
report(s1.toISOString() === "2026-09-25T22:30:00.000Z", "day 1 at 18:30 is tomorrow at 6:30 pm New York time", s1.toISOString());
const lateNight = new Date("2026-09-25T03:30:00Z"); // 11:30 pm on the 24th in New York, already the 25th in UTC
const s2 = time.suggestedMoment(lateNight, 1, 9, 0, "America/New_York");
report(s2.toISOString() === "2026-09-25T13:00:00.000Z", "\"tomorrow\" is counted in the shoppers' zone, not the server's", s2.toISOString());
const s3 = time.suggestedMoment(new Date("2026-10-30T16:00:00Z"), 3, 18, 0, "America/New_York");
report(s3.toISOString() === "2026-11-02T23:00:00.000Z", "a suggestion after the clocks go back keeps its local hour", s3.toISOString());
const s4 = time.suggestedMoment(new Date("2026-09-24T12:00:00Z"), 2, 19, 0, "Europe/London");
report(s4.toISOString() === "2026-09-26T18:00:00.000Z", "a UK shop's evening is UK evening", s4.toISOString());
report(
  time.takenDays(nyNow, [new Date("2026-09-26T23:00:00Z"), new Date("2026-10-10T23:00:00Z"), new Date("2026-09-24T23:00:00Z")], "America/New_York").join(",") === "2",
  "days already taken are counted in the shoppers' zone, within the coming week",
);

// ---------- slide addresses ----------

const look = { brand: "Evenfall", palette: bp.theme.palette, fonts: bp.theme.fonts };
const s = { n: 2, headline: "Cool, crisp percale", line: "A plain cotton weave.", imageUrl: "https://cdn.example.com/sheets-1.jpg" };
const v = design.slideVersion(s, 5, look);
report(v === design.slideVersion({ ...s }, 5, look), "a slide's version is stable while nothing changes");
report(
  [
    design.slideVersion({ ...s, headline: "Cool percale" }, 5, look),
    design.slideVersion({ ...s, imageUrl: null }, 5, look),
    design.slideVersion({ ...s, pictureId: "0f1e2d3c-4b5a-4968-8776-655443322110" }, 5, look),
    design.slideVersion(s, 6, look),
    design.slideVersion(s, 5, { ...look, palette: { ...look.palette, accent: "#123456" } }),
    design.slideVersion(s, 5, { ...look, fonts: { ...look.fonts, display: "Fraunces" } }),
  ].every((x) => x !== v),
  "it changes with the words, the photo, a new ChatGPT picture, the slide count, the palette and the fonts",
);
const url = design.slideUrl("https://armada-pi.vercel.app/", "0f1e2d3c-4b5a-4968-8776-655443322110", 2, v);
report(url === `https://armada-pi.vercel.app/api/social/slide/0f1e2d3c-4b5a-4968-8776-655443322110/2.jpg?v=${v}`, "slide addresses are public, end in .jpg and carry the version", url);
const routeSrc = readFileSync(path.join(root, "app/api/social/slide/[postId]/[n]/route.tsx"), "utf8");
const ns = ["2", "2.jpg", "8.jpeg", "1.png", "0", "9", "2.gif", "../1", "02x"].map((x) => design.slideNumber(x));
report(ns.join(",") === "2,2,8,1,,,,,", "slide numbers read \"2\" and \"2.jpg\", 1 to 8, and nothing else", ns.join(","));
report(/slideNumber\(rawN\)/.test(routeSrc), "the slide route reads its number that way");
report(/immutable/.test(routeSrc) && /asked === version/.test(routeSrc), "only an address with the current version is cached for a year");
report(/pictureId: pic\?\.id/.test(routeSrc) && /pictureId: pictures\.get/.test(readFileSync(path.join(root, "lib/social/posts/schedule.ts"), "utf8")),
  "the slide route and the publisher both version a slide by the picture it's drawn with");
report(design.layoutFor(3, 5, "scene", true) === "cover" && design.layoutFor(3, 5, "scene", false) === "object" && design.layoutFor(1, 5, null) === "statement",
  "a ChatGPT scene is drawn full-bleed on any slide; a product photo keeps its panel");

// ---------- optional: draw real slides ----------

if (process.argv.includes("--render")) {
  const { renderSlide } = await load("lib/social/posts/render.tsx");
  const sharp = (await import("sharp")).default;
  const out = path.join(tmpdir(), "armada-social-slides");
  mkdirSync(out, { recursive: true });
  const cases = [
    { n: 1, total: 5, headline: "A lamp that stays low after ten", line: "Warm, even light on the nightstand.", imageUrl: "https://cdn.dummyjson.com/product-images/home-decoration/table-lamp/1.webp" },
    { n: 2, total: 5, headline: "Cool, crisp percale", line: "A plain cotton weave: fitted sheet, flat sheet and pillowcases in one set.", imageUrl: null },
    { n: 5, total: 5, headline: "The bedroom range, in one place", line: "Bedding, light and quiet.", imageUrl: null },
  ];
  for (const c of cases) {
    try {
      const r = await renderSlide({ look, ...c });
      const meta = await sharp(Buffer.from(r.body)).metadata();
      const file = path.join(out, `slide-${c.n}-${r.layout}.${r.type === "image/jpeg" ? "jpg" : "png"}`);
      writeFileSync(file, r.body);
      report(r.type === "image/jpeg" && meta.format === "jpeg" && meta.width === 1080 && meta.height === 1350, `drew slide ${c.n} (${r.layout}) as a 1080 x 1350 JPEG`, file);
    } catch (e) {
      report(false, `drew slide ${c.n}`, e.message);
    }
  }
}

console.log(failures ? `\n${failures} check${failures === 1 ? "" : "s"} failed.` : "\nAll checks passed.");
process.exit(failures ? 1 : 0);
