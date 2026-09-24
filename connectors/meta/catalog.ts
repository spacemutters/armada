import "server-only";
import { withWorkspace } from "@/lib/db";
import { catalogBatches, catalogRequest, type CatalogSource } from "./core";
import { loadMetaSecret, requireMetaConfig } from "./client";
import { itemsBatch, MetaError } from "./http";

// Keeps a Facebook and Instagram shop's catalog in step with the Shopify store it's linked to: every
// product listed on that Shopify store goes to the Meta catalog with the same price, photos and
// product page, and "in stock" only while the listing is live. Safe to run again at any time: Meta
// updates products it already has (UPDATE with allow_upsert) instead of adding copies.

export interface PushResult {
  sent: number;
  skipped: { title: string; reason: string }[];
  refused: { retailerId: string; reason: string }[];
  shopName: string;
}

export async function pushCatalog(workspaceId: string, facebookStoreId: string): Promise<PushResult> {
  const cfg = requireMetaConfig();
  const [fb] = await withWorkspace(
    workspaceId,
    (tx) => tx<{ meta: { fbeExternalId?: string; shopifyStoreId?: string } }[]>`
      select meta from armada.stores where id = ${facebookStoreId} and platform = 'facebook' and mode = 'live'`,
  );
  if (!fb?.meta.fbeExternalId || !fb.meta.shopifyStoreId) throw new MetaError(404, null, "This shop isn't linked to a Shopify store");
  const secret = await loadMetaSecret(workspaceId, fb.meta.fbeExternalId);
  if (!secret?.assets.catalogId) throw new MetaError(409, null, "Meta hasn't made a catalog for this shop");

  const { shop, listings } = await withWorkspace(workspaceId, async (tx) => {
    const [shop] = await tx<{ name: string; domain: string | null; currency: string }[]>`
      select name, domain, currency from armada.stores where id = ${fb.meta.shopifyStoreId!} and platform = 'shopify'`;
    const listings = await tx<CatalogSource[]>`
      select l.id as listing_id, l.external_id, l.handle, coalesce(l.title, p.title) as title, p.description,
             l.price_cents, l.status, p.images
      from armada.listings l join armada.products p on p.id = l.product_id
      where l.store_id = ${fb.meta.shopifyStoreId!} and l.status in ('active', 'hidden')
      order by l.created_at`;
    return { shop, listings };
  });
  if (!shop?.domain) throw new MetaError(409, null, "The linked Shopify store has no address");

  const skipped: PushResult["skipped"] = [];
  const requests: unknown[] = [];
  for (const l of listings) {
    const r = catalogRequest({ ...l, images: Array.isArray(l.images) ? l.images : [] }, { domain: shop.domain, currency: shop.currency, brand: shop.name });
    if (r.ok) requests.push(r.request);
    else skipped.push({ title: r.title, reason: r.reason });
  }

  const refused: PushResult["refused"] = [];
  for (const batch of catalogBatches(requests)) {
    const answer = await itemsBatch(cfg, secret.accessToken, secret.assets.catalogId, batch);
    for (const v of answer.validation_status ?? []) {
      const reason = v.errors?.map((e) => e.message).find(Boolean);
      if (reason) refused.push({ retailerId: v.retailer_id ?? "", reason: reason.slice(0, 200) });
    }
  }
  const sent = requests.length - refused.length;

  await withWorkspace(workspaceId, async (tx) => {
    await tx`
      update armada.stores
      set meta = meta || ${tx.json({ catalog: { lastPushAt: new Date().toISOString(), sent, skipped: skipped.length, refused: refused.length } } as never)}
      where id = ${facebookStoreId}`;
    await tx`
      insert into armada.audit_log (workspace_id, action, detail)
      values (${workspaceId}, 'facebook.catalog_pushed', ${tx.json({ storeId: facebookStoreId, sent, skipped: skipped.length, refused: refused.length } as never)})`;
  });
  return { sent, skipped, refused, shopName: shop.name };
}
