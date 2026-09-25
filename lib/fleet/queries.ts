import "server-only";
import { withWorkspace } from "@/lib/db";
import type { Store } from "@/lib/types";

// Profit here is always: sales, minus supplier cost, minus platform fees, minus refunds.
// Ad spend joins once ads are connected; the screens say so until then.

const TZ = "America/New_York";

export interface DaySummary {
  salesCents: number;
  profitCents: number;
  orders: number;
}

export interface StoreTile {
  id: string;
  name: string;
  platform: Store["platform"];
  mode: Store["mode"];
  status: Store["status"];
  group: string | null;
  todayCents: number;
  avgDayCents: number;
  /** The store's icon from the shop builder's icon set; null draws a plain square. */
  icon: string | null;
}

export interface NeedsYou {
  kind: "store" | "orders" | "stock" | "shop";
  title: string;
  body: string;
  href: string;
}

export async function homeSummary(workspaceId: string) {
  return withWorkspace(workspaceId, async (tx) => {
    const [yesterday] = await tx<DaySummary[]>`
      with bounds as (
        select (date_trunc('day', now() at time zone ${TZ}) - interval '1 day') at time zone ${TZ} as start_at,
               date_trunc('day', now() at time zone ${TZ}) at time zone ${TZ} as end_at
      ), o as (
        select o.id, o.total_cents, o.fees_cents, o.refund_cents,
               coalesce((select sum(l.cost_cents) from armada.order_lines l where l.order_id = o.id), 0) as cost_cents
        from armada.orders o, bounds b
        where o.placed_at >= b.start_at and o.placed_at < b.end_at and o.status <> 'cancelled'
      )
      select coalesce(sum(total_cents), 0)::int as sales_cents,
             coalesce(sum(total_cents - fees_cents - refund_cents - cost_cents), 0)::int as profit_cents,
             count(*)::int as orders
      from o`;

    const [week] = await tx<DaySummary[]>`
      with o as (
        select o.total_cents, o.fees_cents, o.refund_cents,
               coalesce((select sum(l.cost_cents) from armada.order_lines l where l.order_id = o.id), 0) as cost_cents
        from armada.orders o where o.placed_at >= now() - interval '7 days' and o.status <> 'cancelled'
      )
      select coalesce(sum(total_cents), 0)::int as sales_cents,
             coalesce(sum(total_cents - fees_cents - refund_cents - cost_cents), 0)::int as profit_cents,
             count(*)::int as orders
      from o`;

    const tiles = await tx<StoreTile[]>`
      select s.id, s.name, s.platform, s.mode, s.status, s.icon, g.name as "group",
             coalesce(sum(o.total_cents) filter (where o.placed_at >= now() - interval '24 hours'), 0)::int as today_cents,
             coalesce(sum(o.total_cents) filter (where o.placed_at >= now() - interval '15 days' and o.placed_at < now() - interval '24 hours') / 14, 0)::int as avg_day_cents
      from armada.stores s
      left join armada.store_groups g on g.id = s.group_id
      left join armada.orders o on o.store_id = s.id and o.placed_at >= now() - interval '15 days'
      group by s.id, g.name
      order by g.name nulls last, s.name`;

    const needs: NeedsYou[] = [];
    const attention = await tx<{ id: string; name: string; health: { note?: string } }[]>`
      select id, name, health from armada.stores where status = 'needs_attention' order by name limit 5`;
    for (const s of attention) {
      needs.push({ kind: "store", title: s.name, body: s.health?.note ?? "This store needs a look.", href: `/stores/${s.id}` });
    }
    const [problems] = await tx<{ n: number }[]>`select count(*)::int as n from armada.orders where status = 'problem'`;
    if (problems.n) {
      needs.push({
        kind: "orders",
        title: `${problems.n} ${problems.n === 1 ? "order is" : "orders are"} stuck`,
        body: "The supplier hasn't shipped them on time. Check with the supplier or refund the buyer.",
        href: "/orders?tab=needs",
      });
    }
    const soldOut = await tx<{ title: string; hidden: number }[]>`
      select p.title, count(l.id)::int as hidden
      from armada.products p join armada.listings l on l.product_id = p.id and l.status = 'hidden'
      where p.status = 'paused'
      group by p.id order by hidden desc limit 3`;
    for (const p of soldOut) {
      needs.push({
        kind: "stock",
        title: `${p.title} is out of stock at the supplier`,
        body: `Armada already hid it in ${p.hidden} ${p.hidden === 1 ? "store" : "stores"}. It comes back on its own when stock returns.`,
        href: "/products",
      });
    }
    const failedShops = await tx<{ id: string; niche: string }[]>`
      select id, niche from armada.shops where status = 'failed' and updated_at > now() - interval '3 days' order by updated_at desc limit 3`;
    for (const s of failedShops) {
      needs.push({ kind: "shop", title: `A shop build stopped`, body: `“${s.niche}”. You can build it again in one press.`, href: `/builder/${s.id}` });
    }

    const [counts] = await tx<{ stores: number; practice: number; shops: number; building: number }[]>`
      select (select count(*) from armada.stores)::int as stores,
             (select count(*) from armada.stores where mode = 'practice')::int as practice,
             (select count(*) from armada.shops)::int as shops,
             (select count(*) from armada.shops where status = 'building')::int as building`;

    return { yesterday, week, tiles, needs, counts };
  });
}

export interface StoreRow extends StoreTile {
  domain: string | null;
  sellerKey: string | null;
  health: Record<string, unknown>;
  sales7Cents: number;
  profit7Cents: number;
  orders7: number;
  activeListings: number;
}

export async function storesTable(workspaceId: string): Promise<StoreRow[]> {
  return withWorkspace(
    workspaceId,
    (tx) => tx<StoreRow[]>`
      with o as (
        select o.store_id, o.total_cents, o.fees_cents, o.refund_cents, o.placed_at,
               coalesce((select sum(l.cost_cents) from armada.order_lines l where l.order_id = o.id), 0) as cost_cents
        from armada.orders o where o.placed_at >= now() - interval '15 days' and o.status <> 'cancelled'
      )
      select s.id, s.name, s.platform, s.mode, s.status, s.icon, s.domain, s.seller_key, s.health, g.name as "group",
             coalesce(sum(o.total_cents) filter (where o.placed_at >= now() - interval '24 hours'), 0)::int as today_cents,
             coalesce(sum(o.total_cents) filter (where o.placed_at < now() - interval '24 hours') / 14, 0)::int as avg_day_cents,
             coalesce(sum(o.total_cents) filter (where o.placed_at >= now() - interval '7 days'), 0)::int as sales7_cents,
             coalesce(sum(o.total_cents - o.fees_cents - o.refund_cents - o.cost_cents) filter (where o.placed_at >= now() - interval '7 days'), 0)::int as profit7_cents,
             count(o.*) filter (where o.placed_at >= now() - interval '7 days')::int as orders7,
             (select count(*) from armada.listings l where l.store_id = s.id and l.status = 'active')::int as active_listings
      from armada.stores s
      left join armada.store_groups g on g.id = s.group_id
      left join o on o.store_id = s.id
      group by s.id, g.name
      order by sales7_cents desc, s.name`,
  );
}

export async function storeDetail(workspaceId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return withWorkspace(workspaceId, async (tx) => {
    const [store] = await tx<(Store & { group: string | null })[]>`
      select s.*, g.name as "group" from armada.stores s left join armada.store_groups g on g.id = s.group_id where s.id = ${id}`;
    if (!store) return null;
    const listings = await tx<
      { id: string; title: string; priceCents: number; status: string; score: number | null; costCents: number; shipCents: number; images: { url: string }[]; productId: string; productStatus: string; art: { icon?: string } | null }[]
    >`
      select l.id, p.title, l.price_cents, l.status, p.score, p.cost_cents, p.ship_cents, p.images, p.id as product_id, p.status as product_status,
             c.attributes -> 'art' as art
      from armada.listings l join armada.products p on p.id = l.product_id
      left join armada.catalog_items c on c.id = p.catalog_item_id
      where l.store_id = ${id} order by l.status, p.title`;
    const orders = await tx<{ id: string; externalId: string; placedAt: Date; totalCents: number; status: string; problem: string | null; items: number }[]>`
      select o.id, o.external_id, o.placed_at, o.total_cents, o.status, o.problem,
             (select coalesce(sum(quantity), 0) from armada.order_lines l where l.order_id = o.id)::int as items
      from armada.orders o where o.store_id = ${id} order by o.placed_at desc limit 25`;
    const daily = await tx<{ day: string; salesCents: number }[]>`
      select to_char(d::date, 'YYYY-MM-DD') as day,
             coalesce((select sum(total_cents) from armada.orders o where o.store_id = ${id}
                       and o.placed_at >= d and o.placed_at < d + interval '1 day'), 0)::int as sales_cents
      from generate_series(date_trunc('day', now()) - interval '29 days', date_trunc('day', now()), interval '1 day') d
      order by d`;
    return { store, listings, orders, daily };
  });
}
