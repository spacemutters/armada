import { unitProfitCents } from "./pricing";
import type { ScoreParts } from "./types";

// The 1-100 product score. Each part is 0..1 and says whether it was measured or estimated,
// so the screen never passes an estimate off as a fact.

export const WEIGHTS = { margin: 0.3, demand: 0.25, competition: 0.15, shipping: 0.15, reliability: 0.15 };

export interface ScoreInput {
  priceCents: number;
  costCents: number;
  shipCents: number;
  shipDaysMax: number | null;
  stock: number | null;
  rating: number | null;
  branded: boolean;
  retailSource: boolean;
  platform?: "shopify" | "ebay";
  practice?: boolean;
  fleetUnitsSold30d?: number | null;
}

const clamp = (n: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));

export function scoreProduct(i: ScoreInput): { score: number; parts: ScoreParts } {
  const platform = i.platform ?? "shopify";
  const profit = unitProfitCents(i.priceCents, i.costCents, i.shipCents, platform);
  const marginShare = i.priceCents > 0 ? profit / i.priceCents : 0;
  const margin = {
    value: clamp((marginShare - 0.1) / 0.3),
    measured: !i.practice,
    note: `${Math.round(marginShare * 100)}% left after supplier cost, shipping, fees and a starting ad cost`,
  };

  const demand =
    i.fleetUnitsSold30d != null
      ? {
          value: clamp(Math.log10(1 + i.fleetUnitsSold30d) / 2.5),
          measured: true,
          note: `${i.fleetUnitsSold30d} sold across your stores in the last 30 days`,
        }
      : {
          value: i.rating != null ? clamp((i.rating - 3.5) / 1.5) : 0.5,
          measured: false,
          note: "Estimated from the supplier's rating. Live demand needs eBay's market data.",
        };

  const competition = { value: 0.5, measured: false, note: "Not checked yet. Needs eBay's market data." };

  const shipping =
    i.shipDaysMax != null
      ? {
          value: clamp((20 - i.shipDaysMax) / 13),
          measured: !i.practice,
          note: `Arrives in up to ${i.shipDaysMax} days`,
        }
      : { value: 0.4, measured: false, note: "The supplier gave no shipping time" };

  const reliability =
    i.stock != null
      ? {
          value: clamp(Math.log10(1 + Math.max(0, i.stock)) / Math.log10(501)),
          measured: !i.practice,
          note: i.stock === 0 ? "Out of stock at the supplier" : `${i.stock} in stock at the supplier`,
        }
      : { value: 0.4, measured: false, note: "The supplier gave no stock level" };

  const penalty = { points: 0, reasons: [] as string[] };
  if (i.branded) {
    penalty.points += 40;
    penalty.reasons.push("Names a brand you may not have the right to sell");
  }
  if (i.retailSource && platform === "ebay") {
    penalty.points += 100;
    penalty.reasons.push("eBay doesn't allow dropshipping from retail sites");
  }

  const raw =
    100 *
    (WEIGHTS.margin * margin.value +
      WEIGHTS.demand * demand.value +
      WEIGHTS.competition * competition.value +
      WEIGHTS.shipping * shipping.value +
      WEIGHTS.reliability * reliability.value);
  const score = Math.round(clamp(raw - penalty.points, 1, 100));

  const parts: ScoreParts = { margin, demand, competition, shipping, reliability, penalty, reasons: [] };
  parts.reasons = reasonsFor(parts);
  return { score, parts };
}

function reasonsFor(p: ScoreParts): string[] {
  if (p.penalty.reasons.length) return [p.penalty.reasons[0]];
  const words: [string, number, string, string][] = [
    ["margin", p.margin.value, "strong margin", "thin margin"],
    ["shipping", p.shipping.value, "fast shipping", "slow shipping"],
    ["reliability", p.reliability.value, "deep stock", "low stock"],
    ["demand", p.demand.value, "well rated", "weak rating"],
  ];
  // The two parts furthest from neutral, described in plain words.
  return words
    .map(([, v, good, bad]) => ({ text: v >= 0.5 ? good : bad, distance: Math.abs(v - 0.5) }))
    .sort((a, b) => b.distance - a.distance)
    .slice(0, 2)
    .map((w) => w.text);
}

export function scoreBand(score: number): "strong" | "test" | "weak" {
  return score >= 80 ? "strong" : score >= 60 ? "test" : "weak";
}
