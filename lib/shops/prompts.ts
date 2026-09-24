import { ART_ICONS, BODY_FONTS, DISPLAY_FONTS } from "./style";
import type { Blueprint, ShopBrief } from "./types";
import type { CatalogItem } from "@/lib/types";

// What the AI is told when it builds a shop. The rules in SYSTEM are the honesty line:
// nothing invented, no hype, no brands the shop doesn't own.

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
valueProps: three promises a dropshipping shop can actually keep, such as a tight, well-chosen range, clear returns within the stated window, or secure checkout. Never promise fast shipping, handmade goods, local production, testing, certifications or guarantees.
collections: 3 or 4 collections that organize ${b.productCount} products. Each has a title of at most 3 words, a one-sentence description, and 2-6 keywords.
searchTerms: 4-12 short, plain product words to search a supplier catalog with (for example "dog harness", "slow feeder bowl"). No brand names.
monogramIcon: the one icon from the list that best stands for the shop.`;
}

// Step 2: pick and write products ------------------------------------------------------

const productItem = {
  type: "object",
  additionalProperties: false,
  required: ["candidateId", "collection", "title", "description", "bullets", "seoTitle", "seoDescription"],
  properties: {
    candidateId: str,
    collection: str,
    title: str,
    description: str,
    bullets: strList(3, 5),
    seoTitle: str,
    seoDescription: str,
  },
};

const imaginedItem = {
  type: "object",
  additionalProperties: false,
  required: ["collection", "title", "category", "description", "bullets", "estimatedCostUsd", "icon"],
  properties: {
    collection: str,
    title: str,
    category: str,
    description: str,
    bullets: strList(3, 5),
    estimatedCostUsd: { type: "number" },
    icon: { type: "string", enum: [...ART_ICONS] },
  },
};

export function productsSchema(allowImagined: boolean) {
  return {
    type: "object",
    additionalProperties: false,
    required: allowImagined ? ["products", "imagined"] : ["products"],
    properties: allowImagined
      ? { products: { type: "array", items: productItem }, imagined: { type: "array", items: imaginedItem } }
      : { products: { type: "array", items: productItem } },
  };
}

function candidateLine(c: CatalogItem): string {
  const days = c.shipDaysMax ? `${c.shipDaysMin ?? c.shipDaysMax}-${c.shipDaysMax} days` : "unknown";
  const details = c.description.replace(/\s+/g, " ").slice(0, 220);
  return `${c.id} | ${c.title} | ${c.category} | $${(c.costCents / 100).toFixed(2)} | ${days} | ${c.rating ?? "n/a"} | ${details}`;
}

export function productsPrompt(b: ShopBrief, bp: Blueprint, candidates: CatalogItem[], allowImagined: boolean): string {
  const cols = (bp.collections ?? []).map((c, i) => `${i + 1}. ${c.title}: ${c.description}`).join("\n");
  const imagined = allowImagined
    ? `

This is a practice shop. If fewer than ${b.productCount} candidates are a good fit, fill the gap in "imagined" with realistic items this shop could stock: title, category, the same writing rules, a typical wholesale cost in US dollars (estimatedCostUsd), and the icon that best shows the item. Imagined items are labeled as practice items in the shop, so keep them ordinary and believable. If the candidates already fill the shop, return an empty "imagined" list.`
    : "";
  return `Choose and write the products for the shop "${bp.brand?.name}".

Tagline: ${bp.brand?.tagline}
Voice: ${bp.brand?.voice}
Audience: ${bp.brand?.audience}
Collections (use these exact titles in "collection"):
${cols}

Pick up to ${b.productCount} products from the supplier candidates below that fit this shop well, and spread them across the collections. Skip anything that fits poorly, names a brand, or would need claims the data doesn't support. Use each candidate's id exactly as given in "candidateId".

For each chosen product write:
- title: what it is, plain and specific, at most 60 characters, no brand names
- description: two short paragraphs, 50-100 words in total, using only facts from the candidate's data plus plainly stated uses
- bullets: 3-5 short facts from the data, such as material, size or what's included. Never invented.
- seoTitle: at most 60 characters
- seoDescription: at most 155 characters

Candidates (id | title | category | supplier cost | delivery | rating | details):
${candidates.map(candidateLine).join("\n") || "(none found)"}${imagined}`;
}

// Step 3: pages and policies -----------------------------------------------------------

export const pagesSchema = {
  type: "object",
  additionalProperties: false,
  required: ["about", "faq", "shippingPage", "contactPage", "refundPolicy", "shippingPolicy", "announcement", "footerBlurb", "seoTitle", "seoDescription"],
  properties: {
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

export function pagesPrompt(bp: Blueprint): string {
  const f = bp.facts!;
  return `Write the pages for the shop "${bp.brand?.name}". Voice: ${bp.brand?.voice}

Facts to use exactly as stated, never changed or improved:
- Ships to: ${f.country}
- Orders are processed within ${f.handlingDays} business days
- Delivery takes ${f.deliveryMin}-${f.deliveryMax} business days after dispatch
- Returns: accepted within ${f.returnDays} days of delivery for unused items in their original packaging. The customer pays return shipping unless the item arrived damaged or was the wrong item, in which case the shop covers it.
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
- seoTitle: home page title, at most 60 characters. seoDescription: at most 155 characters.`;
}
