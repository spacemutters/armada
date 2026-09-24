import { NextResponse, type NextRequest } from "next/server";
import { cleanShopDomain, parseCheckoutProducts, passthroughParams, shopifyCartUrl, variantIdFrom } from "@/connectors/meta/core";
import { asSystem } from "@/lib/db";

// The checkout address a Facebook and Instagram shop gives Meta. Meta opens it with
// ?products=ID:QTY,…&coupon=CODE when a buyer presses Checkout; this hands the cart to the linked
// Shopify store's own checkout (a cart link: /cart/VARIANT:QTY,…?discount=CODE), keeping Meta's
// tracking parameters. Public on purpose: shoppers and Meta's checkout check aren't signed in to
// Armada. It reveals nothing but the store's public address.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ARMADA_ID = /^armada-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export async function GET(request: NextRequest, { params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  if (!UUID.test(storeId)) return new Response("Not found", { status: 404 });
  const q = request.nextUrl.searchParams;
  const lines = parseCheckoutProducts(q.get("products"));
  const listingIds = lines.map((l) => ARMADA_ID.exec(l.id)?.[1]).filter((x): x is string => Boolean(x));

  const found = await asSystem(async (tx) => {
    const [shop] = await tx<{ id: string; domain: string | null }[]>`
      select s.id, s.domain from armada.stores f
      join armada.stores s on s.id = (f.meta ->> 'shopifyStoreId')::uuid and s.workspace_id = f.workspace_id and s.platform = 'shopify'
      where f.id = ${storeId} and f.platform = 'facebook' and f.mode = 'live'`;
    if (!shop) return null;
    const listings = listingIds.length
      ? await tx<{ id: string; externalId: string | null; handle: string | null }[]>`
          select id, external_id, handle from armada.listings where store_id = ${shop.id} and id in ${tx(listingIds)}`
      : [];
    return { domain: shop.domain, listings };
  });
  const domain = cleanShopDomain(found?.domain);
  if (!found || !domain) return new Response("Not found", { status: 404 });

  const byId = new Map(found.listings.map((l) => [l.id, l]));
  const cart: { variantId: string; quantity: number }[] = [];
  let fallbackHandle: string | null = null;
  for (const line of lines) {
    if (/^\d{1,20}$/.test(line.id)) {
      cart.push({ variantId: line.id, quantity: line.quantity });
      continue;
    }
    const listing = byId.get(ARMADA_ID.exec(line.id)?.[1] ?? "");
    const variant = variantIdFrom(listing?.externalId);
    if (variant) cart.push({ variantId: variant, quantity: line.quantity });
    else if (listing?.handle && !fallbackHandle) fallbackHandle = listing.handle;
  }

  const keep = passthroughParams(q.entries());
  let target: string;
  if (cart.length) target = shopifyCartUrl(domain, cart, { coupon: q.get("coupon"), passthrough: keep });
  else if (fallbackHandle) target = `https://${domain}/products/${encodeURIComponent(fallbackHandle)}`;
  else target = `https://${domain}/`;
  return NextResponse.redirect(target, 302);
}
