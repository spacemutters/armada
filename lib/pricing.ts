// Prices come from rules, never from the AI. The AI writes words; this file decides numbers.

export type PriceFeel = "budget" | "mid" | "premium";

/** Retail price as a multiple of landed cost (supplier cost + shipping). */
export const MARKUP: Record<PriceFeel, number> = { budget: 2.2, mid: 2.8, premium: 3.4 };

/**
 * Estimated platform fees until real fees can be read from orders.
 * Shopify: card processing on the Basic plan. eBay: a typical final value fee.
 */
export const PLATFORM_FEES = {
  shopify: { pct: 0.029, fixedCents: 30 },
  ebay: { pct: 0.136, fixedCents: 40 },
} as const;

/** Share of the price assumed to go to ads when judging margin. */
export const STARTING_AD_SHARE = 0.15;

/**
 * Stand-in shipping cost for a supplier product whose shipping hasn't been confirmed yet. On the
 * high side of small-parcel rates from China, so an unconfirmed product never looks better than it is.
 */
export const UNCONFIRMED_SHIP_CENTS = 550;

export function retailPrice(costCents: number, shipCents: number, feel: PriceFeel): number {
  const raw = (costCents + shipCents) * MARKUP[feel];
  return charm(Math.max(raw, 500), feel);
}

/** Budget and mid prices end in .99; premium prices are round numbers. */
export function charm(cents: number, feel: PriceFeel): number {
  const dollars = cents / 100;
  if (feel === "premium") {
    const step = dollars < 50 ? 1 : dollars < 200 ? 5 : 10;
    return Math.max(step, Math.round(dollars / step) * step) * 100;
  }
  return Math.max(1, Math.ceil(dollars)) * 100 - 1;
}

export function feesCents(priceCents: number, platform: keyof typeof PLATFORM_FEES = "shopify"): number {
  const f = PLATFORM_FEES[platform];
  return Math.round(priceCents * f.pct + f.fixedCents);
}

/** Profit per sale after supplier cost, shipping, fees and a starting ad cost. */
export function unitProfitCents(
  priceCents: number,
  costCents: number,
  shipCents: number,
  platform: keyof typeof PLATFORM_FEES = "shopify",
): number {
  return priceCents - costCents - shipCents - feesCents(priceCents, platform) - Math.round(priceCents * STARTING_AD_SHARE);
}
