import { createHmac, timingSafeEqual } from "node:crypto";
import type { Fetch } from "@/connectors/social-accounts/types";

// Picture addresses handed to Instagram and TikTok. Both download the pictures themselves, and
// both take JPEG only (TikTok also WebP) from an address that doesn't redirect; TikTok also only
// downloads from an address prefix Armada has proven it owns. So each slide is handed over as
// /api/social-kit/r/<signature>/<address>.jpg, served by app/api/social-kit, which fetches the
// original and sends it on as a JPEG. The signature means only addresses Armada chose are relayed:
// it is not an open proxy. Pure, so the offline check can test it.

const b64url = (s: string) => Buffer.from(s, "utf8").toString("base64url");

function sign(secret: Buffer | string, url: string): string {
  return createHmac("sha256", secret).update(`social-relay:${url}`).digest("base64url").slice(0, 32);
}

/** The relay path for one picture, e.g. /api/social-kit/r/<sig>/<address>.jpg (join it to the public origin). */
export function relayPath(secret: Buffer | string, imageUrl: string): string {
  return `/api/social-kit/r/${sign(secret, imageUrl)}/${b64url(imageUrl)}.jpg`;
}

/** The original address a relay path stands for, or null if the signature doesn't match or it isn't a web address. */
export function readRelay(secret: Buffer | string, sig: string, encoded: string): string | null {
  const raw = encoded.replace(/\.jpe?g$/i, "");
  if (!/^[A-Za-z0-9_-]{4,4000}$/.test(raw) || !/^[A-Za-z0-9_-]{32}$/.test(sig)) return null;
  let url: string;
  try {
    url = Buffer.from(raw, "base64url").toString("utf8");
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  } catch {
    return null;
  }
  const want = Buffer.from(sign(secret, url));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got) ? url : null;
}

const MAX_BYTES = 20 * 1024 * 1024; // TikTok's per-picture ceiling; Instagram's is 8 MB after conversion.

export interface RelayAnswer {
  status: number;
  body?: Uint8Array;
  type?: string;
}

/**
 * Fetches the original picture and hands it on as a JPEG. `toJpeg` re-encodes (and scales to fit
 * 1080 x 1920, TikTok's ceiling and inside Instagram's) when the image library is available;
 * without it a JPEG passes through as it is and anything else is refused, since both platforms
 * would refuse it anyway.
 */
export async function relayImage(f: Fetch, url: string, toJpeg: ((bytes: Uint8Array) => Promise<Uint8Array>) | null): Promise<RelayAnswer> {
  let res: Response;
  try {
    res = await f(url, { redirect: "follow", signal: AbortSignal.timeout(20_000), headers: { Accept: "image/*" } });
  } catch {
    return { status: 502 };
  }
  if (!res.ok) return { status: 502 };
  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!type.startsWith("image/")) return { status: 415 };
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > MAX_BYTES) return { status: 413 };
  if (toJpeg) {
    try {
      return { status: 200, body: await toJpeg(bytes), type: "image/jpeg" };
    } catch {
      // Fall through: a JPEG can still go as it is.
    }
  }
  return type === "image/jpeg" ? { status: 200, body: bytes, type } : { status: 415 };
}
