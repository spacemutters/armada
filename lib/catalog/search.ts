import "server-only";
import type { Tx } from "@/lib/db";
import type { CatalogItem } from "@/lib/types";

/** Turns plain search phrases into an OR of AND-ed words: (dog & harness) | (slow & feeder). */
export function toTsQuery(phrases: string[]): string | null {
  const groups = phrases
    .map((p) =>
      p
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length > 1)
        .slice(0, 4),
    )
    .filter((words) => words.length > 0)
    .map((words) => (words.length === 1 ? words[0] : `(${words.join(" & ")})`));
  const unique = [...new Set(groups)].slice(0, 40);
  return unique.length ? unique.join(" | ") : null;
}

/**
 * Supplier items matching the phrases, best matches first. Visibility comes from row-level
 * security: the shared practice catalog plus this workspace's own items.
 */
export async function searchCatalog(
  tx: Tx,
  opts: { source: "practice" | "cj"; phrases: string[]; limit?: number; includeBranded?: boolean },
): Promise<CatalogItem[]> {
  const q = toTsQuery(opts.phrases);
  if (!q) return [];
  const limit = opts.limit ?? 60;
  // Also match each single word, so "dog harness" still finds a "pet harness".
  const loose = toTsQuery(opts.phrases.flatMap((p) => p.split(/\s+/)));
  return tx<CatalogItem[]>`
    select id, workspace_id, source, source_id, title, description, category, tags, images, cost_cents, ship_cents,
           ship_days_min, ship_days_max, stock, rating, branded, retail_source, attributes
    from armada.catalog_items
    where source = ${opts.source}
      and (${opts.includeBranded ?? false} or not branded)
      and (search @@ to_tsquery('english', ${q}) or search @@ to_tsquery('english', ${loose ?? q}))
    order by (search @@ to_tsquery('english', ${q})) desc,
             ts_rank(search, to_tsquery('english', ${loose ?? q})) desc,
             rating desc nulls last
    limit ${limit}`;
}
