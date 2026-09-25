import { imageFile } from "@/lib/shops/images";

// A shop's brand picture, public (storefronts show it to anyone). The id is a random UUID, so the
// address can't be guessed, and a new picture always gets a new id, so it is cached for a year by
// browsers and the CDN.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const img = await imageFile(id);
  if (!img) return new Response(null, { status: 404, headers: { "cache-control": "no-store" } });
  return new Response(new Uint8Array(img.bytes), {
    headers: {
      "content-type": img.mime,
      "content-length": String(img.bytes.length),
      "cache-control": "public, max-age=31536000, s-maxage=31536000, immutable",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'",
    },
  });
}
