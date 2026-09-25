import { z } from "zod";

// The shape of the AI's answer for "ads.write", and how that answer is checked and tidied before it
// reaches anyone. Pure (no database, no server-only imports) so scripts/check-ads.mjs can load it.
//
// The AI refers to products as p1, p2, … (the order they were listed in the prompt); the ad set keeps
// that order in product_refs, and toDrafts() maps the refs back to real product ids.

export const CTAS = ["SHOP_NOW", "LEARN_MORE", "ORDER_NOW", "BUY_NOW"] as const;
export type Cta = (typeof CTAS)[number];

export const CTA_LABEL: Record<Cta, string> = {
  SHOP_NOW: "Shop now",
  LEARN_MORE: "Learn more",
  ORDER_NOW: "Order now",
  BUY_NOW: "Buy now",
};

/** Lengths the platforms show without cutting words off. Everything the AI writes is clipped to these. */
export const LIMITS = {
  primaryText: 280,
  primaryShown: 125,
  headline: 40,
  description: 30,
  cardHeadline: 32,
  cardDescription: 20,
  idea: 110,
  audience: 220,
  reasoning: 320,
  plan: 200,
} as const;

/** Budget bounds, in whole dollars (or the account's currency). */
export const BUDGET = { minDaily: 5, maxDaily: 200, minDays: 3, maxDays: 30, defaultDaily: 10, defaultDays: 7 } as const;

/**
 * Carousel cards. Platforms take 2 to 10; Armada's carousels have at least 4 (a carousel that can't
 * reach 4 honest cards becomes a single-photo ad) and at most 6, so every card gets a real picture
 * without making more pictures than an ad needs.
 */
export const CARDS = { min: 4, max: 6, platformMax: 10 } as const;

/**
 * Scene cards are the ones whose picture ChatGPT makes (a place or moment, never the product). At most
 * this many per carousel, plus one more only when that's the only way to reach CARDS.min.
 */
export const SCENES_PER_AD = 2;

/** The longest scene description kept (what a scene card's picture shows). */
export const SCENE_MAX = 200;

const str = { type: "string" } as const;
const strList = (min: number, max: number) => ({ type: "array", minItems: min, maxItems: max, items: str });

const cardSchema = {
  type: "object",
  additionalProperties: false,
  required: ["show", "photo", "headline", "description", "scene"],
  properties: { show: str, photo: { type: "integer" }, headline: str, description: str, scene: str },
} as const;

export const adItemSchema = {
  type: "object",
  additionalProperties: false,
  required: ["idea", "format", "primaryText", "headline", "description", "callToAction", "products", "scene", "cards"],
  properties: {
    idea: str,
    format: { type: "string", enum: ["single", "carousel"] },
    primaryText: str,
    headline: str,
    description: str,
    callToAction: { type: "string", enum: [...CTAS] },
    products: strList(1, 10),
    scene: str,
    cards: { type: "array", minItems: 0, maxItems: CARDS.max, items: cardSchema },
  },
} as const;

/** The whole ad set: 3 to 5 ads, one audience, one budget. */
export const adsWriteSchema = {
  type: "object",
  additionalProperties: false,
  required: ["plan", "audience", "budget", "ads"],
  properties: {
    plan: str,
    audience: {
      type: "object",
      additionalProperties: false,
      required: ["description", "ageMin", "ageMax", "interests"],
      properties: { description: str, ageMin: { type: "integer" }, ageMax: { type: "integer" }, interests: strList(0, 6) },
    },
    budget: {
      type: "object",
      additionalProperties: false,
      required: ["dailyAmount", "days", "reasoning"],
      properties: { dailyAmount: { type: "number" }, days: { type: "integer" }, reasoning: str },
    },
    ads: { type: "array", minItems: 3, maxItems: 5, items: adItemSchema },
  },
} as const;

/** Writing one ad again. */
export const adRewriteSchema = {
  type: "object",
  additionalProperties: false,
  required: ["ad"],
  properties: { ad: adItemSchema },
} as const;

// ---------- checking and tidying the answer ----------

function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max + 1);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : t.slice(0, max)).replace(/[\s,;:.-]+$/, "");
}

const Card = z.object({
  show: z.string(),
  photo: z.number().catch(1),
  headline: z.string(),
  description: z.string().catch(""),
  scene: z.string().catch(""),
});
const Ad = z.object({
  idea: z.string(),
  format: z.enum(["single", "carousel"]),
  primaryText: z.string(),
  headline: z.string(),
  description: z.string(),
  callToAction: z.string(),
  products: z.array(z.string()).min(1),
  scene: z.string().catch(""),
  cards: z.array(Card),
});
const Answer = z.object({
  plan: z.string(),
  audience: z.object({ description: z.string(), ageMin: z.number(), ageMax: z.number(), interests: z.array(z.string()) }),
  budget: z.object({ dailyAmount: z.number(), days: z.number(), reasoning: z.string() }),
  ads: z.array(Ad).min(1),
});
const Rewrite = z.object({ ad: Ad });

/**
 * One carousel card, as stored in ad_variations.cards. A product card shows one of the product's real
 * photos (or, in a practice shop, the practice item's picture); a scene card shows a ChatGPT picture
 * of the moment or place, with no product in it. `key` never changes, so a card keeps its picture
 * when a person takes another card out.
 */
export interface CardDraft {
  key: string;
  kind: "product" | "scene";
  /** The product shown; null on a scene card. */
  productId: string | null;
  /** Which of the product's photos (0 is the first). */
  photo: number;
  headline: string;
  description: string;
  /** What a scene card's picture shows; empty on a product card. */
  scene: string;
}

export interface AdDraft {
  idea: string;
  format: "single" | "carousel";
  primaryText: string;
  headline: string;
  description: string;
  callToAction: Cta;
  productIds: string[];
  /** A single-photo ad: the setting its product photo is placed in. */
  scene: string;
  cards: CardDraft[];
}

/** What the tidy-up needs to know about a product: its usable photos, and whether it's a practice item Armada may picture. */
export interface ProductInfo {
  photos: number;
  item: boolean;
  title: string;
  /** The listed price as shown ("$48.00"), for cards Armada adds itself. */
  price: string;
}

const DEFAULT_INFO: ProductInfo = { photos: 1, item: false, title: "", price: "" };

/** Cards saved before carousels had kinds and keys: every card was one product's first photo. */
export function normalizeCards(raw: unknown): CardDraft[] {
  if (!Array.isArray(raw)) return [];
  const used = new Set<string>();
  return raw
    .filter((c): c is Record<string, unknown> => Boolean(c) && typeof c === "object")
    .map((c, i) => {
      let key = typeof c.key === "string" && /^[a-z0-9]{1,8}$/.test(c.key) && !used.has(c.key) ? c.key : `c${i + 1}`;
      for (let n = i + 1; used.has(key); n++) key = `c${n}`;
      used.add(key);
      const kind = c.kind === "scene" ? "scene" : "product";
      return {
        key,
        kind,
        productId: kind === "product" && typeof c.productId === "string" ? c.productId : null,
        photo: Number.isInteger(c.photo) && (c.photo as number) >= 0 ? (c.photo as number) : 0,
        headline: typeof c.headline === "string" ? c.headline : "",
        description: typeof c.description === "string" ? c.description : "",
        scene: kind === "scene" && typeof c.scene === "string" ? c.scene : "",
      } satisfies CardDraft;
    })
    .filter((c) => c.kind === "scene" || c.productId);
}

/** The products a carousel shows, in card order, once each. */
export function cardProducts(cards: CardDraft[]): string[] {
  return [...new Set(cards.filter((c) => c.kind === "product" && c.productId).map((c) => c.productId as string))];
}

export interface SetDraft {
  plan: string;
  audience: { description: string; ageMin: number; ageMax: number; interests: string[] };
  dailyBudgetCents: number;
  days: number;
  budgetReason: string;
  ads: AdDraft[];
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** "p3" → the third product id; anything else (an invented id) → null. */
function resolver(refs: string[]) {
  return (ref: string): string | null => {
    const m = /^p(\d{1,3})$/i.exec(ref.trim());
    if (!m) return null;
    return refs[Number(m[1]) - 1] ?? null;
  };
}

const isScene = (show: string) => /^\s*scene\s*$/i.test(show);

/**
 * Tidies one ad: only real products, text clipped to what platforms show. A carousel keeps its
 * product cards (each product photo once) and at most SCENES_PER_AD scene cards; if it's short of
 * CARDS.min it is filled with the shown products' other photos, then the ad's other products, then
 * one more scene; if it still can't reach CARDS.min it becomes a single-photo ad.
 */
function tidyAd(ad: z.infer<typeof Ad>, refs: string[], usable: (id: string) => boolean, info: (id: string) => ProductInfo): AdDraft | null {
  const toId = resolver(refs);
  // A product can be shown when it may be used and there's a real photo of it (or it's a practice item Armada may picture).
  const showable = (id: string | null): id is string => !!id && usable(id) && (info(id).photos > 0 || info(id).item);
  const productIds = [...new Set(ad.products.map(toId).filter(showable))];
  const photoOf = (id: string, wanted: number) => (info(id).item ? 0 : Math.min(Math.max(0, Math.round(wanted) - 1), Math.max(0, info(id).photos - 1)));

  const cards: Omit<CardDraft, "key">[] = [];
  const seen = new Set<string>();
  let scenes = 0;
  const addProduct = (id: string, photo: number, headline: string, description: string) => {
    const k = `${id}:${photo}`;
    if (seen.has(k) || cards.length >= CARDS.max) return false;
    seen.add(k);
    cards.push({ kind: "product", productId: id, photo, headline: clip(headline, LIMITS.cardHeadline), description: clip(description, LIMITS.cardDescription), scene: "" });
    return true;
  };
  const addScene = (scene: string, headline: string, description: string, limit: number) => {
    const s = clip(scene, SCENE_MAX);
    if (!s || scenes >= limit || cards.length >= CARDS.max) return false;
    scenes++;
    cards.push({ kind: "scene", productId: null, photo: 0, headline: clip(headline, LIMITS.cardHeadline), description: clip(description, LIMITS.cardDescription), scene: s });
    return true;
  };

  if (ad.format === "carousel") {
    for (const c of ad.cards) {
      if (isScene(c.show)) addScene(c.scene, c.headline, c.description, SCENES_PER_AD);
      else {
        const id = toId(c.show);
        if (showable(id)) addProduct(id, photoOf(id, c.photo), c.headline, c.description);
      }
    }
    // Short of four: the shown products' other photos, then the ad's other products, then one more scene.
    const shownIds = [...new Set([...cards.filter((c) => c.productId).map((c) => c.productId as string), ...productIds])];
    for (const id of shownIds) {
      const i = info(id);
      for (let p = 0; p < (i.item ? 1 : i.photos) && cards.length < CARDS.min; p++) addProduct(id, p, i.title || ad.headline, i.price);
    }
    if (cards.length < CARDS.min) {
      const firstScene = cards.find((c) => c.kind === "scene");
      addScene(ad.scene || (firstScene ? `a closer, quieter view of the same place: ${firstScene.scene}` : ""), ad.headline, "", SCENES_PER_AD + 1);
    }
  }

  const hasProduct = cards.some((c) => c.kind === "product");
  const format: AdDraft["format"] = ad.format === "carousel" && cards.length >= CARDS.min && hasProduct ? "carousel" : "single";
  const firstCardProduct = cards.find((c) => c.productId)?.productId ?? null;
  const shown = format === "carousel" ? cardProducts(cards.map((c, i) => ({ ...c, key: `c${i + 1}` }))) : productIds.length ? [productIds[0]] : firstCardProduct ? [firstCardProduct] : [];
  if (!shown.length) return null;
  const primaryText = clip(ad.primaryText, LIMITS.primaryText);
  const headline = clip(ad.headline, LIMITS.headline);
  if (!primaryText || !headline) return null;
  // A single-photo ad's setting: what the AI wrote, or else the first scene it wrote for its cards.
  const scene = clip(ad.scene || cards.find((c) => c.kind === "scene")?.scene || "", SCENE_MAX);
  return {
    idea: clip(ad.idea, LIMITS.idea),
    format,
    primaryText,
    headline,
    description: clip(ad.description, LIMITS.description),
    callToAction: (CTAS as readonly string[]).includes(ad.callToAction) ? (ad.callToAction as Cta) : "SHOP_NOW",
    productIds: shown,
    scene: format === "single" ? scene : "",
    cards: format === "carousel" ? cards.map((c, i) => ({ key: `c${i + 1}`, ...c })) : [],
  };
}

/**
 * Checks the AI's answer for a whole ad set and turns it into drafts. Returns null when nothing usable
 * came back. `refs` are the product ids in prompt order; `usable` says whether a product may be shown
 * (for real platforms, only products with a photo); `info` says how many real photos each product
 * has and whether it's a practice item Armada may picture.
 */
export function toDrafts(output: unknown, refs: string[], usable: (id: string) => boolean = () => true, info: (id: string) => ProductInfo = () => DEFAULT_INFO): SetDraft | null {
  const parsed = Answer.safeParse(output);
  if (!parsed.success) return null;
  const a = parsed.data;
  const ads = a.ads.map((ad) => tidyAd(ad, refs, usable, info)).filter((x): x is AdDraft => x !== null).slice(0, 5);
  if (!ads.length) return null;
  const ageMin = clamp(Math.round(a.audience.ageMin || 18), 18, 65);
  const ageMax = clamp(Math.round(a.audience.ageMax || 65), ageMin, 65);
  const daily = clamp(Number.isFinite(a.budget.dailyAmount) ? a.budget.dailyAmount : BUDGET.defaultDaily, BUDGET.minDaily, BUDGET.maxDaily);
  return {
    plan: clip(a.plan, LIMITS.plan),
    audience: {
      description: clip(a.audience.description, LIMITS.audience),
      ageMin,
      ageMax,
      interests: a.audience.interests.map((s) => clip(s, 40)).filter(Boolean).slice(0, 6),
    },
    dailyBudgetCents: Math.round(daily) * 100,
    days: clamp(Math.round(a.budget.days || BUDGET.defaultDays), BUDGET.minDays, BUDGET.maxDays),
    budgetReason: clip(a.budget.reasoning, LIMITS.reasoning),
    ads,
  };
}

/** Checks the AI's answer for writing one ad again. */
export function toOneDraft(output: unknown, refs: string[], usable: (id: string) => boolean = () => true, info: (id: string) => ProductInfo = () => DEFAULT_INFO): AdDraft | null {
  const parsed = Rewrite.safeParse(output);
  return parsed.success ? tidyAd(parsed.data.ad, refs, usable, info) : null;
}
