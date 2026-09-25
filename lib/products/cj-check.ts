import "server-only";
import { isFatalCjError } from "@/connectors/cj/client";
import { checkAliexpressItem, isFatalAliexpressError } from "@/lib/catalog/aliexpress";
import { checkCjItem } from "@/lib/catalog/cj";
import { withWorkspace } from "@/lib/db";
import type { CatalogItem } from "@/lib/types";
import { scoreCatalogItem } from "./score-item";

const MAX_PER_RUN = 80;

const CHECKERS: Record<"cj" | "aliexpress", { check: (ws: string, id: string, country: string) => Promise<CatalogItem>; fatal: (e: unknown) => boolean; name: string }> = {
  cj: { check: checkCjItem, fatal: isFatalCjError, name: "CJ" },
  aliexpress: { check: checkAliexpressItem, fatal: isFatalAliexpressError, name: "AliExpress" },
};

/**
 * Confirms supplier products after they're added: full photos, the real cost of the default variant,
 * and the real shipping price and time to `country`. Scores and costs are rewritten from what the
 * supplier says. Runs after the response (two supplier calls per product, in the account's speed lane).
 */
export async function checkProductsWithCj(workspaceId: string, productIds: string[], country = "US"): Promise<number> {
  if (!productIds.length) return 0;
  const rows = await withWorkspace(
    workspaceId,
    (tx) => tx<{ id: string; catalogItemId: string; source: "cj" | "aliexpress" }[]>`
      select p.id, p.catalog_item_id, c.source from armada.products p join armada.catalog_items c on c.id = p.catalog_item_id
      where p.id in ${tx(productIds)} and c.source in ('cj', 'aliexpress')`,
  );
  let done = 0;
  const stopped = new Set<string>();
  // About 2.5 seconds a product in a supplier's speed lane; 80 fit well inside one 5-minute run. Any
  // beyond that stay marked "not confirmed" (and costed with the cautious stand-in) until checked later.
  for (const r of rows.slice(0, MAX_PER_RUN)) {
    if (stopped.has(r.source)) continue;
    const checker = CHECKERS[r.source];
    try {
      const item = await checker.check(workspaceId, r.catalogItemId, country);
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
      // A refused connection stops that supplier's checks; the other supplier carries on.
      if (checker.fatal(e)) stopped.add(r.source);
      else console.error(`${checker.name} check failed`, r.catalogItemId, e);
    }
  }
  return done;
}
