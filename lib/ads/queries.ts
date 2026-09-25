import "server-only";
import { cache } from "react";
import { adsInfos, adsSetupSteps, missingSettings } from "@/connectors/ads/info";
import { metaConnection, type MetaConnection } from "@/connectors/meta-ads/connection";
import { asSystem, withWorkspace } from "@/lib/db";
import type { Palette } from "@/lib/color";
import type { ShopRow } from "@/lib/shops/types";
import { appOrigin, type Provider } from "@/lib/connections/types";
import { loadShopProducts, type AdShopProduct } from "./sets";
import type { AdSet, AdVariation, Totals } from "./types";

// Reading ads for the screens. Nothing here changes anything.

const EMPTY: Totals = { impressions: 0, reach: 0, clicks: 0, addToCarts: 0, purchases: 0, spendCents: 0, salesCents: 0, days: 0, practice: false };

/** Whether this member is a platform admin (members.is_admin), who sees exactly what switches each platform on. */
export const isPlatformAdmin = cache(async (memberId: string): Promise<boolean> => {
  const rows = await asSystem((tx) => tx<{ isAdmin: boolean }[]>`select is_admin from armada.members where id = ${memberId}`);
  return rows[0]?.isAdmin === true;
});

/** What a product looks like in an ad preview; plain data, safe to hand to the browser. */
export interface ProductLite {
  id: string;
  title: string;
  imageUrl: string | null;
  icon: string | null;
  priceCents: number;
}

export function lite(p: AdShopProduct): ProductLite {
  return { id: p.id, title: p.title, imageUrl: p.images[0]?.url ?? null, icon: p.art?.icon ?? null, priceCents: p.priceCents };
}

async function totalsBy(workspaceId: string, setIds: string[], by: "ad_set_id" | "variation_id"): Promise<Map<string, Totals>> {
  const out = new Map<string, Totals>();
  if (!setIds.length) return out;
  const rows = await withWorkspace(
    workspaceId,
    (tx) => tx<(Totals & { key: string })[]>`
      select ${tx(by)} as key,
             sum(impressions)::int as impressions, sum(reach)::int as reach, sum(clicks)::int as clicks,
             sum(add_to_carts)::int as add_to_carts, sum(purchases)::int as purchases,
             sum(spend_cents)::int as spend_cents, sum(sales_cents)::int as sales_cents,
             count(distinct day)::int as days, bool_or(practice) as practice
      from armada.ad_results_daily where ad_set_id in ${tx(setIds)}
      group by ${tx(by)}`,
  );
  for (const r of rows) out.set(r.key, { ...EMPTY, ...r });
  return out;
}

// ---------- the Ads page ----------

export interface ShopAdsRow {
  shop: Pick<ShopRow, "id" | "slug" | "status" | "niche"> & { brand: string; tagline: string; palette: Palette | null; practice: boolean };
  thumb: ProductLite | null;
  set: AdSet | null;
  totals: Totals;
  ads: number;
}

export async function adsOverview(workspaceId: string): Promise<{ rows: ShopAdsRow[]; onCount: number; totals: Totals }> {
  const { shops, sets, counts } = await withWorkspace(workspaceId, async (tx) => {
    const shops = await tx<ShopRow[]>`select * from armada.shops where status in ('ready', 'published') order by created_at desc limit 200`;
    // Each shop's unfinished ad set, or else its latest one.
    const sets = await tx<AdSet[]>`
      select distinct on (shop_id) * from armada.ad_sets
      order by shop_id, (status in ('writing', 'draft', 'paused', 'on', 'failed')) desc, created_at desc`;
    const counts = sets.length
      ? await tx<{ adSetId: string; n: number }[]>`
          select ad_set_id, count(*)::int as n from armada.ad_variations where ad_set_id in ${tx(sets.map((s) => s.id))} and status <> 'removed' group by ad_set_id`
      : [];
    return { shops, sets, counts };
  });
  const firstIds = shops.map((s) => s.blueprint.products?.find((p) => p) ?? null).filter((p) => p).map((p) => p!.productId);
  const thumbs = firstIds.length
    ? await withWorkspace(
        workspaceId,
        (tx) => tx<{ id: string; title: string; images: { url: string }[]; icon: string | null }[]>`
          select p.id, p.title, p.images, c.attributes -> 'art' ->> 'icon' as icon
          from armada.products p left join armada.catalog_items c on c.id = p.catalog_item_id where p.id in ${tx(firstIds)}`,
      )
    : [];
  const thumbBy = new Map(thumbs.map((t) => [t.id, t]));
  const setBy = new Map(sets.map((s) => [s.shopId, s]));
  const countBy = new Map(counts.map((c) => [c.adSetId, c.n]));
  const totals = await totalsBy(workspaceId, sets.map((s) => s.id), "ad_set_id");

  const rows: ShopAdsRow[] = shops.map((s) => {
    const set = setBy.get(s.id) ?? null;
    const first = s.blueprint.products?.[0];
    const t = first ? thumbBy.get(first.productId) : undefined;
    return {
      shop: {
        id: s.id,
        slug: s.slug,
        status: s.status,
        niche: s.niche,
        brand: s.blueprint.brand?.name ?? s.niche,
        tagline: s.blueprint.brand?.tagline ?? "",
        palette: s.blueprint.theme?.palette ?? null,
        practice: s.brief?.source === "practice",
      },
      thumb: t && first ? { id: t.id, title: t.title, imageUrl: t.images?.[0]?.url ?? null, icon: t.icon, priceCents: first.priceCents } : null,
      set,
      totals: (set && totals.get(set.id)) ?? EMPTY,
      ads: set ? countBy.get(set.id) ?? 0 : 0,
    };
  });
  const all = rows.reduce<Totals>(
    (a, r) => ({
      impressions: a.impressions + r.totals.impressions,
      reach: a.reach + r.totals.reach,
      clicks: a.clicks + r.totals.clicks,
      addToCarts: a.addToCarts + r.totals.addToCarts,
      purchases: a.purchases + r.totals.purchases,
      spendCents: a.spendCents + r.totals.spendCents,
      salesCents: a.salesCents + r.totals.salesCents,
      days: Math.max(a.days, r.totals.days),
      practice: a.practice || r.totals.practice,
    }),
    EMPTY,
  );
  return { rows, onCount: rows.filter((r) => r.set?.status === "on").length, totals: all };
}

// ---------- one shop's ads ----------

export interface ShopAdsView {
  shop: ShopRow;
  /** The shop's address as ads show it. */
  domain: string;
  set: AdSet | null;
  variations: AdVariation[];
  products: Record<string, ProductLite>;
  totals: Totals;
  byVariation: Record<string, Totals>;
  /** Day by day, for the whole set: spend and visits. */
  daily: { day: string; spendCents: number; clicks: number; purchases: number }[];
  earlier: { id: string; createdAt: Date; stopReason: string | null; platform: AdSet["platform"]; totals: Totals }[];
}

export async function shopAdsView(workspaceId: string, shopId: string): Promise<ShopAdsView | null> {
  if (!/^[0-9a-f-]{36}$/i.test(shopId)) return null;
  const data = await withWorkspace(workspaceId, async (tx) => {
    const [shop] = await tx<ShopRow[]>`select * from armada.shops where id = ${shopId}`;
    if (!shop) return null;
    const sets = await tx<AdSet[]>`
      select * from armada.ad_sets where shop_id = ${shopId}
      order by (status in ('writing', 'draft', 'paused', 'on', 'failed')) desc, created_at desc limit 10`;
    const set = sets[0] ?? null;
    const variations = set ? await tx<AdVariation[]>`select * from armada.ad_variations where ad_set_id = ${set.id} order by position` : [];
    const products = await loadShopProducts(tx, shop);
    const daily = set
      ? await tx<{ day: string; spendCents: number; clicks: number; purchases: number }[]>`
          select to_char(day, 'YYYY-MM-DD') as day, sum(spend_cents)::int as spend_cents, sum(clicks)::int as clicks, sum(purchases)::int as purchases
          from armada.ad_results_daily where ad_set_id = ${set.id} group by day order by day`
      : [];
    const [store] = shop.storeId ? await tx<{ mode: string; domain: string | null }[]>`select mode, domain from armada.stores where id = ${shop.storeId}` : [];
    const domain = store?.mode === "live" && store.domain ? store.domain : new URL(appOrigin()).host;
    return { shop, sets, set, variations, products, daily, domain };
  });
  if (!data) return null;
  const { shop, sets, set, variations, products, daily, domain } = data;
  const setTotals = await totalsBy(workspaceId, sets.map((s) => s.id), "ad_set_id");
  const byVariation = set ? await totalsBy(workspaceId, [set.id], "variation_id") : new Map<string, Totals>();
  return {
    shop,
    domain,
    set,
    variations,
    products: Object.fromEntries(products.map((p) => [p.id, lite(p)])),
    totals: (set && setTotals.get(set.id)) ?? EMPTY,
    byVariation: Object.fromEntries(byVariation),
    daily,
    earlier: sets
      .slice(1)
      .filter((s) => s.status === "stopped")
      .map((s) => ({ id: s.id, createdAt: s.createdAt, stopReason: s.stopReason, platform: s.platform, totals: setTotals.get(s.id) ?? EMPTY })),
  };
}

// ---------- where ads can run ----------

export interface PlatformRow {
  provider: Provider;
  name: string;
  blurb: string;
  available: boolean;
  /** Meta only: the connected sign-in (never the secret). */
  meta: MetaConnection | null;
  /** For platform admins: what's still missing and the steps to switch it on. */
  missing: string[];
  steps: string[];
  callback: string | null;
}

export async function platformRows(workspaceId: string): Promise<PlatformRow[]> {
  const meta = await metaConnection(workspaceId).catch(() => null);
  return adsInfos.map((info) => ({
    provider: info.provider,
    name: info.name,
    blurb: info.blurb,
    available: info.available(),
    meta: info.provider === "meta_ads" ? meta : null,
    missing: missingSettings(info),
    steps: adsSetupSteps[info.provider] ?? [info.ownerSetup],
    callback: info.callbackPath ?? null,
  }));
}
