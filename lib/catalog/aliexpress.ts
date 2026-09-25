import "server-only";
import { freightOptions, pickFreight, productDetail, searchProducts, type AeSearchItem } from "@/connectors/aliexpress/api";
import { AliexpressNotConnected } from "@/connectors/aliexpress/client";
import { AliexpressError } from "@/connectors/aliexpress/sign";
import { plainText } from "@/connectors/cj/api";
import { mentionsBrand } from "@/lib/brands";
import { withWorkspace } from "@/lib/db";
import { UNCONFIRMED_SHIP_CENTS } from "@/lib/pricing";
import type { CatalogItem } from "@/lib/types";

// Bringing AliExpress products into a workspace's catalog, the same way as CJ's: a search gives the
// basics (title, main photo, price, rating, how often it has sold), and "checking" an item pulls its
// full photos, variants and description, then a real shipping quote to one country. Until an item is
// checked its shipping is a cautious stand-in, and its score says so.

export interface AliexpressAttributes {
  aliexpress: {
    orders?: number;
    url?: string;
    checked?: boolean;
    checkedFor?: string;
    /** A country AliExpress gave no shipping quote to for this item. */
    noRouteTo?: string;
    freight?: { name: string; daysMin: number | null; daysMax: number | null };
    skus?: { id: string; costCents: number | null; label: string }[];
    defaultSkuId?: string;
    reviews?: number;
    brand?: string;
  };
}

const COLS = `id, workspace_id, source, source_id, title, description, category, tags, images, cost_cents, ship_cents,
  ship_days_min, ship_days_max, stock, rating, branded, retail_source, attributes`;

/** A refused or expired connection stops a run; one bad phrase or item doesn't. */
export function isFatalAliexpressError(e: unknown): boolean {
  if (e instanceof AliexpressNotConnected) return true;
  return e instanceof AliexpressError && /token|session|auth|sign|appkey|app_key|not_set_up/i.test(`${e.code} ${e.message}`);
}

function rowFromSearch(p: AeSearchItem) {
  const brand = mentionsBrand(p.title);
  return {
    sourceId: p.id,
    title: p.title.slice(0, 200),
    images: p.image ? [{ url: p.image, alt: p.title }] : [],
    costCents: p.costCents ?? 0,
    rating: p.rating,
    branded: Boolean(brand),
    attributes: {
      aliexpress: {
        ...(p.orders != null ? { orders: p.orders } : {}),
        ...(p.url ? { url: p.url } : {}),
        checked: false,
        ...(brand ? { brand } : {}),
      },
    } satisfies AliexpressAttributes,
  };
}

/** Searches AliExpress for each phrase (one call each, in the account's speed lane) and saves what it finds. */
export async function importAliexpressSearch(
  workspaceId: string,
  phrases: string[],
  opts: { perPhrase?: number; maxPhrases?: number; country?: string } = {},
): Promise<CatalogItem[]> {
  const seen = new Map<string, AeSearchItem>();
  let failure: unknown = null;
  for (const phrase of [...new Set(phrases.map((p) => p.trim()).filter(Boolean))].slice(0, opts.maxPhrases ?? 5)) {
    try {
      for (const p of await searchProducts(workspaceId, phrase, { country: opts.country, pageSize: opts.perPhrase ?? 20 })) {
        // Items with no price can't be costed, so they never reach the catalog.
        if (p.costCents && !seen.has(p.id)) seen.set(p.id, p);
      }
    } catch (e) {
      failure = e;
      if (isFatalAliexpressError(e)) break;
    }
  }
  if (!seen.size) {
    if (failure) throw failure;
    return [];
  }
  const byId = await withWorkspace(workspaceId, async (tx) => {
    const rows = new Map<string, CatalogItem>();
    for (const p of [...seen.values()].sort((x, y) => (x.id < y.id ? -1 : 1))) {
      const r = rowFromSearch(p);
      // A checked item keeps what AliExpress confirmed; a later search refreshes only its sales count and rating.
      const [row] = await tx<CatalogItem[]>`
        insert into armada.catalog_items
          (workspace_id, source, source_id, title, description, category, images, cost_cents, ship_cents, rating, branded, attributes)
        values (${workspaceId}, 'aliexpress', ${r.sourceId}, ${r.title}, '', '', ${tx.json(r.images as never)},
                ${r.costCents}, ${UNCONFIRMED_SHIP_CENTS}, ${r.rating}, ${r.branded}, ${tx.json(r.attributes as never)})
        on conflict (workspace_id, source, source_id) do update set
          rating = coalesce(excluded.rating, armada.catalog_items.rating),
          branded = armada.catalog_items.branded or excluded.branded,
          updated_at = now(),
          title = case when armada.catalog_items.attributes -> 'aliexpress' ->> 'checked' = 'true' then armada.catalog_items.title else excluded.title end,
          cost_cents = case when armada.catalog_items.attributes -> 'aliexpress' ->> 'checked' = 'true' then armada.catalog_items.cost_cents else excluded.cost_cents end,
          images = case when armada.catalog_items.attributes -> 'aliexpress' ->> 'checked' = 'true' then armada.catalog_items.images else excluded.images end,
          attributes = jsonb_set(coalesce(armada.catalog_items.attributes, '{}'), '{aliexpress}',
                                 case when armada.catalog_items.attributes -> 'aliexpress' ->> 'checked' = 'true'
                                      then (armada.catalog_items.attributes -> 'aliexpress') || jsonb_strip_nulls(jsonb_build_object('orders', excluded.attributes -> 'aliexpress' -> 'orders'))
                                      else coalesce(armada.catalog_items.attributes -> 'aliexpress', '{}') || (excluded.attributes -> 'aliexpress') end)
        returning ${tx.unsafe(COLS)}`;
      rows.set(r.sourceId, row);
    }
    return rows;
  });
  // Back in AliExpress's order, most relevant first.
  return [...seen.keys()].map((id) => byId.get(id)).filter((x): x is CatalogItem => Boolean(x));
}

/**
 * Checks one AliExpress item: full photos, variants, stock and description, then a real shipping
 * quote to `country`. Two AliExpress calls, both through the speed lane. Returns the updated item.
 */
export async function checkAliexpressItem(workspaceId: string, catalogItemId: string, country: string): Promise<CatalogItem> {
  const [item] = await withWorkspace(workspaceId, (tx) => tx<CatalogItem[]>`select ${tx.unsafe(COLS)} from armada.catalog_items where id = ${catalogItemId}`);
  if (!item || item.source !== "aliexpress") throw new Error("Not an AliExpress item");
  const attrs = (item.attributes as unknown as AliexpressAttributes).aliexpress ?? {};
  if (attrs.checked && attrs.checkedFor === country) return item;
  if (attrs.noRouteTo === country) return item;

  const d = await productDetail(workspaceId, item.sourceId, country);
  let freight = null;
  try {
    freight = pickFreight(await freightOptions(workspaceId, item.sourceId, d.defaultSkuId, country));
  } catch (e) {
    // No quote is an answer ("unchecked"); a dead connection is not.
    if (isFatalAliexpressError(e)) throw e;
    console.error("AliExpress shipping quote failed", item.sourceId, e);
  }

  const images = [...new Set([...d.images, item.images[0]?.url].filter((u): u is string => Boolean(u && /^https?:\/\//.test(u))))]
    .slice(0, 6)
    .map((url) => ({ url, alt: d.title || item.title }));
  const costCents = d.costCents ?? item.costCents;
  const brand = mentionsBrand(`${d.title} ${item.title}`);
  // As with CJ, "checked" means a real shipping price came back; without one the stand-in stays.
  const next: AliexpressAttributes["aliexpress"] = {
    ...attrs,
    checked: Boolean(freight),
    checkedFor: freight ? country : undefined,
    noRouteTo: freight ? undefined : country,
    freight: freight ? { name: freight.name, daysMin: freight.daysMin, daysMax: freight.daysMax } : undefined,
    skus: d.skus,
    defaultSkuId: d.defaultSkuId ?? undefined,
    ...(d.orders != null ? { orders: d.orders } : {}),
    ...(d.reviews != null ? { reviews: d.reviews } : {}),
    ...(brand ? { brand } : { brand: undefined }),
  };

  const [updated] = await withWorkspace(
    workspaceId,
    (tx) => tx<CatalogItem[]>`
      update armada.catalog_items set
        title = ${(d.title || item.title).slice(0, 200)},
        description = ${plainText(d.descriptionHtml, 2500) || item.description},
        images = ${tx.json(images as never)},
        cost_cents = ${costCents},
        ship_cents = ${freight?.priceCents ?? UNCONFIRMED_SHIP_CENTS},
        ship_days_min = ${freight?.daysMin ?? null},
        ship_days_max = ${freight?.daysMax ?? d.deliveryDays ?? null},
        stock = ${d.stock},
        rating = ${d.rating ?? item.rating},
        branded = ${Boolean(brand)},
        attributes = ${tx.json({ ...item.attributes, aliexpress: next } as never)},
        updated_at = now()
      where id = ${item.id}
      returning ${tx.unsafe(COLS)}`,
  );
  return updated;
}
