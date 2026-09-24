import "server-only";
import type { Tx } from "@/lib/db";
import type { ShopRow } from "@/lib/shops/types";
import { slugify } from "@/lib/text";

/**
 * Puts a built shop into a practice store: a pretend Shopify store inside Armada that behaves like
 * a real one for everything except taking money. Running it twice changes nothing the second time.
 */
export async function publishShopToPractice(tx: Tx, shop: ShopRow, memberId: string): Promise<string> {
  if (shop.storeId) return shop.storeId;
  const bp = shop.blueprint;
  const brand = bp.brand?.name ?? shop.niche;

  const [group] = await tx<{ id: string }[]>`
    insert into armada.store_groups (workspace_id, name) values (${shop.workspaceId}, 'Built with the shop builder')
    on conflict (workspace_id, name) do update set name = excluded.name
    returning id`;

  const [store] = await tx<{ id: string }[]>`
    insert into armada.stores (workspace_id, platform, mode, name, domain, currency, country, status, group_id, meta)
    values (${shop.workspaceId}, 'shopify', 'practice', ${brand}, ${`${slugify(brand)}.practice`}, 'USD', 'US', 'connected',
            ${group.id}, ${tx.json({ shopId: shop.id, builtByAi: true, openedAt: new Date().toISOString() } as never)})
    returning id`;

  const products = bp.products ?? [];
  const [change] = await tx<{ id: string }[]>`
    insert into armada.change_sets (workspace_id, kind, summary, status, params, created_by, approved_at)
    values (${shop.workspaceId}, 'publish_shop', ${`Put ${brand} in a practice store with ${products.length} products`}, 'running',
            ${tx.json({ shopId: shop.id, storeId: store.id } as never)}, ${memberId}, now())
    returning id`;

  for (const p of products) {
    const [listing] = await tx<{ id: string }[]>`
      insert into armada.listings (workspace_id, product_id, store_id, external_id, handle, price_cents, status, last_synced_at)
      values (${shop.workspaceId}, ${p.productId}, ${store.id}, ${"practice-" + p.handle}, ${p.handle}, ${p.priceCents}, 'active', now())
      on conflict (store_id, product_id) do nothing
      returning id`;
    if (!listing) continue;
    await tx`
      insert into armada.change_items (workspace_id, change_set_id, store_id, target_type, target_id, before, after, status, finished_at)
      values (${shop.workspaceId}, ${change.id}, ${store.id}, 'listing', ${listing.id}, null,
              ${tx.json({ status: "active", priceCents: p.priceCents } as never)}, 'done', now())`;
  }

  await tx`
    update armada.change_sets set status = 'done', finished_at = now(),
      counts = ${tx.json({ done: products.length, failed: 0 } as never)}
    where id = ${change.id}`;
  await tx`update armada.shops set status = 'published', store_id = ${store.id}, updated_at = now() where id = ${shop.id}`;
  await tx`
    insert into armada.audit_log (workspace_id, member_id, action, detail)
    values (${shop.workspaceId}, ${memberId}, 'shop.published_practice', ${tx.json({ shopId: shop.id, storeId: store.id } as never)})`;
  return store.id;
}
