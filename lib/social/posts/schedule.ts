import "server-only";
import { appOrigin } from "@/lib/connections/types";
import { asSystem, withWorkspace } from "@/lib/db";
import { publishCarousel, socialAccountsFor } from "@/lib/social/accounts";
import type { SocialAccount, Slide } from "@/lib/social/types";
import type { ShopRow } from "@/lib/shops/types";
import { lookFromBlueprint, slideUrl, slideVersion } from "./design";
import { slidePictureIndex, slidePictures } from "./pictures";
import { LOST_AFTER_MINUTES, PER_SWEEP } from "./due";
import { fullCaption } from "./schema";
import type { AccountResult, SocialPostRow, SocialSlideRow } from "./types";

// Sending posts out. A post is "claimed" by moving it from scheduled to posting in one statement,
// so the sweep, a "Post now" press and a second server can never send the same post twice. Each
// account's result is saved as soon as it's known, and an account already marked ok is skipped on
// any later try, so a retry only goes to the accounts that didn't take it.


const PLATFORM: Record<string, string> = { instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok" };
export const platformLabel = (p: string) => PLATFORM[p] ?? p;

/**
 * Publishes every post whose time has come. Call it about once a minute (the AI helper's poll does,
 * in app/api/helper/claim). Pass a workspace to only sweep that one (the posts page does, on view).
 */
export async function publishDuePosts(opts: { workspaceId?: string } = {}): Promise<number> {
  const ws = opts.workspaceId ?? null;
  const claimed = await asSystem(async (tx) => {
    await tx`
      update armada.social_posts
      set status = 'failed', updated_at = now(),
          problem = 'Armada lost track of this post while sending it. Check the accounts before trying again; any that already have it won''t get it twice.'
      where status = 'posting' and posting_started_at < now() - make_interval(mins => ${LOST_AFTER_MINUTES})
        and (${ws}::uuid is null or workspace_id = ${ws}::uuid)`;
    return tx<SocialPostRow[]>`
      update armada.social_posts set status = 'posting', posting_started_at = now(), updated_at = now()
      where id in (
        select id from armada.social_posts
        where status = 'scheduled' and scheduled_at <= now() and not rewriting
          and (${ws}::uuid is null or workspace_id = ${ws}::uuid)
        order by scheduled_at
        limit ${PER_SWEEP}
        for update skip locked
      )
      returning *`;
  });
  for (const post of claimed) {
    try {
      await sendClaimed(post);
    } catch (e) {
      console.error("sending a social post failed", post.id, e);
      await withWorkspace(
        post.workspaceId,
        (tx) => tx`
          update armada.social_posts set status = 'failed', problem = 'Something went wrong while sending it. Try again.', updated_at = now()
          where id = ${post.id} and status = 'posting'`,
      ).catch(() => {});
    }
  }
  return claimed.length;
}

/** "Post now": sends one post straight away, if it's due and nobody else has picked it up. */
export async function publishPostNow(workspaceId: string, postId: string): Promise<void> {
  const [post] = await withWorkspace(
    workspaceId,
    (tx) => tx<SocialPostRow[]>`
      update armada.social_posts set status = 'posting', posting_started_at = now(), updated_at = now()
      where id = ${postId} and status = 'scheduled' and scheduled_at <= now() and not rewriting
      returning *`,
  );
  if (post) await sendClaimed(post);
}

async function sendClaimed(post: SocialPostRow): Promise<void> {
  const { shop, slides } = await withWorkspace(post.workspaceId, async (tx) => {
    const [s] = await tx<ShopRow[]>`select * from armada.shops where id = ${post.shopId}`;
    const sl = await tx<SocialSlideRow[]>`select * from armada.social_slides where post_id = ${post.id} order by n`;
    // Each slide's address carries the picture it's drawn with, the same as the preview.
    const pictures = slidePictures(sl, await slidePictureIndex(tx, post.shopId, sl));
    return { shop: s, slides: sl.map((x) => ({ ...x, pictureId: pictures.get(`${x.postId}:${x.n}`)?.pictureId ?? null })) };
  });
  const look = shop ? lookFromBlueprint(shop.blueprint) : null;
  if (!shop || !look || !slides.length) {
    await finish(post, post.results, "This post has no slides to send.");
    return;
  }

  const base = appOrigin();
  const carousel: { caption: string; slides: Slide[] } = {
    caption: fullCaption(post.caption, post.hashtags ?? []),
    slides: slides.map((s) => ({ imageUrl: slideUrl(base, post.id, s.n, slideVersion(s, slides.length, look)), alt: s.alt })),
  };

  let accounts: SocialAccount[] = [];
  try {
    accounts = await socialAccountsFor(post.workspaceId, post.shopId);
  } catch (e) {
    console.error("loading social accounts failed", post.shopId, e);
    await finish(post, post.results, "Armada couldn't load this shop's social accounts. Try again in a minute.");
    return;
  }

  const practiceShop = shop.brief.source === "practice";
  const results: Record<string, AccountResult> = { ...(post.results ?? {}) };
  const targets = (post.accountIds ?? []).filter((id) => !results[id]?.ok);
  for (const id of targets) {
    const account = accounts.find((a) => a.id === id);
    const who = {
      platform: account?.platform ?? results[id]?.platform ?? "instagram",
      name: account?.name ?? results[id]?.name ?? "An account",
      handle: account?.handle ?? results[id]?.handle ?? null,
      practice: account?.status === "practice",
      at: new Date().toISOString(),
    };
    let result: AccountResult;
    if (!account) {
      result = { ...who, ok: false, problem: "This account isn't connected to the shop any more." };
    } else if (!account.canPostCarousel) {
      result = { ...who, ok: false, problem: `${platformLabel(account.platform)} doesn't let Armada post carousels to this account.` };
    } else if (account.status === "needs_attention") {
      result = { ...who, ok: false, problem: `${platformLabel(account.platform)} stopped accepting posts from Armada. Reconnect it on the set-up page, then try again.` };
    } else if (practiceShop && account.status !== "practice") {
      result = { ...who, ok: false, problem: "This is a practice shop, so its posts only go to practice accounts." };
    } else {
      try {
        const r = await publishCarousel(post.workspaceId, id, carousel);
        result = r.ok
          ? { ...who, ok: true, externalId: r.externalId, url: r.url }
          : { ...who, ok: false, problem: r.problem || `${platformLabel(account.platform)} didn't take the post.` };
      } catch (e) {
        console.error("publishCarousel threw", post.id, id, e);
        result = { ...who, ok: false, problem: "Something went wrong while sending it. Try again." };
      }
    }
    results[id] = result;
    // Saved straight away, so a cut-off never loses track of an account that already has the post.
    await withWorkspace(
      post.workspaceId,
      (tx) => tx`
        update armada.social_posts set results = results || ${tx.json({ [id]: result } as never)}, updated_at = now()
        where id = ${post.id}`,
    );
  }
  await finish(post, results);
}

async function finish(post: SocialPostRow, results: Record<string, AccountResult>, problem?: string): Promise<void> {
  const chosen = post.accountIds ?? [];
  const failed = chosen.filter((id) => !results[id]?.ok);
  const allOk = !problem && chosen.length > 0 && failed.length === 0;
  const message =
    problem ??
    (chosen.length === 0
      ? "No accounts were chosen for this post."
      : failed.length === 0
        ? null
        : failed.length === chosen.length
          ? "It didn't go out."
          : `It went out on ${chosen.length - failed.length} of ${chosen.length} accounts.`);
  await withWorkspace(
    post.workspaceId,
    (tx) => tx`
      update armada.social_posts
      set status = ${allOk ? "posted" : "failed"}, posted_at = ${allOk ? new Date() : null}, problem = ${message}, updated_at = now()
      where id = ${post.id} and status = 'posting'`,
  );
}
