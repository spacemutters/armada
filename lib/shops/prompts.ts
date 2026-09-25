import { z } from "zod";
import { mentionsBrand } from "@/lib/brands";
import { scoreCatalogItem } from "@/lib/products/score-item";
import { clip } from "@/lib/text";
import type { CatalogItem } from "@/lib/types";
import { ART_ICONS, BODY_FONTS, DISPLAY_FONTS } from "./style";
import { proposalTarget, type Blueprint, type Proposal, type ShopBrief } from "./types";

// What the AI is told when it builds a shop, and how its product answer is read back. The rules in
// SYSTEM are the honesty line: nothing invented, no hype, no brands the shop doesn't own.
// No database and no server-only imports, so scripts/check-chooser.mjs can load this file offline.

export const SYSTEM = `You are the shop designer inside Armada, a tool that builds and runs online shops. You write like a restrained, senior brand studio: specific, concrete and calm.

Rules you always follow:
- No hype words (elevate, unleash, game-changer, revolutionary, must-have, ultimate, perfect, premium quality, luxurious), no emoji, no exclamation marks, no ALL CAPS.
- Never invent facts. Materials, sizes, features and specs come only from the product data you are given. If the data doesn't say it, don't say it.
- Never invent a history, founder story, awards, press mentions, reviews, testimonials, certifications, warranties or delivery promises.
- Never name a brand the shop doesn't own, and never describe a product as a copy, dupe or alternative of a brand.
- American English. Sentence case for headings and titles.
Answer only with JSON that matches the schema you are given.`;

const PRICE_WORDS: Record<ShopBrief["priceFeel"], string> = {
  budget: "everyday prices",
  mid: "considered, mid-range prices",
  premium: "premium prices",
  luxury:
    "a premium brand: prices several times the cost, earned only by a clear brand, beautiful presentation and generous true terms (60-day returns the shop pays for). Choose products whose materials and make can carry that price, and describe them with quiet confidence; never fake discounts, reviews, scarcity or claims the data doesn't support",
};

const str = { type: "string" } as const;
const strList = (min: number, max: number) => ({ type: "array", minItems: min, maxItems: max, items: str });

// Step 1: brand, look and plan -------------------------------------------------------

export const conceptSchema = {
  type: "object",
  additionalProperties: false,
  required: ["brandName", "alternativeNames", "tagline", "voice", "audience", "palette", "fonts", "hero", "valueProps", "collections", "searchTerms", "monogramIcon"],
  properties: {
    brandName: str,
    alternativeNames: strList(2, 2),
    tagline: str,
    voice: str,
    audience: str,
    palette: {
      type: "object",
      additionalProperties: false,
      required: ["background", "surface", "ink", "muted", "accent", "accentInk"],
      properties: { background: str, surface: str, ink: str, muted: str, accent: str, accentInk: str },
    },
    fonts: {
      type: "object",
      additionalProperties: false,
      required: ["display", "body"],
      properties: { display: { type: "string", enum: [...DISPLAY_FONTS] }, body: { type: "string", enum: [...BODY_FONTS] } },
    },
    hero: {
      type: "object",
      additionalProperties: false,
      required: ["headline", "subhead", "cta"],
      properties: { headline: str, subhead: str, cta: str },
    },
    valueProps: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: { type: "object", additionalProperties: false, required: ["title", "body"], properties: { title: str, body: str } },
    },
    collections: {
      type: "array",
      minItems: 3,
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "description", "keywords"],
        properties: { title: str, description: str, keywords: strList(2, 6) },
      },
    },
    searchTerms: strList(4, 12),
    monogramIcon: { type: "string", enum: [...ART_ICONS] },
  },
} as const;

export function conceptPrompt(b: ShopBrief): string {
  return `Design a new online shop.

What it sells: ${b.niche}
Who it's for: ${b.audience || "decide the most promising audience for this"}
Country it sells to: ${b.country}
Price level: ${PRICE_WORDS[b.priceFeel]}
Look and feel: ${b.look || "decide from the products and the audience"}
Number of products at launch: ${b.productCount}

brandName: one or two words, easy to say and spell, not the name of any existing well-known brand, no filler like "shop", "store", "co" or "hub". alternativeNames: two more options in the same spirit.
tagline: at most 8 words.
voice: one sentence describing how the shop talks.
audience: one sentence naming who buys and why.

palette: six hex colors (like #1f2a24), taken from the materials and setting of what this shop sells (for example raw oak and linen for home goods, chalk and rubber for a gym brand). background and surface are light unless the look asks for dark. ink must read on background at 7:1 contrast or better, muted at 4.5:1, and accentInk on accent at 4.5:1. The accent colors buttons and links only. Avoid these overused looks: warm cream with a terracotta accent and a high-contrast serif; near-black with an acid-green or vermilion accent; beige on beige.
fonts: one display font and one body font from the allowed lists that suit the brand.
hero: headline of at most 8 words, subhead of at most 20 words, cta (button label) of at most 3 words.
valueProps: three promises a dropshipping shop can actually keep, such as a tight, well-chosen range, what the products make easier, or clear returns within the stated window. Not "secure checkout": checkout may not be switched on. Never promise fast shipping, handmade goods, local production, testing, certifications or guarantees.
collections: 3 or 4 collections that organize ${b.productCount} products. Each has a title of at most 3 words, a one-sentence description, and 2-6 keywords.
searchTerms: 4-12 short, plain product words to search a supplier catalog with (for example "dog harness", "slow feeder bowl"). No brand names.
monogramIcon: the one icon from the list that best stands for the shop.`;
}

// Step 2: propose and write products ---------------------------------------------------
// The AI proposes twice as many products as the shop will sell, best fit first; the owner then
// chooses which ones go in (or lets the AI's first ones go in).

const productItem = {
  type: "object",
  additionalProperties: false,
  required: ["candidateId", "collection", "title", "description", "bullets", "seoTitle", "seoDescription", "why"],
  properties: {
    candidateId: str,
    collection: str,
    title: str,
    description: str,
    bullets: strList(3, 5),
    seoTitle: str,
    seoDescription: str,
    why: str,
  },
};

const imaginedItem = {
  type: "object",
  additionalProperties: false,
  required: ["collection", "title", "category", "description", "bullets", "estimatedCostUsd", "icon", "why"],
  properties: {
    collection: str,
    title: str,
    category: str,
    description: str,
    bullets: strList(3, 5),
    estimatedCostUsd: { type: "number" },
    icon: { type: "string", enum: [...ART_ICONS] },
    why: str,
  },
};

/** The answer's shape. `target` is how many products the AI proposes in all (see proposalTarget). */
export function productsSchema(allowImagined: boolean, target: number) {
  const list = (items: object) => ({ type: "array", maxItems: target, items });
  return {
    type: "object",
    additionalProperties: false,
    required: allowImagined ? ["products", "imagined"] : ["products"],
    properties: allowImagined ? { products: list(productItem), imagined: list(imaginedItem) } : { products: list(productItem) },
  };
}

function candidateLine(c: CatalogItem): string {
  const days = c.shipDaysMax ? `${c.shipDaysMin ?? c.shipDaysMax}-${c.shipDaysMax} days` : "unknown";
  const details = c.description.replace(/\s+/g, " ").slice(0, 220);
  return `${c.id} | ${c.title} | ${c.category} | $${(c.costCents / 100).toFixed(2)} | ${days} | ${c.rating ?? "n/a"} | ${details}`;
}

export function productsPrompt(b: ShopBrief, bp: Blueprint, candidates: CatalogItem[], allowImagined: boolean): string {
  const target = proposalTarget(b.productCount, candidates.length, allowImagined);
  const cols = (bp.collections ?? []).map((c, i) => `${i + 1}. ${c.title}: ${c.description}`).join("\n");
  const imagined = allowImagined
    ? `

This is a practice shop. If fewer than ${target} candidates are a good fit, fill the gap in "imagined" with realistic items this shop could stock, so that "products" and "imagined" together hold ${target}: title, category, the same writing rules, a typical wholesale cost in US dollars (estimatedCostUsd), the icon that best shows the item, and why. List them best fit first too; they come after the real candidates. Imagined items are labeled as practice items in the shop, so keep them ordinary and believable. If the candidates already fill the list, return an empty "imagined" list.`
    : "";
  return `Propose and write products for the shop "${bp.brand?.name}". The shop will sell ${b.productCount} products. You propose ${target}, and the owner chooses the ${b.productCount} that go in.

Tagline: ${bp.brand?.tagline}
Voice: ${bp.brand?.voice}
Audience: ${bp.brand?.audience}
Collections (use these exact titles in "collection"):
${cols}

Propose ${target} products from the supplier candidates below that fit this shop well (fewer only if not enough fit), best fit first. Make the first ${b.productCount} on their own a balanced shop spread across the collections, because an owner who doesn't want to choose gets exactly those. Skip anything that fits poorly, names a brand, or would need claims the data doesn't support. Use each candidate's id exactly as given in "candidateId", and each candidate at most once.

For each proposed product write:
- title: what it is, plain and specific, at most 60 characters, no brand names
- description: two short paragraphs, 50-100 words in total, using only facts from the candidate's data plus plainly stated uses
- bullets: 3-5 short facts from the data, such as material, size or what's included. Never invented.
- seoTitle: at most 60 characters
- seoDescription: at most 155 characters
- why: one plain sentence of at most 100 characters on why it suits this shop and its buyers, from the data only. No hype.

Candidates (id | title | category | supplier cost | delivery | rating | details):
${candidates.map(candidateLine).join("\n") || "(none found)"}${imagined}`;
}

/** The prompt and answer shape for the products step, with how many products it asks for. */
export function productsAsk(b: ShopBrief, bp: Blueprint, candidates: CatalogItem[], allowImagined: boolean) {
  const target = proposalTarget(b.productCount, candidates.length, allowImagined);
  return { target, prompt: productsPrompt(b, bp, candidates, allowImagined), schema: productsSchema(allowImagined, target) };
}

// Reading the products answer ------------------------------------------------------------

// Lenient readers for AI output: trim, cap lengths, and fall back rather than fail on style.
export const text = (max: number) => z.string().transform((s) => clip(s, max));
export const longText = (max: number) => z.string().transform((s) => s.trim().slice(0, max));

const ProductOut = z.object({
  candidateId: z.string(),
  collection: z.string(),
  title: text(70),
  description: longText(1200),
  bullets: z.array(text(140)).default([]),
  seoTitle: text(70),
  seoDescription: text(160),
  why: text(140).default(""),
});

const ImaginedOut = z.object({
  collection: z.string(),
  title: text(70),
  category: text(60),
  description: longText(1200),
  bullets: z.array(text(140)).default([]),
  estimatedCostUsd: z.number(),
  icon: z.string(),
  why: text(140).default(""),
});

export const ProductsAnswer = z.object({ products: z.array(ProductOut).default([]), imagined: z.array(ImaginedOut).default([]) });
export type ProductsAnswer = z.infer<typeof ProductsAnswer>;

/** A practice item the AI imagines ships like the practice catalog's. These price it and fill its catalog row. */
export const IMAGINED_ITEM = { shipCents: 499, shipDaysMin: 7, shipDaysMax: 14, stock: 250 } as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The candidate ids in an answer worth looking up: well formed, and among those the AI was shown (when known). */
export function answerIds(answer: ProductsAnswer, shown: readonly string[] | undefined): string[] {
  const allowed = shown ? new Set(shown) : null;
  return [...new Set(answer.products.map((p) => p.candidateId.trim()))].filter((id) => UUID.test(id) && (!allowed || allowed.has(id)));
}

/**
 * Turns the AI's answer into the cards the owner chooses from. Only real candidates are kept: an id
 * the AI made up, one it wasn't shown, a repeat, a branded item or a title naming a brand is dropped,
 * not trusted. Practice shops may fill the rest with imagined items. Prices and scores come from the
 * pricing rules, never the AI. At most `target`, ranked in the AI's order (real candidates first).
 */
export function buildProposals(
  answer: ProductsAnswer,
  items: ReadonlyMap<string, CatalogItem>,
  opts: {
    target: number;
    allowImagined: boolean;
    source: ShopBrief["source"];
    priceFeel: ShopBrief["priceFeel"];
    collections: { handle: string; title: string }[];
    shown?: readonly string[];
    newId?: () => string;
  },
): Proposal[] {
  const allowed = opts.shown ? new Set(opts.shown) : null;
  const collectionFor = (title: string) =>
    (opts.collections.find((c) => c.title.toLowerCase() === title.trim().toLowerCase()) ?? opts.collections[0])?.handle ?? "";
  const newId = opts.newId ?? (() => crypto.randomUUID());
  const out: Omit<Proposal, "rank">[] = [];
  const seen = new Set<string>();

  for (const p of answer.products) {
    if (out.length >= opts.target) break;
    const id = p.candidateId.trim();
    const item = items.get(id);
    if (!UUID.test(id) || seen.has(id) || !item || (allowed && !allowed.has(id))) continue;
    if (item.source !== opts.source || item.branded || mentionsBrand(p.title)) continue;
    seen.add(id);
    const { priceCents, shipEstimated, score, parts } = scoreCatalogItem(item, opts.priceFeel);
    const photo = item.images?.find((i) => i?.url && /^https?:\/\//.test(i.url));
    out.push({
      id,
      catalogItemId: id,
      title: p.title,
      description: p.description,
      bullets: p.bullets,
      seoTitle: p.seoTitle,
      seoDescription: p.seoDescription,
      why: p.why,
      collection: collectionFor(p.collection),
      priceCents,
      priceEstimated: shipEstimated,
      score,
      reasons: parts.reasons,
      image: photo ? { url: photo.url, alt: photo.alt ?? p.title } : null,
      icon: item.attributes?.art?.icon ?? null,
      imagined: null,
    });
  }

  if (opts.allowImagined) {
    for (const im of answer.imagined) {
      if (out.length >= opts.target) break;
      if (mentionsBrand(im.title)) continue;
      const costCents = Math.round(Math.min(500, Math.max(1, im.estimatedCostUsd)) * 100);
      const { priceCents, score, parts } = scoreCatalogItem(
        {
          source: "practice",
          costCents,
          shipCents: IMAGINED_ITEM.shipCents,
          shipDaysMax: IMAGINED_ITEM.shipDaysMax,
          stock: IMAGINED_ITEM.stock,
          rating: null,
          branded: false,
          retailSource: false,
          attributes: { imagined: true },
        },
        opts.priceFeel,
      );
      out.push({
        id: newId(),
        catalogItemId: null,
        title: im.title,
        description: im.description,
        bullets: im.bullets,
        seoTitle: im.title,
        seoDescription: null,
        why: im.why,
        collection: collectionFor(im.collection),
        priceCents,
        priceEstimated: false,
        score,
        reasons: parts.reasons,
        image: null,
        icon: (ART_ICONS as readonly string[]).includes(im.icon) ? im.icon : "package",
        imagined: { category: im.category, costCents },
      });
    }
  }

  return out.map((p, i) => ({ ...p, rank: i + 1 }));
}

// Step 3: pages and policies -----------------------------------------------------------

export const pagesSchema = {
  type: "object",
  additionalProperties: false,
  required: ["about", "faq", "shippingPage", "contactPage", "refundPolicy", "shippingPolicy", "announcement", "footerBlurb", "seoTitle", "seoDescription", "sets", "pairings"],
  properties: {
    sets: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "why", "products"],
        properties: { title: str, why: str, products: { type: "array", minItems: 2, maxItems: 3, items: str } },
      },
    },
    pairings: {
      type: "array",
      maxItems: 24,
      items: { type: "object", additionalProperties: false, required: ["product", "with", "why"], properties: { product: str, with: str, why: str } },
    },
    about: str,
    faq: {
      type: "array",
      minItems: 5,
      maxItems: 7,
      items: { type: "object", additionalProperties: false, required: ["question", "answer"], properties: { question: str, answer: str } },
    },
    shippingPage: str,
    contactPage: str,
    refundPolicy: str,
    shippingPolicy: str,
    announcement: str,
    footerBlurb: str,
    seoTitle: str,
    seoDescription: str,
  },
} as const;

export function pagesPrompt(bp: Blueprint, products: { handle: string; title: string; collection: string }[] = []): string {
  const f = bp.facts!;
  const returns = f.freeReturns
    ? `accepted within ${f.returnDays} days of delivery for unused items in their original packaging, and the shop pays for the return shipping.`
    : `accepted within ${f.returnDays} days of delivery for unused items in their original packaging. The customer pays return shipping unless the item arrived damaged or was the wrong item, in which case the shop covers it.`;
  return `Write the pages for the shop "${bp.brand?.name}". Voice: ${bp.brand?.voice}

Facts to use exactly as stated, never changed or improved:
- Ships to: ${f.country}
- Orders are processed within ${f.handlingDays} business days
- Delivery takes ${f.deliveryMin}-${f.deliveryMax} business days after dispatch
- Returns: ${returns}
- Support email: {{support_email}} (keep this placeholder exactly as written)
- Collections: ${(bp.collections ?? []).map((c) => c.title).join(", ")}

Write, using markdown where a page needs structure:
- about: 120-180 words on what the shop focuses on and how its range is chosen. No founder story, no history, no claims about testing or quality control.
- faq: 5-7 questions and answers that use only the facts above.
- shippingPage: the shipping and returns page, built from the facts.
- contactPage: a short contact page with the placeholder email and a reply time of 1-2 business days.
- refundPolicy: a plain-language refund policy draft built from the facts.
- shippingPolicy: a plain-language shipping policy draft built from the facts.
- announcement: one factual line for the top of every page, at most 60 characters.
- footerBlurb: one sentence for the footer.
- seoTitle: home page title, at most 60 characters. seoDescription: at most 155 characters.
${
  products.length
    ? `
The products, by handle:
${products.map((p) => `- ${p.handle}: ${p.title}${p.collection ? ` (${p.collection})` : ""}`).join("\n")}

Then, using only those handles:
- sets: up to 3 small sets of 2 or 3 products that are genuinely used together (a routine, a room, a gift). title: at most 5 words. why: one sentence on what the set does for the buyer. Armada prices each set a little below its items bought separately; never mention a price, a discount or savings. Leave the list empty if nothing truly belongs together.
- pairings: for products that go well with another one, the pair and why in one short phrase from their facts (for example "keeps the blade dry between uses"). At most 2 per product. Never say "frequently bought together", "popular" or "customers also bought": there's no data for that.`
    : ""
}`;
}
