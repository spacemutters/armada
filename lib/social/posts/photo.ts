import type { PhotoKind } from "./design";

// Reading a product photo (or a ChatGPT picture) and saying what kind it is, for the slide drawer
// (./render.tsx) and the ad pictures (lib/creative/compose.ts). No JSX and no database, so the offline
// checks can load it.

export interface LoadedPhoto {
  bytes: Buffer;
  kind: PhotoKind;
  /** The format the drawer can read directly, when sharp isn't there. */
  mime: "image/png" | "image/jpeg" | null;
}

type SharpFn = typeof import("sharp").default;
let sharpPromise: Promise<SharpFn | null> | null = null;
function getSharp(): Promise<SharpFn | null> {
  sharpPromise ??= import("sharp").then((m) => m.default).catch(() => null);
  return sharpPromise;
}

const MAX_PHOTO_BYTES = 12 * 1024 * 1024;

function sniff(b: Buffer): LoadedPhoto["mime"] {
  if (b.length > 3 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length > 2 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  return null;
}

/**
 * Fetches a product photo and says what kind it is: a "cutout" (a product on a white or clear
 * background, judged by the ring of pixels around the edge) or a "scene" that should fill its frame.
 */
export async function loadPhoto(url: string | null): Promise<LoadedPhoto | null> {
  if (!url || !/^https:\/\//i.test(url)) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { accept: "image/jpeg,image/png,image/webp,image/*;q=0.8" } });
    if (!res.ok) return null;
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > MAX_PHOTO_BYTES) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > MAX_PHOTO_BYTES || bytes.length < 64) return null;
    return await photoFromBytes(bytes);
  } catch {
    return null;
  }
}

/** A photo already in hand (a ChatGPT picture from the database, or a fetched one), with its kind worked out the same way. */
export async function photoFromBytes(bytes: Buffer): Promise<LoadedPhoto | null> {
  const mime = sniff(bytes);
  const sharp = await getSharp();
  if (!sharp) return mime ? { bytes, kind: "scene", mime } : null;
  try {
    const { data, info } = await sharp(bytes).flatten({ background: "#ffffff" }).resize(48, 48, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
    let edge = 0;
    let white = 0;
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        if (x > 2 && y > 2 && x < info.width - 3 && y < info.height - 3) continue;
        edge++;
        const i = (y * info.width + x) * info.channels;
        if (data[i] > 232 && data[i + 1] > 232 && data[i + 2] > 232) white++;
      }
    }
    return { bytes, kind: white / edge >= 0.82 ? "cutout" : "scene", mime };
  } catch {
    return null;
  }
}
