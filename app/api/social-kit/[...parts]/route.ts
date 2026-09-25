import { asSystem } from "@/lib/db";
import { relaySecret } from "@/lib/social/accounts/config";
import { artBrand, kitImage } from "@/lib/social/accounts/kit-image";
import { readRelay, relayImage } from "@/lib/social/accounts/relay";
import type { Blueprint } from "@/lib/shops/types";

// Public files for a shop's social profiles. Meta and TikTok download these themselves, so they
// can't sit behind sign-in; a shop is found by its unguessable link, like its preview.
//
//   /api/social-kit/<shop link>/avatar.png   the profile picture, 1080 x 1080 (add ?download=1 to save it)
//   /api/social-kit/<shop link>/cover.png    the Facebook cover, 1640 x 924
//   /api/social-kit/r/<signature>/<address>.jpg   a post's picture, handed to Instagram and TikTok as a JPEG
//   /api/social-kit/<TikTok's file>.txt      the file TikTok reads to confirm Armada owns this address

const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request, { params }: { params: Promise<{ parts: string[] }> }) {
  const { parts } = await params;
  if (parts.length === 1) return verificationFile(parts[0]);
  if (parts.length === 3 && parts[0] === "r") return relay(parts[1], parts[2]);
  if (parts.length === 2 && (parts[1] === "avatar.png" || parts[1] === "cover.png")) {
    return kitPicture(parts[0], parts[1] === "avatar.png" ? "avatar" : "cover", new URL(request.url).searchParams.has("download"));
  }
  return notFound();
}

function verificationFile(name: string): Response {
  const file = process.env.TIKTOK_VERIFY_FILE;
  const text = process.env.TIKTOK_VERIFY_TEXT;
  if (!file || !text || name !== file) return notFound();
  return new Response(text, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=300" } });
}

async function relay(sig: string, encoded: string): Promise<Response> {
  const url = readRelay(relaySecret(), sig, encoded);
  if (!url) return notFound();
  const toJpeg = await jpegEncoder();
  const answer = await relayImage(fetch, url, toJpeg);
  if (answer.status !== 200 || !answer.body) return new Response(null, { status: answer.status, headers: { "Cache-Control": "no-store" } });
  return new Response(Buffer.from(answer.body), {
    headers: { "Content-Type": answer.type ?? "image/jpeg", "Cache-Control": "public, max-age=3600", "Content-Length": String(answer.body.byteLength) },
  });
}

/** Re-encodes to JPEG (white behind transparency) and scales to fit 1080 x 1920, when the image library is installed. */
async function jpegEncoder(): Promise<((bytes: Uint8Array) => Promise<Uint8Array>) | null> {
  try {
    const sharp = (await import("sharp")).default;
    return async (bytes) =>
      new Uint8Array(
        await sharp(bytes)
          .rotate()
          .resize({ width: 1080, height: 1920, fit: "inside", withoutEnlargement: true })
          .flatten({ background: "#ffffff" })
          .jpeg({ quality: 90, mozjpeg: true })
          .toBuffer(),
      );
  } catch {
    return null;
  }
}

async function kitPicture(slug: string, kind: "avatar" | "cover", download: boolean): Promise<Response> {
  if (!/^[a-z0-9]{6,20}$/.test(slug)) return notFound();
  const [shop] = await asSystem(
    (tx) => tx<{ niche: string; blueprint: Blueprint }[]>`select niche, blueprint from armada.shops where slug = ${slug} and blueprint ? 'brand'`,
  );
  const brand = shop ? artBrand(shop.blueprint, shop.niche) : null;
  if (!brand) return notFound();
  const headers: Record<string, string> = { "Cache-Control": "public, max-age=3600, s-maxage=3600" };
  if (download) {
    const words = `${brand.name} ${kind === "avatar" ? "profile picture" : "cover"}.png`;
    headers["Content-Disposition"] = `attachment; filename="${kind === "avatar" ? "profile-picture" : "cover"}.png"; filename*=UTF-8''${encodeURIComponent(words)}`;
  }
  return kitImage(brand, kind, headers);
}
