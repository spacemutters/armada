import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductArt } from "@/components/product-art";
import { AddToBag } from "@/components/storefront/bag";
import { ProductCard } from "@/components/storefront/product-card";
import { SetCard } from "@/components/storefront/set-card";
import { AddTogether } from "@/components/storefront/sets";
import { StickyBuy } from "@/components/storefront/sticky-buy";
import { formatMoney } from "@/lib/money";
import { loadStorefront, shopBase, storeItems } from "@/lib/shops/storefront";

// A product page reads in the order a shopper decides: what it is and what it costs, what it does for
// them (the description's opening), the facts that decide it (bullets), the button, then the shop's
// true delivery and returns terms right under it, then the rest of the details. Pictures here are
// only the supplier's real photos (or a practice item's labelled illustration), never brand pictures.

/** The description's opening as the lead, the rest as details. A long single paragraph gives up its first sentence. */
function splitLead(paragraphs: string[]): { lead: string; rest: string[] } {
  const [first, ...rest] = paragraphs;
  if (!first) return { lead: "", rest: [] };
  if (first.split(/\s+/).length <= 45) return { lead: first, rest };
  const m = first.match(/^(.+?[.?!])\s+(\S[\s\S]*)$/);
  return m ? { lead: m[1], rest: [m[2], ...rest] } : { lead: first, rest };
}

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
  const pairs = (bp.pairings?.[item.handle] ?? [])
    .map((pr) => ({ ...pr, item: items.find((i) => i.handle === pr.handle) }))
    .filter((pr): pr is { handle: string; why: string; item: (typeof items)[number] } => Boolean(pr.item));
  const inSets = (bp.sets ?? []).filter((s) => s.productHandles.includes(item.handle));
  const shown = new Set([item.handle, ...pairs.map((pr) => pr.handle)]);
  const related = items.filter((i) => i.collection === item.collection && !shown.has(i.handle)).slice(0, 4);
  const paragraphs = p.description.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  const { lead, rest } = splitLead(paragraphs);
  const line = { handle: item.handle, title: p.title, priceCents: item.priceCents, image: p.images[0]?.url ?? null, icon: p.art?.icon ?? null };

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
          <div className="flex flex-col gap-3">
            <h1 className="sf-heading" style={{ fontSize: "var(--text-h1)" }}>
              {p.title}
            </h1>
            <p className="text-[24px] tabular-nums">{formatMoney(item.priceCents)}</p>
          </div>
          {lead ? <p className="sf-lead">{lead}</p> : null}
          {p.bullets.length ? (
            <ul className="sf-points text-[16px]" aria-label="Key details">
              {p.bullets.map((b) => (
                <li key={b}>
                  <span aria-hidden className="sf-muted">
                    –
                  </span>
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          ) : null}
          <div id="sf-buy">
            <AddToBag slug={slug} line={line} />
          </div>
          {facts ? (
            <div>
              <dl className="sf-facts">
                <div>
                  <dt className="sf-muted">Delivery</dt>
                  <dd>
                    Ships within {facts.handlingDays} business days, then arrives in {facts.deliveryMin}–{facts.deliveryMax} business days
                  </dd>
                </div>
                <div>
                  <dt className="sf-muted">Returns</dt>
                  <dd>
                    Within {facts.returnDays} days of delivery{facts.freeReturns ? ", and return shipping is on us" : ""}
                  </dd>
                </div>
                <div>
                  <dt className="sf-muted">Ships to</dt>
                  <dd>{facts.country}</dd>
                </div>
              </dl>
              <Link href={`${base}/pages/shipping`} className="sf-link mt-3 inline-flex min-h-11 items-center text-[15px]">
                Shipping and returns, in full
              </Link>
            </div>
          ) : null}
          {item.imagined ? <p className="sf-label">Practice item. The picture is an illustration, not a photo.</p> : null}
          {rest.length ? (
            <div>
              <h2 className="sf-label">Details</h2>
              <div className="sf-prose mt-2">
                {rest.map((para, i) => (
                  <p key={i}>{para}</p>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
      <StickyBuy slug={slug} line={line} price={formatMoney(item.priceCents)} targetId="sf-buy" />

      {pairs.length ? (
        <section className="sf-line border-t" aria-labelledby="sf-pairs">
          <div className="sf-wrap sf-section">
            <h2 id="sf-pairs" className="sf-heading mb-10" style={{ fontSize: "var(--text-h2)" }}>
              Goes well with
            </h2>
            <ul className="grid gap-6 md:grid-cols-2">
              {pairs.map((pr) => {
                const other = pr.item;
                const otherLine = { handle: other.handle, title: other.product.title, priceCents: other.priceCents, image: other.product.images[0]?.url ?? null, icon: other.product.art?.icon ?? null };
                return (
                  <li key={pr.handle} className="sf-line flex list-none items-center gap-5 rounded-[var(--s-radius)] border p-4">
                    <Link href={`${base}/products/${other.handle}`} className="sf-card-media block w-24 shrink-0" style={{ aspectRatio: "1 / 1" }} aria-label={other.product.title}>
                      <ProductArt images={other.product.images} icon={other.product.art?.icon} title={other.product.title} sizes="96px" />
                    </Link>
                    <div className="flex min-w-0 flex-1 flex-col gap-2">
                      <Link href={`${base}/products/${other.handle}`} className="font-medium leading-snug">
                        {other.product.title}
                      </Link>
                      <p className="sf-muted text-[14px]">{pr.why}</p>
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="tabular-nums">{formatMoney(other.priceCents)}</span>
                        <AddTogether slug={slug} lines={[line, otherLine]} label="Add both to bag" ghost />
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      ) : null}

      {inSets.length ? (
        <section className="sf-line border-t" aria-labelledby="sf-in-sets">
          <div className="sf-wrap sf-section">
            <h2 id="sf-in-sets" className="sf-heading mb-10" style={{ fontSize: "var(--text-h2)" }}>
              Also in a set
            </h2>
            <ul className={`grid gap-6 ${inSets.length > 1 ? "md:grid-cols-2" : "max-w-xl"}`}>
              {inSets.map((s) => (
                <SetCard key={s.handle} set={s} items={items} base={base} slug={slug} />
              ))}
            </ul>
          </div>
        </section>
      ) : null}

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
