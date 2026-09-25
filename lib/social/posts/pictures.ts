import "server-only";
import type { SceneSpec } from "@/lib/creative/brief";
import { callOff, dropPictures, pictureIndex, pictureKey, queueItem, queueScene, type PictureIndex, type SlotState } from "@/lib/creative/pictures";
import type { Tx } from "@/lib/db";
import type { ShopRow } from "@/lib/shops/types";
import { clip } from "@/lib/text";
import type { SocialPostRow, SocialSlideRow } from "./types";

// The ChatGPT pictures on a post's slides (lib/creative does the making). A slide shows:
//   a product's real photo   image_url, as before; nothing is made
//   a scene                  picture = 'scene': a ChatGPT picture of a place or moment, never a product
//   a practice item          picture = 'item' (practice shops only): the item's one ChatGPT picture,
//                            shared with every ad and post that shows it
// Pictures are asked for when the posts are written and when a slide is changed to one; a slide's
// picture is made once, until someone presses "Make again".

export type SlidePictureState = "ready" | "making" | "failed" | "waiting";

export interface SlidePicture {
  /** The cut a slide is drawn with (portrait for scenes, square for items), or null until there is one. */
  pictureId: string | null;
  pictureState: SlidePictureState | null;
}

const EMPTY: SlotState = { cuts: {}, alt: "", making: false, failed: false, tried: false };

function stateOf(s: SlotState, cut: string | null): SlidePictureState {
  if (s.making) return "making";
  if (cut) return "ready";
  return s.failed ? "failed" : "waiting";
}

/** The picture on each slide, and where making it stands. */
export function slidePictures(slides: Pick<SocialSlideRow, "postId" | "n" | "picture" | "productId">[], index: PictureIndex): Map<string, SlidePicture> {
  const out = new Map<string, SlidePicture>();
  for (const s of slides) {
    const k = `${s.postId}:${s.n}`;
    if (s.picture === "scene") {
      const st = index.get(pictureKey.post(s.postId, `slide:${s.n}`)) ?? EMPTY;
      const cut = st.cuts.portrait?.id ?? null;
      out.set(k, { pictureId: cut, pictureState: stateOf(st, cut) });
    } else if (s.picture === "item" && s.productId) {
      const st = index.get(pictureKey.item(s.productId)) ?? EMPTY;
      const cut = st.cuts.square?.id ?? null;
      out.set(k, { pictureId: cut, pictureState: stateOf(st, cut) });
    } else out.set(k, { pictureId: null, pictureState: null });
  }
  return out;
}

/** Reads the picture index for these posts' slides. */
export async function slidePictureIndex(tx: Tx, shopId: string, slides: Pick<SocialSlideRow, "postId" | "picture" | "productId">[]): Promise<PictureIndex> {
  const postIds = [...new Set(slides.filter((s) => s.picture === "scene").map((s) => s.postId))];
  const itemIds = [...new Set(slides.filter((s) => s.picture === "item" && s.productId).map((s) => s.productId as string))];
  return pictureIndex(tx, { shopId, postIds, itemIds });
}

/** What ChatGPT is asked for on a scene slide. */
export function slideScene(post: Pick<SocialPostRow, "angle">, slide: Pick<SocialSlideRow, "n" | "headline" | "scene">, total: number): SceneSpec {
  return {
    kind: "scene",
    role: "slide",
    scene: slide.scene,
    context: `slide ${slide.n} of ${total} of a social media carousel post about "${clip(post.angle, 80)}", headed "${clip(slide.headline, 60)}"`,
  };
}

/**
 * Asks for the pictures these posts' slides are missing. Slots that have a picture, are being made,
 * or couldn't be made are left alone. Returns how many were asked for.
 */
export async function ensurePostPictures(tx: Tx, shop: ShopRow, postIds: string[]): Promise<number> {
  if (!postIds.length) return 0;
  const posts = await tx<SocialPostRow[]>`select * from armada.social_posts where id in ${tx(postIds)} and status in ('draft', 'scheduled', 'failed')`;
  if (!posts.length) return 0;
  const slides = await tx<SocialSlideRow[]>`select * from armada.social_slides where post_id in ${tx(posts.map((p) => p.id))} and picture is not null order by post_id, n`;
  if (!slides.length) return 0;
  const totals = new Map<string, number>();
  for (const r of await tx<{ postId: string; n: number }[]>`
    select post_id, count(*)::int as n from armada.social_slides where post_id in ${tx(posts.map((p) => p.id))} group by post_id`) totals.set(r.postId, r.n);
  const index = await slidePictureIndex(tx, shop.id, slides);
  const untouched = (s: SlotState | undefined) => !s || (!s.tried && !s.making && !Object.keys(s.cuts).length);
  const itemIds = [...new Set(slides.filter((s) => s.picture === "item" && s.productId).map((s) => s.productId as string))];
  const facts = itemIds.length
    ? new Map((await tx<{ id: string; title: string; bullets: string[] }[]>`select id, title, bullets from armada.products where id in ${tx(itemIds)}`).map((p) => [p.id, p]))
    : new Map<string, { id: string; title: string; bullets: string[] }>();
  let queued = 0;
  const askedItems = new Set<string>();
  for (const s of slides) {
    const post = posts.find((p) => p.id === s.postId);
    if (!post) continue;
    if (s.picture === "scene" && s.scene && untouched(index.get(pictureKey.post(post.id, `slide:${s.n}`)))) {
      if (await queueScene(tx, shop, { type: "post", id: post.id }, `slide:${s.n}`, slideScene(post, s, totals.get(post.id) ?? s.n))) queued++;
    } else if (s.picture === "item" && s.productId && !askedItems.has(s.productId) && untouched(index.get(pictureKey.item(s.productId)))) {
      askedItems.add(s.productId);
      const p = facts.get(s.productId);
      if (p && (await queueItem(tx, shop, p.id, { title: p.title, facts: p.bullets ?? [] }))) queued++;
    }
  }
  return queued;
}

/** "Make again" on one slide's picture. False when there's nothing to remake or it's already being made. */
export async function redoSlidePicture(tx: Tx, shop: ShopRow, post: SocialPostRow, n: number): Promise<boolean> {
  const [s] = await tx<SocialSlideRow[]>`select * from armada.social_slides where post_id = ${post.id} and n = ${n}`;
  if (!s?.picture) return false;
  if (s.picture === "scene") {
    if (!s.scene) return false;
    const [t] = await tx<{ n: number }[]>`select count(*)::int as n from armada.social_slides where post_id = ${post.id}`;
    return queueScene(tx, shop, { type: "post", id: post.id }, `slide:${n}`, slideScene(post, s, t?.n ?? n));
  }
  if (!s.productId) return false;
  const [p] = await tx<{ id: string; title: string; bullets: string[] }[]>`select id, title, bullets from armada.products where id = ${s.productId}`;
  return p ? queueItem(tx, shop, p.id, { title: p.title, facts: p.bullets ?? [] }, { again: true }) : false;
}

/** A post written again, or taken out: its scene pictures go (and any not started are called off). */
export async function dropPostPictures(tx: Tx, postId: string, slides?: number[]): Promise<void> {
  await dropPictures(tx, { type: "post", id: postId }, slides?.map((n) => `slide:${n}`));
}

/** A post taken out: its pictures that haven't started aren't made. */
export async function callOffPostPictures(tx: Tx, postId: string): Promise<void> {
  await callOff(tx, { type: "post", id: postId });
}
