import "server-only";
import type { Tx } from "@/lib/db";
import { charm } from "@/lib/pricing";
import { slugify } from "@/lib/text";

// Every change that touches more than one store goes through here: it is written as a preview
// first, applied only when someone approves it, and each item keeps its before-value for undo.
// The before-value rule is enforced by the "before-values" build check.

export interface PlannedItem {
  storeId: string;
  storeName: string;
  targetType: "listing";
  targetId: string | null;
  productId: string;
  productTitle: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
}

export interface Skipped {
  storeName: string;
  productTitle: string;
  reason: string;
}

interface StoreLite {
  id: string;
  name: string;
  platform: "shopify" | "ebay";
  mode: "practice" | "live";
  sellerKey: string | null;
}

interface ProductLite {
  id: string;
  title: string;
  costCents: number;
  shipCents: number;
  status: string;
  retailSource: boolean;
  branded: boolean;
}

/** Plans listing products in stores. Applies the eBay rules before anything is written. */
export async function planListing(tx: Tx, productIds: string[], storeIds: string[], markup = 2.8) {
  const stores = await tx<StoreLite[]>`select id, name, platform, mode, seller_key from armada.stores where id in ${tx(storeIds)}`;
  const products = await tx<ProductLite[]>`
    select p.id, p.title, p.cost_cents, p.ship_cents, p.status,
           coalesce(c.retail_source, false) as retail_source, coalesce(c.branded, false) as branded
    from armada.products p left join armada.catalog_items c on c.id = p.catalog_item_id
    where p.id in ${tx(productIds)}`;
  const existing = await tx<{ storeId: string; productId: string; sellerKey: string | null; platform: string }[]>`
    select l.store_id, l.product_id, s.seller_key, s.platform
    from armada.listings l join armada.stores s on s.id = l.store_id
    where l.product_id in ${tx(productIds)} and l.status <> 'error'`;

  const listed = new Set(existing.map((e) => `${e.storeId}:${e.productId}`));
  // eBay: one fixed-price listing per item per seller, across all of that seller's accounts.
  const ebaySeller = new Set(existing.filter((e) => e.platform === "ebay" && e.sellerKey).map((e) => `${e.sellerKey}:${e.productId}`));

  const planned: PlannedItem[] = [];
  const skipped: Skipped[] = [];
  for (const p of products) {
    for (const s of stores) {
      if (listed.has(`${s.id}:${p.id}`)) {
        skipped.push({ storeName: s.name, productTitle: p.title, reason: "Already in this store" });
        continue;
      }
      if (p.status !== "active") {
        skipped.push({ storeName: s.name, productTitle: p.title, reason: "Paused, usually because the supplier is out of stock" });
        continue;
      }
      if (p.branded) {
        skipped.push({ storeName: s.name, productTitle: p.title, reason: "Names a brand you may not have the right to sell" });
        continue;
      }
      if (s.platform === "ebay") {
        if (p.retailSource) {
          skipped.push({ storeName: s.name, productTitle: p.title, reason: "eBay doesn't allow dropshipping from retail sites" });
          continue;
        }
        const key = `${s.sellerKey ?? s.id}:${p.id}`;
        if (ebaySeller.has(key)) {
          skipped.push({ storeName: s.name, productTitle: p.title, reason: "This seller already lists it on another eBay account, and eBay allows one" });
          continue;
        }
        ebaySeller.add(key);
      }
      const base = (p.costCents + p.shipCents) * markup * (s.platform === "ebay" ? 1.1 : 1);
      const priceCents = charm(Math.max(base, 500), "mid");
      planned.push({
        storeId: s.id,
        storeName: s.name,
        targetType: "listing",
        targetId: null,
        productId: p.id,
        productTitle: p.title,
        before: null,
        after: { status: "active", priceCents, productId: p.id, handle: slugify(p.title) },
      });
    }
  }
  return { planned, skipped, stores, products };
}

/** Plans a price change of `percent` on every live listing of these products. */
export async function planReprice(tx: Tx, productIds: string[], percent: number) {
  const rows = await tx<{ id: string; storeId: string; storeName: string; productId: string; title: string; priceCents: number; platform: string }[]>`
    select l.id, l.store_id, s.name as store_name, l.product_id, p.title, l.price_cents, s.platform
    from armada.listings l join armada.stores s on s.id = l.store_id join armada.products p on p.id = l.product_id
    where l.product_id in ${tx(productIds)} and l.status = 'active'
    order by p.title, s.name`;
  const planned: PlannedItem[] = rows.map((r) => {
    const next = charm(Math.max(100, r.priceCents * (1 + percent / 100)), "mid");
    return {
      storeId: r.storeId,
      storeName: r.storeName,
      targetType: "listing",
      targetId: r.id,
      productId: r.productId,
      productTitle: r.title,
      before: { priceCents: r.priceCents },
      after: { priceCents: next },
    };
  });
  return { planned };
}

/** Writes a change as a preview. Nothing touches a store until it is applied. */
export async function savePreview(
  tx: Tx,
  workspaceId: string,
  memberId: string,
  kind: string,
  summary: string,
  items: PlannedItem[],
  params: Record<string, unknown>,
): Promise<string> {
  const [cs] = await tx<{ id: string }[]>`
    insert into armada.change_sets (workspace_id, kind, summary, status, params, counts, created_by)
    values (${workspaceId}, ${kind}, ${summary}, 'preview', ${tx.json(params as never)},
            ${tx.json({ planned: items.length } as never)}, ${memberId})
    returning id`;
  for (let i = 0; i < items.length; i += 500) {
    const chunk = items.slice(i, i + 500).map((it) => ({
      workspaceId,
      changeSetId: cs.id,
      storeId: it.storeId,
      targetType: it.targetType,
      targetId: it.targetId,
      before: it.before === null ? null : tx.json(it.before as never),
      after: tx.json(it.after as never),
      status: "pending",
    }));
    await tx`insert into armada.change_items ${tx(chunk as never)}`;
  }
  return cs.id;
}

interface ItemRow {
  id: string;
  storeId: string;
  targetType: string;
  targetId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
  status: string;
  mode: "practice" | "live";
}

/**
 * Applies a previewed change. Practice stores change straight away; live stores will go through
 * each store's connector (the per-store limiter) once real stores are connected.
 */
export async function applyChange(tx: Tx, changeSetId: string): Promise<{ done: number; failed: number }> {
  const [cs] = await tx<{ id: string; workspaceId: string; status: string; kind: string }[]>`
    select id, workspace_id, status, kind from armada.change_sets where id = ${changeSetId} for update`;
  if (!cs || cs.status !== "preview") return { done: 0, failed: 0 };
  await tx`update armada.change_sets set status = 'running', approved_at = now() where id = ${cs.id}`;

  const items = await tx<ItemRow[]>`
    select i.id, i.store_id, i.target_type, i.target_id, i.before, i.after, i.status, s.mode
    from armada.change_items i join armada.stores s on s.id = i.store_id
    where i.change_set_id = ${cs.id} and i.status = 'pending'`;

  let done = 0;
  let failed = 0;
  for (const it of items) {
    try {
      if (it.mode === "live") throw new Error("Live stores aren't connected yet");
      if (it.targetType === "listing" && it.before === null) {
        const a = it.after as { productId: string; priceCents: number; handle: string };
        const [row] = await tx<{ id: string }[]>`
          insert into armada.listings (workspace_id, product_id, store_id, external_id, handle, price_cents, status, last_synced_at)
          values (${cs.workspaceId}, ${a.productId}, ${it.storeId}, ${"practice-" + crypto.randomUUID().slice(0, 8)}, ${a.handle}, ${a.priceCents}, 'active', now())
          on conflict (store_id, product_id) do nothing
          returning id`;
        if (!row) {
          await tx`update armada.change_items set status = 'skipped', error = 'Already in this store', finished_at = now() where id = ${it.id}`;
          continue;
        }
        await tx`update armada.change_items set target_id = ${row.id}, status = 'done', finished_at = now() where id = ${it.id}`;
      } else if (it.targetType === "listing" && it.targetId) {
        const a = it.after as { priceCents?: number; status?: string };
        await tx`
          update armada.listings set
            price_cents = coalesce(${a.priceCents ?? null}, price_cents),
            status = coalesce(${a.status ?? null}, status),
            last_synced_at = now()
          where id = ${it.targetId}`;
        await tx`update armada.change_items set status = 'done', finished_at = now() where id = ${it.id}`;
      }
      done++;
    } catch (e) {
      failed++;
      await tx`update armada.change_items set status = 'failed', error = ${e instanceof Error ? e.message : "Failed"}, finished_at = now() where id = ${it.id}`;
    }
  }
  await tx`
    update armada.change_sets
    set status = ${failed === 0 ? "done" : done === 0 ? "failed" : "partial"}, finished_at = now(),
        counts = counts || ${tx.json({ done, failed } as never)}
    where id = ${cs.id}`;
  return { done, failed };
}

/** Undo builds a new change from the saved before-values and applies it straight away. */
export async function undoChange(tx: Tx, changeSetId: string, memberId: string): Promise<string | null> {
  const [cs] = await tx<{ id: string; workspaceId: string; status: string; summary: string }[]>`
    select id, workspace_id, status, summary from armada.change_sets where id = ${changeSetId} for update`;
  if (!cs || (cs.status !== "done" && cs.status !== "partial")) return null;
  const items = await tx<ItemRow[]>`
    select i.id, i.store_id, i.target_type, i.target_id, i.before, i.after, i.status, s.mode
    from armada.change_items i join armada.stores s on s.id = i.store_id
    where i.change_set_id = ${cs.id} and i.status = 'done' and i.undoable`;

  const [undo] = await tx<{ id: string }[]>`
    insert into armada.change_sets (workspace_id, kind, summary, status, params, created_by, approved_at, undo_of)
    values (${cs.workspaceId}, 'undo', ${`Undo: ${cs.summary}`}, 'running', ${tx.json({ undoOf: cs.id } as never)}, ${memberId}, now(), ${cs.id})
    returning id`;

  let done = 0;
  for (const it of items) {
    if (!it.targetId) continue;
    const current = await tx<{ priceCents: number; status: string; productId: string }[]>`
      select price_cents, status, product_id from armada.listings where id = ${it.targetId}`;
    if (!current[0]) continue;
    const now = { priceCents: current[0].priceCents, status: current[0].status, productId: current[0].productId };
    if (it.before === null) {
      // It didn't exist before: take it down.
      await tx`delete from armada.listings where id = ${it.targetId}`;
    } else {
      const b = it.before as { priceCents?: number; status?: string };
      await tx`
        update armada.listings set price_cents = coalesce(${b.priceCents ?? null}, price_cents), status = coalesce(${b.status ?? null}, status)
        where id = ${it.targetId}`;
    }
    await tx`
      insert into armada.change_items (workspace_id, change_set_id, store_id, target_type, target_id, before, after, status, finished_at, undoable)
      values (${cs.workspaceId}, ${undo.id}, ${it.storeId}, 'listing', ${it.before === null ? null : it.targetId},
              ${tx.json(now as never)}, ${tx.json({ ...(it.before ?? { removed: true }), productId: now.productId } as never)}, 'done', now(), false)`;
    done++;
  }
  await tx`update armada.change_sets set status = 'done', finished_at = now(), counts = ${tx.json({ done, failed: 0 } as never)} where id = ${undo.id}`;
  await tx`update armada.change_sets set status = 'undone' where id = ${cs.id}`;
  return undo.id;
}
