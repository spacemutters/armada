// Checks the shop builder's craft guidance and the brand-image pipeline. Prints one PASS/FAIL line per
// check and exits 1 on any FAIL.
//
//   node scripts/check-shop-images.mjs          offline: no network, no AI calls
//   node scripts/check-shop-images.mjs --live   also makes ONE real picture through ChatGPT's image
//                                               maker on this PC (the owner's ChatGPT plan) and saves
//                                               the cuts in .shots/brand/
//
// What it guards:
// - the craft blocks stay short and keep the honesty lines (no invented reviews or pressure; brand
//   pictures never show a product the shop sells)
// - image jobs run on the ChatGPT tool with a model that can reach the image tool under the lockdown
// - the helper's image command switches on the image tool and nothing else; text jobs keep it off
// - pictures are cut to the asked sizes, never enlarged, and compressed under their budgets
// - the storefront never puts a brand picture on a product card or a product page

import fs from "node:fs";
import { registerHooks } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const live = process.argv.includes("--live");

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
    if (specifier === "server-only") return { url: pathToFileURL(path.join(root, "node_modules", "server-only", "empty.js")).href, shortCircuit: true };
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

const craft = await import("../lib/shops/craft.ts");
const config = await import("../lib/ai/config.ts");
const engines = await import("../helper/engines.mjs");
const images = await import("../lib/shops/images.ts");
const sharp = (await import("sharp")).default;

// ---------- 1. the craft blocks ----------

const words = (s) => s.split(/\s+/).filter(Boolean).length;
for (const name of ["BRAND_CRAFT", "CONVERSION_CRAFT", "IMAGE_CRAFT"]) {
  const n = words(craft[name]);
  report(n <= 360, `${name} stays short (sent with every call)`, `${n} words`);
}
report(/never show a product the shop sells/i.test(craft.IMAGE_CRAFT), "IMAGE_CRAFT: brand pictures never show a product the shop sells");
report(/no face toward the camera/i.test(craft.IMAGE_CRAFT) && /never text/i.test(craft.IMAGE_CRAFT), "IMAGE_CRAFT: no faces to camera, no text in pictures");
report(/never write reviews/i.test(craft.CONVERSION_CRAFT) && /countdowns/.test(craft.CONVERSION_CRAFT) && /crossed-out prices/.test(craft.CONVERSION_CRAFT),
  "CONVERSION_CRAFT: no invented reviews, discounts or pressure");
report(/only from the data and facts/i.test(craft.CONVERSION_CRAFT), "CONVERSION_CRAFT: every claim still comes from the data");
const sys = "Rules.\nAnswer only with JSON that matches the schema you are given.";
const withBoth = craft.withCraft(sys, ["conversion", "brand"]);
report(withBoth.trimEnd().endsWith("Answer only with JSON that matches the schema you are given."), "withCraft keeps the JSON rule last");
report(withBoth.indexOf("Brand craft") < withBoth.indexOf("Conversion craft"), "withCraft puts brand before conversion");
report(craft.withCraft(withBoth, ["brand", "conversion"]) === withBoth, "withCraft never adds a block twice");
report(craft.withCraft(sys, []) === sys, "withCraft with no parts leaves the prompt alone");

// ---------- 2. routing ----------

const kinds = ["images.hero", "images.collection", "images.lifestyle"];
report(kinds.every((k) => config.engineFor(k) === "codex"), "image jobs run on the ChatGPT tool (codex)", kinds.map((k) => config.engineFor(k)).join(","));
// gpt-6 and gpt-5.6 only reach tools through Codex's code-mode host, which the helper keeps off.
let codeModeOnly = (m) => /^gpt-(6|5\.6)/.test(m);
try {
  const cache = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".codex", "models_cache.json"), "utf8"));
  const bySlug = new Map((cache.models ?? []).map((m) => [m.slug, m]));
  if (bySlug.size) codeModeOnly = (m) => (bySlug.has(m) ? bySlug.get(m).tool_mode === "code_mode_only" : /^gpt-(6|5\.6)/.test(m));
} catch {}
const models = kinds.map((k) => config.modelFor(k));
report(models.every((m) => !codeModeOnly(m)),
  "image jobs use a model that can reach the image tool with the lockdown on",
  models.every((m) => !codeModeOnly(m)) ? models.join(",") : `${models.join(",")}: add "images.hero", "images.collection" and "images.lifestyle": "gpt-5.5" to AI_MODELS in lib/ai/config.ts`);

// ---------- 3. the helper's image command ----------

const shop = {
  niche: "Home workout gear for small spaces",
  brief: { niche: "Home workout gear for small spaces", audience: "", country: "United States", priceFeel: "mid", productCount: 12, look: "", source: "practice" },
  blueprint: {
    brand: { name: "Alcove", alternativeNames: [], tagline: "Home workout gear that puts away easily", voice: "Talks plainly about size, weight and storage.", audience: "Apartment renters who train in a living room.", monogramIcon: "dumbbell" },
    theme: { palette: { background: "#eceeed", surface: "#f8f9f7", ink: "#1d2326", muted: "#565f63", accent: "#6b3fa0", accentInk: "#ffffff" }, fonts: { display: "Familjen Grotesk", body: "Figtree" }, contrastFixes: [] },
    hero: { headline: "A full workout in your living room", subhead: "Bands, adjustable weights and folding mats for apartment workouts that put away in a closet.", cta: "Shop the gear" },
    collections: [
      { handle: "strength", title: "Strength", description: "Adjustable weights and bands for building strength in a small footprint.", keywords: ["adjustable dumbbell", "kettlebell", "resistance bands"], productIds: ["a"] },
      { handle: "floor-work", title: "Floor work", description: "Mats and props for stretching, core and mobility sessions on the floor.", keywords: ["exercise mat", "yoga block", "foam roller"], productIds: ["b"] },
      { handle: "cardio", title: "Cardio", description: "Quiet cardio tools that work in an apartment.", keywords: ["jump rope", "step platform"], productIds: ["c"] },
      { handle: "put-away", title: "Put away", description: "Storage pieces that keep gear out of sight.", keywords: ["storage rack"], productIds: [] },
    ],
    searchTerms: ["adjustable dumbbell", "resistance bands set", "exercise mat", "foam roller", "jump rope"],
  },
};
const heroSlot = { key: "hero", kind: "hero" };
const coverSlot = { key: "collection:strength", kind: "collection", collection: shop.blueprint.collections[0] };
const heroInput = images.imageJobInput(shop, heroSlot);
const coverInput = images.imageJobInput(shop, coverSlot);
report(!("model" in heroInput), "an image job carries no model of its own (the config decides)");
report(heroInput.system.includes(craft.IMAGE_CRAFT.split("\n")[1]) && /Answer only with JSON/.test(heroInput.system.trim().split("\n").at(-1)),
  "an image job's instructions carry the image craft, JSON rule last");
report(/None of these, and nothing that looks like one, may appear: .*adjustable dumbbell.*jump rope/.test(heroInput.prompt), "the brief names the shop's product kinds as things that must not appear");
report(/Wide 3:2/.test(heroInput.prompt) && /left 40%/.test(heroInput.prompt), "the hero brief asks for wide 3:2 with room for the headline");
report(/Square 1:1/.test(coverInput.prompt) && /"Strength"/.test(coverInput.prompt) && /without showing any of its products/.test(coverInput.prompt), "a cover brief is square and names its collection");
report(engines.isImageJob(heroInput) && !engines.isImageJob({ system: "x", prompt: "y" }), "the helper tells image jobs from text jobs");
const outs = engines.imageOutputs(heroInput);
report(JSON.stringify(outs.map((o) => [o.name, o.width, o.height, o.format])) === JSON.stringify([["wide", 1600, 900, "webp"], ["tall", 1080, 1350, "webp"], ["og", 1200, 630, "jpeg"]]),
  "the hero is cut wide 1600x900, tall 1080x1350 and link preview 1200x630", JSON.stringify(outs.map((o) => `${o.name} ${o.width}x${o.height}`)));
const odd = engines.imageOutputs({ image: { outputs: [{ name: "../x", width: 10, height: 10 }, { name: "big", width: 9000, height: 100 }, { name: "ok", width: 100, height: 100 }] } });
report(odd.length === 1 && odd[0].name === "ok", "sizes outside the limits, or odd names, are refused");

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "armada-image-check-"));
try {
  const { args, files } = engines.codexCommand({ ...heroInput, engine: "codex", model: "gpt-5.5" }, scratch, { imageTool: true });
  const disabled = new Set(args.filter((_, i) => args[i - 1] === "--disable"));
  const enabled = args.filter((_, i) => args[i - 1] === "--enable");
  report(JSON.stringify(enabled) === JSON.stringify(["image_generation"]), "image job: exactly one tool switched on, the image maker", enabled.join(","));
  report(!disabled.has("image_generation") && engines.CODEX_DISABLED_FEATURES.filter((f) => f !== "image_generation").every((f) => disabled.has(f)),
    "image job: every other tool stays off (commands, files, browser, apps, plugins...)");
  report(args.includes("--sandbox") && args[args.indexOf("--sandbox") + 1] === "read-only" && args.includes("--ignore-user-config") && args.includes("--ephemeral"),
    "image job: read-only sandbox, no user settings, no saved session");
  report(!args.some((a) => /danger|workspace-write|--add-dir|--full-auto/.test(a)), "image job: nothing that widens access");
  const instr = fs.readFileSync(files.instructions, "utf8");
  report(instr.includes(engines.CODEX_IMAGE_NOTE.trim()) && !instr.includes(engines.CODEX_NOTE.trim()), "image job: told its only tool is the image maker");
  const text = engines.codexCommand({ engine: "codex", system: "s", prompt: "p", schema: { type: "object" }, model: "gpt-6-sol" }, path.join(scratch, "t"));
  const textDisabled = new Set(text.args.filter((_, i) => text.args[i - 1] === "--disable"));
  report(textDisabled.has("image_generation") && !text.args.includes("--enable"), "text jobs keep the image maker off, as before");
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
report(engines.codexImagesDir("../../etc") === null && engines.codexImagesDir("01a0d6c9-06e4-7fa0-b277-e33aa4c6c4f4")?.endsWith(path.join(".codex", "generated_images", "01a0d6c9-06e4-7fa0-b277-e33aa4c6c4f4")),
  "the helper only ever reads (and deletes) the run's own picture folder");
report(engines.codexThreadId('{"type":"thread.started","thread_id":"abc12345-1"}\n{"type":"turn.started"}') === "abc12345-1", "the run's thread id is read from Codex's events");
const wrongEngine = await engines.runJob({ claude: "claude.exe", codex: "codex.exe" }, { ...heroInput, engine: "claude" });
report(!wrongEngine.ok && /ChatGPT tool/.test(wrongEngine.error), "an image job sent to the Claude tool fails plainly");

// ---------- 4. cutting and compressing ----------

const w = 1536, h = 1024;
const noise = Buffer.alloc(w * h * 3);
for (let i = 0; i < noise.length; i++) noise[i] = (Math.sin(i * 0.013) * 60 + 128 + ((i * 2654435761) % 61)) & 255;
const sample = path.join(os.tmpdir(), `armada-image-check-${process.pid}.png`);
await sharp(noise, { raw: { width: w, height: h, channels: 3 } }).png().toFile(sample);
try {
  const { files, source } = await engines.renderImageOutputs(sample, outs);
  report(source.width === w && source.height === h, "the picture's own size is read", `${source.width}x${source.height}`);
  const byName = Object.fromEntries(files.map((f) => [f.name, f]));
  const within = (f, o) => f.width <= o.width && f.height <= o.height && Math.abs(f.width / f.height - o.width / o.height) < 0.01;
  report(outs.every((o) => byName[o.name] && within(byName[o.name], o)), "every cut has the asked shape and is never enlarged",
    files.map((f) => `${f.name} ${f.width}x${f.height}`).join(", "));
  report(files.every((f) => f.bytes <= outs.find((o) => o.name === f.name).maxBytes), "every cut is under its byte budget, even from a very busy picture",
    files.map((f) => `${f.name} ${f.width}x${f.height} ${Math.round(f.bytes / 1024)} KB`).join(", "));
  const magic = (f) => {
    const b = Buffer.from(f.data, "base64");
    return f.type === "image/webp" ? b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP" : b[0] === 0xff && b[1] === 0xd8;
  };
  report(files.every(magic), "the files really are WebP (and JPEG for link previews)");
} finally {
  fs.rmSync(sample, { force: true });
}

// ---------- 5. the storefront's honesty line ----------

const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const productSurfaces = ["components/storefront/product-card.tsx", "app/s/[slug]/products/[handle]/page.tsx", "components/storefront/bag.tsx"];
const leaks = productSurfaces.filter((p) => /storefrontImages|BrandPicture|\/api\/img\/|shop_images/.test(read(p)));
report(leaks.length === 0, "no brand picture on product cards, product pages or the bag", leaks.join(", "));
const home = read("app/s/[slug]/page.tsx");
report(/async function heroFor/.test(home) && /<CountView slug=\{slug\} \/>/.test(home) && /Showing \{previewing === "b"/.test(home), "the headline test (heroFor, CountView, preview pill) is still on the home page");
const css = read("app/s/storefront.css");
report(/prefers-reduced-motion: reduce[\s\S]*sf-sticky-buy/.test(css), "the storefront's motion stops for reduced motion, the sticky bar included");
report(!/#000\b|#fff\b|#000000|#ffffff/i.test(css), "no pure black or white in the storefront styles");

// ---------- 6. live (optional): one real picture ----------

if (live) {
  const exe = engines.findCodex();
  report(Boolean(exe), "live: found codex.exe", exe ?? "not found");
  if (exe) {
    const model = codeModeOnly(config.modelFor("images.hero")) ? "gpt-5.5" : config.modelFor("images.hero");
    const r = await engines.runJob({ codex: exe }, { ...heroInput, engine: "codex", model });
    report(r.ok && r.files?.length === 3, "live: one hero picture made and cut three ways", r.ok ? `${Math.round(r.usage.ms / 1000)}s, ${r.files.map((f) => `${f.name} ${f.width}x${f.height} ${Math.round(f.bytes / 1024)} KB`).join(", ")}` : r.error);
    if (r.ok) {
      const out = path.join(root, ".shots", "brand");
      fs.mkdirSync(out, { recursive: true });
      for (const f of r.files) fs.writeFileSync(path.join(out, `live-hero-${f.name}.${f.type === "image/jpeg" ? "jpg" : "webp"}`), Buffer.from(f.data, "base64"));
      fs.writeFileSync(path.join(out, "live-hero-answer.json"), JSON.stringify({ model, output: r.output, usage: r.usage }, null, 2));
      console.log(`     saved in ${out}`);
      report(typeof r.output?.prompt === "string" && r.output.prompt.length > 40 && typeof r.output?.alt === "string" && r.output.alt.length > 5,
        "live: the AI says what prompt it used and writes alt text");
    }
  }
}

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll shop image checks passed.");
process.exit(failures ? 1 : 0);
