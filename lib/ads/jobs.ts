import "server-only";
import { onJobFinished } from "@/lib/ai/jobs";
import type { Tx } from "@/lib/db";
import type { AiJob, CatalogImage } from "@/lib/types";
import { toDrafts, toOneDraft } from "./schema";
import type { AdSet, AdVariation } from "./types";

// What happens when the AI finishes an "ads.write" job. Loaded by lib/ai/handlers.ts
// (import "@/lib/ads/jobs"), which registers it for every "ads.…" job kind.
//
// A whole set (parent "ad_set"): its answer becomes 3 to 5 draft ads, plus the audience and budget.
// One ad written again (parent "ad_variation"): its answer replaces that ad's words and products.
// Nothing here creates or switches on anything on an ad platform; that is always a person's press.

async function photoCheck(tx: Tx, refs: string[], needPhotos: boolean): Promise<(id: string) => boolean> {
  if (!needPhotos || !refs.length) return (id) => refs.includes(id);
  const rows = await tx<{ id: string; images: CatalogImage[] }[]>`select id, images from armada.products where id in ${tx(refs)}`;
  const withPhoto = new Set(rows.filter((r) => r.images?.[0]?.url).map((r) => r.id));
  return (id) => withPhoto.has(id);
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
  const usable = await photoCheck(tx, set.productRefs, set.platform !== "practice");
  const draft = toDrafts(job.output, set.productRefs, usable);
  if (!draft) {
    await tx`update armada.ad_sets set status = 'failed', error = 'The AI''s answer came back in the wrong shape.', updated_at = now() where id = ${set.id}`;
    return;
  }
  for (const [i, ad] of draft.ads.entries()) {
    await tx`
      insert into armada.ad_variations
        (workspace_id, ad_set_id, position, format, idea, primary_text, headline, description, call_to_action, product_ids, cards)
      values (${set.workspaceId}, ${set.id}, ${i}, ${ad.format}, ${ad.idea}, ${ad.primaryText}, ${ad.headline}, ${ad.description},
              ${ad.callToAction}, ${tx.json(ad.productIds as never)}, ${tx.json(ad.cards as never)})`;
  }
  const audience = { ...set.audience, ...draft.audience };
  await tx`
    update armada.ad_sets
    set status = 'draft', plan = ${draft.plan}, audience = ${tx.json(audience as never)}, daily_budget_cents = ${draft.dailyBudgetCents},
        days = ${draft.days}, budget_reason = ${draft.budgetReason}, error = null, updated_at = now()
    where id = ${set.id}`;
}

async function finishOne(tx: Tx, job: AiJob) {
  const [v] = await tx<AdVariation[]>`select * from armada.ad_variations where id = ${job.parentId} for update`;
  if (!v || v.status !== "rewriting") return;
  const [set] = await tx<AdSet[]>`select * from armada.ad_sets where id = ${v.adSetId}`;
  const fail = (why: string) => tx`update armada.ad_variations set status = 'draft', error = ${why}, updated_at = now() where id = ${v.id}`;
  if (!set || set.status !== "draft") return fail("These ads were already created, so this one wasn't changed.");
  if (job.status === "failed") return fail("The AI couldn't write this ad again, so it's unchanged.");
  const draft = toOneDraft(job.output, set.productRefs, await photoCheck(tx, set.productRefs, set.platform !== "practice"));
  if (!draft) return fail("The AI's new version came back in the wrong shape, so this ad is unchanged.");
  await tx`
    update armada.ad_variations
    set status = 'draft', format = ${draft.format}, idea = ${draft.idea}, primary_text = ${draft.primaryText}, headline = ${draft.headline},
        description = ${draft.description}, call_to_action = ${draft.callToAction}, product_ids = ${tx.json(draft.productIds as never)},
        cards = ${tx.json(draft.cards as never)}, written_by = 'ai', error = null, updated_at = now()
    where id = ${v.id}`;
}

onJobFinished("ads", async (tx: Tx, job: AiJob) => {
  if (!job.parentId) return;
  if (job.parentType === "ad_set") await finishSet(tx, job);
  else if (job.parentType === "ad_variation") await finishOne(tx, job);
});
