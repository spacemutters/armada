import "server-only";
import { COMPOSE_REV, type Shape } from "@/lib/creative/compose";
import { mayPictureItem, type SceneSpec } from "@/lib/creative/brief";
import { callOff, dropPictures, pictureIndex, pictureKey, queueItem, queueScene, type PictureIndex, type SlotState } from "@/lib/creative/pictures";
import type { Tx } from "@/lib/db";
import { shortHash } from "@/lib/social/posts/design";
import type { ShopRow } from "@/lib/shops/types";
import { clip } from "@/lib/text";
import type { CatalogImage, ItemArt } from "@/lib/types";
import { normalizeCards, type CardDraft } from "./schema";
import type { AdVariation } from "./types";

// Which pictures each ad needs, where they come from, and whether they're ready. Honest by
// construction: a product is only ever shown by its real photo, or (practice shops only) by its
// practice item picture; ChatGPT makes the scenes around it (lib/creative).
//
//   single-photo ad   "main": the product's photo on a panel in front of a ChatGPT setting (staged)
//   carousel card     a product card (its real photo on the shop's ground) or a scene card (a ChatGPT scene)
//
// Pictures are asked for when the ads are written (lib/ads/jobs.ts), when an ad is put back, and when
// an older set is opened; never again for a slot that has one, is being made, or couldn't be made,
// until someone presses "Make again".

/** What the picture code needs to know about a shop's product. */
export interface PictureProduct {
  id: string;
  title: string;
  bullets: string[];
  images: CatalogImage[];
  art: ItemArt | null;
  imagined: boolean;
}

/** A product's photos Armada can show: https only, the first three (later ones are mostly size charts and banners). */
export function photosOf(p: Pick<PictureProduct, "images">): string[] {
  return (p.images ?? [])
    .map((i) => i?.url)
    .filter((u): u is string => typeof u === "string" && /^https:\/\//i.test(u))
    .slice(0, 3);
}

/** A practice item Armada may picture: a practice shop's imagined item with no real photo. */
export function isPracticeItem(shop: Pick<ShopRow, "brief" | "blueprint">, p: PictureProduct): boolean {
  return photosOf(p).length === 0 && mayPictureItem(shop, p.id);
}

export type PicturePlan =
  | { mode: "product"; productId: string; photoUrl: string | null; item: boolean }
  | { mode: "scene"; slot: string }
  | { mode: "staged"; productId: string; photoUrl: string | null; item: boolean; slot: "main" };

export interface AdPictureSlot {
  /** "main" for a single-photo ad, or the card's key. */
  key: string;
  plan: PicturePlan;
  /** What ChatGPT is asked for, if anything: the scene of this slot. */
  scene: SceneSpec | null;
}

function defaultSetting(title: string): string {
  return `a calm, uncluttered surface in the place a "${clip(title, 60)}" is used, soft daylight, gentle shadows`;
}

/** The pictures one ad shows, in order: one for a single-photo ad, one per card for a carousel. */
export function adPictureSlots(
  shop: Pick<ShopRow, "brief" | "blueprint">,
  v: Pick<AdVariation, "format" | "headline" | "productIds" | "scene"> & { cards: unknown },
  products: Map<string, PictureProduct>,
): AdPictureSlot[] {
  const productPlan = (id: string, photo: number) => {
    const p = products.get(id);
    const photos = p ? photosOf(p) : [];
    return { productId: id, photoUrl: photos[Math.min(photo, photos.length - 1)] ?? null, item: Boolean(p && isPracticeItem(shop, p)) };
  };
  if (v.format === "single") {
    const id = v.productIds[0];
    if (!id) return [];
    const p = products.get(id);
    return [
      {
        key: "main",
        plan: { mode: "staged", slot: "main", ...productPlan(id, 0) },
        scene: {
          kind: "scene",
          role: "backdrop",
          scene: v.scene || defaultSetting(p?.title ?? "product"),
          context: `the setting behind the product photo of a single-photo ad for "${clip(p?.title ?? "the product", 70)}", headed "${clip(v.headline, 60)}"`,
        },
      },
    ];
  }
  const cards = normalizeCards(v.cards);
  return cards.map((c: CardDraft, i) =>
    c.kind === "scene"
      ? {
          key: c.key,
          plan: { mode: "scene", slot: `card:${c.key}` },
          scene: { kind: "scene", role: "card", scene: c.scene, context: `card ${i + 1} of ${cards.length} of a carousel ad, headed "${clip(c.headline || v.headline, 60)}"` },
        }
      : { key: c.key, plan: { mode: "product", ...productPlan(c.productId as string, c.photo) }, scene: null },
  );
}

export type PictureStateWord = "ready" | "making" | "failed" | "waiting";

export interface AdPictureView {
  key: string;
  mode: PicturePlan["mode"];
  state: PictureStateWord;
  /** Composed pictures (null until there's something honest to show). */
  src: Record<Shape, string | null>;
  /** Shown on the picture in previews: a practice item's picture is labelled as practice. */
  practiceItem: boolean;
  /** Plain words for the pictures list. */
  label: string;
  alt: string;
  /** What "Make again" can remake here: this slot's scene and/or the practice item's picture. */
  redo: { scene: boolean; item: string | null };
  /** A picture that couldn't be made, in plain words. */
  note: string | null;
}

const SHAPES: Shape[] = ["square", "portrait", "story"];

/** The address of one composed ad picture. Changes whenever anything in it changes. */
export function adPictureUrl(variationId: string, key: string, shape: Shape, version: string): string {
  return `/api/ads/picture/${variationId}/${key}.jpg?shape=${shape}&v=${version}`;
}

/** What goes into one composed picture, as a short hash: the plan, the pictures used, the shop's colours. */
export function adPictureVersion(plan: PicturePlan, shape: Shape, parts: { sceneCut: string | null; itemCut: string | null }, palette: object | undefined): string {
  return shortHash([COMPOSE_REV, shape, JSON.stringify(plan), parts.sceneCut ?? "", parts.itemCut ?? "", JSON.stringify(palette ?? {})].join("|"));
}

const EMPTY: SlotState = { cuts: {}, alt: "", making: false, failed: false, tried: false };

/** Everything the ad previews need about one ad's pictures. */
export function adPictureViews(
  shop: Pick<ShopRow, "brief" | "blueprint">,
  v: Pick<AdVariation, "id" | "format" | "headline" | "productIds" | "scene"> & { cards: unknown },
  products: Map<string, PictureProduct>,
  index: PictureIndex,
): AdPictureView[] {
  const palette = shop.blueprint.theme?.palette;
  return adPictureSlots(shop, v, products).map(({ key, plan }) => {
    const sceneState = plan.mode === "product" ? null : (index.get(pictureKey.ad(v.id, plan.slot)) ?? EMPTY);
    const itemState = plan.mode !== "scene" && plan.item ? (index.get(pictureKey.item(plan.productId)) ?? EMPTY) : null;
    const productReady = plan.mode === "scene" || Boolean(plan.photoUrl) || Boolean(itemState?.cuts.square);
    const sceneReady = !sceneState || SHAPES.every((s) => sceneState.cuts[s]);
    const parts = [sceneState, itemState].filter((x): x is SlotState => x !== null);
    const making = parts.some((s) => s.making);
    const failed = parts.some((s) => s.failed && !s.making);
    let state: PictureStateWord;
    if (productReady && sceneReady) state = making ? "making" : "ready";
    else if (making) state = "making";
    else if (failed) state = "failed";
    else state = "waiting";
    // A single-photo ad whose setting couldn't be made still shows its product on the shop's ground.
    const showable = productReady && (sceneReady || (plan.mode === "staged" && sceneState?.failed && !sceneState.making));
    const src = Object.fromEntries(
      SHAPES.map((shape) => {
        if (!showable || (state === "making" && !(productReady && sceneReady))) return [shape, null];
        const version = adPictureVersion(plan, shape, { sceneCut: sceneState?.cuts[shape]?.id ?? null, itemCut: itemState?.cuts.square?.id ?? null }, palette);
        return [shape, adPictureUrl(v.id, key, shape, version)];
      }),
    ) as Record<Shape, string | null>;
    const title = plan.mode === "scene" ? "" : (products.get(plan.productId)?.title ?? "the product");
    const label =
      plan.mode === "scene"
        ? "Scene made with AI"
        : plan.mode === "staged"
          ? plan.item
            ? "Practice item and its setting, made with AI"
            : "The product's own photo, in a setting made with AI"
          : plan.item
            ? "Practice item picture, made with AI"
            : "The product's own photo";
    const note =
      sceneState?.failed && !sceneState.making
        ? plan.mode === "staged"
          ? "The setting couldn't be made, so the product shows on its own."
          : "This scene couldn't be made."
        : itemState?.failed && !itemState.making
          ? "The practice item's picture couldn't be made."
          : null;
    return {
      key,
      mode: plan.mode,
      state,
      src,
      practiceItem: plan.mode !== "scene" && plan.item,
      label,
      alt: plan.mode === "scene" ? sceneState?.alt || "A scene made for this ad" : `${title}${plan.item ? " (practice item)" : ""}`,
      redo: { scene: plan.mode !== "product", item: plan.mode !== "scene" && plan.item ? plan.productId : null },
      note,
    };
  });
}

/**
 * Asks for whatever pictures these ads are missing: a scene per scene card and per single-photo ad,
 * and a picture of each practice item they show (once per shop and item). Slots that have a picture,
 * are being made, or already failed are left alone. Returns how many were asked for.
 */
export async function ensureAdPictures(tx: Tx, shop: ShopRow, variations: AdVariation[], products: Map<string, PictureProduct>): Promise<number> {
  const live = variations.filter((v) => v.status === "draft" || v.status === "created" || v.status === "failed");
  if (!live.length) return 0;
  const itemIds = [...products.values()].filter((p) => isPracticeItem(shop, p)).map((p) => p.id);
  const index = await pictureIndex(tx, { shopId: shop.id, adIds: live.map((v) => v.id), itemIds });
  const untouched = (s: SlotState | undefined) => !s || (!s.tried && !s.making && !Object.keys(s.cuts).length);
  let queued = 0;
  const items = new Set<string>();
  for (const v of live) {
    for (const slot of adPictureSlots(shop, v, products)) {
      if (slot.scene && slot.plan.mode !== "product" && untouched(index.get(pictureKey.ad(v.id, slot.plan.slot)))) {
        if (await queueScene(tx, shop, { type: "ad", id: v.id }, slot.plan.slot, slot.scene)) queued++;
      }
      if (slot.plan.mode !== "scene" && slot.plan.item && !items.has(slot.plan.productId) && untouched(index.get(pictureKey.item(slot.plan.productId)))) {
        items.add(slot.plan.productId);
        const p = products.get(slot.plan.productId);
        if (p && (await queueItem(tx, shop, p.id, { title: p.title, facts: p.bullets }))) queued++;
      }
    }
  }
  return queued;
}

/** "Make again" on one of an ad's pictures: its scene, or the practice item's picture. False if it's already being made. */
export async function redoAdPicture(tx: Tx, shop: ShopRow, v: AdVariation, key: string, what: "scene" | "item", products: Map<string, PictureProduct>): Promise<boolean> {
  const slot = adPictureSlots(shop, v, products).find((s) => s.key === key);
  if (!slot) return false;
  if (what === "scene") {
    if (!slot.scene || slot.plan.mode === "product") return false;
    return queueScene(tx, shop, { type: "ad", id: v.id }, slot.plan.slot, slot.scene);
  }
  if (slot.plan.mode === "scene" || !slot.plan.item) return false;
  const p = products.get(slot.plan.productId);
  return p ? queueItem(tx, shop, p.id, { title: p.title, facts: p.bullets }, { again: true }) : false;
}

/** Calls off an ad's pictures that haven't started (it was taken out). */
export async function callOffAdPictures(tx: Tx, variationId: string): Promise<void> {
  await callOff(tx, { type: "ad", id: variationId });
}

/** Deletes an ad's pictures: all of them (it was written again), or those of cards taken out. */
export async function dropAdPictures(tx: Tx, variationId: string, cardKeys?: string[]): Promise<void> {
  await dropPictures(tx, { type: "ad", id: variationId }, cardKeys?.map((k) => `card:${k}`));
}
