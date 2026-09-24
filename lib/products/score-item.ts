import { retailPrice, UNCONFIRMED_SHIP_CENTS, type PriceFeel } from "@/lib/pricing";
import { scoreProduct } from "@/lib/score";
import type { CatalogItem, ScoreParts } from "@/lib/types";

type Scorable = Pick<
  CatalogItem,
  "source" | "costCents" | "shipCents" | "shipDaysMax" | "stock" | "rating" | "branded" | "retailSource" | "attributes"
>;

/**
 * Price and score for a catalog item, the same way everywhere. A CJ item whose shipping hasn't been
 * confirmed is costed with a cautious stand-in, and its score says the margin is an estimate.
 */
export function scoreCatalogItem(
  item: Scorable,
  feel: PriceFeel = "mid",
): { priceCents: number; shipCents: number; shipEstimated: boolean; score: number; parts: ScoreParts } {
  const cj = (item.attributes as { cj?: { checked?: boolean; listedNum?: number } } | null)?.cj;
  const shipEstimated = item.source === "cj" && !cj?.checked;
  const shipCents = shipEstimated ? UNCONFIRMED_SHIP_CENTS : item.shipCents;
  const priceCents = retailPrice(item.costCents, shipCents, feel);
  const { score, parts } = scoreProduct({
    priceCents,
    costCents: item.costCents,
    shipCents,
    shipDaysMax: item.shipDaysMax,
    stock: item.stock,
    rating: item.rating != null ? Number(item.rating) : null,
    branded: item.branded,
    retailSource: item.retailSource,
    practice: item.source === "practice",
    supplierListings: cj?.listedNum ?? null,
    shipEstimated,
  });
  return { priceCents, shipCents, shipEstimated, score, parts };
}
