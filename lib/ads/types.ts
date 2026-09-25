import type { CardDraft, Cta } from "./schema";

// Shapes shared by the ads screens, lib/ads and the ad platform connectors.

export type AdSetStatus = "writing" | "draft" | "paused" | "on" | "stopped" | "failed";
export type AdPlatformKey = "practice" | "meta" | "google" | "tiktok";
export type VariationStatus = "draft" | "rewriting" | "removed" | "created" | "failed";

export interface AudiencePlan {
  description: string;
  countries: string[];
  ageMin: number;
  ageMax: number;
  interests: string[];
}

export interface AdSet {
  id: string;
  workspaceId: string;
  shopId: string;
  status: AdSetStatus;
  platform: AdPlatformKey;
  practiceReason: string | null;
  currency: string;
  dailyBudgetCents: number;
  days: number;
  spendCapCents: number;
  budgetReason: string | null;
  plan: string | null;
  audience: Partial<AudiencePlan>;
  productRefs: string[];
  external: {
    accountId?: string;
    accountName?: string;
    campaignId?: string;
    adSetId?: string;
    pageId?: string;
    reach?: number;
    leftovers?: string[];
  };
  error: string | null;
  stopReason: string | null;
  createdBy: string | null;
  launchingAt: Date | null;
  launchedAt: Date | null;
  switchedOnAt: Date | null;
  switchedOnBy: string | null;
  clockStartedAt: Date | null;
  resultsSyncedAt: Date | null;
  stoppedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** A carousel card as stored: a product card (a real photo) or a scene card (a ChatGPT picture). */
export type CardCopy = CardDraft;

export interface AdVariation {
  id: string;
  workspaceId: string;
  adSetId: string;
  position: number;
  status: VariationStatus;
  format: "single" | "carousel";
  idea: string;
  primaryText: string;
  headline: string;
  description: string;
  callToAction: Cta;
  productIds: string[];
  /** A single-photo ad: the setting its product photo is placed in (a ChatGPT picture). */
  scene: string;
  cards: CardCopy[];
  writtenBy: "ai" | "ai_edited";
  practiceStrength: number | null;
  external: { creativeId?: string; adId?: string };
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Totals for one ad, or for a whole set. */
export interface Totals {
  impressions: number;
  reach: number;
  clicks: number;
  addToCarts: number;
  purchases: number;
  spendCents: number;
  salesCents: number;
  days: number;
  practice: boolean;
}

// ---------- what a platform connector implements ----------

export interface LaunchCard {
  /** Null on a scene card, which sends people to the shop. */
  productId: string | null;
  headline: string;
  description: string;
  link: string;
  imageUrl: string | null;
}

export interface LaunchAd {
  variationId: string;
  format: "single" | "carousel";
  primaryText: string;
  headline: string;
  description: string;
  callToAction: Cta;
  /** Where the ad sends people (a product page for single ads, the shop for carousels). */
  link: string;
  imageUrl: string | null;
  cards: LaunchCard[];
}

export interface LaunchInput {
  /** Shown in the platform's own screens, e.g. "Armada · Hearth & Loom · Sep 24". */
  name: string;
  currency: string;
  countries: string[];
  ageMin: number;
  ageMax: number;
  interests: string[];
  dailyBudgetCents: number;
  days: number;
  ads: LaunchAd[];
}

export interface LaunchOutput {
  ok: boolean;
  /** A plain sentence when it didn't work. */
  problem?: string;
  /** Whatever got created, even on a problem (it was all created switched off). */
  external: AdSet["external"];
  ads: { variationId: string; external: AdVariation["external"] }[];
}

export interface ResultRow {
  variationId: string;
  /** YYYY-MM-DD. */
  day: string;
  impressions: number;
  reach: number;
  clicks: number;
  addToCarts: number;
  purchases: number;
  spendCents: number;
  salesCents: number;
}

export interface BudgetChange {
  dailyBudgetCents: number;
  days: number;
  /** Money already spent, so a new cap never falls below it. */
  spentCents: number;
  /** When the ads first went on, if they have. */
  switchedOnAt: Date | null;
}

/**
 * One ad platform. Every method that creates something creates it switched off; switchOn is the only
 * way anything starts spending, and only a person's press calls it.
 */
export interface AdPlatform {
  key: Exclude<AdPlatformKey, "practice">;
  name: string;
  /** Null when this workspace can create ads here now; otherwise a plain sentence why not. */
  cannotLaunch(workspaceId: string): Promise<string | null>;
  createPaused(workspaceId: string, input: LaunchInput): Promise<LaunchOutput>;
  switchOn(workspaceId: string, set: AdSet, ads: AdVariation[], budget: BudgetChange): Promise<void>;
  pause(workspaceId: string, set: AdSet): Promise<void>;
  changeBudget(workspaceId: string, set: AdSet, budget: BudgetChange): Promise<void>;
  readResults(workspaceId: string, set: AdSet, ads: AdVariation[]): Promise<{ rows: ResultRow[]; reachTotal: number | null }>;
}

/** A plain-words problem from a platform, safe to show on screen. */
export class PlatformProblem extends Error {}
