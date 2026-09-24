import "server-only";
import type { Tx } from "@/lib/db";
import { retailPrice } from "@/lib/pricing";
import { scoreProduct } from "@/lib/score";
import { slugify } from "@/lib/text";
import type { CatalogItem } from "@/lib/types";

// One practice store, opened on request: a pretend Shopify store, eBay account or Facebook shop
// with a handful of real-looking products from the shared practice catalog and no history yet
// (it's brand new). Same rules as the practice fleet in lib/practice/fleet.ts: products priced by
// the pricing rules, eBay prices a little higher for eBay's fees, and eBay's one-listing-per-item
// rule respected across the practice seller's accounts. No real money is involved anywhere.

export type PracticePlatform = "shopify" | "ebay" | "facebook";

const THEMES = [
  { categories: ["Kitchen accessories"], first: ["Copper", "Quiet", "Oak", "Salt", "Field", "Slow", "Ember", "Hearth"], second: ["Pantry", "Table", "Kitchen", "Larder", "Supply"] },
  { categories: ["Sports accessories"], first: ["Iron", "Chalk", "North", "Tempo", "Steady", "Summit", "Rally"], second: ["Supply", "Athletic", "Club", "Works", "Goods"] },
  { categories: ["Home decoration", "Tops", "Womens dresses", "Womens jewellery"], first: ["Linen", "Juniper", "Common", "Harbor", "Willow", "Fern", "Dune"], second: ["House", "Studio", "Market", "Room", "Goods"] },
];

/** The practice seller behind practice eBay accounts (the practice fleet uses the same one). */
const PRACTICE_SELLER = "practice-seller-a";
const WANT = 8;

function pick<T>(xs: T[], r: () => number): T {
  return xs[Math.floor(r() * xs.length)];
}

/** A name that reads like a small independent shop, not yet used in this workspace. */
export function practiceName(taken: Set<string>, theme = THEMES[0], r: () => number = Math.random): string {
  for (let i = 0; i < 40; i++) {
    const name = `${pick(theme.first, r)} ${pick(theme.second, r)}`;
    if (!taken.has(name.toLowerCase())) return name;
  }
  let n = 2;
  const base = `${pick(theme.first, r)} ${pick(theme.second, r)}`;
  while (taken.has(`${base} ${n}`.toLowerCase())) n++;
  return `${base} ${n}`;
}

function practiceDomain(platform: PracticePlatform, name: string): string {
  const slug = slugify(name);
  return platform === "shopify" ? `${slug}.practice` : `${platform}.practice/${slug}`;
}

export interface PracticeOpened {
  storeId: string;
  name: string;
  listed: number;
}

export async function openPracticeStore(
  tx: Tx,
  workspaceId: string,
  memberId: string,
  input: { platform: PracticePlatform; name?: string },
  r: () => number = Math.random,
): Promise<PracticeOpened> {
  const theme = pick(THEMES, r);
  const taken = new Set((await tx<{ name: string }[]>`select name from armada.stores`).map((s) => s.name.toLowerCase()));
  const name = input.name?.trim().slice(0, 60) || practiceName(taken, theme, r);
  const sellerKey = input.platform === "ebay" ? PRACTICE_SELLER : null;

  const [store] = await tx<{ id: string }[]>`
    insert into armada.stores (workspace_id, platform, mode, name, domain, currency, country, status, seller_key, meta)
    values (${workspaceId}, ${input.platform}, 'practice', ${name}, ${practiceDomain(input.platform, name)}, 'USD', 'US', 'connected',
            ${sellerKey}, ${tx.json({ practice: true, openedAt: new Date().toISOString(), openedFrom: "open-a-new-store", dailyRate: Number((0.6 + r() * 1.4).toFixed(2)) } as never)})
    returning id`;

  const items = await tx<CatalogItem[]>`
    select id, workspace_id, source, source_id, title, description, category, tags, images, cost_cents, ship_cents,
           ship_days_min, ship_days_max, stock, rating, branded, retail_source, attributes
    from armada.catalog_items
    where workspace_id is null and source = 'practice' and not branded and category in ${tx(theme.categories)}`;
  const shuffled = items.map((i) => ({ i, k: r() })).sort((a, b) => a.k - b.k).map((x) => x.i);

  // eBay: skip anything the practice seller already lists on another of its accounts.
  const alreadyListed = new Set(
    sellerKey
      ? (
          await tx<{ catalogItemId: string }[]>`
            select p.catalog_item_id from armada.listings l
            join armada.stores s on s.id = l.store_id
            join armada.products p on p.id = l.product_id
            where s.platform = 'ebay' and s.seller_key = ${sellerKey} and p.catalog_item_id is not null`
        ).map((x) => x.catalogItemId)
      : [],
  );

  let listed = 0;
  for (const item of shuffled) {
    if (listed >= WANT) break;
    if (alreadyListed.has(item.id)) continue;
    const basePrice = retailPrice(item.costCents, item.shipCents, "mid");
    // Reuse the workspace's product for this catalog item if there is one; otherwise add it.
    let [product] = await tx<{ id: string }[]>`select id from armada.products where catalog_item_id = ${item.id} and status <> 'archived' limit 1`;
    if (!product) {
      const { score, parts } = scoreProduct({
        priceCents: basePrice,
        costCents: item.costCents,
        shipCents: item.shipCents,
        shipDaysMax: item.shipDaysMax,
        stock: item.stock,
        rating: item.rating != null ? Number(item.rating) : null,
        branded: false,
        retailSource: false,
        platform: input.platform,
        practice: true,
      });
      [product] = await tx<{ id: string }[]>`
        insert into armada.products (workspace_id, catalog_item_id, title, description, images, category, cost_cents, ship_cents, seo_title, score, score_parts)
        values (${workspaceId}, ${item.id}, ${item.title}, ${item.description}, ${tx.json(item.images as never)}, ${item.category},
                ${item.costCents}, ${item.shipCents}, ${item.title}, ${score}, ${tx.json(parts as never)})
        returning id`;
    }
    // eBay prices run a little higher to cover eBay's bigger fees (as in the practice fleet).
    const priceCents = input.platform === "ebay" ? Math.ceil((basePrice * 1.1) / 100) * 100 - 1 : basePrice;
    await tx`
      insert into armada.listings (workspace_id, product_id, store_id, external_id, handle, price_cents, status, last_synced_at)
      values (${workspaceId}, ${product.id}, ${store.id}, ${`practice-${store.id.slice(0, 8)}-${listed + 1}`}, ${slugify(item.title)}, ${priceCents}, 'active', now())
      on conflict (store_id, product_id) do nothing`;
    listed++;
  }

  await tx`
    insert into armada.audit_log (workspace_id, member_id, action, detail)
    values (${workspaceId}, ${memberId}, 'practice.store_opened', ${tx.json({ storeId: store.id, platform: input.platform, listed } as never)})`;
  return { storeId: store.id, name, listed };
}
