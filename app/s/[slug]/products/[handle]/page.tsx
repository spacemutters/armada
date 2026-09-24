import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductArt } from "@/components/product-art";
import { AddToBag } from "@/components/storefront/bag";
import { ProductCard } from "@/components/storefront/product-card";
import { formatMoney } from "@/lib/money";
import { loadStorefront, shopBase, storeItems } from "@/lib/shops/storefront";

export async function generateMetadata({ params }: PageProps<"/s/[slug]/products/[handle]">) {
  const { slug, handle } = await params;
  const data = await loadStorefront(slug);
  const item = data ? storeItems(data.shop, data.products).find((i) => i.handle === handle) : undefined;
  if (!item) return {};
  return { title: { absolute: item.product.seoTitle || item.product.title }, description: item.product.seoDescription ?? undefined };
}

export default async function ProductPage({ params }: PageProps<"/s/[slug]/products/[handle]">) {
  const { slug, handle } = await params;
  const data = await loadStorefront(slug);
  if (!data) notFound();
  const bp = data.shop.blueprint;
  const items = storeItems(data.shop, data.products);
  const item = items.find((i) => i.handle === handle);
  if (!item) notFound();
  const p = item.product;
  const base = shopBase(slug);
  const collection = bp.collections?.find((c) => c.handle === item.collection);
  const facts = bp.facts;
  const related = items.filter((i) => i.collection === item.collection && i.handle !== item.handle).slice(0, 4);
  const paragraphs = p.description.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);

  return (
    <>
      <div className="sf-wrap grid gap-12 pt-10 pb-[var(--s-section)] lg:grid-cols-[7fr_5fr]">
        <div className="flex flex-col gap-3">
          <div className="sf-card-media">
            <ProductArt images={p.images} icon={p.art?.icon} title={p.title} sizes="(min-width: 1024px) 55vw, 100vw" />
          </div>
          {p.images.length > 1 ? (
            <ul className="grid grid-cols-3 gap-3">
              {p.images.slice(1, 4).map((img) => (
                <li key={img.url} className="sf-card-media" style={{ aspectRatio: "1 / 1" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.url} alt={img.alt ?? p.title} loading="lazy" className="h-full w-full" />
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="flex h-fit flex-col gap-6 lg:sticky lg:top-24">
          {collection ? (
            <Link href={`${base}/collections/${collection.handle}`} className="sf-label hover:underline">
              {collection.title}
            </Link>
          ) : null}
          <h1 className="sf-heading" style={{ fontSize: "var(--text-h1)" }}>
            {p.title}
          </h1>
          <p className="text-[24px] tabular-nums">{formatMoney(item.priceCents)}</p>
          {p.bullets.length ? (
            <ul className="flex flex-col gap-2 text-[16px]">
              {p.bullets.map((b) => (
                <li key={b} className="flex gap-3">
                  <span aria-hidden className="sf-muted">
                    –
                  </span>
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          ) : null}
          <AddToBag
            slug={slug}
            line={{ handle: item.handle, title: p.title, priceCents: item.priceCents, image: p.images[0]?.url ?? null, icon: p.art?.icon ?? null }}
          />
          {facts ? (
            <p className="sf-muted text-[15px]">
              Ships within {facts.handlingDays} business days, then arrives in {facts.deliveryMin}–{facts.deliveryMax} business days. Returns accepted
              within {facts.returnDays} days of delivery.{" "}
              <Link href={`${base}/pages/shipping`} className="sf-link">
                Shipping and returns
              </Link>
            </p>
          ) : null}
          {item.imagined ? <p className="sf-label">Practice item. The picture is an illustration, not a photo.</p> : null}
          <div className="sf-prose sf-line border-t pt-6">
            {paragraphs.map((para, i) => (
              <p key={i}>{para}</p>
            ))}
          </div>
        </div>
      </div>

      {related.length ? (
        <section className="sf-line border-t">
          <div className="sf-wrap sf-section">
            <h2 className="sf-heading mb-10" style={{ fontSize: "var(--text-h2)" }}>
              More from {collection?.title ?? "the shop"}
            </h2>
            <ul className="grid grid-cols-2 gap-x-5 gap-y-10 md:grid-cols-4">
              {related.map((r) => (
                <ProductCard key={r.handle} item={r} base={base} />
              ))}
            </ul>
          </div>
        </section>
      ) : null}
    </>
  );
}
