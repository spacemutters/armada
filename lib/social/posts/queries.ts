import "server-only";
import { enqueueJob } from "@/lib/ai/jobs";
import { countryCode } from "@/lib/countries";
import { withWorkspace, type Tx } from "@/lib/db";
import type { ShopRow } from "@/lib/shops/types";
import { slideAlt } from "./design";
import { callOffPostPictures, dropPostPictures, ensurePostPictures, redoSlidePicture, slidePictureIndex, slidePictures } from "./pictures";
import { carouselPrompt, photoRefs, SYSTEM, type PhotoRef, type PromptProduct } from "./prompt";
import { carouselSchema, CAPTION_MAX, HEADLINE_MAX, LINE_MAX, normalizeHashtags, POSTS_PER_PRODUCT, POSTS_PER_WEEK, tidyCaption, tidyLine } from "./schema";
import { takenDays, zoneFor } from "./time";
import type { PostWithSlides, SlideWithPicture, SocialPostRow, SocialRunRow, SocialSlideRow } from "./types";

// Reading and changing a shop's carousel posts. Everything here runs as one workspace, so row-level
// security keeps every query inside it. Publishing lives in ./schedule.ts; the AI's answer is read in ./jobs.ts.

/** A plain sentence for the person, when something can't be done. */
export class PostProblem extends Error {}

const WEEK_TIMEOUT_MS = 330_000;
const ONE_TIMEOUT_MS = 180_000;
/** Posts that can be changed: not out yet and not on their way out. */
const EDITABLE = ["draft", "scheduled", "failed"] as const;

export const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

async function readyShop(tx: Tx, shopId: string): Promise<ShopRow> {
  const [shop] = await tx<ShopRow[]>`select * from armada.shops where id = ${shopId}`;
  if (!shop || !["ready", "publishing", "published"].includes(shop.status) || !shop.blueprint.theme) {
    throw new PostProblem("This shop isn't finished yet. Posts can be made once the shop builder is done.");
  }
  return shop;
}

/** The shop's products in the order the shop shows them, with the facts the AI may use. */
export async function shopProducts(tx: Tx, shop: ShopRow): Promise<PromptProduct[]> {
  const refs = shop.blueprint.products ?? [];
  if (!refs.length) return [];
  const rows = await tx<{ id: string; title: string; description: string; bullets: string[]; images: { url: string }[] }[]>`
    select id, title, description, bullets, images from armada.products where id in ${tx(refs.map((r) => r.productId))}`;
  const byId = new Map(rows.map((r) => [r.id, r]));
  return refs
    .map((r) => {
      const p = byId.get(r.productId);
      return p
        ? { id: p.id, title: p.title, description: p.description ?? "", bullets: p.bullets ?? [], images: p.images ?? [], collection: r.collection, imagined: r.imagined }
        : null;
    })
    .filter((p): p is PromptProduct => p !== null);
}

async function askForPosts(
  tx: Tx,
  shop: ShopRow,
  run: { id: string; kind: "week" | "rewrite" | "product" },
  opts: { platforms: string[]; replacing?: { postId: string; angle: string; headlines: string[] }; productId?: string },
): Promise<Record<string, PhotoRef>> {
  const all = await shopProducts(tx, shop);
  // A product run sees only its own product, so every fact and photo in the ads is that product's.
  const products = opts.productId ? all.filter((p) => p.id === opts.productId) : all;
  if (!products.length) {
    throw new PostProblem(opts.productId ? "This product isn't in that shop, so its ads can't be made there." : "This shop has no products yet, so there's nothing to post about.");
  }
  const refs = photoRefs(products, { practice: shop.brief.source === "practice" });
  const recent = await tx<{ angle: string; scheduledAt: Date | null }[]>`
    select angle, scheduled_at from armada.social_posts
    where shop_id = ${shop.id} and created_at > now() - interval '45 days' and id <> ${opts.replacing?.postId ?? "00000000-0000-0000-0000-000000000000"}
    order by created_at desc limit 30`;
  const zone = zoneFor(countryCode(shop.brief.country ?? ""));
  const scheduled = recent.map((r) => r.scheduledAt).filter((d): d is Date => d != null).map((d) => new Date(d));
  const count = run.kind === "week" ? POSTS_PER_WEEK : run.kind === "product" ? POSTS_PER_PRODUCT : 1;
  await tx`update armada.social_runs set refs = ${tx.json(refs as never)} where id = ${run.id}`;
  await enqueueJob(tx, {
    workspaceId: shop.workspaceId,
    kind: "social.carousel",
    input: {
      system: SYSTEM,
      prompt: carouselPrompt({
        bp: shop.blueprint,
        practice: shop.brief.source === "practice",
        products,
        refs,
        count,
        platforms: opts.platforms,
        earlierAngles: recent.map((r) => r.angle).filter(Boolean).slice(0, 20),
        takenDays: takenDays(new Date(), scheduled, zone.tz),
        zoneLabel: zone.label,
        replacing: opts.replacing ? { angle: opts.replacing.angle, headlines: opts.replacing.headlines } : undefined,
        focus: run.kind === "product",
      }),
      schema: carouselSchema(Object.keys(refs), count) as never,
      timeoutMs: count === 1 ? ONE_TIMEOUT_MS : WEEK_TIMEOUT_MS,
    },
    parent: { type: "social_run", id: run.id },
  });
  return refs;
}

/** "Make a week of posts". A second press while the week is being written finds the same run. */
export async function startWeek(workspaceId: string, shopId: string, memberId: string, platforms: string[]): Promise<string> {
  return withWorkspace(workspaceId, async (tx) => {
    const shop = await readyShop(tx, shopId);
    const [open] = await tx<{ id: string }[]>`select id from armada.social_runs where shop_id = ${shopId} and kind = 'week' and status = 'writing'`;
    if (open) return open.id;
    const [run] = await tx<{ id: string }[]>`
      insert into armada.social_runs (workspace_id, shop_id, kind, created_by)
      values (${workspaceId}, ${shopId}, 'week', ${memberId})
      on conflict (shop_id) where status = 'writing' and kind = 'week' do nothing
      returning id`;
    if (!run) {
      const [other] = await tx<{ id: string }[]>`select id from armada.social_runs where shop_id = ${shopId} and kind = 'week' and status = 'writing'`;
      if (other) return other.id;
      throw new PostProblem("Couldn't start writing. Try again.");
    }
    await askForPosts(tx, shop, { id: run.id, kind: "week" }, { platforms });
    await tx`
      insert into armada.audit_log (workspace_id, member_id, action, detail)
      values (${workspaceId}, ${memberId}, 'social.week_started', ${tx.json({ shopId, runId: run.id } as never)})`;
    return run.id;
  });
}

/**
 * "Make an ad with AI" on a product: the AI writes a few carousel ads about that one product, in the
 * shop's look, as drafts on the shop's posts page. A second press while they're being written finds
 * the same run.
 */
export async function startProductAds(workspaceId: string, shopId: string, productId: string, memberId: string, platforms: string[]): Promise<string> {
  return withWorkspace(workspaceId, async (tx) => {
    const shop = await readyShop(tx, shopId);
    const find = () => tx<{ id: string }[]>`
      select id from armada.social_runs where shop_id = ${shopId} and product_id = ${productId} and kind = 'product' and status = 'writing'`;
    const [open] = await find();
    if (open) return open.id;
    const [run] = await tx<{ id: string }[]>`
      insert into armada.social_runs (workspace_id, shop_id, kind, product_id, created_by)
      values (${workspaceId}, ${shopId}, 'product', ${productId}, ${memberId})
      on conflict (shop_id, product_id) where status = 'writing' and kind = 'product' do nothing
      returning id`;
    if (!run) {
      const [other] = await find();
      if (other) return other.id;
      throw new PostProblem("Couldn't start writing. Try again.");
    }
    await askForPosts(tx, shop, { id: run.id, kind: "product" }, { platforms, productId });
    await tx`
      insert into armada.audit_log (workspace_id, member_id, action, detail)
      values (${workspaceId}, ${memberId}, 'social.product_ads_started', ${tx.json({ shopId, productId, runId: run.id } as never)})`;
    return run.id;
  });
}

/** The newest week or product run for the shop, with the product's name for a product run. */
export async function latestRun(workspaceId: string, shopId: string): Promise<(SocialRunRow & { productTitle: string | null }) | null> {
  const rows = await withWorkspace(
    workspaceId,
    (tx) => tx<(SocialRunRow & { productTitle: string | null })[]>`
      select r.*, p.title as product_title from armada.social_runs r left join armada.products p on p.id = r.product_id
      where r.shop_id = ${shopId} and r.kind in ('week', 'product') order by r.created_at desc limit 1`,
  );
  return rows[0] ?? null;
}

/** Ready shops that sell this product, for "Make an ad with AI". */
export async function shopsWithProduct(workspaceId: string, productId: string): Promise<{ id: string; name: string }[]> {
  return withWorkspace(
    workspaceId,
    (tx) => tx<{ id: string; name: string }[]>`
      select id, coalesce(blueprint -> 'brand' ->> 'name', niche) as name from armada.shops
      where status in ('ready', 'publishing', 'published') and blueprint ? 'theme'
        and blueprint -> 'products' @> ${tx.json([{ productId }] as never)}
      order by updated_at desc`,
  );
}

/** "Write again": the AI writes a new version of one post, in place. */
export async function startRewrite(workspaceId: string, postId: string, memberId: string, platforms: string[]): Promise<void> {
  await withWorkspace(workspaceId, async (tx) => {
    // Not for a post that already went out on one of its accounts: its words are on record there.
    const [post] = await tx<SocialPostRow[]>`
      select * from armada.social_posts where id = ${postId} and status in ('draft', 'failed')
        and not exists (select 1 from jsonb_each(results) r where (r.value ->> 'ok')::boolean)
      for update`;
    if (!post || post.rewriting) return;
    const shop = await readyShop(tx, post.shopId);
    const slides = await tx<{ headline: string }[]>`select headline from armada.social_slides where post_id = ${postId} order by n`;
    const [run] = await tx<{ id: string }[]>`
      insert into armada.social_runs (workspace_id, shop_id, kind, post_id, created_by)
      values (${workspaceId}, ${post.shopId}, 'rewrite', ${postId}, ${memberId}) returning id`;
    await tx`update armada.social_posts set rewriting = true, problem = null, updated_at = now() where id = ${postId}`;
    await askForPosts(tx, shop, { id: run.id, kind: "rewrite" }, { platforms, replacing: { postId, angle: post.angle, headlines: slides.map((s) => s.headline) } });
  });
}

export async function cancelRun(workspaceId: string, runId: string): Promise<void> {
  await withWorkspace(workspaceId, async (tx) => {
    const [run] = await tx<SocialRunRow[]>`
      update armada.social_runs set status = 'cancelled', finished_at = now() where id = ${runId} and status = 'writing' returning *`;
    if (run?.postId) await tx`update armada.social_posts set rewriting = false, updated_at = now() where id = ${run.postId}`;
  });
}

// ---------- reading ----------

export async function latestWeekRun(workspaceId: string, shopId: string): Promise<SocialRunRow | null> {
  const rows = await withWorkspace(
    workspaceId,
    (tx) => tx<SocialRunRow[]>`select * from armada.social_runs where shop_id = ${shopId} and kind = 'week' order by created_at desc limit 1`,
  );
  return rows[0] ?? null;
}

/** Every post for the shop that's still in play, plus the most recent ones that went out. */
export async function postsForShop(workspaceId: string, shopId: string): Promise<PostWithSlides[]> {
  return withWorkspace(workspaceId, async (tx) => {
    const posts = await tx<SocialPostRow[]>`
      (select * from armada.social_posts where shop_id = ${shopId} and status <> 'posted')
      union all
      (select * from armada.social_posts where shop_id = ${shopId} and status = 'posted' order by posted_at desc nulls last limit 12)`;
    if (!posts.length) return [];
    const slides = await tx<SocialSlideRow[]>`select * from armada.social_slides where post_id in ${tx(posts.map((p) => p.id))} order by post_id, n`;
    const pictures = slidePictures(slides, await slidePictureIndex(tx, shopId, slides));
    const byPost = new Map<string, SlideWithPicture[]>();
    for (const s of slides) {
      const pic = pictures.get(`${s.postId}:${s.n}`) ?? { pictureId: null, pictureState: null };
      byPost.set(s.postId, [...(byPost.get(s.postId) ?? []), { ...s, ...pic }]);
    }
    return posts.map((p) => ({ ...p, slides: byPost.get(p.id) ?? [] }));
  });
}

export interface PhotoChoice {
  /** "<productId>:<photo index>", or "<productId>:item" for a practice item's picture. */
  value: string;
  label: string;
  /** The photo's address; empty for a practice item's picture. */
  url: string;
}

/** The product photos a slide can show, for the slide editor. In a practice shop, practice items' pictures too. */
export async function photoChoices(workspaceId: string, shop: ShopRow): Promise<PhotoChoice[]> {
  const products = await withWorkspace(workspaceId, (tx) => shopProducts(tx, shop));
  const out: PhotoChoice[] = [];
  for (const p of products) {
    const imgs = p.images.filter((img) => /^https:\/\//i.test(img?.url ?? "")).slice(0, 3);
    imgs.forEach((img, k) => out.push({ value: `${p.id}:${k}`, label: imgs.length > 1 ? `${p.title}, photo ${k + 1}` : p.title, url: img.url }));
    if (!imgs.length && p.imagined && shop.brief.source === "practice") out.push({ value: `${p.id}:item`, label: `${p.title} (practice item picture)`, url: "" });
  }
  return out;
}

// ---------- editing ----------

export async function saveCaption(workspaceId: string, postId: string, caption: string, hashtags: string): Promise<void> {
  await withWorkspace(
    workspaceId,
    (tx) => tx`
      update armada.social_posts
      set caption = ${tidyCaption(caption, CAPTION_MAX)}, hashtags = ${tx.json(normalizeHashtags(hashtags) as never)}, edited = true, updated_at = now()
      where id = ${postId} and status in ${tx([...EDITABLE])} and not rewriting`,
  );
}

export interface SlideEdit {
  n: number;
  headline: string;
  line: string;
  /** "keep", "none", or "<productId>:<photo index>". */
  photo: string;
}

export async function saveSlides(workspaceId: string, postId: string, edits: SlideEdit[]): Promise<void> {
  await withWorkspace(workspaceId, async (tx) => {
    const [post] = await tx<SocialPostRow[]>`
      select * from armada.social_posts where id = ${postId} and status in ${tx([...EDITABLE])} and not rewriting for update`;
    if (!post) return;
    const shop = await readyShop(tx, post.shopId);
    const products = await shopProducts(tx, shop);
    const current = await tx<SocialSlideRow[]>`select * from armada.social_slides where post_id = ${postId}`;
    const titleOf = (productId: string | null) => products.find((p) => p.id === productId)?.title ?? null;
    let changed = false;
    const droppedScenes: number[] = [];
    for (const e of edits) {
      const slide = current.find((s) => s.n === e.n);
      if (!slide) continue;
      const headline = tidyLine(e.headline, HEADLINE_MAX);
      if (!headline) throw new PostProblem(`Slide ${e.n} needs a headline.`);
      const line = tidyLine(e.line, LINE_MAX);
      let productId = slide.productId;
      let imageUrl = slide.imageUrl;
      let picture = slide.picture;
      if (e.photo === "none") {
        productId = null;
        imageUrl = null;
        picture = null;
      } else if (e.photo !== "keep") {
        // Only a photo of one of this shop's own products can go on a slide, or (practice shops) a practice item's picture.
        const [pid, idx] = e.photo.split(":");
        const product = products.find((p) => p.id === pid);
        const url = product?.images.filter((img) => /^https:\/\//i.test(img?.url ?? ""))[Number(idx)]?.url;
        if (product && url) {
          productId = product.id;
          imageUrl = url;
          picture = null;
        } else if (product && idx === "item" && product.imagined && shop.brief.source === "practice") {
          productId = product.id;
          imageUrl = null;
          picture = "item";
        }
      }
      if (headline === slide.headline && line === slide.line && imageUrl === slide.imageUrl && picture === slide.picture && productId === slide.productId) continue;
      changed = true;
      if (slide.picture === "scene" && picture !== "scene") droppedScenes.push(e.n);
      await tx`
        update armada.social_slides
        set headline = ${headline}, line = ${line}, product_id = ${productId}, image_url = ${imageUrl}, picture = ${picture},
            scene = ${picture === "scene" ? slide.scene : ""},
            alt = ${slideAlt(headline, line, imageUrl || picture === "item" ? titleOf(productId) : null)}, updated_at = now()
        where post_id = ${postId} and n = ${e.n}`;
    }
    if (changed) {
      await tx`update armada.social_posts set edited = true, updated_at = now() where id = ${postId}`;
      // A scene swapped for a product photo takes its picture with it; a practice item chosen now gets its picture.
      await dropPostPictures(tx, postId, droppedScenes);
      await ensurePostPictures(tx, shop, [postId]);
    }
  });
}

/** Takes a post that hasn't gone out off the list. A post that went out anywhere stays as the record. */
export async function removePost(workspaceId: string, postId: string): Promise<void> {
  await withWorkspace(workspaceId, async (tx) => {
    const [post] = await tx<{ id: string }[]>`
      select id from armada.social_posts
      where id = ${postId} and status in ('draft', 'scheduled', 'failed')
        and not exists (select 1 from jsonb_each(results) r where (r.value ->> 'ok')::boolean)`;
    if (!post) return;
    // Its pictures that haven't started aren't made: nobody will see them.
    await callOffPostPictures(tx, postId);
    await tx`delete from armada.social_posts where id = ${postId}`;
  });
}

/** "Make again" on one slide's picture (a scene, or a practice item's picture). */
export async function remakeSlidePicture(workspaceId: string, postId: string, n: number): Promise<void> {
  await withWorkspace(workspaceId, async (tx) => {
    const [post] = await tx<SocialPostRow[]>`select * from armada.social_posts where id = ${postId} and status in ${tx([...EDITABLE])} and not rewriting`;
    if (!post) throw new PostProblem("Pictures can be made again only before a post goes out.");
    const shop = await readyShop(tx, post.shopId);
    if (!(await redoSlidePicture(tx, shop, post, n))) throw new PostProblem("That picture is already being made again.");
  });
}

// ---------- scheduling ----------

/** Puts a post in the queue for `at` (or now), to the chosen accounts. Returns false if it can't be. */
export async function schedulePost(workspaceId: string, shopId: string, postId: string, at: Date, accountIds: string[], base: string): Promise<boolean> {
  const rows = await withWorkspace(
    workspaceId,
    (tx) => tx`
      update armada.social_posts
      set status = 'scheduled', scheduled_at = ${at}, account_ids = ${tx.json(accountIds as never)}, slide_base = ${base},
          problem = null, updated_at = now()
      where id = ${postId} and shop_id = ${shopId} and status in ${tx([...EDITABLE])} and not rewriting
      returning id`,
  );
  return rows.length > 0;
}

export async function unschedulePost(workspaceId: string, postId: string): Promise<void> {
  await withWorkspace(
    workspaceId,
    (tx) => tx`
      update armada.social_posts set status = 'draft', scheduled_at = null, updated_at = now()
      where id = ${postId} and status = 'scheduled' and scheduled_at > now()`,
  );
}

/** Queues every draft at the time the AI suggested. Drafts whose suggested time has passed are left for a new time. */
export async function scheduleAllSuggested(workspaceId: string, shopId: string, accountIds: string[], base: string): Promise<{ scheduled: number; past: number }> {
  return withWorkspace(workspaceId, async (tx) => {
    const rows = await tx<{ id: string }[]>`
      update armada.social_posts
      set status = 'scheduled', scheduled_at = suggested_at, account_ids = ${tx.json(accountIds as never)}, slide_base = ${base},
          problem = null, updated_at = now()
      where shop_id = ${shopId} and status = 'draft' and not rewriting and suggested_at > now() + interval '2 minutes'
      returning id`;
    const [left] = await tx<{ n: number }[]>`
      select count(*)::int as n from armada.social_posts where shop_id = ${shopId} and status = 'draft' and not rewriting`;
    return { scheduled: rows.length, past: left?.n ?? 0 };
  });
}
