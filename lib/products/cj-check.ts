import "server-only";
import { isFatalCjError } from "@/connectors/cj/client";
import { checkCjItem } from "@/lib/catalog/cj";
import { withWorkspace } from "@/lib/db";
import { scoreCatalogItem } from "./score-item";

const MAX_PER_RUN = 80;

/**
 * Confirms CJ products after they're added: full photos, the real cost of the default variant, and
 * the real shipping price and time to `country`. Scores and costs are rewritten from what CJ says.
 * Runs after the response (two CJ calls per product, in the account's speed lane).
 */
export async function checkProductsWithCj(workspaceId: string, productIds: string[], country = "US"): Promise<number> {
  if (!productIds.length) return 0;
  const rows = await withWorkspace(
    workspaceId,
    (tx) => tx<{ id: string; catalogItemId: string }[]>`
      select p.id, p.catalog_item_id from armada.products p join armada.catalog_items c on c.id = p.catalog_item_id
      where p.id in ${tx(productIds)} and c.source = 'cj'`,
  );
  let done = 0;
  // About 2.5 seconds a product in CJ's speed lane; 80 fit well inside one 5-minute run. Any beyond
  // that stay marked "not confirmed" (and costed with the cautious stand-in) until checked later.
  for (const r of rows.slice(0, MAX_PER_RUN)) {
    try {
      const item = await checkCjItem(workspaceId, r.catalogItemId, country);
      const { score, parts } = scoreCatalogItem(item, "mid");
      await withWorkspace(
        workspaceId,
        (tx) => tx`
          update armada.products set cost_cents = ${item.costCents}, ship_cents = ${item.shipCents}, images = ${tx.json(item.images as never)},
            category = ${item.category}, score = ${score}, score_parts = ${tx.json(parts as never)}, updated_at = now()
          where id = ${r.id}`,
      );
      done++;
    } catch (e) {
      if (isFatalCjError(e)) break;
      console.error("CJ check failed", r.catalogItemId, e);
    }
  }
  return done;
}
