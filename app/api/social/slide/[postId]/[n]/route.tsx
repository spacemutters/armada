import { asSystem } from "@/lib/db";
import { lookFromBlueprint, slideNumber, slideVersion } from "@/lib/social/posts/design";
import { renderSlide } from "@/lib/social/posts/render";
import type { Blueprint } from "@/lib/shops/types";

// One carousel slide as an image: /api/social/slide/<postId>/<n>.jpg?v=<version>.
//
// Public on purpose: Instagram, Facebook and TikTok download slides themselves, with no sign-in.
// The post's id is a random UUID, so an address can't be guessed, and a removed post's slides are
// gone. The version in the address changes whenever anything drawn changes (words, photo, the
// shop's look), so an address that matches is cached for a year by browsers and the CDN; any other
// address gets the current drawing with a short cache.

export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Row {
  n: number;
  headline: string;
  line: string;
  imageUrl: string | null;
  total: number;
  blueprint: Blueprint;
}

export async function GET(request: Request, { params }: { params: Promise<{ postId: string; n: string }> }) {
  const { postId, n: rawN } = await params;
  const n = slideNumber(rawN);
  if (!UUID.test(postId) || n === null) return notFound();

  const [row] = await asSystem(
    (tx) => tx<Row[]>`
      select s.n, s.headline, s.line, s.image_url, sh.blueprint,
             (select count(*) from armada.social_slides x where x.post_id = s.post_id)::int as total
      from armada.social_slides s
      join armada.social_posts p on p.id = s.post_id
      join armada.shops sh on sh.id = p.shop_id
      where s.post_id = ${postId} and s.n = ${n}`,
  );
  const look = row ? lookFromBlueprint(row.blueprint) : null;
  if (!row || !look) return notFound();

  const version = slideVersion({ n: row.n, headline: row.headline, line: row.line, imageUrl: row.imageUrl }, row.total, look);
  const asked = new URL(request.url).searchParams.get("v");
  const etag = `"${version}"`;
  const current = asked === version;
  const cache = current ? "public, max-age=31536000, s-maxage=31536000, immutable" : "public, max-age=60, s-maxage=60";
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: { etag, "cache-control": cache } });

  try {
    const image = await renderSlide({ look, n: row.n, total: row.total, headline: row.headline, line: row.line, imageUrl: row.imageUrl });
    return new Response(image.body as BodyInit, {
      headers: {
        "content-type": image.type,
        "cache-control": cache,
        etag,
        "x-robots-tag": "noindex",
        "content-disposition": `inline; filename="slide-${row.n}.${image.type === "image/jpeg" ? "jpg" : "png"}"`,
      },
    });
  } catch (e) {
    console.error("drawing a social slide failed", postId, n, e);
    return new Response("This slide couldn't be drawn right now.", { status: 500, headers: { "cache-control": "no-store" } });
  }
}

function notFound() {
  return new Response("Not found", { status: 404, headers: { "cache-control": "public, max-age=60" } });
}
