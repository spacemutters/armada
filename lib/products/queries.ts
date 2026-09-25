import "server-only";
import { importAliexpressSearch } from "@/lib/catalog/aliexpress";
import { importCjSearch } from "@/lib/catalog/cj";
import { searchCatalog } from "@/lib/catalog/search";
import { withWorkspace } from "@/lib/db";
import { scoreCatalogItem } from "@/lib/products/score-item";
import type { CatalogImage, ScoreParts } from "@/lib/types";

export interface ProductRow {
  id: string;
  title: string;
  category: string;
  images: CatalogImage[];
  costCents: number;
  shipCents: number;
  score: number | null;
  scoreParts: ScoreParts | Record<string, never>;
  status: string;
  activeListings: number;
  hiddenListings: number;
  typicalPriceCents: number | null;
  unitsSold30: number;
  /** A CJ or AliExpress product whose shipping the supplier hasn't confirmed yet. */
  unconfirmed: boolean;
}

export async function listProducts(workspaceId: string): Promise<ProductRow[]> {
  return withWorkspace(
    workspaceId,
    (tx) => tx<ProductRow[]>`
      select p.id, p.title, p.category, p.images, p.cost_cents, p.ship_cents, p.score, p.score_parts, p.status,
             coalesce((select c.source in ('cj', 'aliexpress') and coalesce(c.attributes -> c.source ->> 'checked', 'false') <> 'true'
                       from armada.catalog_items c where c.id = p.catalog_item_id), false) as unconfirmed,
             count(l.id) filter (where l.status = 'active')::int as active_listings,
             count(l.id) filter (where l.status = 'hidden')::int as hidden_listings,
             (percentile_disc(0.5) within group (order by l.price_cents))::int as typical_price_cents,
             coalesce((select sum(ol.quantity) from armada.order_lines ol join armada.orders o on o.id = ol.order_id
                       where ol.product_id = p.id and o.placed_at >= now() - interval '30 days'), 0)::int as units_sold30
      from armada.products p left join armada.listings l on l.product_id = p.id
      where p.status <> 'archived'
      group by p.id
      order by units_sold30 desc, p.score desc nulls last, p.title
      limit 500`,
  );
}

export interface FoundItem {
  id: string;
  title: string;
  category: string;
  images: CatalogImage[];
  costCents: number;
  shipCents: number;
  shipDaysMax: number | null;
  suggestedPriceCents: number;
  score: number;
  reasons: string[];
  alreadyAdded: boolean;
  practice: boolean;
  /** Supplier search results carry no shipping until the product is checked. */
  shippingKnown: boolean;
}

export type FindSource = "practice" | "cj" | "aliexpress";

export async function findProducts(workspaceId: string, q: string, source: FindSource = "practice"): Promise<FoundItem[]> {
  const phrases = q
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!phrases.length) return [];
  // Suppliers are searched live (one call per phrase, in the account's speed lane) and saved to the catalog.
  const live =
    source === "cj"
      ? await importCjSearch(workspaceId, phrases, { maxPhrases: 3, perPhrase: 24 })
      : source === "aliexpress"
        ? await importAliexpressSearch(workspaceId, phrases, { maxPhrases: 3, perPhrase: 24 })
        : null;
  return withWorkspace(workspaceId, async (tx) => {
    const items = live ?? (await searchCatalog(tx, { source: "practice", phrases, limit: 48 }));
    const added = new Set(
      (await tx<{ catalogItemId: string }[]>`select catalog_item_id from armada.products where catalog_item_id is not null`).map((r) => r.catalogItemId),
    );
    return items
      .map((item) => {
        const s = scoreCatalogItem(item, "mid");
        return {
          id: item.id,
          title: item.title,
          category: item.category,
          images: item.images,
          costCents: item.costCents,
          shipCents: s.shipCents,
          shipDaysMax: item.shipDaysMax,
          suggestedPriceCents: s.priceCents,
          score: s.score,
          reasons: s.parts.reasons,
          alreadyAdded: added.has(item.id),
          practice: item.source === "practice",
          shippingKnown: !s.shipEstimated,
        };
      })
      .sort((a, b) => b.score - a.score);
  });
}
