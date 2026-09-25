import "server-only";
import { endEbayListing, ListingProblem, publishEbayListing, type EbayListingStore } from "@/connectors/ebay/listing";
import { listingBlocker, listingQuantity, LIMIT_NOTE, readSellingLimit, fitSellingLimit, EBAY_LISTING_QUANTITY, type ListingFacts } from "@/connectors/ebay/listing-core";
import { asSystem, withWorkspace, type Tx } from "@/lib/db";
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
  platform: string;
}

/**
 * Applies a previewed change. Practice stores change straight away. New listings on a live eBay
 * account are left pending here and published one at a time by applyLiveEbayItems (each is several
 * calls to eBay, too slow for one open transaction); other live stores aren't connected yet.
 */
export async function applyChange(tx: Tx, changeSetId: string): Promise<{ done: number; failed: number; live: number }> {
  const [cs] = await tx<{ id: string; workspaceId: string; status: string; kind: string }[]>`
    select id, workspace_id, status, kind from armada.change_sets where id = ${changeSetId} for update`;
  if (!cs || cs.status !== "preview") return { done: 0, failed: 0, live: 0 };
  await tx`update armada.change_sets set status = 'running', approved_at = now() where id = ${cs.id}`;

  const items = await tx<ItemRow[]>`
    select i.id, i.store_id, i.target_type, i.target_id, i.before, i.after, i.status, s.mode, s.platform
    from armada.change_items i join armada.stores s on s.id = i.store_id
    where i.change_set_id = ${cs.id} and i.status = 'pending'`;

  let done = 0;
  let failed = 0;
  let live = 0;
  for (const it of items) {
    try {
      if (it.mode === "live" && it.platform === "ebay" && it.targetType === "listing" && it.before === null) {
        live++;
        continue;
      }
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
  if (live) {
    // Still running: the eBay listings finish it (applyLiveEbayItems).
    await tx`update armada.change_sets set counts = counts || ${tx.json({ done, failed, live } as never)} where id = ${cs.id}`;
    return { done, failed, live };
  }
  await tx`
    update armada.change_sets
    set status = ${failed === 0 ? "done" : done === 0 ? "failed" : "partial"}, finished_at = now(),
        counts = counts || ${tx.json({ done, failed } as never)}
    where id = ${cs.id}`;
  return { done, failed, live };
}

// ---------- live eBay listings ----------
// A new listing on a real eBay account goes through the eBay connector one product at a time,
// outside any open transaction: claim the item (a two-minute hold, so a second worker skips it),
// publish on eBay, record the listing. Only real supplier products are ever sent (listingBlocker,
// checked again inside publishEbayListing). The account's monthly selling limit is respected. The
// change finishes when no item is left pending; undo ends each listing on eBay.

interface LiveItem {
  id: string;
  workspaceId: string;
  storeId: string;
  after: { productId: string; priceCents: number; handle: string; attempts?: number };
  storeMeta: {
    ebayUserId: string;
    marketplaceId: string;
    env?: "production" | "sandbox";
    policies?: EbayListingStore["policies"];
    locationKey?: string;
    sellingLimit?: unknown;
  };
  storeCurrency: string;
}

export interface LiveApplyResult {
  done: number;
  failed: number;
  skipped: number;
  /** Items still pending after this pass. */
  left: number;
  /** Set when listing stopped for the whole account: what a person has to do, in plain words. */
  stopped?: { kind: string; note: string };
}

const BUSY_TRIES = 3;

async function productFacts(workspaceId: string, productId: string, imagined: boolean | null): Promise<ListingFacts | null> {
  const [p] = await withWorkspace(
    workspaceId,
    (tx) => tx<
      {
        id: string;
        title: string;
        description: string;
        bullets: string[];
        images: { url?: string }[];
        category: string;
        status: string;
        source: string | null;
        branded: boolean | null;
        stock: number | null;
        attributes: Record<string, { materials?: string[]; variants?: { key?: string }[] }> | null;
      }[]
    >`
      select p.id, p.title, p.description, p.bullets, p.images, p.category, p.status,
             c.source, c.branded, c.stock, c.attributes
      from armada.products p left join armada.catalog_items c on c.id = p.catalog_item_id
      where p.id = ${productId}`,
  );
  if (!p) return null;
  const supplier = p.source && p.attributes ? p.attributes[p.source] : undefined;
  return {
    productId: p.id,
    title: p.title,
    description: p.description ?? "",
    bullets: Array.isArray(p.bullets) ? p.bullets.map(String) : [],
    category: p.category ?? "",
    images: Array.isArray(p.images) ? p.images : [],
    source: p.source,
    // A product with no supplier item behind it is never treated as real.
    imagined: Boolean(imagined) || !p.source,
    branded: Boolean(p.branded),
    materials: Array.isArray(supplier?.materials) ? supplier.materials.map(String) : [],
    variant: supplier?.variants?.[0]?.key ?? null,
    stock: typeof p.stock === "number" ? p.stock : null,
    status: p.status,
  };
}

/** What the store already has listed on eBay, for the selling limit. */
async function listedOn(workspaceId: string, storeId: string): Promise<{ quantity: number; amountCents: number }> {
  const [r] = await withWorkspace(
    workspaceId,
    (tx) => tx<{ n: number; amount: number }[]>`
      select count(*)::int as n, coalesce(sum(price_cents), 0)::bigint as amount
      from armada.listings where store_id = ${storeId} and status = 'active'`,
  );
  return { quantity: r.n * EBAY_LISTING_QUANTITY, amountCents: Number(r.amount) * EBAY_LISTING_QUANTITY };
}

async function finishIfEmpty(workspaceId: string, changeSetId: string): Promise<number> {
  return withWorkspace(workspaceId, async (tx) => {
    const [c] = await tx<{ pending: number; done: number; failed: number; skipped: number }[]>`
      select count(*) filter (where status = 'pending')::int as pending, count(*) filter (where status = 'done')::int as done,
             count(*) filter (where status = 'failed')::int as failed, count(*) filter (where status = 'skipped')::int as skipped
      from armada.change_items where change_set_id = ${changeSetId}`;
    if (c.pending === 0) {
      await tx`
        update armada.change_sets
        set status = ${c.failed + c.skipped === 0 ? "done" : c.done === 0 ? "failed" : "partial"}, finished_at = now(),
            counts = counts || ${tx.json({ done: c.done, failed: c.failed, skipped: c.skipped, live: 0 } as never)}
        where id = ${changeSetId} and status = 'running'`;
    }
    return c.pending;
  });
}

async function settleItem(workspaceId: string, itemId: string, status: "done" | "failed" | "skipped", error: string | null, patch: Record<string, unknown>, targetId?: string) {
  await withWorkspace(
    workspaceId,
    (tx) => tx`
      update armada.change_items
      set status = ${status}, error = ${error}, finished_at = now(), target_id = coalesce(${targetId ?? null}::uuid, target_id),
          after = (after - 'claimedUntil') || ${tx.json(patch as never)}
      where id = ${itemId}`,
  );
}

/**
 * Publishes up to `max` pending eBay listings of an approved change, stopping early at `deadline`
 * (ms since epoch). Safe to call again and again: each call picks up the items still pending.
 */
export async function applyLiveEbayItems(workspaceId: string, changeSetId: string, opts: { max?: number; deadline?: number } = {}): Promise<LiveApplyResult> {
  const out: LiveApplyResult = { done: 0, failed: 0, skipped: 0, left: 0 };
  const max = opts.max ?? 3;
  const imaginedIds = await withWorkspace(workspaceId, async (tx) => {
    const [cs] = await tx<{ params: { shopId?: string } }[]>`select params from armada.change_sets where id = ${changeSetId}`;
    if (!cs?.params?.shopId) return new Set<string>();
    const [shop] = await tx<{ products: { productId: string; imagined?: boolean }[] | null }[]>`
      select blueprint -> 'products' as products from armada.shops where id = ${cs.params.shopId}`;
    return new Set((shop?.products ?? []).filter((p) => p.imagined).map((p) => p.productId));
  });

  for (let n = 0; n < max; n++) {
    if (opts.deadline && Date.now() > opts.deadline) break;
    // Claim one pending item: nobody else takes it for two minutes.
    const [it] = await withWorkspace(
      workspaceId,
      (tx) => tx<LiveItem[]>`
        update armada.change_items i set after = i.after || jsonb_build_object('claimedUntil', (now() + interval '2 minutes')::text)
        where i.id = (
          select i2.id from armada.change_items i2
          join armada.change_sets c on c.id = i2.change_set_id and c.status = 'running'
          join armada.stores s on s.id = i2.store_id and s.mode = 'live' and s.platform = 'ebay'
          where i2.change_set_id = ${changeSetId} and i2.status = 'pending' and i2.target_type = 'listing' and i2.before is null
            and coalesce((i2.after ->> 'claimedUntil')::timestamptz, 'epoch') < now()
          order by i2.id limit 1 for update of i2 skip locked)
        returning i.id, i.workspace_id, i.store_id, i.after,
          (select meta from armada.stores where id = i.store_id) as store_meta,
          (select currency from armada.stores where id = i.store_id) as store_currency`,
    );
    if (!it) break;

    const facts = await productFacts(workspaceId, it.after.productId, imaginedIds.has(it.after.productId));
    const blocked = facts ? listingBlocker(facts) : "This product isn't in Armada any more";
    if (!facts || blocked) {
      await settleItem(workspaceId, it.id, "skipped", blocked, {});
      out.skipped++;
      continue;
    }
    const quantity = listingQuantity(facts.stock);
    const limit = readSellingLimit(it.storeMeta.sellingLimit);
    if (fitSellingLimit([{ priceCents: it.after.priceCents, quantity }], limit, await listedOn(workspaceId, it.storeId)) < 1) {
      await settleItem(workspaceId, it.id, "skipped", LIMIT_NOTE, {});
      out.skipped++;
      continue;
    }
    const store: EbayListingStore = {
      storeId: it.storeId,
      ebayUserId: it.storeMeta.ebayUserId,
      marketplaceId: it.storeMeta.marketplaceId,
      env: it.storeMeta.env ?? "production",
      currency: it.storeCurrency,
      policies: it.storeMeta.policies ?? {},
      locationKey: it.storeMeta.locationKey ?? null,
    };
    try {
      const listed = await publishEbayListing(workspaceId, store, facts, it.after.priceCents, quantity);
      const targetId = await withWorkspace(workspaceId, async (tx) => {
        const [row] = await tx<{ id: string }[]>`
          insert into armada.listings (workspace_id, product_id, store_id, external_id, handle, title, price_cents, status, last_synced_at)
          values (${workspaceId}, ${facts.productId}, ${it.storeId}, ${listed.listingId}, ${it.after.handle}, ${facts.title.slice(0, 200)}, ${it.after.priceCents}, 'active', now())
          on conflict (store_id, product_id) do update set external_id = excluded.external_id, status = 'active', last_synced_at = now(), error = null
          returning id`;
        return row.id;
      });
      await settleItem(workspaceId, it.id, "done", null, { quantity, sku: listed.sku, offerId: listed.offerId, listingId: listed.listingId, categoryId: listed.categoryId, url: listed.url }, targetId);
      out.done++;
    } catch (e) {
      const p = e instanceof ListingProblem ? e : new ListingProblem("busy", "Something went wrong on Armada's side. Armada tries again in a minute.");
      if (p.kind === "item") {
        await settleItem(workspaceId, it.id, "failed", p.message, {});
        out.failed++;
      } else if (p.kind === "limit") {
        // eBay's own count says the month is full: the rest of this account's items wait too.
        await settleItem(workspaceId, it.id, "skipped", p.message, {});
        const rest = await withWorkspace(
          workspaceId,
          (tx) => tx`
            update armada.change_items set status = 'skipped', error = ${p.message}, finished_at = now(), after = after - 'claimedUntil'
            where change_set_id = ${changeSetId} and store_id = ${it.storeId} and status = 'pending'`,
        );
        out.skipped += 1 + rest.count;
        break;
      } else if (p.kind === "busy" && (it.after.attempts ?? 0) + 1 >= BUSY_TRIES) {
        await settleItem(workspaceId, it.id, "failed", p.message, { attempts: (it.after.attempts ?? 0) + 1 });
        out.failed++;
      } else {
        // eBay is busy, or the whole account needs a person: the item waits, unclaimed, for the next pass.
        await withWorkspace(
          workspaceId,
          (tx) => tx`
            update armada.change_items set after = (after - 'claimedUntil') || ${tx.json({ attempts: (it.after.attempts ?? 0) + (p.kind === "busy" ? 1 : 0) } as never)}
            where id = ${it.id}`,
        );
        out.stopped = { kind: p.kind, note: p.message };
        break;
      }
    }
  }
  out.left = await finishIfEmpty(workspaceId, changeSetId);
  return out;
}

/** Keeps publishing an approved change's eBay listings until none are left or time runs out. */
export async function drainLiveEbayItems(workspaceId: string, changeSetId: string, budgetMs = 240_000): Promise<LiveApplyResult> {
  const deadline = Date.now() + budgetMs;
  let last: LiveApplyResult = { done: 0, failed: 0, skipped: 0, left: 0 };
  while (Date.now() < deadline) {
    last = await applyLiveEbayItems(workspaceId, changeSetId, { max: 5, deadline });
    if (!last.left || last.stopped) break;
  }
  return last;
}

/** The helper's sweep: approved changes whose eBay listings stopped part way carry on. */
export async function resumeLiveEbayChanges(budgetMs = 120_000): Promise<number> {
  const sets = await asSystem(
    (tx) => tx<{ id: string; workspaceId: string }[]>`
      select distinct c.id, c.workspace_id from armada.change_sets c
      join armada.change_items i on i.change_set_id = c.id and i.status = 'pending'
      join armada.stores s on s.id = i.store_id and s.mode = 'live' and s.platform = 'ebay'
      where c.status = 'running' and c.approved_at < now() - interval '2 minutes'
        and coalesce((i.after ->> 'claimedUntil')::timestamptz, 'epoch') < now()
      limit 5`,
  );
  const deadline = Date.now() + budgetMs;
  for (const s of sets) {
    if (Date.now() > deadline) break;
    await applyLiveEbayItems(s.workspaceId, s.id, { max: 5, deadline }).catch((e) => console.error("eBay listing sweep failed", s.id, e));
  }
  return sets.length;
}

/** Undo builds a new change from the saved before-values and applies it straight away. */
export async function undoChange(tx: Tx, changeSetId: string, memberId: string): Promise<string | null> {
  const [cs] = await tx<{ id: string; workspaceId: string; status: string; summary: string }[]>`
    select id, workspace_id, status, summary from armada.change_sets where id = ${changeSetId} for update`;
  if (!cs || (cs.status !== "done" && cs.status !== "partial")) return null;
  const items = await tx<(ItemRow & { ebayUserId: string | null })[]>`
    select i.id, i.store_id, i.target_type, i.target_id, i.before, i.after, i.status, s.mode, s.platform, s.meta ->> 'ebayUserId' as ebay_user_id
    from armada.change_items i join armada.stores s on s.id = i.store_id
    where i.change_set_id = ${cs.id} and i.status = 'done' and i.undoable`;

  const [undo] = await tx<{ id: string }[]>`
    insert into armada.change_sets (workspace_id, kind, summary, status, params, created_by, approved_at, undo_of)
    values (${cs.workspaceId}, 'undo', ${`Undo: ${cs.summary}`}, 'running', ${tx.json({ undoOf: cs.id } as never)}, ${memberId}, now(), ${cs.id})
    returning id`;

  let done = 0;
  let failed = 0;
  for (const it of items) {
    if (!it.targetId) continue;
    const current = await tx<{ priceCents: number; status: string; productId: string }[]>`
      select price_cents, status, product_id from armada.listings where id = ${it.targetId}`;
    if (!current[0]) continue;
    const now = { priceCents: current[0].priceCents, status: current[0].status, productId: current[0].productId };
    if (it.before === null && it.mode === "live" && it.platform === "ebay") {
      // A real eBay listing: take it down on eBay first. If eBay can't be reached, it stays listed
      // (and in Armada), and this change can be undone again.
      try {
        if (!it.ebayUserId) throw new ListingProblem("setup", "This eBay account isn't connected any more.");
        await endEbayListing(cs.workspaceId, it.ebayUserId, now.productId);
      } catch (e) {
        failed++;
        await tx`
          insert into armada.change_items (workspace_id, change_set_id, store_id, target_type, target_id, before, after, status, error, finished_at, undoable)
          values (${cs.workspaceId}, ${undo.id}, ${it.storeId}, 'listing', ${it.targetId}, ${tx.json(now as never)}, ${tx.json({ removed: true, productId: now.productId } as never)},
                  'failed', ${e instanceof Error ? e.message : "eBay didn't take the listing down."}, now(), false)`;
        continue;
      }
    }
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
  await tx`
    update armada.change_sets set status = ${failed === 0 ? "done" : done === 0 ? "failed" : "partial"}, finished_at = now(),
      counts = ${tx.json({ done, failed } as never)}
    where id = ${undo.id}`;
  // Only a complete undo retires the change; otherwise what's left can be undone again.
  if (failed === 0) await tx`update armada.change_sets set status = 'undone' where id = ${cs.id}`;
  return undo.id;
}
