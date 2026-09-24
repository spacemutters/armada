import pricing from "../../docs/pricing-plans.json";

// Armada's plans. The numbers (prices, limits, trial, the "includes" sentences) come from
// docs/pricing-plans.json, the pricing research's file; this module checks them and shapes them for
// the billing page, the limits in lib/billing/entitlements.ts, and the Products and Prices Armada
// creates in Stripe. The only things added here are words the file doesn't carry: a one-line tagline
// per plan and which plan the page recommends.
//
// To change a price: edit docs/pricing-plans.json, deploy, then press "Update plans in Stripe" on
// /billing. Stripe prices can't be edited, so Armada makes a new Stripe Price for the new amount and
// uses it for new sign-ups; people already paying keep the price they signed up at until they change plan.
//
// Kept free of app imports, so the offline check (scripts/check-stripe.mjs) can load it.

export type PlanKey = "practice" | "starter" | "growth" | "fleet";
export type BillingInterval = "month" | "year";
export type LimitFeature = "stores" | "products" | "shopBuildsPerMonth" | "headlineTests" | "seats";
export const LIMIT_FEATURES: readonly LimitFeature[] = ["stores", "products", "shopBuildsPerMonth", "headlineTests", "seats"];

/** null means no limit. The definitions are the pricing file's (see `definitions` there). */
export interface PlanLimits {
  /** Real stores connected at once, Shopify, eBay and Facebook/Instagram together. Practice stores never count. */
  stores: number | null;
  /** Products listed in real stores, each counted once however many stores list it. */
  products: number | null;
  /** AI shop builds started in a month. A batch of 10 shops is 10 builds. */
  shopBuildsPerMonth: number | null;
  /** Headline tests started in a month. */
  headlineTests: number | null;
  /** People who can sign in, the owner included. */
  seats: number | null;
}

export interface Plan {
  /** Lowercase letters only: it's stored as a JSON key, which the database client would camel-case. */
  key: PlanKey;
  name: string;
  /** One plain sentence: who the plan is for. */
  tagline: string;
  /** Whole cents. 0 for the free plan. */
  monthlyCents: number;
  /** Whole cents for a year paid at once. */
  yearlyCents: number;
  limits: PlanLimits;
  /** Plain sentences shown under the plan. They also go to Stripe as the plan's features. */
  includes: string[];
  /** Free days before the first charge, for a workspace's first paid plan. 0 for none. */
  trialDays: number;
  /** Tighter limits while the free trial lasts (the pricing file allows 5 shop builds in a trial). */
  trialLimits: Partial<PlanLimits>;
  /** The one plan the page suggests. */
  recommended: boolean;
}

/** Words the pricing file doesn't carry. Each must stay true of the app. */
const TAGLINES: Record<PlanKey, string> = {
  practice: "Learn every screen on a practice fleet before you spend a dollar.",
  starter: "Your first real stores, with the AI doing the heavy lifting.",
  growth: "For a growing fleet that tests and improves every week.",
  fleet: "For dozens of stores and a whole team.",
};

/** The research's pick: "the plan most people should land on" (docs/pricing-research.md). */
const RECOMMENDED: PlanKey = "growth";

const KNOWN: readonly string[] = ["practice", "starter", "growth", "fleet"];

interface PricingFile {
  currency: string;
  status?: string;
  asOf?: string;
  plans: {
    key: string;
    name: string;
    monthlyUsd: number;
    yearlyUsd: number;
    limits: Record<string, number | null | undefined>;
    includes: string[];
    trialDays: number;
    trialLimits?: { shopBuilds?: number } | null;
  }[];
}

function limit(file: string, value: number | null | undefined): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) throw new Error(`docs/pricing-plans.json: ${file} must be a whole number or null`);
  return value;
}

function cents(file: string, usd: number): number {
  const c = Math.round(usd * 100);
  if (typeof usd !== "number" || !Number.isFinite(usd) || usd < 0 || Math.abs(c - usd * 100) > 1e-6) throw new Error(`docs/pricing-plans.json: ${file} must be dollars and whole cents`);
  return c;
}

/** Shapes the pricing file into plans, cheapest first, refusing anything it can't read exactly. */
export function plansFromPricing(file: PricingFile): Plan[] {
  if (file.currency !== "usd") throw new Error("docs/pricing-plans.json: only US dollars are supported");
  const plans = file.plans.map((p): Plan => {
    if (!KNOWN.includes(p.key)) throw new Error(`docs/pricing-plans.json: unknown plan "${p.key}" (add it to PlanKey in lib/billing/plans.ts)`);
    const key = p.key as PlanKey;
    const trialBuilds = p.trialLimits?.shopBuilds;
    return {
      key,
      name: p.name,
      tagline: TAGLINES[key],
      monthlyCents: cents(`${key}.monthlyUsd`, p.monthlyUsd),
      yearlyCents: cents(`${key}.yearlyUsd`, p.yearlyUsd),
      limits: {
        stores: limit(`${key}.limits.stores`, p.limits.stores),
        products: limit(`${key}.limits.products`, p.limits.products),
        shopBuildsPerMonth: limit(`${key}.limits.shopBuildsPerMonth`, p.limits.shopBuildsPerMonth),
        headlineTests: limit(`${key}.limits.headlineTests`, p.limits.headlineTests),
        seats: limit(`${key}.limits.seats`, p.limits.seats),
      },
      includes: [...p.includes],
      trialDays: p.trialDays,
      trialLimits: trialBuilds === undefined ? {} : { shopBuildsPerMonth: limit(`${key}.trialLimits.shopBuilds`, trialBuilds) },
      recommended: key === RECOMMENDED,
    };
  });
  return plans.sort((a, b) => a.monthlyCents - b.monthlyCents);
}

/** Every price is in US dollars. */
export const CURRENCY = "usd";

/** Whether the pricing file says Davis has approved it yet (it starts as a recommendation). */
export const PRICING_STATUS: string = (pricing as { status?: string }).status ?? "";
export const PRICING_AS_OF: string = (pricing as { asOf?: string }).asOf ?? "";

export const PLANS: readonly Plan[] = plansFromPricing(pricing as unknown as PricingFile);

/** The plan every workspace has when it pays for nothing. */
export const FREE_PLAN_KEY: PlanKey = "practice";

export const PAID_PLANS: readonly Plan[] = PLANS.filter((p) => p.monthlyCents > 0);

export function isPlanKey(v: unknown): v is PlanKey {
  return typeof v === "string" && PLANS.some((p) => p.key === v);
}

export function isInterval(v: unknown): v is BillingInterval {
  return v === "month" || v === "year";
}

export function planByKey(key: string | null | undefined): Plan | null {
  return PLANS.find((p) => p.key === key) ?? null;
}

export function freePlan(): Plan {
  return planByKey(FREE_PLAN_KEY)!;
}

export function priceCents(plan: Plan, interval: BillingInterval): number {
  return interval === "year" ? plan.yearlyCents : plan.monthlyCents;
}

/**
 * The Stripe lookup key for one plan at one interval and amount, e.g. "armada_growth_month_7900usd".
 * The amount is part of the key, so a new price means a new Stripe Price, never an edit.
 */
export function lookupKey(plan: Plan, interval: BillingInterval): string {
  return `armada_${plan.key}_${interval}_${priceCents(plan, interval)}${CURRENCY}`;
}

/** Reads a lookup key made by lookupKey() back into its plan and interval. */
export function parseLookupKey(key: string | null | undefined): { plan: PlanKey; interval: BillingInterval } | null {
  const m = /^armada_([a-z]+)_(month|year)_\d+[a-z]{3}$/.exec(key ?? "");
  return m && isPlanKey(m[1]) ? { plan: m[1], interval: m[2] as BillingInterval } : null;
}

/** One Stripe Price Armada needs: a paid plan at one interval. */
export interface PriceSpec {
  plan: Plan;
  interval: BillingInterval;
  unitAmount: number;
  currency: string;
  lookupKey: string;
}

/** Every Stripe Price the plans need: each paid plan, monthly and yearly. */
export function priceSpecs(plans: readonly Plan[] = PAID_PLANS): PriceSpec[] {
  return plans.flatMap((plan) =>
    (["month", "year"] as const).map((interval) => ({
      plan,
      interval,
      unitAmount: priceCents(plan, interval),
      currency: CURRENCY,
      lookupKey: lookupKey(plan, interval),
    })),
  );
}

/** A fingerprint of every paid price, saved when Stripe is set up, to notice a price change since. */
export function plansVersion(plans: readonly Plan[] = PAID_PLANS): string {
  return priceSpecs(plans)
    .map((s) => s.lookupKey)
    .sort()
    .join(",");
}

/** Plans in order, cheapest first, for "the next plan up". */
export function planRank(key: PlanKey): number {
  return PLANS.findIndex((p) => p.key === key);
}
