// Offline checks for the pictures in ads and social posts (lib/creative, lib/ads/pictures.ts,
// lib/social/posts/pictures.ts). No database, no network, no AI calls. Prints one PASS/FAIL line per
// check and exits 1 on any FAIL.
//
//   node scripts/check-creative-pictures.mjs
//
// What it guards:
// - honesty: a product is only ever shown by its real photo; ChatGPT makes scenes (never a product)
//   and, in practice shops only, a practice item's one picture. Checked in the rules the AI gets, in
//   the code that asks for pictures, in the database migration, and in the composed pictures (the
//   product's own pixels survive into the ad picture)
// - carousels: ads have at least four cards and posts at least four slides
// - the pictures run on the ChatGPT tool with a model that can reach its image maker
// - usage: one short brief per picture, scenes capped per ad and post, pictures made once
// - what runs is what was checked: ads go to the platform with the same composed pictures
// - the previews never fall back to a big icon on white

import fs from "node:fs";
import { registerHooks } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Load the app's TypeScript: "@/x" paths, extensionless imports, and "server-only" as an empty module.
function tryFile(base) {
  for (const ext of ["", ".ts", ".tsx", "/index.ts"]) {
    const p = base + ext;
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  }
  return null;
}
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export%20%7B%7D", shortCircuit: true };
    if (specifier.startsWith("@/")) {
      const p = tryFile(path.join(root, specifier.slice(2)));
      if (p) return { url: pathToFileURL(p).href, shortCircuit: true };
    }
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
      const base = path.join(path.dirname(fileURLToPath(context.parentURL)), specifier);
      const p = tryFile(base);
      if (p && p !== base) return { url: pathToFileURL(p).href, shortCircuit: true };
    }
    return next(specifier, context);
  },
});

let failures = 0;
function report(ok, label, detail) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? ` (${detail})` : ""}`);
}
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const words = (s) => s.split(/\s+/).filter(Boolean).length;

let craft, config, engines, brief, adsSchema, adPictures, postsSchema, compose, render;
try {
  craft = await import("../lib/shops/craft.ts");
  config = await import("../lib/ai/config.ts");
  engines = await import("../helper/engines.mjs");
  brief = await import("../lib/creative/brief.ts");
  adsSchema = await import("../lib/ads/schema.ts");
  adPictures = await import("../lib/ads/pictures.ts");
  postsSchema = await import("../lib/social/posts/schema.ts");
  compose = await import("../lib/creative/compose.ts");
} catch (e) {
  console.log(`FAIL couldn't load the pictures code: ${e.message}`);
  process.exit(1);
}
const sharp = (await import("sharp")).default;

// ---------- 1. what the AI is told ----------

const PC = craft.PICTURE_CRAFT;
report(words(PC) <= 360, "PICTURE_CRAFT stays short (sent with every picture)", `${words(PC)} words`);
report(/never a product the shop sells/i.test(PC) && /Armada places the product's real photo itself/.test(PC), "PICTURE_CRAFT: a scene never shows a product; the product is its real photo, placed by Armada");
report(/only exception is a brief that says "practice item"/.test(PC), "PICTURE_CRAFT: the one exception is a practice item, and only when the brief says so");
report(/Never text, letters, numbers, logos/.test(PC) && /No face toward the camera/.test(PC), "PICTURE_CRAFT: no text and no faces to camera in pictures (words are Armada's real text)");
const shared = craft.IMAGE_CRAFT.split("\n").filter((l) => /^- (Never text|One idea|Light is|Color:|Camera:|Avoid the stock|A set is)/.test(l));
report(shared.length === 7 && shared.every((l) => PC.includes(l)), "brand pictures and ad pictures share one set of craft lines");

// ---------- 2. routing ----------

const kinds = [brief.PICTURE_JOB.scene, brief.PICTURE_JOB.item];
report(kinds.every((k) => config.engineFor(k) === "codex"), "ad and post pictures run on the ChatGPT tool", kinds.map((k) => `${k}→${config.engineFor(k)}`).join(", "));
let codeModeOnly = (m) => /^gpt-(6|5\.6)/.test(m);
try {
  const cache = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".codex", "models_cache.json"), "utf8"));
  const bySlug = new Map((cache.models ?? []).map((m) => [m.slug, m]));
  if (bySlug.size) codeModeOnly = (m) => (bySlug.has(m) ? bySlug.get(m).tool_mode === "code_mode_only" : /^gpt-(6|5\.6)/.test(m));
} catch {}
report(kinds.every((k) => !codeModeOnly(config.modelFor(k))), "their model can reach the image maker with the helper's lockdown on", kinds.map((k) => config.modelFor(k)).join(","));

// ---------- 3. the briefs ----------

const bp = {
  brand: { name: "Bloomline", alternativeNames: [], tagline: "Pour-over gear for a slower first cup", voice: "Plain.", audience: "People who make one careful cup before work", monogramIcon: "coffee" },
  theme: { palette: { background: "#f3f0ea", surface: "#e8e2d7", ink: "#2a2520", muted: "#6a6158", accent: "#8a4b2a", accentInk: "#ffffff" }, fonts: { display: "Fraunces", body: "Karla" }, contrastFixes: [] },
  collections: [{ handle: "brew", title: "Brew", description: "", keywords: ["pour-over dripper", "gooseneck kettle"], productIds: [] }],
  searchTerms: ["coffee grinder", "coffee scale"],
  products: [
    { productId: "11111111-1111-4111-8111-111111111111", handle: "dripper", collection: "brew", priceCents: 4800, imagined: true },
    { productId: "22222222-2222-4222-8222-222222222222", handle: "glass", collection: "brew", priceCents: 1800, imagined: false },
  ],
};
const practiceShop = { niche: "Pour-over coffee gear", brief: { source: "practice", look: "pale wood", priceFeel: "premium", country: "United States" }, blueprint: bp };
const realShop = { ...practiceShop, brief: { ...practiceShop.brief, source: "cj" } };
const ITEM = "11111111-1111-4111-8111-111111111111";
const REAL = "22222222-2222-4222-8222-222222222222";

const sceneSpec = { kind: "scene", role: "card", scene: "a pale oak counter at 7 a.m., steam from a mug", context: 'card 1 of 4 of a carousel ad, headed "A slower first cup"' };
const sceneIn = brief.pictureJobInput(practiceShop, sceneSpec, { slot: "card:c1", shopId: "s" });
const itemIn = brief.pictureJobInput(practiceShop, { kind: "item", title: "Ceramic dripper", facts: ["Glazed stoneware"] }, { slot: "item", shopId: "s", productId: ITEM });
report(!("model" in sceneIn) && !("model" in itemIn), "a picture job carries no model of its own (the config decides)");
report(sceneIn.system.includes(PC.split("\n")[1]) && /Answer only with JSON/.test(sceneIn.system.trim().split("\n").at(-1)), "a picture job's instructions carry the picture craft, JSON rule last");
report(/None of these, and nothing that looks like one, may appear: .*coffee grinder.*gooseneck kettle/.test(sceneIn.prompt), "a scene brief names the shop's product kinds as things that must not appear");
report(!/practice item exception/.test(sceneIn.prompt) && /practice item exception/.test(itemIn.prompt) && /Ceramic dripper/.test(itemIn.prompt), "only an item brief uses the practice item exception, and it names the item");
report(words(sceneIn.prompt) <= 140 && words(itemIn.prompt) <= 140, "every brief is a few short lines (usage)", `${words(sceneIn.prompt)} and ${words(itemIn.prompt)} words`);
const longScene = brief.pictureJobInput(practiceShop, { ...sceneSpec, scene: "word ".repeat(300) }, { slot: "main", shopId: "s" });
const runaway = (longScene.prompt.match(/(?:^|\s)word(?=\s|\.|$)/g) ?? []).length;
report(runaway > 0 && runaway <= brief.SCENE_WORDS_MAX, `a runaway scene description is cut to ${brief.SCENE_WORDS_MAX} words before it reaches the image maker`, `${runaway} kept`);
const outs = engines.imageOutputs(sceneIn);
report(
  JSON.stringify(outs.map((o) => [o.name, o.width, o.height])) === JSON.stringify([["square", 1080, 1080], ["portrait", 1080, 1350], ["story", 1080, 1920]]),
  "a scene is cut square (cards), 4:5 (feed and slides) and 9:16 (full-screen), and the helper accepts those sizes",
  outs.map((o) => `${o.name} ${o.width}x${o.height}`).join(", "),
);
report(engines.imageOutputs(itemIn).map((o) => o.name).join() === "square" && itemIn.image.productId === ITEM && sceneIn.image.productId === null, "an item picture is one square cut, tied to its item; a scene to no product");
report(engines.isImageJob(sceneIn) && engines.isImageJob(itemIn), "the helper sees both as image jobs (image maker on, every other tool off)");

// ---------- 4. who may get an item picture ----------

report(brief.mayPictureItem(practiceShop, ITEM) === true, "a practice shop's imagined item may get a picture");
report(brief.mayPictureItem(practiceShop, REAL) === false, "a practice shop's real product (it has a photo) never gets a made-up picture");
report(brief.mayPictureItem(realShop, ITEM) === false, "a real shop never gets a made-up picture of anything, even an item marked imagined");
const picturesSrc = read("lib/creative/pictures.ts");
const queueItemFn = picturesSrc.match(/export async function queueItem[\s\S]*?\n}/)?.[0] ?? "";
report(/if \(!UUID\.test\(productId\) \|\| !mayPictureItem\(shop, productId\)\) return false;/.test(queueItemFn) && queueItemFn.indexOf("mayPictureItem") < queueItemFn.indexOf("enqueueJob"),
  "asking for an item picture checks the practice rule before anything is queued");
report(/mayPictureItem\(shop, spec\.productId\)/.test(picturesSrc), "a picture handed back is kept as an item picture only if the rule still holds");
const migration = fs.readdirSync(path.join(root, "supabase", "migrations")).filter((f) => /creative_pictures/.test(f)).map((f) => read(`supabase/migrations/${f}`)).join("\n");
report(/create trigger creative_item_is_practice/.test(migration) && /brief ->> 'source' = 'practice'/.test(migration) && /\(p ->> 'imagined'\)::boolean/.test(migration),
  "the database refuses an item picture for anything but a practice shop's imagined item");
report(/kind = 'scene' and product_id is null/.test(migration), "the database keeps scenes free of any product");

// ---------- 5. which pictures an ad shows ----------

const products = new Map([
  [ITEM, { id: ITEM, title: "Ceramic dripper", bullets: ["Glazed stoneware"], images: [], art: { icon: "coffee", tone: "accent" }, imagined: true }],
  [REAL, { id: REAL, title: "Glass server", bullets: [], images: [{ url: "https://cdn.example.com/glass-1.jpg" }, { url: "https://cdn.example.com/glass-2.jpg" }, { url: "http://insecure.example.com/x.jpg" }], art: null, imagined: false }],
]);
report(adPictures.photosOf(products.get(REAL)).length === 2, "only https photos are shown (an insecure one is skipped)");
const single = { id: "33333333-3333-4333-8333-333333333333", format: "single", headline: "A slower first cup", productIds: [REAL], scene: "a pale oak counter by a window", cards: [] };
const [main] = adPictures.adPictureSlots(practiceShop, single, products);
report(main.plan.mode === "staged" && main.plan.photoUrl === "https://cdn.example.com/glass-1.jpg" && main.plan.item === false && main.scene?.role === "backdrop",
  "a single-photo ad: the product's real photo on a panel, in front of a ChatGPT setting");
const cards = [
  { key: "c1", kind: "scene", productId: null, photo: 0, headline: "Slow mornings", description: "", scene: "a quiet kitchen at dawn" },
  { key: "c2", kind: "product", productId: REAL, photo: 1, headline: "Glass server", description: "$18.00", scene: "" },
  { key: "c3", kind: "product", productId: ITEM, photo: 0, headline: "Ceramic dripper", description: "$48.00", scene: "" },
  { key: "c4", kind: "product", productId: REAL, photo: 0, headline: "Glass server", description: "$18.00", scene: "" },
];
const carousel = { id: "44444444-4444-4444-8444-444444444444", format: "carousel", headline: "The pour-over set", productIds: [REAL, ITEM], scene: "", cards };
const slots = adPictures.adPictureSlots(practiceShop, carousel, products);
report(slots.length === 4 && slots.map((s) => s.plan.mode).join() === "scene,product,product,product", "a carousel shows one picture per card: scenes made with AI, products in their photos");
report(slots[1].plan.photoUrl === "https://cdn.example.com/glass-2.jpg" && slots[1].scene === null, "a product card shows the photo the ad chose, and asks ChatGPT for nothing");
report(slots[2].plan.item === true && slots[2].plan.photoUrl === null, "in a practice shop, a practice item's card shows its practice picture");
const realSlots = adPictures.adPictureSlots(realShop, carousel, products);
report(realSlots[2].plan.item === false, "in a real shop, nothing is ever pictured by ChatGPT in a product's place");

const emptyIndex = new Map();
const views = adPictures.adPictureViews(practiceShop, carousel, products, emptyIndex);
report(views[1].state === "ready" && /^\/api\/ads\/picture\/44444444-[\w-]+\/c2\.jpg\?shape=square&v=\w+$/.test(views[1].src.square ?? ""), "a real photo's card is ready at once, at Armada's composed picture address", views[1].src.square);
report(views[0].state === "waiting" && views[0].src.square === null && views[2].src.square === null, "a card whose picture isn't made yet shows no picture (the preview shows a quiet placeholder)");
report(views[2].practiceItem === true && views[1].practiceItem === false, "a practice item's picture is labelled practice on the preview");
const failedSetting = new Map([[`ad:${single.id}:main`, { cuts: {}, alt: "", making: false, failed: true, tried: true }]]);
const sv = adPictures.adPictureViews(practiceShop, single, products, failedSetting)[0];
report(sv.state === "failed" && sv.src.portrait !== null && /on its own/.test(sv.note ?? ""), "a single-photo ad whose setting couldn't be made still shows its product, and says so");
const cut = (id) => ({ id, width: 1024, height: 1024 });
const ready = new Map([[`ad:${single.id}:main`, { cuts: { square: cut("a1"), portrait: cut("a2"), story: cut("a3") }, alt: "x", making: false, failed: false, tried: true }]]);
const again = new Map([[`ad:${single.id}:main`, { cuts: { square: cut("b1"), portrait: cut("b2"), story: cut("b3") }, alt: "x", making: false, failed: false, tried: true }]]);
const va = adPictures.adPictureViews(practiceShop, single, products, ready)[0];
const vb = adPictures.adPictureViews(practiceShop, single, products, again)[0];
report(va.state === "ready" && va.src.portrait !== vb.src.portrait && va.src.story !== va.src.portrait, "a picture made again gets a new address, and each shape its own");

// ---------- 6. carousels have at least four ----------

report(adsSchema.CARDS.min >= 4, `carousel ads have at least four cards`, `CARDS.min ${adsSchema.CARDS.min}`);
report(postsSchema.MIN_SLIDES >= 4 && postsSchema.carouselSchema([], 1).properties.posts.items.properties.slides.minItems >= 4, "carousel posts have at least four slides, and the AI is held to it");
report(adsSchema.SCENES_PER_AD <= 2 && postsSchema.MAX_SCENES_PER_POST <= 2, "at most two scenes made per ad and per post (usage)");

// ---------- 7. composing: the product keeps its own pixels ----------

const palette = bp.theme.palette;
const W = 600, H = 600;
// A product on white: a pure red block with a thin blue stripe, the way a supplier shoots on white.
const productBytes = await sharp({ create: { width: W, height: H, channels: 3, background: "#ffffff" } })
  .composite([{ input: await sharp({ create: { width: 300, height: 400, channels: 3, background: "#d01010" } }).png().toBuffer(), left: 150, top: 100 }])
  .png()
  .toBuffer();
const { photoFromBytes } = await import("../lib/social/posts/photo.ts");
const product = await photoFromBytes(productBytes);
report(product?.kind === "cutout", "a product on white is recognised as a cut-out");
const noise = Buffer.alloc(1024 * 1536 * 3);
for (let i = 0; i < noise.length; i++) noise[i] = (Math.sin(i * 0.011) * 50 + 120 + ((i * 2654435761) % 37)) & 255;
const setting = await sharp(noise, { raw: { width: 1024, height: 1536, channels: 3 } }).webp({ quality: 80 }).toBuffer();
const sizes = {};
for (const shape of ["square", "portrait", "story"]) {
  const out = await compose.staged(setting, product, shape, palette);
  const meta = await sharp(out).metadata();
  sizes[shape] = `${meta.width}x${meta.height}`;
  const [w, h] = compose.SHAPE_SIZE[shape];
  const box = compose.panelBox(shape);
  const { data, info } = await sharp(out).extract({ left: box.left + Math.round(box.w / 2) - 4, top: box.top + Math.round(box.h / 2) - 4, width: 8, height: 8 }).raw().toBuffer({ resolveWithObject: true });
  let red = 0;
  for (let i = 0; i < data.length; i += info.channels) if (data[i] > 150 && data[i + 1] < 90 && data[i + 2] < 90) red++;
  report(meta.format === "jpeg" && meta.width === w && meta.height === h && red >= 60, `a staged ${shape} picture is ${w}x${h} and the product's own pixels sit on its panel`, `${sizes[shape]}, ${red}/64 product pixels`);
}
// A square picture on a plain seamless (a practice item's, or a supplier's studio shot) placed in a
// tall frame: the whole product stays in view, nothing is cropped off its sides.
const seamless = await sharp({ create: { width: 600, height: 600, channels: 3, background: "#cfd4d1" } })
  .composite([{ input: await sharp({ create: { width: 480, height: 300, channels: 3, background: "#1030c0" } }).png().toBuffer(), left: 60, top: 150 }])
  .png()
  .toBuffer();
const wide = await photoFromBytes(seamless);
const story = await compose.staged(setting, wide, "story", palette);
const sb = compose.panelBox("story");
const row = Math.round(sb.top + sb.h / 2);
const px = async (x) => [...(await sharp(story).extract({ left: x, top: row, width: 1, height: 1 }).raw().toBuffer())];
const blue = (p) => p[2] > 150 && p[0] < 80;
const [edgeIn, inside, edgeOut] = [await px(sb.left + 6), await px(sb.left + 100), await px(sb.left + sb.w - 7)];
report(wide?.kind === "scene" && !blue(edgeIn) && blue(inside) && !blue(edgeOut), "a square picture in a tall frame keeps the whole product (nothing cropped off its sides)", `${wide?.kind}; edge ${edgeIn.join(",")}, inside ${inside.join(",")}, far edge ${edgeOut.join(",")}`);
const alone = await sharp(await compose.staged(null, product, "portrait", palette)).metadata();
report(alone.width === 1080 && alone.height === 1350, "without a setting, the product shows alone on the shop's ground, same size");
const pc = await compose.productCard(product, "square", palette);
const corner = await sharp(pc).extract({ left: 4, top: 4, width: 1, height: 1 }).raw().toBuffer();
const ground = compose.groundFor(palette);
const g = [1, 3, 5].map((i) => parseInt(ground.slice(i, i + 2), 16));
report(Math.max(...[0, 1, 2].map((i) => Math.abs(corner[i] - g[i]))) <= 6, "a product card puts the cut-out on the shop's own ground, not white", `${ground} vs rgb(${[...corner].join(",")})`);

// ---------- 8. what runs is what was checked ----------

const sets = read("lib/ads/sets.ts");
const launch = sets.match(/export async function launchPaused[\s\S]*?\n}\n/)?.[0] ?? "";
report(/adPictureViews\(/.test(launch) && /src\.portrait/.test(launch) && /src\.square/.test(launch) && !/images\[0\]/.test(launch),
  "ads are created on the platform with the same composed pictures the previews show, never a bare supplier photo");
report(/are still being made/.test(launch) && /couldn't be made/.test(launch), "real ads aren't created while a picture is missing; the page says why in plain words");
const route = read("app/api/ads/picture/[variationId]/[slot]/route.ts");
report(/plan\.photoUrl \? await loadPhoto\(plan\.photoUrl\) : item \? await photoFromBytes/.test(route), "the ad picture route shows a product only by its real photo or its practice picture");

// ---------- 9. previews and the storefront ----------

const preview = read("components/ads/ad-preview.tsx");
report(!/ProductArt|iconFor/.test(preview) && /Making this picture/.test(preview) && /picture-making/.test(preview), "ad previews never show a big icon on white; a picture being made shows a quiet panel that says so");
report(/Practice item/.test(preview) && /Practice ad/.test(preview), "practice ads and practice item pictures are labelled on the previews");
const css = read("app/globals.css");
report(/prefers-reduced-motion: reduce\)\s*{\s*\.picture-making::after\s*{\s*display: none/.test(css), "the placeholder's moving light stops for reduced motion");
const storefront = ["components/storefront/product-card.tsx", "app/s/[slug]/products/[handle]/page.tsx", "components/storefront/bag.tsx"].filter((p) => fs.existsSync(path.join(root, p)));
const leaks = storefront.filter((p) => /creative_pictures|creativeFile|\/api\/ads\/picture|storefrontImages|shop_images/.test(read(p)));
report(storefront.length === 3 && leaks.length === 0, "no ad picture or brand picture reaches a product card, product page or the bag", leaks.join(", "));
const socialJobs = read("lib/social/posts/jobs.ts");
report(/const picture = ref\?\.item \? "item" : s\.scene \? "scene" : null;/.test(socialJobs), "a slide gets a practice picture only from a practice item's offered name");
const handlerFor = read("lib/ai/jobs.ts").match(/function handlerFor[\s\S]*?\n}/)?.[0] ?? "";
report(/prefix\.length > best\[0\]\.length/.test(handlerFor), "a picture job's own handler wins over the brand pictures' (longest name first)");

// ---- pictures that failed because ChatGPT was down are asked for again, later ----
{
  const creative = await import("../lib/creative/pictures.ts");
  const slot = (o) => ({ cuts: {}, alt: "", making: false, failed: false, tried: false, retry: false, ...o });
  report(creative.needsAsking(undefined) && creative.needsAsking(slot({})), "a picture never asked for is asked for");
  report(!creative.needsAsking(slot({ tried: true, failed: true })), "a picture that failed for its own reasons isn't asked for by itself");
  report(creative.needsAsking(slot({ tried: true, failed: true, retry: true })), "a picture that failed only because ChatGPT was down is asked for again");
  report(!creative.needsAsking(slot({ tried: true, making: true, retry: true })), "…but not while one is being made");
  report(!creative.needsAsking(slot({ tried: true, failed: true, retry: true, cuts: { square: { id: "x", width: 1, height: 1 } } })), "…and not when it already has a picture");
  const down = [
    "The ChatGPT tool on the helper computer isn't signed in. Sign in once with: codex login",
    "ChatGPT isn't answering right now (a problem on OpenAI's side). Armada tries again later.",
    "The AI took too long to answer.",
  ];
  report(down.every((m) => creative.AI_DOWN.test(m)), "ChatGPT being down or unreachable counts as not the picture's fault");
  report(!creative.AI_DOWN.test("The AI couldn't finish: content policy") && !creative.AI_DOWN.test("The picture came back empty."), "refusals and bad pictures don't count");
  report(creative.RETRY_AFTER_MS >= 10 * 60_000, "an outage isn't hammered: a failed picture waits at least 10 minutes");
  report(/ensureShopPostPictures\(session\.workspaceId, shop\.id\)/.test(read("app/(app)/social/page.tsx")), "opening a shop's posts asks for missing pictures again, as the ads page does");
}

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll picture checks passed.");
process.exit(failures ? 1 : 0);
