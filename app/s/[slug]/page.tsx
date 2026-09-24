import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductArt } from "@/components/product-art";
import { ProductCard } from "@/components/storefront/product-card";
import { loadStorefront, shopBase, storeItems } from "@/lib/shops/storefront";

/** The first real paragraph of a markdown page, as plain text. */
function firstParagraph(md: string | undefined): string {
  if (!md) return "";
  const para = md
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .find((b) => b && !b.startsWith("#") && !/^[-*\d]/.test(b));
  return (para ?? "").replace(/\*\*|\*|__|_|\[|\]\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
}

export default async function StorefrontHome({ params }: PageProps<"/s/[slug]">) {
  const { slug } = await params;
  const data = await loadStorefront(slug);
  if (!data) notFound();
  const { shop, products } = data;
  const bp = shop.blueprint;
  const base = shopBase(slug);
  const items = storeItems(shop, products);
  const collections = (bp.collections ?? []).filter((c) => items.some((i) => i.collection === c.handle));
  const heroItem = items.find((i) => i.product.images.length) ?? items[0];
  const firstCollectionHref = collections[0] ? `${base}/collections/${collections[0].handle}` : base;
  const story = firstParagraph(bp.pages?.about);

  return (
    <>
      {/* Hero: 7/5 split, the one moving moment on the page */}
      <section className="sf-wrap grid items-end gap-10 pt-[clamp(2.5rem,6vw,5.5rem)] pb-[var(--s-section)] lg:grid-cols-[7fr_5fr]">
        <div className="sf-hero-copy flex flex-col gap-7">
          <p className="sf-label">{bp.brand?.tagline}</p>
          <h1 className="sf-display" style={{ fontSize: "var(--text-display)" }}>
            {bp.hero?.headline}
          </h1>
          <p className="sf-lead sf-muted max-w-[36ch]">{bp.hero?.subhead}</p>
          <div>
            <Link href={firstCollectionHref} className="sf-button">
              {bp.hero?.cta || "Shop the range"}
            </Link>
          </div>
        </div>
        {heroItem ? (
          <Link href={`${base}/products/${heroItem.handle}`} className="sf-hero-media sf-card block overflow-hidden rounded-[var(--s-radius)]">
            <div className="sf-card-media" style={{ aspectRatio: "4 / 5" }}>
              <ProductArt images={heroItem.product.images} icon={heroItem.product.art?.icon} title={heroItem.product.title} sizes="(min-width: 1024px) 40vw, 100vw" />
            </div>
          </Link>
        ) : null}
      </section>

      {/* What the shop promises */}
      {bp.valueProps?.length ? (
        <section className="sf-line border-t">
          <div className="sf-wrap grid gap-10 py-14 md:grid-cols-3">
            {bp.valueProps.map((v) => (
              <div key={v.title}>
                <h2 className="sf-heading text-[21px]">{v.title}</h2>
                <p className="sf-muted mt-2 text-[16px]">{v.body}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* Collections. The first is laid out as a feature: one large product beside four. */}
      {collections.map((col, ci) => {
        const inCol = items.filter((i) => i.collection === col.handle);
        const href = `${base}/collections/${col.handle}`;
        return (
          <section key={col.handle} className="sf-line border-t">
            <div className="sf-wrap sf-section">
              <div className="mb-12 flex flex-wrap items-end justify-between gap-6">
                <div>
                  <h2 className="sf-heading" style={{ fontSize: "var(--text-h1)" }}>
                    {col.title}
                  </h2>
                  <p className="sf-muted mt-3 max-w-[52ch]">{col.description}</p>
                </div>
                <Link href={href} className="sf-link text-[15px]">
                  See all {inCol.length}
                </Link>
              </div>
              {ci === 0 && inCol.length >= 3 ? (
                <div className="grid gap-x-6 gap-y-12 lg:grid-cols-[7fr_5fr]">
                  <ul>
                    <ProductCard item={inCol[0]} base={base} feature />
                  </ul>
                  <ul className="grid grid-cols-2 gap-x-5 gap-y-10 self-start">
                    {inCol.slice(1, 5).map((item) => (
                      <ProductCard key={item.handle} item={item} base={base} />
                    ))}
                  </ul>
                </div>
              ) : (
                <ul className="grid grid-cols-2 gap-x-5 gap-y-10 md:grid-cols-4">
                  {inCol.slice(0, 4).map((item) => (
                    <ProductCard key={item.handle} item={item} base={base} />
                  ))}
                </ul>
              )}
            </div>
          </section>
        );
      })}

      {/* The shop in its own words */}
      {story ? (
        <section className="sf-line border-t" style={{ background: "var(--s-surface)" }}>
          <div className="sf-wrap sf-section grid gap-8 lg:grid-cols-[5fr_7fr]">
            <p className="sf-label pt-2">About {bp.brand?.name}</p>
            <div>
              <p className="sf-heading" style={{ fontSize: "var(--text-h2)", lineHeight: 1.3 }}>
                {story}
              </p>
              <Link href={`${base}/pages/about`} className="sf-link mt-8 inline-block text-[15px]">
                Read more about {bp.brand?.name}
              </Link>
            </div>
          </div>
        </section>
      ) : null}

      {/* Questions */}
      {bp.pages?.faq?.length ? (
        <section className="sf-line border-t">
          <div className="sf-wrap sf-section grid gap-10 lg:grid-cols-[5fr_7fr]">
            <h2 className="sf-heading" style={{ fontSize: "var(--text-h1)" }}>
              Questions, answered
            </h2>
            <div>
              {bp.pages.faq.slice(0, 4).map((f) => (
                <details key={f.question} className="sf-line border-b py-5">
                  <summary className="flex items-center justify-between gap-6 text-[17px] font-medium">
                    {f.question}
                    <span aria-hidden className="sf-plus text-[22px] leading-none">
                      +
                    </span>
                  </summary>
                  <p className="sf-muted mt-3 max-w-[62ch]">{f.answer}</p>
                </details>
              ))}
              <Link href={`${base}/pages/faq`} className="sf-link mt-8 inline-block text-[15px]">
                All questions
              </Link>
            </div>
          </div>
        </section>
      ) : null}

      <section className="sf-wrap pb-[var(--s-section)]">
        <div className="sf-line flex flex-wrap items-end justify-between gap-8 border-t pt-14">
          <p className="sf-display max-w-[16ch]" style={{ fontSize: "var(--text-h1)" }}>
            {bp.brand?.tagline}
          </p>
          <Link href={firstCollectionHref} className="sf-button">
            {bp.hero?.cta || "Shop the range"}
          </Link>
        </div>
      </section>
    </>
  );
}
