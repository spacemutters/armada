import "server-only";
import { onJobFinished } from "@/lib/ai/jobs";
import type { Tx } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import type { ShopRow } from "@/lib/shops/types";
import type { AiJob } from "@/lib/types";
import { dropAdPictures, ensureAdPictures, isPracticeItem, photosOf } from "./pictures";
import { toDrafts, toOneDraft, type ProductInfo } from "./schema";
import { loadShopProducts, type AdShopProduct } from "./sets";
import type { AdSet, AdVariation } from "./types";

// What happens when the AI finishes an "ads.write" job. Loaded by lib/ai/handlers.ts
// (import "@/lib/ads/jobs"), which registers it for every "ads.…" job kind.
//
// A whole set (parent "ad_set"): its answer becomes 3 to 5 draft ads, plus the audience and budget,
// and the pictures they need are asked for straight away (lib/ads/pictures.ts), so they're ready by
// the time someone looks.
// One ad written again (parent "ad_variation"): its answer replaces that ad's words, products and
// pictures. Nothing here creates or switches on anything on an ad platform; that is always a person's press.

interface Loaded {
  shop: ShopRow;
  products: Map<string, AdShopProduct>;
  usable: (id: string) => boolean;
  info: (id: string) => ProductInfo;
}

async function load(tx: Tx, set: AdSet): Promise<Loaded | null> {
  const [shop] = await tx<ShopRow[]>`select * from armada.shops where id = ${set.shopId}`;
  if (!shop) return null;
  const products = new Map((await loadShopProducts(tx, shop)).map((p) => [p.id, p]));
  const needPhotos = set.platform !== "practice";
  return {
    shop,
    products,
    // For real platforms only products with a real photo can be shown.
    usable: (id) => set.productRefs.includes(id) && (!needPhotos || photosOf(products.get(id) ?? { images: [] }).length > 0),
    info: (id) => {
      const p = products.get(id);
      return p
        ? { photos: photosOf(p).length, item: isPracticeItem(shop, p), title: p.title, price: formatMoney(p.priceCents, set.currency) }
        : { photos: 0, item: false, title: "", price: "" };
    },
  };
}

async function finishSet(tx: Tx, job: AiJob) {
  const [set] = await tx<AdSet[]>`select * from armada.ad_sets where id = ${job.parentId} for update`;
  if (!set || set.status !== "writing") return;
  if (job.status === "failed") {
    await tx`
      update armada.ad_sets set status = 'failed', error = 'The AI couldn''t write the ads, even on a second try.', updated_at = now()
      where id = ${set.id}`;
    return;
  }
  const ctx = await load(tx, set);
  const draft = ctx ? toDrafts(job.output, set.productRefs, ctx.usable, ctx.info) : null;
  if (!ctx || !draft) {
    await tx`update armada.ad_sets set status = 'failed', error = 'The AI''s answer came back in the wrong shape.', updated_at = now() where id = ${set.id}`;
    return;
  }
  for (const [i, ad] of draft.ads.entries()) {
    await tx`
      insert into armada.ad_variations
        (workspace_id, ad_set_id, position, format, idea, primary_text, headline, description, call_to_action, product_ids, scene, cards)
      values (${set.workspaceId}, ${set.id}, ${i}, ${ad.format}, ${ad.idea}, ${ad.primaryText}, ${ad.headline}, ${ad.description},
              ${ad.callToAction}, ${tx.json(ad.productIds as never)}, ${ad.scene}, ${tx.json(ad.cards as never)})`;
  }
  const audience = { ...set.audience, ...draft.audience };
  await tx`
    update armada.ad_sets
    set status = 'draft', plan = ${draft.plan}, audience = ${tx.json(audience as never)}, daily_budget_cents = ${draft.dailyBudgetCents},
        days = ${draft.days}, budget_reason = ${draft.budgetReason}, error = null, updated_at = now()
    where id = ${set.id}`;
  // The pictures, once per ad, now that the words are settled.
  const variations = await tx<AdVariation[]>`select * from armada.ad_variations where ad_set_id = ${set.id} order by position`;
  await ensureAdPictures(tx, ctx.shop, variations, ctx.products);
}

async function finishOne(tx: Tx, job: AiJob) {
  const [v] = await tx<AdVariation[]>`select * from armada.ad_variations where id = ${job.parentId} for update`;
  if (!v || v.status !== "rewriting") return;
  const [set] = await tx<AdSet[]>`select * from armada.ad_sets where id = ${v.adSetId}`;
  const fail = (why: string) => tx`update armada.ad_variations set status = 'draft', error = ${why}, updated_at = now() where id = ${v.id}`;
  if (!set || set.status !== "draft") return fail("These ads were already created, so this one wasn't changed.");
  if (job.status === "failed") return fail("The AI couldn't write this ad again, so it's unchanged.");
  const ctx = await load(tx, set);
  const draft = ctx ? toOneDraft(job.output, set.productRefs, ctx.usable, ctx.info) : null;
  if (!ctx || !draft) return fail("The AI's new version came back in the wrong shape, so this ad is unchanged.");
  const [updated] = await tx<AdVariation[]>`
    update armada.ad_variations
    set status = 'draft', format = ${draft.format}, idea = ${draft.idea}, primary_text = ${draft.primaryText}, headline = ${draft.headline},
        description = ${draft.description}, call_to_action = ${draft.callToAction}, product_ids = ${tx.json(draft.productIds as never)},
        scene = ${draft.scene}, cards = ${tx.json(draft.cards as never)}, written_by = 'ai', error = null, updated_at = now()
    where id = ${v.id} returning *`;
  // A new ad gets new pictures; the old ones described another ad.
  await dropAdPictures(tx, v.id);
  await ensureAdPictures(tx, ctx.shop, [updated], ctx.products);
}

onJobFinished("ads", async (tx: Tx, job: AiJob) => {
  if (!job.parentId) return;
  if (job.parentType === "ad_set") await finishSet(tx, job);
  else if (job.parentType === "ad_variation") await finishOne(tx, job);
});
