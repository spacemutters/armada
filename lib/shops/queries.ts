import "server-only";
import { asSystem, withWorkspace } from "@/lib/db";
import type { CatalogImage, ItemArt, ScoreParts } from "@/lib/types";
import type { ShopRow } from "./types";

export interface ShopProduct {
  id: string;
  title: string;
  description: string;
  bullets: string[];
  images: CatalogImage[];
  category: string;
  costCents: number;
  shipCents: number;
  seoTitle: string | null;
  seoDescription: string | null;
  score: number | null;
  scoreParts: ScoreParts | Record<string, never>;
  art: ItemArt | null;
  imagined: boolean;
  shipDaysMin: number | null;
  shipDaysMax: number | null;
}

export async function listShops(workspaceId: string): Promise<ShopRow[]> {
  return withWorkspace(workspaceId, (tx) => tx<ShopRow[]>`select * from armada.shops order by created_at desc limit 200`);
}

export async function getShop(workspaceId: string, id: string): Promise<ShopRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const rows = await withWorkspace(workspaceId, (tx) => tx<ShopRow[]>`select * from armada.shops where id = ${id}`);
  return rows[0] ?? null;
}

async function productsFor(tx: Parameters<Parameters<typeof withWorkspace>[1]>[0], ids: string[]): Promise<ShopProduct[]> {
  if (!ids.length) return [];
  return tx<ShopProduct[]>`
    select p.id, p.title, p.description, p.bullets, p.images, p.category, p.cost_cents, p.ship_cents, p.seo_title,
           p.seo_description, p.score, p.score_parts, c.attributes -> 'art' as art,
           coalesce((c.attributes ->> 'imagined')::boolean, false) as imagined, c.ship_days_min, c.ship_days_max
    from armada.products p left join armada.catalog_items c on c.id = p.catalog_item_id
    where p.id in ${tx(ids)}`;
}

export async function getShopProducts(workspaceId: string, ids: string[]): Promise<ShopProduct[]> {
  return withWorkspace(workspaceId, (tx) => productsFor(tx, ids));
}

/**
 * The public preview of a built shop. Looked up by its unguessable link, so it runs with
 * system reach, and returns only what a storefront shows.
 */
export async function getShopForStorefront(slug: string): Promise<{ shop: ShopRow; products: ShopProduct[] } | null> {
  if (!/^[a-z0-9]{6,20}$/.test(slug)) return null;
  return asSystem(async (tx) => {
    const [shop] = await tx<ShopRow[]>`select * from armada.shops where slug = ${slug} and status in ('ready', 'publishing', 'published')`;
    if (!shop) return null;
    const ids = (shop.blueprint.products ?? []).map((p) => p.productId);
    return { shop, products: await productsFor(tx, ids) };
  });
}
