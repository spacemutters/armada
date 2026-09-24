import "server-only";
import type { Tx } from "@/lib/db";
import { feesCents, retailPrice } from "@/lib/pricing";
import { scoreProduct } from "@/lib/score";
import { slugify } from "@/lib/text";
import type { CatalogItem } from "@/lib/types";

// The practice fleet: pretend stores with a month of believable history, so every screen has
// something true-to-life to show before a real store is connected. Everything is marked practice.

function prng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function poisson(lambda: number, r: () => number): number {
  const l = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= r();
  } while (p > l && k < 60);
  return k - 1;
}

const GROUPS = [
  {
    name: "Kitchen",
    share: 0.4,
    categories: ["Kitchen accessories"],
    first: ["Copper", "Quiet", "Oak", "Salt", "Field", "Slow", "Plain", "Good", "Ember", "Hearth"],
    second: ["Pantry", "Table", "Kitchen", "Cook", "Larder", "Crumb", "Supply"],
  },
  {
    name: "Fitness",
    share: 0.3,
    categories: ["Sports accessories"],
    first: ["Iron", "Chalk", "North", "Tempo", "Steady", "Grit", "Summit", "Rally"],
    second: ["Supply", "Athletic", "Club", "Works", "Goods", "Lab"],
  },
  {
    name: "Home and style",
    share: 0.3,
    categories: ["Home decoration", "Tops", "Womens dresses", "Womens jewellery"],
    first: ["Linen", "Juniper", "Common", "Harbor", "Slate", "Willow", "Fern", "Dune"],
    second: ["House", "Studio", "Market", "Room", "Goods", "Supply"],
  },
];

const DAY = 86_400_000;

async function insertChunked(tx: Tx, table: string, rows: Record<string, unknown>[], size = 800) {
  for (let i = 0; i < rows.length; i += size) {
    const chunk = rows.slice(i, i + size);
    await tx`insert into ${tx("armada." + table)} ${tx(chunk as never)}`;
  }
}

export interface FleetResult {
  stores: number;
  products: number;
  listings: number;
  orders: number;
}

export async function createPracticeFleet(tx: Tx, workspaceId: string, storeCount: number, seed = Date.now() % 100000): Promise<FleetResult> {
  const r = prng(seed);
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const now = Date.now();

  const catalog = await tx<CatalogItem[]>`
    select id, workspace_id, source, source_id, title, description, category, tags, images, cost_cents, ship_cents,
           ship_days_min, ship_days_max, stock, rating, branded, retail_source, attributes
    from armada.catalog_items
    where workspace_id is null and source = 'practice' and not branded
      and category in ${tx(GROUPS.flatMap((g) => g.categories))}`;

  // Groups and their products.
  const groupProducts = new Map<string, { id: string; priceCents: number; costCents: number; title: string }[]>();
  const groupIds = new Map<string, string>();
  let productCount = 0;
  for (const g of GROUPS) {
    const [row] = await tx<{ id: string }[]>`
      insert into armada.store_groups (workspace_id, name) values (${workspaceId}, ${g.name})
      on conflict (workspace_id, name) do update set name = excluded.name returning id`;
    groupIds.set(g.name, row.id);
    const items = catalog.filter((c) => g.categories.includes(c.category)).slice(0, 14);
    const products: { id: string; priceCents: number; costCents: number; title: string }[] = [];
    const rows = items.map((item) => {
      const priceCents = retailPrice(item.costCents, item.shipCents, "mid");
      const { score, parts } = scoreProduct({
        priceCents,
        costCents: item.costCents,
        shipCents: item.shipCents,
        shipDaysMax: item.shipDaysMax,
        stock: item.stock,
        rating: item.rating != null ? Number(item.rating) : null,
        branded: false,
        retailSource: false,
        practice: true,
      });
      const id = crypto.randomUUID();
      products.push({ id, priceCents, costCents: item.costCents + item.shipCents, title: item.title });
      return {
        id,
        workspaceId,
        catalogItemId: item.id,
        title: item.title,
        description: item.description,
        bullets: tx.json([]),
        images: tx.json(item.images as never),
        category: item.category,
        costCents: item.costCents,
        shipCents: item.shipCents,
        seoTitle: item.title,
        score,
        scoreParts: tx.json(parts as never),
      };
    });
    if (rows.length) await insertChunked(tx, "products", rows);
    productCount += rows.length;
    groupProducts.set(g.name, products);
  }

  // Stores: roughly one in five is an eBay account; eBay accounts share two practice sellers so the
  // one-listing-per-seller rule has something to enforce.
  const usedNames = new Set<string>();
  const stores: { id: string; group: string; platform: "shopify" | "ebay"; sellerKey: string | null; rate: number; name: string }[] = [];
  for (let i = 0; i < storeCount; i++) {
    const roll = r();
    let acc = 0;
    const g = GROUPS.find((x) => (acc += x.share) >= roll) ?? GROUPS[0];
    let name = "";
    for (let tries = 0; tries < 50 && (!name || usedNames.has(name)); tries++) name = `${pick(g.first)} ${pick(g.second)}`;
    if (usedNames.has(name)) name = `${name} ${i + 1}`;
    usedNames.add(name);
    const platform = i % 5 === 4 ? "ebay" : "shopify";
    // A few stores carry most of the sales, as in real fleets.
    const rate = 0.35 + Math.pow(r(), 2.2) * 6;
    stores.push({ id: crypto.randomUUID(), group: g.name, platform, sellerKey: platform === "ebay" ? (i % 10 === 4 ? "practice-seller-a" : "practice-seller-b") : null, rate, name });
  }
  await insertChunked(
    tx,
    "stores",
    stores.map((s) => ({
      id: s.id,
      workspaceId,
      platform: s.platform,
      mode: "practice",
      name: s.name,
      domain: s.platform === "shopify" ? `${slugify(s.name)}.practice` : `ebay.practice/${slugify(s.name)}`,
      groupId: groupIds.get(s.group),
      sellerKey: s.sellerKey,
      status: "connected",
      health: tx.json({}),
      meta: tx.json({ practice: true, dailyRate: Number(s.rate.toFixed(2)) }),
    })),
  );

  // Listings. On eBay, one seller may list each item once across all of its accounts.
  const listingRows: Record<string, unknown>[] = [];
  const storeListings = new Map<string, { id: string; productId: string; priceCents: number; costCents: number; title: string }[]>();
  const ebayTaken = new Set<string>();
  for (const s of stores) {
    const pool = [...(groupProducts.get(s.group) ?? [])].sort(() => r() - 0.5);
    const want = 6 + Math.floor(r() * 5);
    const chosen: typeof pool = [];
    for (const p of pool) {
      if (chosen.length >= want) break;
      if (s.platform === "ebay") {
        const k = `${s.sellerKey}:${p.id}`;
        if (ebayTaken.has(k)) continue;
        ebayTaken.add(k);
      }
      chosen.push(p);
    }
    const mine = chosen.map((p) => {
      const id = crypto.randomUUID();
      // eBay prices run a little higher to cover eBay's bigger fees.
      const priceCents = s.platform === "ebay" ? Math.ceil((p.priceCents * 1.1) / 100) * 100 - 1 : p.priceCents;
      listingRows.push({
        id,
        workspaceId,
        productId: p.id,
        storeId: s.id,
        externalId: `practice-${id.slice(0, 8)}`,
        handle: slugify(p.title),
        priceCents,
        status: "active",
        lastSyncedAt: new Date(now - r() * 3_600_000),
      });
      return { id, productId: p.id, priceCents, costCents: p.costCents, title: p.title };
    });
    storeListings.set(s.id, mine);
  }
  await insertChunked(tx, "listings", listingRows);

  // Thirty days of orders.
  const orders: Record<string, unknown>[] = [];
  const lines: Record<string, unknown>[] = [];
  const supplierOrders: Record<string, unknown>[] = [];
  let orderNo = 1001;
  for (const s of stores) {
    const listings = storeListings.get(s.id) ?? [];
    if (!listings.length) continue;
    for (let d = 29; d >= 0; d--) {
      const dayStart = now - d * DAY - (now % DAY);
      const weekday = new Date(dayStart).getUTCDay();
      const trend = 0.85 + ((29 - d) / 29) * 0.3;
      const n = poisson(s.rate * trend * (weekday === 0 || weekday === 6 ? 1.2 : 1), r);
      for (let k = 0; k < n; k++) {
        const placed = dayStart + Math.floor(r() * DAY);
        if (placed > now) continue;
        const ageDays = (now - placed) / DAY;
        const orderId = crypto.randomUUID();
        const lineCount = r() < 0.18 ? 2 : 1;
        let total = 0;
        const orderLines: { id: string; cost: number }[] = [];
        for (let li = 0; li < lineCount; li++) {
          const listing = pick(listings);
          const qty = r() < 0.1 ? 2 : 1;
          const lineId = crypto.randomUUID();
          total += listing.priceCents * qty;
          orderLines.push({ id: lineId, cost: listing.costCents * qty });
          lines.push({
            id: lineId,
            workspaceId,
            orderId,
            listingId: listing.id,
            productId: listing.productId,
            title: listing.title,
            quantity: qty,
            priceCents: listing.priceCents,
            costCents: listing.costCents * qty,
          });
        }
        let status = ageDays < 0.5 ? "new" : ageDays < 3 ? "ordered" : ageDays < 9 ? "shipped" : "delivered";
        let problem: string | null = null;
        let refund = 0;
        if (status === "delivered" && r() < 0.02) {
          status = "refunded";
          refund = total;
        }
        if (status === "shipped" && ageDays < 4.5 && r() < 0.03) {
          status = "problem";
          problem = "The supplier hasn't shipped this after 4 days";
        }
        orders.push({
          id: orderId,
          workspaceId,
          storeId: s.id,
          externalId: `#${orderNo++}`,
          placedAt: new Date(placed),
          customerCountry: r() < 0.93 ? "US" : pick(["CA", "GB", "AU"]),
          totalCents: total,
          feesCents: feesCents(total, s.platform),
          refundCents: refund,
          status,
          problem,
        });
        if (status !== "new") {
          for (const l of orderLines) {
            const shipped = status === "shipped" || status === "delivered" || status === "refunded";
            supplierOrders.push({
              workspaceId,
              orderLineId: l.id,
              supplier: "practice",
              externalId: `PS-${Math.floor(r() * 1e9)}`,
              costCents: l.cost,
              status: status === "delivered" || status === "refunded" ? "delivered" : shipped ? "shipped" : "placed",
              trackingNumber: shipped ? `PRX${Math.floor(1e9 + r() * 9e9)}` : null,
              carrier: shipped ? "Practice Post" : null,
            });
          }
        }
      }
    }
  }
  await insertChunked(tx, "orders", orders);
  await insertChunked(tx, "order_lines", lines);
  await insertChunked(tx, "supplier_orders", supplierOrders);

  // Two realistic problems for the home screen.
  const kitchen = groupProducts.get("Kitchen") ?? [];
  if (kitchen.length) {
    const soldOut = kitchen[Math.floor(r() * kitchen.length)];
    await tx`update armada.products set status = 'paused' where id = ${soldOut.id}`;
    await tx`update armada.listings set status = 'hidden' where product_id = ${soldOut.id}`;
    await tx`
      update armada.products set score_parts = jsonb_set(score_parts, '{reliability}',
        ${tx.json({ value: 0, measured: false, note: "Out of stock at the supplier" } as never)})
      where id = ${soldOut.id}`;
  }
  const ebay = stores.find((s) => s.platform === "ebay");
  if (ebay) {
    await tx`
      update armada.stores set status = 'needs_attention',
        health = ${tx.json({ issue: "late_shipping", lateRate: 3.6, limit: 4, note: "Close to eBay's late-shipping limit: 3.6% of orders shipped late, and the limit is 4%." } as never)}
      where id = ${ebay.id}`;
  }

  await tx`
    update armada.workspaces set settings = settings || ${tx.json({ practice: { createdAt: new Date().toISOString(), seed, stores: storeCount }, practiceTickAt: new Date().toISOString() } as never)}
    where id = ${workspaceId}`;

  return { stores: stores.length, products: productCount, listings: listingRows.length, orders: orders.length };
}
