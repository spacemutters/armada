"use server";

import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { planListing, planReprice, savePreview } from "@/lib/changes/engine";
import { withWorkspace } from "@/lib/db";
import { retailPrice } from "@/lib/pricing";
import { scoreProduct } from "@/lib/score";
import type { CatalogItem } from "@/lib/types";

const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);

export async function addToProducts(formData: FormData) {
  const session = await requireSession();
  const ids = formData.getAll("catalogIds").filter(uuid).slice(0, 100);
  if (!ids.length) redirect("/products?tab=find");
  const added = await withWorkspace(session.workspaceId, async (tx) => {
    const items = await tx<CatalogItem[]>`
      select c.* from armada.catalog_items c
      where c.id in ${tx(ids)} and not exists (select 1 from armada.products p where p.catalog_item_id = c.id)`;
    for (const item of items) {
      const price = retailPrice(item.costCents, item.shipCents, "mid");
      const { score, parts } = scoreProduct({
        priceCents: price,
        costCents: item.costCents,
        shipCents: item.shipCents,
        shipDaysMax: item.shipDaysMax,
        stock: item.stock,
        rating: item.rating != null ? Number(item.rating) : null,
        branded: item.branded,
        retailSource: item.retailSource,
        practice: item.source === "practice",
      });
      await tx`
        insert into armada.products (workspace_id, catalog_item_id, title, description, images, category, cost_cents, ship_cents, seo_title, score, score_parts)
        values (${session.workspaceId}, ${item.id}, ${item.title}, ${item.description}, ${tx.json(item.images as never)}, ${item.category},
                ${item.costCents}, ${item.shipCents}, ${item.title}, ${score}, ${tx.json(parts as never)})`;
    }
    return items.length;
  });
  redirect(`/products?added=${added}`);
}

export async function previewListing(formData: FormData) {
  const session = await requireSession();
  const productIds = formData.getAll("ids").filter(uuid).slice(0, 200);
  const storeIds = formData.getAll("stores").filter(uuid).slice(0, 1000);
  if (!productIds.length || !storeIds.length) redirect(`/products/list?${productIds.map((i) => `ids=${i}`).join("&")}&error=stores`);
  const id = await withWorkspace(session.workspaceId, async (tx) => {
    const { planned, skipped } = await planListing(tx, productIds, storeIds);
    const summary = `List ${productIds.length} ${productIds.length === 1 ? "product" : "products"} in ${storeIds.length} ${storeIds.length === 1 ? "store" : "stores"}`;
    return savePreview(tx, session.workspaceId, session.memberId, "list_products", summary, planned, { productIds, storeIds, skipped });
  });
  redirect(`/changes/${id}`);
}

export async function previewReprice(formData: FormData) {
  const session = await requireSession();
  const productIds = formData.getAll("ids").filter(uuid).slice(0, 200);
  const percent = Math.max(-50, Math.min(100, Number(formData.get("percent")) || 0));
  if (!productIds.length || percent === 0) redirect("/products");
  const id = await withWorkspace(session.workspaceId, async (tx) => {
    const { planned } = await planReprice(tx, productIds, percent);
    const summary = `${percent > 0 ? "Raise" : "Lower"} prices ${Math.abs(percent)}% on ${productIds.length} ${productIds.length === 1 ? "product" : "products"}`;
    return savePreview(tx, session.workspaceId, session.memberId, "reprice", summary, planned, { productIds, percent, skipped: [] });
  });
  redirect(`/changes/${id}`);
}
