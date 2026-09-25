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

/** A carousel shows 2 to 10 cards on every platform; Armada asks for 3 to 6. */
export const CARDS = { min: 2, max: 10 } as const;

const str = { type: "string" } as const;
const strList = (min: number, max: number) => ({ type: "array", minItems: min, maxItems: max, items: str });

const cardSchema = {
  type: "object",
  additionalProperties: false,
  required: ["product", "headline", "description"],
  properties: { product: str, headline: str, description: str },
} as const;

export const adItemSchema = {
  type: "object",
  additionalProperties: false,
  required: ["idea", "format", "primaryText", "headline", "description", "callToAction", "products", "cards"],
  properties: {
    idea: str,
    format: { type: "string", enum: ["single", "carousel"] },
    primaryText: str,
    headline: str,
    description: str,
    callToAction: { type: "string", enum: [...CTAS] },
    products: strList(1, 10),
    cards: { type: "array", minItems: 0, maxItems: 10, items: cardSchema },
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

const Card = z.object({ product: z.string(), headline: z.string(), description: z.string() });
const Ad = z.object({
  idea: z.string(),
  format: z.enum(["single", "carousel"]),
  primaryText: z.string(),
  headline: z.string(),
  description: z.string(),
  callToAction: z.string(),
  products: z.array(z.string()).min(1),
  cards: z.array(Card),
});
const Answer = z.object({
  plan: z.string(),
  audience: z.object({ description: z.string(), ageMin: z.number(), ageMax: z.number(), interests: z.array(z.string()) }),
  budget: z.object({ dailyAmount: z.number(), days: z.number(), reasoning: z.string() }),
  ads: z.array(Ad).min(1),
});
const Rewrite = z.object({ ad: Ad });

export interface CardDraft {
  productId: string;
  headline: string;
  description: string;
}

export interface AdDraft {
  idea: string;
  format: "single" | "carousel";
  primaryText: string;
  headline: string;
  description: string;
  callToAction: Cta;
  productIds: string[];
  cards: CardDraft[];
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

/** Tidies one ad: only real products, text clipped to what platforms show, a carousel with too few cards becomes a single-photo ad. */
function tidyAd(ad: z.infer<typeof Ad>, refs: string[], usable: (id: string) => boolean): AdDraft | null {
  const toId = resolver(refs);
  const productIds = [...new Set(ad.products.map(toId).filter((x): x is string => !!x && usable(x)))];
  const seen = new Set<string>();
  const cards: CardDraft[] = [];
  for (const c of ad.cards) {
    const id = toId(c.product);
    if (!id || !usable(id) || seen.has(id)) continue;
    seen.add(id);
    cards.push({ productId: id, headline: clip(c.headline, LIMITS.cardHeadline), description: clip(c.description, LIMITS.cardDescription) });
    if (cards.length === CARDS.max) break;
  }
  let format: AdDraft["format"] = ad.format;
  if (format === "carousel" && cards.length < CARDS.min) format = "single";
  const shown = format === "carousel" ? cards.map((c) => c.productId) : productIds.length ? [productIds[0]] : cards.slice(0, 1).map((c) => c.productId);
  if (!shown.length) return null;
  const primaryText = clip(ad.primaryText, LIMITS.primaryText);
  const headline = clip(ad.headline, LIMITS.headline);
  if (!primaryText || !headline) return null;
  return {
    idea: clip(ad.idea, LIMITS.idea),
    format,
    primaryText,
    headline,
    description: clip(ad.description, LIMITS.description),
    callToAction: (CTAS as readonly string[]).includes(ad.callToAction) ? (ad.callToAction as Cta) : "SHOP_NOW",
    productIds: shown,
    cards: format === "carousel" ? cards : [],
  };
}

/**
 * Checks the AI's answer for a whole ad set and turns it into drafts. Returns null when nothing usable
 * came back. `refs` are the product ids in prompt order; `usable` says whether a product may be shown
 * (for real platforms, only products with a photo).
 */
export function toDrafts(output: unknown, refs: string[], usable: (id: string) => boolean = () => true): SetDraft | null {
  const parsed = Answer.safeParse(output);
  if (!parsed.success) return null;
  const a = parsed.data;
  const ads = a.ads.map((ad) => tidyAd(ad, refs, usable)).filter((x): x is AdDraft => x !== null).slice(0, 5);
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
export function toOneDraft(output: unknown, refs: string[], usable: (id: string) => boolean = () => true): AdDraft | null {
  const parsed = Rewrite.safeParse(output);
  return parsed.success ? tidyAd(parsed.data.ad, refs, usable) : null;
}
