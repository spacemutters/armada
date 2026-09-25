import { SYSTEM } from "@/lib/shops/prompts";
import type { Blueprint } from "@/lib/shops/types";
import { CARDS, CTAS, LIMITS, SCENES_PER_AD } from "./schema";

// What the AI is told when it writes a shop's ads ("ads.write"). It starts from the shop builder's own
// honesty rules (SYSTEM: nothing invented, no hype, no brands the shop doesn't own) and adds the rules
// ads need: claims only from the product data and the shop's facts, no made-up offers or urgency, and
// nothing that tells the reader what they are (platform rules forbid it).

export const ADS_SYSTEM = `${SYSTEM}

You also write the shop's paid ads. When you write ads:
- Every claim comes from the product data or the shop facts you are given. Prices may be used exactly as listed.
- No discounts, sales, coupons, free shipping, gifts, countdowns, "limited", "last chance", "today only", or any other urgency or scarcity, unless it is listed as a shop fact.
- No reviews, star ratings, customer counts, "best-selling", "bestseller", "loved by", "trusted by" or "as seen in".
- No before-and-after, health, medical, weight, beauty-result or money-making claims.
- Never say or suggest you know something personal about the reader: their age, body, health, money, religion, beliefs, or anything they are struggling with. Describe the product and the moment it's for instead ("For long walks in wet weather", not "Tired of wet feet?").
- No hashtags, no emoji, no exclamation marks, no ALL CAPS, no clickbait questions.`;

export interface AdProduct {
  ref: string;
  title: string;
  priceCents: number;
  category: string;
  /** How many of its real photos Armada can show (0 to 3). */
  photos: number;
  /** A practice shop's imagined item: Armada makes a picture of it, since it has no photo. */
  practiceItem: boolean;
  bullets: string[];
  description: string;
}

export interface AdContext {
  bp: Blueprint;
  country: string;
  /** "practice": practice ads; "real": the ads will be real, so every product shown needs a photo. */
  target: "practice" | "real";
  products: AdProduct[];
}

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

function shopLines(ctx: AdContext): string {
  const bp = ctx.bp;
  const f = bp.facts;
  const facts = f
    ? [
        `Ships to: ${f.country}`,
        `Delivery: ${f.deliveryMin} to ${f.deliveryMax} business days after a ${f.handlingDays}-day handling time`,
        `Returns: accepted within ${f.returnDays} days of delivery`,
      ]
    : [];
  return `- Name: ${bp.brand?.name}
- Tagline: ${bp.brand?.tagline}
- Voice: ${bp.brand?.voice}
- Who it's for: ${bp.brand?.audience}
- What it promises: ${(bp.valueProps ?? []).map((v) => `${v.title} (${v.body})`).join("; ") || "nothing stated"}
- Collections: ${(bp.collections ?? []).map((c) => c.title).join(", ") || "none"}
${facts.length ? `- Shop facts you may use: ${facts.join("; ")}` : "- There are no delivery or returns facts, so don't mention delivery or returns."}
- The ads run in: ${ctx.country}`;
}

function productLines(ctx: AdContext): string {
  return ctx.products
    .map((p) => {
      const details = [p.bullets.slice(0, 4).join("; "), p.description.replace(/\s+/g, " ").slice(0, 200)].filter(Boolean).join(" | ");
      const pictures = p.photos > 0 ? `photos: ${p.photos}` : p.practiceItem ? "photos: practice item (Armada makes its one picture)" : "photos: none";
      return `${p.ref} | ${p.title} | ${money(p.priceCents)} | ${p.category || "n/a"} | ${pictures} | ${details}`;
    })
    .join("\n");
}

const photoRule = (ctx: AdContext) =>
  ctx.target === "real" ? "Only show products that have photos; the others can't be used in ads." : "Only show products that have photos or are practice items.";

const perAdRules = (ctx: AdContext) => `For each ad:
- idea: what it tries, in one plain sentence a shop owner would understand, at most 12 words.
- format: "single" (one product, its real photo set in a scene) or "carousel" (${CARDS.min} to ${CARDS.max} cards people swipe through).
- primaryText: the words above the picture. The first ${LIMITS.primaryShown} characters must work on their own, because that is all most people see. At most ${LIMITS.primaryText} characters in total.
- headline: at most ${LIMITS.headline} characters.
- description: at most ${LIMITS.description} characters: a plain fact from the list (a price, the delivery time, the returns window) or an empty string.
- callToAction: one of ${CTAS.join(", ")}.
- products: the refs shown (p1, p2 …). A single-photo ad shows the first one. ${photoRule(ctx)}
- scene: for a single-photo ad, the setting its product photo is placed in: a specific place, surface and light in at most 20 words ("a pale oak counter by a window at 7 a.m."), with no product, no text and no faces in it. For a carousel, "".
- cards: for a single-photo ad, an empty list. For a carousel, ${CARDS.min} to ${CARDS.max} cards in the order people swipe them. Each card is one of:
  - a product card: show is its ref ("p2"), photo is which of its photos (1 is the first; a practice item has only 1), scene is "". The same product may appear twice only with a different photo.
  - a scene card: show is "scene", photo is 0, scene is what its picture shows in at most 20 words: the moment or place the products are for, with no product of the shop's kinds, no text and no faces toward the camera. Armada has ChatGPT make it. At most ${SCENES_PER_AD} scene cards, and at least two product cards.
  Every card: headline at most ${LIMITS.cardHeadline} characters, description at most ${LIMITS.cardDescription} characters (the listed price is fine on a product card). A strong carousel often opens on a scene that stops the scroll and then shows the products.`;

export function adsPrompt(ctx: AdContext): string {
  return `Write paid ads for the shop "${ctx.bp.brand?.name}". They appear in Facebook and Instagram feeds and as full-screen cards between short videos, so the first line has to stop someone scrolling on its own, without tricks.

The shop
${shopLines(ctx)}

Products (ref | title | price | category | photos | facts)
${productLines(ctx)}

Write 3 to 5 ads. Each tries a genuinely different idea, for example: one standout product and what it does; a small set that belongs together, as a carousel; who it's for and the everyday moment it helps with; a concrete detail such as a material, size or what's included. Include at least one carousel and at least one single-photo ad.

Pictures: a product is always shown by its own real photo (or a practice item's one picture); ChatGPT only makes the scenes you describe, which never show a product. Describe scenes the way a photographer would brief a shoot, in the shop's look.

${perAdRules(ctx)}

audience: who to show the ads to.
- description: one or two plain sentences a shop owner would understand. No jargon.
- ageMin and ageMax: whole numbers between 18 and 65.
- interests: up to 6 short, plain interests people might follow (for example "home cooking", "trail running"). No brand names.

budget: a starting budget for a first test that finds out which ad works.
- dailyAmount: US dollars a day, between 5 and 200. Small shops usually start between 10 and 30.
- days: how many days to run the first test, between 3 and 30. Seven is typical.
- reasoning: two plain sentences on why this amount for this long is enough to learn which ad works, with the product prices in mind. Don't use jargon such as CPM, CPC, CTR, ROAS or conversion rate.

plan: one plain sentence that sums up the ads.`;
}

export interface ExistingAd {
  idea: string;
  format: "single" | "carousel";
  primaryText: string;
  headline: string;
}

export function rewritePrompt(ctx: AdContext, replacing: ExistingAd, others: ExistingAd[]): string {
  const line = (a: ExistingAd) => `- (${a.format === "carousel" ? "carousel" : "single photo"}) ${a.idea}: "${a.headline}" / "${a.primaryText.slice(0, 120)}"`;
  return `Write one new ad for the shop "${ctx.bp.brand?.name}" to replace an ad its owner wants written again. It appears in Facebook and Instagram feeds and as a full-screen card between short videos.

The shop
${shopLines(ctx)}

Products (ref | title | price | category | photos | facts)
${productLines(ctx)}

The ad being replaced (try a different idea and different words; you may keep its format or change it):
${line(replacing)}
${others.length ? `\nThe shop's other ads, which the new one must not repeat or lightly reword:\n${others.map(line).join("\n")}\n` : ""}
${perAdRules(ctx)}

Answer with the new ad in "ad".`;
}
