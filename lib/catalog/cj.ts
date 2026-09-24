import "server-only";
import { freightOptions, pickFreight, plainText, priceToCents, productDetail, searchProducts, type CjListProduct } from "@/connectors/cj/api";
import { mentionsBrand } from "@/lib/brands";
import { withWorkspace } from "@/lib/db";
import type { CatalogItem } from "@/lib/types";

// Bringing CJ products into a workspace's catalog. A search gives the basics fast; "checking" an
// item then pulls its full photos and variants and the real shipping price and time to a country.
// Until an item is checked its shipping is unknown, and its score says so.

export interface CjAttributes {
  cj: {
    sku?: string;
    listedNum?: number;
    supplierName?: string;
    freeShipping?: boolean;
    checked?: boolean;
    checkedFor?: string;
    freight?: { name: string; daysMin: number | null; daysMax: number | null };
    variants?: { vid: string; sku: string; key?: string; priceCents: number | null; image?: string }[];
    defaultVid?: string;
    materials?: string[];
    packing?: string[];
    weightGrams?: number;
    suggestedPrice?: string;
    brand?: string;
  };
}

const COLS = `id, workspace_id, source, source_id, title, description, category, tags, images, cost_cents, ship_cents,
  ship_days_min, ship_days_max, stock, rating, branded, retail_source, attributes`;

function rowFromListing(p: CjListProduct) {
  const brand = mentionsBrand(p.nameEn ?? "");
  return {
    sourceId: p.id,
    title: (p.nameEn ?? "").trim().slice(0, 200),
    description: plainText(p.description, 1500),
    category: p.threeCategoryName || p.oneCategoryName || "",
    images: p.bigImage ? [{ url: p.bigImage, alt: p.nameEn }] : [],
    costCents: priceToCents(p.sellPrice) ?? 0,
    stock: typeof p.warehouseInventoryNum === "number" ? p.warehouseInventoryNum : null,
    branded: Boolean(brand),
    attributes: {
      cj: {
        sku: p.sku,
        listedNum: p.listedNum,
        supplierName: p.supplierName,
        freeShipping: p.addMarkStatus === 1,
        checked: false,
        ...(brand ? { brand } : {}),
      },
    } satisfies CjAttributes,
  };
}

/** Searches CJ for each phrase (one call each, in the account's speed lane) and saves what it finds. */
export async function importCjSearch(
  workspaceId: string,
  phrases: string[],
  opts: { perPhrase?: number; maxPhrases?: number; countryCode?: string } = {},
): Promise<CatalogItem[]> {
  const seen = new Map<string, CjListProduct>();
  for (const phrase of [...new Set(phrases.map((p) => p.trim()).filter(Boolean))].slice(0, opts.maxPhrases ?? 5)) {
    for (const p of await searchProducts(workspaceId, { keyword: phrase, size: opts.perPhrase ?? 20, countryCode: opts.countryCode })) {
      if (p?.id && p.nameEn && !seen.has(p.id)) seen.set(p.id, p);
    }
  }
  if (!seen.size) return [];
  return withWorkspace(workspaceId, async (tx) => {
    const saved: CatalogItem[] = [];
    for (const p of seen.values()) {
      const r = rowFromListing(p);
      const [row] = await tx<CatalogItem[]>`
        insert into armada.catalog_items
          (workspace_id, source, source_id, title, description, category, images, cost_cents, ship_cents, stock, branded, attributes)
        values (${workspaceId}, 'cj', ${r.sourceId}, ${r.title}, ${r.description}, ${r.category}, ${tx.json(r.images as never)},
                ${r.costCents}, 0, ${r.stock}, ${r.branded}, ${tx.json(r.attributes as never)})
        on conflict (workspace_id, source, source_id) do update set
          title = excluded.title, category = excluded.category, cost_cents = excluded.cost_cents, stock = excluded.stock,
          branded = excluded.branded, updated_at = now(),
          description = case when armada.catalog_items.attributes -> 'cj' ->> 'checked' = 'true' then armada.catalog_items.description else excluded.description end,
          images = case when armada.catalog_items.attributes -> 'cj' ->> 'checked' = 'true' then armada.catalog_items.images else excluded.images end,
          attributes = case when armada.catalog_items.attributes -> 'cj' ->> 'checked' = 'true' then armada.catalog_items.attributes else excluded.attributes end
        returning ${tx.unsafe(COLS)}`;
      saved.push(row);
    }
    return saved;
  });
}

/**
 * Checks one CJ item: full photos, variants and materials, then the real shipping price and days to
 * `country`. Two CJ calls, both through the speed lane. Returns the updated item.
 */
export async function checkCjItem(workspaceId: string, catalogItemId: string, country: string): Promise<CatalogItem> {
  const [item] = await withWorkspace(workspaceId, (tx) => tx<CatalogItem[]>`select ${tx.unsafe(COLS)} from armada.catalog_items where id = ${catalogItemId}`);
  if (!item || item.source !== "cj") throw new Error("Not a CJ item");
  const attrs = (item.attributes as unknown as CjAttributes).cj ?? {};
  if (attrs.checked && attrs.checkedFor === country) return item;

  const d = await productDetail(workspaceId, item.sourceId);
  const variants = (d.variants ?? []).slice(0, 30).map((v) => ({
    vid: v.vid,
    sku: v.variantSku,
    key: v.variantKey,
    priceCents: typeof v.variantSellPrice === "number" ? Math.round(v.variantSellPrice * 100) : null,
    image: v.variantImage,
  }));
  const main = variants[0];
  const freight = main ? pickFreight(await freightOptions(workspaceId, main.vid, country)) : null;

  const images = [...new Set([d.bigImage, ...(d.productImageSet ?? []), item.images[0]?.url].filter((u): u is string => Boolean(u)))]
    .slice(0, 6)
    .map((url) => ({ url, alt: d.productNameEn || item.title }));
  const costCents = main?.priceCents ?? priceToCents(d.sellPrice) ?? item.costCents;
  const brand = mentionsBrand(`${d.productNameEn ?? ""} ${item.title}`);
  const next: CjAttributes["cj"] = {
    ...attrs,
    checked: true,
    checkedFor: country,
    freight: freight ? { name: freight.name, daysMin: freight.daysMin, daysMax: freight.daysMax } : undefined,
    variants,
    defaultVid: main?.vid,
    materials: d.materialNameEnSet,
    packing: d.packingNameEnSet,
    weightGrams: d.productWeight,
    suggestedPrice: d.suggestSellPrice,
    ...(brand ? { brand } : {}),
  };

  const [updated] = await withWorkspace(
    workspaceId,
    (tx) => tx<CatalogItem[]>`
      update armada.catalog_items set
        title = ${(d.productNameEn || item.title).slice(0, 200)},
        description = ${plainText(d.description, 2500) || item.description},
        category = ${d.categoryName?.split(">").at(-1)?.trim() || item.category},
        images = ${tx.json(images as never)},
        cost_cents = ${costCents},
        ship_cents = ${freight?.priceCents ?? 0},
        ship_days_min = ${freight?.daysMin ?? null},
        ship_days_max = ${freight?.daysMax ?? null},
        branded = ${Boolean(brand)},
        attributes = ${tx.json({ ...item.attributes, cj: next } as never)},
        updated_at = now()
      where id = ${item.id}
      returning ${tx.unsafe(COLS)}`,
  );
  return updated;
}

export function isChecked(item: Pick<CatalogItem, "attributes">): boolean {
  return Boolean((item.attributes as unknown as CjAttributes).cj?.checked);
}
