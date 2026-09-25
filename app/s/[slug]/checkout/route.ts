import { startShopCheckout } from "@/lib/shops/checkout";

// The bag's Checkout press: Stripe's own checkout page for what's in the bag. The browser only says
// which items and how many; prices come from the shop (lib/shops/checkout-core.ts).
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let body: { lines?: unknown } | null = null;
  try {
    const text = await request.text();
    body = text.length <= 20_000 ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  const r = await startShopCheckout(slug, body?.lines);
  return Response.json(r, { status: "url" in r ? 200 : 400, headers: { "cache-control": "no-store" } });
}
