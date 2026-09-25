import { retailPrice, UNCONFIRMED_SHIP_CENTS, type PriceFeel } from "@/lib/pricing";
import { scoreProduct } from "@/lib/score";
import type { CatalogItem, ScoreParts } from "@/lib/types";

type Scorable = Pick<
  CatalogItem,
  "source" | "costCents" | "shipCents" | "shipDaysMax" | "stock" | "rating" | "branded" | "retailSource" | "attributes"
>;

/** Suppliers whose search results carry no shipping price until the item is checked. */
const CHECKED_SOURCES = new Set(["cj", "aliexpress"]);

/**
 * Price and score for a catalog item, the same way everywhere. A CJ or AliExpress item whose shipping
 * hasn't been confirmed is costed with a cautious stand-in, and its score says the margin is an estimate.
 */
export function scoreCatalogItem(
  item: Scorable,
  feel: PriceFeel = "mid",
): { priceCents: number; shipCents: number; shipEstimated: boolean; score: number; parts: ScoreParts } {
  const attrs = item.attributes as { cj?: { checked?: boolean; listedNum?: number }; aliexpress?: { checked?: boolean; orders?: number } } | null;
  const cj = attrs?.cj;
  const ae = attrs?.aliexpress;
  const supplier = item.source === "aliexpress" ? ae : cj;
  const shipEstimated = CHECKED_SOURCES.has(item.source) && !supplier?.checked;
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
    supplierListings: item.source === "cj" ? (cj?.listedNum ?? null) : null,
    supplierOrders: item.source === "aliexpress" ? (ae?.orders ?? null) : null,
    shipEstimated,
  });
  return { priceCents, shipCents, shipEstimated, score, parts };
}
