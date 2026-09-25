import { notFound } from "next/navigation";
import { ProductCard } from "@/components/storefront/product-card";
import { storefrontImages } from "@/lib/shops/images";
import { loadStorefront, shopBase, storeItems } from "@/lib/shops/storefront";

export async function generateMetadata({ params }: PageProps<"/s/[slug]/collections/[handle]">) {
  const { slug, handle } = await params;
  const data = await loadStorefront(slug);
  const col = data?.shop.blueprint.collections?.find((c) => c.handle === handle);
  return col ? { title: { absolute: `${col.title} · ${data!.shop.blueprint.brand?.name}` }, description: col.description } : {};
}

export default async function CollectionPage({ params }: PageProps<"/s/[slug]/collections/[handle]">) {
  const { slug, handle } = await params;
  const data = await loadStorefront(slug);
  if (!data) notFound();
  const col = data.shop.blueprint.collections?.find((c) => c.handle === handle);
  if (!col) notFound();
  const items = storeItems(data.shop, data.products).filter((i) => i.collection === col.handle);
  const base = shopBase(slug);
  // The collection's cover is a mood picture (never one of its products); the products below show
  // the supplier's real photos.
  const cover = (await storefrontImages(data.shop.id)).collections[col.handle] ?? null;

  const heading = (
    <div>
      <p className="sf-label">
        {items.length} {items.length === 1 ? "product" : "products"}
      </p>
      <h1 className="sf-display mt-4" style={{ fontSize: "clamp(2.4rem, 1rem + 4.5vw, 5.5rem)" }}>
        {col.title}
      </h1>
      <p className="sf-lead sf-muted mt-5 max-w-[48ch]">{col.description}</p>
    </div>
  );

  return (
    <section className="sf-wrap pt-[clamp(2.5rem,6vw,5rem)] pb-[var(--s-section)]">
      {cover ? (
        <div className="grid items-end gap-8 lg:grid-cols-[7fr_5fr] lg:gap-12">
          {heading}
          <div className="sf-cover">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/img/${cover.id}`} width={cover.width} height={cover.height} alt="" fetchPriority="high" decoding="async" />
          </div>
        </div>
      ) : (
        heading
      )}
      <ul className="mt-14 grid grid-cols-2 gap-x-5 gap-y-12 md:grid-cols-3 xl:grid-cols-4">
        {items.map((item) => (
          <ProductCard key={item.handle} item={item} base={base} />
        ))}
      </ul>
    </section>
  );
}
