import { luminance, mix, type Palette } from "@/lib/color";
import type { LoadedPhoto } from "@/lib/social/posts/photo";

// How Armada puts an ad's pictures together, as JPEGs for the previews and for the ad platform alike
// (what you check is what runs). No words are drawn here: the platform and the preview set the
// headline and button beside the picture as real text.
//
//   packshot  a product's real photo on the shop's own light ground: a cut-out (a product on white)
//             is trimmed, placed with room around it and a soft shadow under it, and multiplied onto
//             the ground so its white becomes the shop's colour; a photo with its own background fills
//             the frame. A practice item's ChatGPT picture is treated the same way.
//   scene     a ChatGPT scene, filling the frame.
//   staged    a single-photo ad: the ChatGPT setting fills the frame and the product's real photo sits
//             on a panel in front of it, so the product is exactly the supplier's photo.
// No database here, so scripts/check-creative-pictures.mjs can compose pictures offline.

export type Shape = "square" | "portrait" | "story";

/** 1:1 for carousel cards, 4:5 for a single-photo ad in a feed, 9:16 for a full-screen card. */
export const SHAPE_SIZE: Record<Shape, readonly [number, number]> = { square: [1080, 1080], portrait: [1080, 1350], story: [1080, 1920] };

/** Bump when the composition changes, so every picture gets a fresh address. */
export const COMPOSE_REV = 1;

type SharpFn = typeof import("sharp").default;
let sharpPromise: Promise<SharpFn> | null = null;
function getSharp(): Promise<SharpFn> {
  sharpPromise ??= import("sharp").then((m) => m.default);
  return sharpPromise;
}

/** The light ground a product photo sits on: the shop's surface or background if light, else a light neutral tinted with its accent. */
export function groundFor(p: Palette): string {
  if (luminance(p.surface) >= 0.45) return p.surface;
  if (luminance(p.background) >= 0.45) return p.background;
  return mix("#f3f2ee", p.accent, 0.05);
}

/** Channel values from LIFT_FROM up are stretched so that LIFT_TO and above become pure white. */
const LIFT_FROM = 226;
const LIFT_TO = 246;

/** A photo cropped to fill w x h, keeping its most interesting part. */
async function fill(bytes: Buffer, w: number, h: number): Promise<Buffer> {
  const sharp = await getSharp();
  return sharp(bytes).rotate().flatten({ background: "#ffffff" }).resize(w, h, { fit: "cover", position: sharp.strategy.attention }).removeAlpha().png().toBuffer();
}

/** A cut-out product on a light ground: trimmed, fitted with room around it, a soft shadow under it, multiplied onto the ground. */
async function cutoutOnGround(bytes: Buffer, w: number, h: number, ground: string, room = 0.74): Promise<Buffer> {
  const sharp = await getSharp();
  let trimmed = await sharp(bytes).rotate().flatten({ background: "#ffffff" }).png().toBuffer();
  trimmed = await sharp(trimmed)
    .trim({ background: "#ffffff", threshold: 12 })
    .png()
    .toBuffer()
    .catch(() => trimmed);
  const { data, info } = await sharp(trimmed)
    .resize(Math.round(w * room), Math.round(h * room), { fit: "inside", withoutEnlargement: false })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  // Supplier "white" is often a little grey; lift only the near-whites so no faint box shows on the ground.
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (v >= LIFT_FROM) data[i] = Math.min(255, Math.round(LIFT_FROM + ((v - LIFT_FROM) * (255 - LIFT_FROM)) / (LIFT_TO - LIFT_FROM)));
  }
  const left = Math.round((w - info.width) / 2);
  // Optical centre: a little above the middle.
  const top = Math.max(0, Math.round((h - info.height) / 2 - h * 0.03));
  const rx = Math.round(info.width * 0.4);
  const ry = Math.max(8, Math.round(h * 0.016));
  const cy = Math.min(h - ry, top + info.height - Math.round(ry * 0.3));
  const shadow = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><filter id="s" x="-50%" y="-200%" width="200%" height="500%"><feGaussianBlur stdDeviation="${Math.max(6, Math.round(ry * 1.2))}"/></filter></defs><ellipse cx="${Math.round(w / 2)}" cy="${cy}" rx="${rx}" ry="${ry}" fill="#000" fill-opacity="0.2" filter="url(#s)"/></svg>`,
  );
  return sharp({ create: { width: w, height: h, channels: 3, background: ground } })
    .composite([
      { input: shadow, blend: "multiply" },
      { input: data, raw: { width: info.width, height: info.height, channels: info.channels }, left, top, blend: "multiply" },
    ])
    .png()
    .toBuffer();
}

/**
 * The colour around a photo's edge, and whether the edge is one plain colour (a studio seamless, as
 * in a practice item's picture or many supplier shots on a coloured backdrop).
 */
export async function edgeOf(bytes: Buffer): Promise<{ color: string; plain: boolean }> {
  const sharp = await getSharp();
  const { data, info } = await sharp(bytes).rotate().flatten({ background: "#ffffff" }).resize(48, 48, { fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const px: number[][] = [];
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (x > 1 && y > 1 && x < info.width - 2 && y < info.height - 2) continue;
      const i = (y * info.width + x) * info.channels;
      px.push([data[i], data[i + 1], data[i + 2]]);
    }
  }
  const mean = [0, 1, 2].map((c) => px.reduce((s, p) => s + p[c], 0) / px.length);
  const spread = Math.max(...[0, 1, 2].map((c) => Math.sqrt(px.reduce((s, p) => s + (p[c] - mean[c]) ** 2, 0) / px.length)));
  const hex = `#${mean.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
  return { color: hex, plain: spread < 12 };
}

/**
 * A photo on a plain seamless, fitted whole inside w x h (never cropping the product), so a square
 * picture sits in a tall frame without losing its sides. The space it doesn't fill is the same
 * seamless, stretched and softened, and the photo's edges fade into it, so no band shows.
 */
async function fitOnSeamless(bytes: Buffer, w: number, h: number, color: string): Promise<Buffer> {
  const sharp = await getSharp();
  const flat = await sharp(bytes).rotate().flatten({ background: color }).removeAlpha().png().toBuffer();
  const { data: inner, info } = await sharp(flat).resize(w, h, { fit: "inside" }).removeAlpha().png().toBuffer({ resolveWithObject: true });
  if (info.width >= w - 1 && info.height >= h - 1) return sharp(inner).resize(w, h, { fit: "cover" }).png().toBuffer();
  const base = await sharp(flat).resize(w, h, { fit: "fill" }).blur(40).png().toBuffer();
  const tall = info.height < h; // the gaps are above and below
  const size = tall ? info.height : info.width;
  const f = Math.max(1, Math.round(size * 0.08)) / size;
  const stops = `<stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="${f}" stop-color="#fff"/><stop offset="${1 - f}" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>`;
  const mask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${info.width}" height="${info.height}"><defs><linearGradient id="g" x1="0" y1="0" x2="${tall ? 0 : 1}" y2="${tall ? 1 : 0}">${stops}</linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`,
  );
  const faded = await sharp(inner).ensureAlpha().composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
  return sharp(base)
    .composite([{ input: faded, left: Math.round((w - info.width) / 2), top: Math.round((h - info.height) / 2), blend: "over" }])
    .removeAlpha()
    .png()
    .toBuffer();
}

/** A product photo (real, or a practice item's picture) on the shop's ground, w x h. The product is never cropped away. */
export async function packshot(photo: LoadedPhoto, w: number, h: number, palette: Palette): Promise<Buffer> {
  if (photo.kind === "cutout") return cutoutOnGround(photo.bytes, w, h, groundFor(palette));
  const edge = await edgeOf(photo.bytes).catch(() => null);
  if (edge?.plain) return fitOnSeamless(photo.bytes, w, h, edge.color);
  return fill(photo.bytes, w, h);
}

/** Where the product panel sits on a staged picture: its size and top-left corner. */
export function panelBox(shape: Shape): { w: number; h: number; left: number; top: number; radius: number } {
  const [W, H] = SHAPE_SIZE[shape];
  const w = Math.round(W * (shape === "story" ? 0.7 : shape === "portrait" ? 0.62 : 0.58));
  const h = Math.round(w * 1.25);
  // The story leaves its lower third for the words set over it; the others centre, a touch high.
  const centre = shape === "story" ? H * 0.41 : H * 0.48;
  return { w, h, left: Math.round((W - w) / 2), top: Math.round(centre - h / 2), radius: Math.round(w * 0.045) };
}

/**
 * A single-photo ad: the setting fills the frame and the product's real photo sits on a panel in
 * front of it with a soft shadow. Without a setting (not made yet, or couldn't be), the product
 * photo alone on the shop's ground.
 */
export async function staged(setting: Buffer | null, product: LoadedPhoto, shape: Shape, palette: Palette): Promise<Buffer> {
  const sharp = await getSharp();
  const [W, H] = SHAPE_SIZE[shape];
  if (!setting) return toJpeg(await packshot(product, W, H, palette));
  const base = await fill(setting, W, H);
  const box = panelBox(shape);
  const inner = await packshot(product, box.w, box.h, palette);
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${box.w}" height="${box.h}"><rect width="${box.w}" height="${box.h}" rx="${box.radius}" ry="${box.radius}"/></svg>`);
  const panel = await sharp(inner).ensureAlpha().composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
  const shadow = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs><filter id="s" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="${Math.round(box.w * 0.05)}"/></filter></defs>` +
      `<rect x="${box.left}" y="${box.top + Math.round(box.h * 0.035)}" width="${box.w}" height="${box.h}" rx="${box.radius}" fill="#000" fill-opacity="0.34" filter="url(#s)"/></svg>`,
  );
  const out = await sharp(base)
    .composite([
      { input: shadow, blend: "over" },
      { input: panel, left: box.left, top: box.top, blend: "over" },
    ])
    .png()
    .toBuffer();
  return toJpeg(out);
}

/** A ChatGPT scene filling a frame of this shape. */
export async function sceneCard(scene: Buffer, shape: Shape): Promise<Buffer> {
  const [W, H] = SHAPE_SIZE[shape];
  return toJpeg(await fill(scene, W, H));
}

/** A product card: the product's photo on the shop's ground, in this shape. */
export async function productCard(photo: LoadedPhoto, shape: Shape, palette: Palette): Promise<Buffer> {
  const [W, H] = SHAPE_SIZE[shape];
  return toJpeg(await packshot(photo, W, H, palette));
}

async function toJpeg(png: Buffer): Promise<Buffer> {
  const sharp = await getSharp();
  return sharp(png).flatten({ background: "#ffffff" }).jpeg({ quality: 86, mozjpeg: true, chromaSubsampling: "4:4:4" }).toBuffer();
}
