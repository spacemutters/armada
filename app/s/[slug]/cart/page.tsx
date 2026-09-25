import { notFound } from "next/navigation";
import { BagView } from "@/components/storefront/bag";
import { checkoutState, CLOSED_WORDS } from "@/lib/shops/checkout";
import { loadStorefront, storeItems } from "@/lib/shops/storefront";

export const metadata = { title: "Your bag" };

export default async function CartPage({ params }: PageProps<"/s/[slug]/cart">) {
  const { slug } = await params;
  const data = await loadStorefront(slug);
  if (!data) notFound();
  const bp = data.shop.blueprint;
  const items = storeItems(data.shop, data.products);
  const state = await checkoutState(data.shop);
  // For each product, the ones that go with it, ready to add from the bag.
  const goesWith = Object.fromEntries(
    Object.entries(bp.pairings ?? {}).map(([h, list]) => [
      h,
      list
        .map((pr) => {
          const o = items.find((i) => i.handle === pr.handle);
          return o ? { handle: o.handle, title: o.product.title, priceCents: o.priceCents, image: o.product.images[0]?.url ?? null, icon: o.product.art?.icon ?? null, why: pr.why } : null;
        })
        .filter((x): x is NonNullable<typeof x> => x !== null),
    ]),
  );
  return (
    <section className="sf-wrap pt-[clamp(2.5rem,6vw,5rem)] pb-[var(--s-section)]">
      <h1 className="sf-display mb-12" style={{ fontSize: "clamp(2.4rem, 1rem + 4vw, 4.5rem)" }}>
        Your bag
      </h1>
      <BagView slug={slug} sets={bp.sets ?? []} goesWith={goesWith} checkout={state.open ? { open: true, test: state.test } : { open: false, note: CLOSED_WORDS[state.why] }} />
    </section>
  );
}
