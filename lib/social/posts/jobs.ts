import "server-only";
import { onJobFinished } from "@/lib/ai/jobs";
import { countryCode } from "@/lib/countries";
import type { Tx } from "@/lib/db";
import type { ShopRow } from "@/lib/shops/types";
import type { AiJob } from "@/lib/types";
import { slideAlt } from "./design";
import { POSTS_PER_PRODUCT, POSTS_PER_WEEK, readCarouselAnswer, type ReadPost } from "./schema";
import { suggestedMoment, zoneFor } from "./time";
import type { SocialPostRow, SocialRunRow } from "./types";

// What happens when the AI hands back carousel posts (job kind "social.carousel"). Loaded by
// lib/ai/handlers.ts. Runs inside the helper's hand-back, as the job's workspace only.
//
// Registered for "social.carousel" rather than all of "social", so other social jobs (the accounts
// side) can have handlers of their own.

async function insertSlides(tx: Tx, workspaceId: string, postId: string, post: ReadPost, refs: SocialRunRow["refs"]) {
  for (const [i, s] of post.slides.entries()) {
    const ref = s.photo ? refs[s.photo] : undefined;
    await tx`
      insert into armada.social_slides (post_id, workspace_id, n, headline, line, product_id, image_url, alt)
      values (${postId}, ${workspaceId}, ${i + 1}, ${s.headline}, ${s.line}, ${ref?.productId ?? null}, ${ref?.url ?? null},
              ${slideAlt(s.headline, s.line, ref?.title ?? null)})`;
  }
}

async function failRun(tx: Tx, run: SocialRunRow, message: string) {
  await tx`update armada.social_runs set status = 'failed', error = ${message}, finished_at = now() where id = ${run.id}`;
  if (run.postId) {
    await tx`
      update armada.social_posts set rewriting = false, problem = ${`${message} The version you had is still here.`}, updated_at = now()
      where id = ${run.postId}`;
  }
}

onJobFinished("social.carousel", async (tx: Tx, job: AiJob) => {
  if (job.parentType !== "social_run" || !job.parentId) return;
  const [run] = await tx<SocialRunRow[]>`select * from armada.social_runs where id = ${job.parentId} for update`;
  // A run that was cancelled (or already answered) ignores a late answer.
  if (!run || run.status !== "writing") return;

  if (job.status === "failed") {
    await failRun(tx, run, "The AI couldn't write the posts, even on a second try.");
    return;
  }

  const [shop] = await tx<ShopRow[]>`select * from armada.shops where id = ${run.shopId}`;
  if (!shop) {
    await failRun(tx, run, "The shop is gone.");
    return;
  }
  const count = run.kind === "week" ? POSTS_PER_WEEK : run.kind === "product" ? POSTS_PER_PRODUCT : 1;
  const { posts, notes } = readCarouselAnswer(job.output, Object.keys(run.refs ?? {}), count);
  if (notes.length) console.warn("social.carousel answer notes", run.id, notes);
  if (!posts.length) {
    await failRun(tx, run, "The AI's answer came back in the wrong shape.");
    return;
  }

  const zone = zoneFor(countryCode(shop.brief.country ?? ""));
  const now = new Date();
  const when = (p: ReadPost) => suggestedMoment(now, p.day, p.hour, p.minute, zone.tz);

  if (run.kind === "rewrite" && run.postId) {
    const [post] = await tx<SocialPostRow[]>`
      select * from armada.social_posts where id = ${run.postId} and rewriting and status in ('draft', 'failed') for update`;
    if (!post) {
      await tx`update armada.social_runs set status = 'cancelled', finished_at = now() where id = ${run.id}`;
      return;
    }
    const p = posts[0];
    await tx`delete from armada.social_slides where post_id = ${post.id}`;
    await insertSlides(tx, run.workspaceId, post.id, p, run.refs);
    await tx`
      update armada.social_posts
      set angle = ${p.angle}, caption = ${p.caption}, hashtags = ${tx.json(p.hashtags as never)}, suggested_at = ${when(p)},
          status = 'draft', results = '{}', problem = null, edited = false, rewriting = false, run_id = ${run.id}, updated_at = now()
      where id = ${post.id}`;
    await tx`update armada.social_runs set status = 'done', count = 1, finished_at = now() where id = ${run.id}`;
    return;
  }

  for (const p of posts) {
    const [row] = await tx<{ id: string }[]>`
      insert into armada.social_posts (workspace_id, shop_id, run_id, angle, caption, hashtags, suggested_at, created_by)
      values (${run.workspaceId}, ${run.shopId}, ${run.id}, ${p.angle}, ${p.caption}, ${tx.json(p.hashtags as never)}, ${when(p)}, ${run.createdBy})
      returning id`;
    await insertSlides(tx, run.workspaceId, row.id, p, run.refs);
  }
  await tx`update armada.social_runs set status = 'done', count = ${posts.length}, finished_at = now() where id = ${run.id}`;
});
