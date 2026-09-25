import { SYSTEM } from "@/lib/shops/prompts";
import type { Blueprint } from "@/lib/shops/types";
import { HEADLINE_MAX, LINE_MAX, MAX_HASHTAGS, MAX_SCENES_PER_POST, MAX_SLIDES, MIN_HASHTAGS, MIN_SLIDES, PHOTOS_PER_PRODUCT } from "./schema";

// What the AI is told when it writes carousel posts for a shop. It gets the shop builder's honesty
// rules (SYSTEM) word for word, the shop's own brand and products, and a short list of named photos
// it may put on slides. It never sees a photo address, so it can't invent one.

export { SYSTEM };

export interface PromptProduct {
  id: string;
  title: string;
  collection: string;
  bullets: string[];
  description: string;
  images: { url: string }[];
  /** A practice item made up for a practice shop. */
  imagined: boolean;
}

export interface PhotoRef {
  productId: string;
  /** The product's real photo; null for a practice item, whose one picture Armada has ChatGPT make. */
  url: string | null;
  title: string;
  /** A practice item's picture (practice shops only). */
  item?: boolean;
}

/**
 * Short names for the shop's product photos: "P3-1" is product 3's first photo. In a practice shop a
 * practice item without a photo gets one name too ("P5-1"): its picture, made with ChatGPT, labelled practice.
 */
export function photoRefs(products: PromptProduct[], opts: { practice?: boolean } = {}): Record<string, PhotoRef> {
  const refs: Record<string, PhotoRef> = {};
  products.forEach((p, i) => {
    const photos = p.images.filter((img) => typeof img?.url === "string" && /^https:\/\//i.test(img.url)).slice(0, PHOTOS_PER_PRODUCT);
    photos.forEach((img, k) => {
      refs[`P${i + 1}-${k + 1}`] = { productId: p.id, url: img.url, title: p.title };
    });
    if (!photos.length && opts.practice && p.imagined) refs[`P${i + 1}-1`] = { productId: p.id, url: null, title: p.title, item: true };
  });
  return refs;
}

const PLATFORM_NAMES: Record<string, string> = { instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok" };

export interface CarouselRequest {
  bp: Blueprint;
  practice: boolean;
  products: PromptProduct[];
  refs: Record<string, PhotoRef>;
  count: number;
  platforms: string[];
  /** Angles of the shop's recent posts, so the new ones don't repeat them. */
  earlierAngles: string[];
  /** Days (1..7) that already have a post scheduled. */
  takenDays: number[];
  /** "US Eastern time" and so on: the zone the suggested times are in. */
  zoneLabel: string;
  /** Writing one post again: what it said before. */
  replacing?: { angle: string; headlines: string[] };
  /** Ads about the one product given ("Make an ad with AI" on a product). */
  focus?: boolean;
}

export function carouselPrompt(r: CarouselRequest): string {
  const bp = r.bp;
  const refsByProduct = new Map<string, string[]>();
  for (const [key, ref] of Object.entries(r.refs)) refsByProduct.set(ref.productId, [...(refsByProduct.get(ref.productId) ?? []), key]);
  const collectionTitle = (handle: string) => bp.collections?.find((c) => c.handle === handle)?.title ?? "";
  const productLines = r.products
    .map((p, i) => {
      const photos = refsByProduct.get(p.id);
      const item = photos?.length === 1 && r.refs[photos[0]]?.item;
      const facts = [...p.bullets, p.description.replace(/\s+/g, " ").slice(0, 240)].filter(Boolean).join("; ");
      return `P${i + 1}. ${p.title}${collectionTitle(p.collection) ? ` (${collectionTitle(p.collection)})` : ""}${p.imagined ? " [practice item]" : ""}
   Facts: ${facts || "only the title"}
   Photos: ${item ? `${photos![0]} (a practice item: Armada makes its one picture)` : (photos?.join(", ") ?? "none, so no slide can show it")}`;
    })
    .join("\n");

  const facts = bp.facts
    ? [
        `Ships to ${bp.facts.country}`,
        `Delivery takes ${bp.facts.deliveryMin} to ${bp.facts.deliveryMax} business days after a ${bp.facts.handlingDays}-day handling time`,
        `Returns are accepted within ${bp.facts.returnDays} days of delivery`,
      ]
    : [];
  const platforms = [...new Set(r.platforms.map((p) => PLATFORM_NAMES[p] ?? p))];
  const one = r.count === 1;

  const focus = r.focus && r.products.length === 1 ? r.products[0] : null;
  const what = focus
    ? `${one ? "one carousel ad" : `${r.count} carousel ads`} about one product, "${focus.title}",`
    : one
      ? "one carousel post"
      : `${r.count} carousel posts`;
  return `Write ${what} for the social media accounts of the online shop "${bp.brand?.name}".
${platforms.length ? `They will go out on ${platforms.join(" and ")}.` : "They will go out on Instagram-style photo carousels."}

The shop
- Name: ${bp.brand?.name}
- Tagline: ${bp.brand?.tagline}
- Voice: ${bp.brand?.voice}
- Who it's for: ${bp.brand?.audience}
- What it promises: ${(bp.valueProps ?? []).map((v) => `${v.title} (${v.body})`).join("; ") || "nothing beyond its products"}
${facts.length ? `- Facts you may use: ${facts.join("; ")}` : "- There are no delivery or returns facts yet, so don't mention delivery or returns."}
${r.practice ? "- This is a practice shop. Write exactly as you would for a real one; the posts only go to practice accounts.\n" : ""}
The products (use only these, and only their facts)
${productLines || "(none yet)"}
${r.earlierAngles.length ? `\nRecent posts, whose ideas you must not repeat:\n${r.earlierAngles.map((a) => `- ${a}`).join("\n")}\n` : ""}${r.replacing ? `\nYou are writing a new version of this post. Keep its idea ("${r.replacing.angle}") but make it fresh: don't reuse these headlines: ${r.replacing.headlines.map((h) => `"${h}"`).join(", ")}.\n` : ""}
Each post is a carousel of ${MIN_SLIDES} to ${MAX_SLIDES} slides that people swipe through. Armada draws every slide itself in the shop's colours and fonts, with the headline, the line under it and, if you pick one, a picture: a product's own photo, or a scene ChatGPT makes for the slide. A product is only ever shown by its own photo; a scene never shows one.
${
  one
    ? ""
    : focus
      ? `\nEvery post is about "${focus.title}" and nothing else. Give each one a genuinely different idea, for example: the product up close and the detail that makes it good; how it's used day to day; who it's for and the moment it fits; how to care for it or what's included. Put its photos on the slides that show it.\n`
      : `\nGive each post a genuinely different idea, for example: one product up close; how to use or care for something; what to pair with what; a small routine the products fit into; how to choose between two products; what the shop promises (only the facts above). Spread the posts across the products.\n`
}
For each post:
- angle: the idea of the post, in plain words for the shop owner, at most 12 words.
- slides: ${MIN_SLIDES} to ${MAX_SLIDES} slides.
  - Slide 1 makes someone stop scrolling: a clear, specific promise of what the post shows. No questions, no clickbait.
  - Each middle slide carries one idea: a real detail from the facts, a use, what's included.
  - The last slide closes calmly and names the shop. Don't write a web address, "link in bio" or "shop now".
  - headline: at most 8 words (at most ${HEADLINE_MAX} characters).
  - line: one sentence under the headline, at most 18 words (at most ${LINE_MAX} characters). Use "" when the headline says it all.
  - photo: the name of one photo from the lists above (like "P2-1") when the slide shows that product; "scene" for a slide whose picture ChatGPT makes (a place or moment the products are for, with no product of the shop's kinds in it); or "none" for words only. Put a photo or a scene on slide 1. Use a photo at most once per post, and only on a slide about that product. Use "scene" on at most ${MAX_SCENES_PER_POST} slides per post. At least half of the slides carry a picture (a product photo or a scene); keep words-only slides for a calm statement or the close.
  - scene: when photo is "scene", what its picture shows in at most 20 words, the way a photographer would brief a shoot in the shop's look ("a linen-made bed at 7 a.m., window light across the sheets"); no product, no text, no faces toward the camera. Otherwise "".
- caption: what goes under the post. 40 to 110 words in the shop's voice, in short paragraphs, adding something the slides don't say. No hashtags in the caption.
- hashtags: ${MIN_HASHTAGS} to ${MAX_HASHTAGS} hashtags without the # sign, specific to the products and who they're for, as people really search them (for example "bedroomideas"). No brand names the shop doesn't own, and nothing about sales, discounts, giveaways or free things.
- day: when to post it, from 1 (tomorrow) to 7 (a week from today).${r.takenDays.length ? ` These days already have a post, so use others if you can: ${r.takenDays.join(", ")}.` : ""}${one ? "" : " Put each post on a different day."}
- time: the best time of day for this shop's shoppers to see it, as 24-hour "HH:MM" in ${r.zoneLabel}. Think about when these particular people scroll (for example after work, or early on weekend mornings).

Only use facts from this message. No prices, discounts, sales, free shipping, giveaways, reviews, testimonials, numbers of customers, "bestseller", awards, health or safety claims, or urgency ("limited", "last chance", "today only").`;
}
