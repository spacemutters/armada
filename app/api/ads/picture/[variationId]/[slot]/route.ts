import { adPictureSlots, adPictureVersion } from "@/lib/ads/pictures";
import { loadShopProducts } from "@/lib/ads/sets";
import type { AdVariation } from "@/lib/ads/types";
import { productCard, sceneCard, staged, type Shape } from "@/lib/creative/compose";
import { asSystem } from "@/lib/db";
import type { ShopRow } from "@/lib/shops/types";
import { loadPhoto, photoFromBytes } from "@/lib/social/posts/photo";

// One of an ad's pictures as a JPEG: /api/ads/picture/<adId>/<main or card key>.jpg?shape=square|portrait|story&v=<version>.
//
// The same picture the previews show and the ad platform gets (lib/creative/compose.ts): a product's
// real photo on the shop's ground, a ChatGPT scene, or the product's real photo in front of a ChatGPT
// setting. Public on purpose, like post slides: Meta downloads it itself. The ad's id is a random
// UUID, so an address can't be guessed. An address with the current version is cached for a year;
// any other gets the current picture with a short cache.

export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHAPES = new Set<Shape>(["square", "portrait", "story"]);

export async function GET(request: Request, { params }: { params: Promise<{ variationId: string; slot: string }> }) {
  const { variationId, slot: raw } = await params;
  const key = /^([a-z0-9]{1,8})(?:\.jpe?g)?$/i.exec(raw)?.[1]?.toLowerCase();
  const url = new URL(request.url);
  const shape = (url.searchParams.get("shape") ?? "square") as Shape;
  if (!UUID.test(variationId) || !key || !SHAPES.has(shape)) return notFound();

  const data = await asSystem(async (tx) => {
    const [v] = await tx<(AdVariation & { shopId: string })[]>`
      select v.*, s.shop_id from armada.ad_variations v join armada.ad_sets s on s.id = v.ad_set_id where v.id = ${variationId}`;
    if (!v) return null;
    const [shop] = await tx<ShopRow[]>`select * from armada.shops where id = ${v.shopId}`;
    if (!shop) return null;
    const products = new Map((await loadShopProducts(tx, shop)).map((p) => [p.id, p]));
    const slot = adPictureSlots(shop, v, products).find((s) => s.key === key);
    if (!slot) return null;
    const plan = slot.plan;
    const [scene] =
      plan.mode === "product"
        ? []
        : await tx<{ id: string; bytes: Buffer }[]>`
            select id, bytes from armada.creative_pictures where ad_variation_id = ${v.id} and slot = ${plan.slot} and variant = ${shape} and live
            order by created_at desc limit 1`;
    const [item] =
      plan.mode !== "scene" && plan.item
        ? await tx<{ id: string; bytes: Buffer }[]>`
            select id, bytes from armada.creative_pictures where shop_id = ${shop.id} and product_id = ${plan.productId} and kind = 'item' and variant = 'square' and live
            order by created_at desc limit 1`
        : [];
    return { shop, plan, scene: scene ?? null, item: item ?? null };
  });
  if (!data) return notFound();
  const { shop, plan, scene, item } = data;
  const palette = shop.blueprint.theme?.palette;
  if (!palette) return notFound();

  const version = adPictureVersion(plan, shape, { sceneCut: scene?.id ?? null, itemCut: item?.id ?? null }, palette);
  const etag = `"${version}"`;
  const cache = url.searchParams.get("v") === version ? "public, max-age=31536000, s-maxage=31536000, immutable" : "public, max-age=60, s-maxage=60";
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: { etag, "cache-control": cache } });

  try {
    let body: Buffer | null = null;
    if (plan.mode === "scene") {
      if (scene) body = await sceneCard(Buffer.from(scene.bytes), shape);
    } else {
      // The product is always its own photo: the supplier's, or a practice item's picture.
      const photo = plan.photoUrl ? await loadPhoto(plan.photoUrl) : item ? await photoFromBytes(Buffer.from(item.bytes)) : null;
      if (photo) body = plan.mode === "staged" ? await staged(scene ? Buffer.from(scene.bytes) : null, photo, shape, palette) : await productCard(photo, shape, palette);
    }
    if (!body) return new Response("This picture isn't ready yet.", { status: 404, headers: { "cache-control": "no-store" } });
    return new Response(new Uint8Array(body), {
      headers: {
        "content-type": "image/jpeg",
        "content-length": String(body.length),
        "cache-control": cache,
        etag,
        "x-robots-tag": "noindex",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (e) {
    console.error("composing an ad picture failed", variationId, key, e);
    return new Response("This picture couldn't be drawn right now.", { status: 500, headers: { "cache-control": "no-store" } });
  }
}

function notFound() {
  return new Response("Not found", { status: 404, headers: { "cache-control": "public, max-age=60" } });
}
