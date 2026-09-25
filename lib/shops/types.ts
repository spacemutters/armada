import type { Palette } from "@/lib/color";
import type { PriceFeel } from "@/lib/pricing";
import type { CatalogImage } from "@/lib/types";
import type { Pairings, ShopSet } from "./sets";

export interface ShopBrief {
  niche: string;
  audience: string;
  country: string;
  priceFeel: PriceFeel;
  productCount: number;
  look: string;
  source: "practice" | "cj";
}

/**
 * The steps of a build, in order. "choose" is the owner's: the AI proposes twice the products and
 * the build waits for a person. "check" (CJ shops only) confirms real shipping for the chosen ones.
 */
export type StepKey = "concept" | "products" | "choose" | "check" | "pages";
/** "needs-you" means the build is waiting for a person, not for the AI and not stuck. */
export type StepState = "waiting" | "running" | "needs-you" | "done" | "failed";

export interface ProgressStep {
  key: StepKey;
  label: string;
  state: StepState;
  startedAt?: string;
  finishedAt?: string;
  note?: string;
}

/** One product the AI proposes for the owner to choose from. Kept in the blueprint until the choice. */
export interface Proposal {
  /** The card's id: the catalog item's id, or a fresh id for a practice item the AI imagined. */
  id: string;
  catalogItemId: string | null;
  /** The AI's order, best fit first (1 is its favourite). "Let the AI pick" takes the first ones. */
  rank: number;
  title: string;
  description: string;
  bullets: string[];
  seoTitle: string;
  seoDescription: string | null;
  /** The AI's one line on why it fits this shop. */
  why: string;
  /** The collection's handle. */
  collection: string;
  /** From the pricing rules, never the AI. For a CJ item it is an estimate until CJ confirms shipping. */
  priceCents: number;
  priceEstimated: boolean;
  score: number;
  reasons: string[];
  image: CatalogImage | null;
  /** The illustration for a practice item without a photo. */
  icon: string | null;
  /** Set for a practice item the AI imagined; its catalog row is made only if it's chosen. */
  imagined: { category: string; costCents: number } | null;
}

export interface Blueprint {
  brand?: {
    name: string;
    alternativeNames: string[];
    tagline: string;
    voice: string;
    audience: string;
    monogramIcon: string;
  };
  theme?: { palette: Palette; fonts: { display: string; body: string }; contrastFixes: string[] };
  hero?: { headline: string; subhead: string; cta: string };
  valueProps?: { title: string; body: string }[];
  collections?: { handle: string; title: string; description: string; keywords: string[]; productIds: string[] }[];
  searchTerms?: string[];
  products?: { productId: string; handle: string; collection: string; priceCents: number; imagined: boolean }[];
  pages?: {
    about: string;
    faq: { question: string; answer: string }[];
    shipping: string;
    contact: string;
  };
  policies?: { refund: string; shipping: string };
  announcement?: string;
  footerBlurb?: string;
  seo?: { title: string; description: string };
  facts?: { country: string; deliveryMin: number; deliveryMax: number; handlingDays: number; returnDays: number; freeReturns?: boolean };
  /** Sets of products sold together for less than their items separately (lib/shops/sets.ts). */
  sets?: ShopSet[];
  /** Each product's "goes well with" products and why. */
  pairings?: Pairings;
  candidateCount?: number;
  /** The supplier candidates the AI was shown. Only these ids are accepted back. */
  candidateIds?: string[];
  /** What the AI proposed, while the build waits for the owner to choose. */
  proposals?: Proposal[];
  /** How the products were chosen, once they were. */
  choice?: { offered: number; chosen: number; by: "you" | "ai" | "all" };
}

export interface ShopRow {
  id: string;
  workspaceId: string;
  slug: string;
  status: "draft" | "building" | "choosing" | "ready" | "publishing" | "published" | "failed";
  niche: string;
  brief: ShopBrief;
  blueprint: Blueprint;
  storeId: string | null;
  /** Launch switched the shop's own checkout on (supabase/migrations/0024_shop_checkout.sql). */
  checkoutOpen?: boolean;
  progress: ProgressStep[];
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ---------- the choosing rules ----------
// Plain functions with no imports, shared by the pipeline, the chooser page and scripts/check-chooser.mjs.

/** The AI proposes this many times the shop's product count, so the owner has a real choice. */
export const PROPOSAL_FACTOR = 2;

/**
 * How many products the AI is asked to propose: twice the shop's count. A shop built from supplier
 * products can't be offered more than the real candidates found; a practice shop can fill the gap
 * with practice items, which count toward the total.
 */
export function proposalTarget(productCount: number, candidateCount: number, allowImagined: boolean): number {
  const want = Math.max(0, Math.floor(productCount)) * PROPOSAL_FACTOR;
  return allowImagined ? want : Math.max(0, Math.min(want, Math.floor(candidateCount)));
}

/** How many the owner chooses: the count they asked for, or all of them if the AI found fewer. */
export function chooseCount(productCount: number, offered: number): number {
  return Math.max(0, Math.min(productCount, offered));
}

/** The AI's own top picks: the first `need` proposals in its order. */
export function aiPicks(proposals: Pick<Proposal, "id" | "rank">[], need: number): string[] {
  return [...proposals]
    .sort((a, b) => a.rank - b.rank)
    .slice(0, Math.max(0, need))
    .map((p) => p.id);
}

export type ChoiceCheck = { ok: true; ids: string[] } | { ok: false; problem: string };

/** A choice is exactly `need` different products, every one of them from the proposals. */
export function checkChoice(proposals: Pick<Proposal, "id">[], picked: unknown[], need: number): ChoiceCheck {
  const offered = new Set(proposals.map((p) => p.id));
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const v of picked) {
    if (typeof v !== "string" || !offered.has(v)) return { ok: false, problem: "One of those products isn't on this list any more. Choose again." };
    if (seen.has(v)) return { ok: false, problem: "The same product was chosen twice. Choose again." };
    seen.add(v);
    ids.push(v);
  }
  if (ids.length !== need) {
    return { ok: false, problem: `Choose exactly ${need} products. ${ids.length === 1 ? "1 is" : `${ids.length} are`} chosen.` };
  }
  return { ok: true, ids };
}

/**
 * Which unattended CJ step a quiet build is stuck in, if any: the catalog search, or the shipping
 * check. A shop waiting for its owner is never stuck, whatever its clock says.
 */
export function stalledCjStep(shop: {
  status: string;
  brief: { source?: string } | null;
  progress: Pick<ProgressStep, "key" | "state">[];
  hasProducts: boolean;
}): "search" | "check" | null {
  if (shop.status !== "building" || shop.brief?.source !== "cj") return null;
  if (shop.progress.some((s) => s.state === "needs-you")) return null;
  const running = new Set(shop.progress.filter((s) => s.state === "running").map((s) => s.key));
  if (running.has("check") || (running.has("products") && shop.hasProducts)) return "check";
  if (running.has("products")) return "search";
  return null;
}
