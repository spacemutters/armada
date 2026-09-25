import Link from "next/link";
import { ProductArt } from "@/components/product-art";
import type { ImageRow } from "@/lib/shops/images";
import type { StoreItem } from "@/lib/shops/storefront";
import type { Blueprint } from "@/lib/shops/types";

// Storefront pieces built from the shop's brand pictures and its true facts.
//
// Brand pictures (made by ChatGPT's image maker) set the mood only: the hero, collection covers and
// the lifestyle band. They are never used on a product card or a product page, where shoppers see
// the supplier's real photos, because a shopper must receive what the product pictures show.

const src = (img: ImageRow) => `/api/img/${img.id}`;

/**
 * One brand picture that swaps shape with the screen: the wide cut from 1024 pixels up, the tall cut
 * below. Either may stand in for the other.
 */
export function BrandPicture({
  wide,
  tall,
  alt,
  priority = false,
  className,
}: {
  wide: ImageRow | null;
  tall: ImageRow | null;
  alt: string;
  priority?: boolean;
  className?: string;
}) {
  const small = tall ?? wide;
  const large = wide ?? tall;
  if (!small || !large) return null;
  return (
    <picture className={className}>
      <source media="(min-width: 1024px)" srcSet={src(large)} width={large.width} height={large.height} />
      <img
        src={src(small)}
        width={small.width}
        height={small.height}
        alt={alt}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : "auto"}
        decoding="async"
      />
    </picture>
  );
}

/**
 * The shop's delivery and returns terms, exactly as its facts state them, near the top of the page
 * and linked to the full shipping and returns page. Nothing here is a promise the facts don't make.
 */
export function TrustStrip({ facts, base }: { facts: Blueprint["facts"]; base: string }) {
  if (!facts) return null;
  const items = [
    { label: "Delivery", value: `Ships within ${facts.handlingDays} business days, then ${facts.deliveryMin}–${facts.deliveryMax} to arrive` },
    { label: "Returns", value: `Within ${facts.returnDays} days of delivery` },
    { label: "Ships to", value: facts.country },
  ];
  return (
    <section aria-label="Delivery and returns" className="sf-line border-b">
      <ul className="sf-wrap sf-trust">
        {items.map((i) => (
          <li key={i.label}>
            <Link href={`${base}/pages/shipping`} className="sf-trust-item">
              <span className="sf-label">{i.label}</span>
              <span className="text-[15px]">{i.value}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * "Shop by collection": each collection's cover (a brand picture), its name and how many products it
 * holds. A collection without a cover shows its first product's photo instead.
 */
export function CollectionTiles({
  collections,
  items,
  covers,
  base,
}: {
  collections: NonNullable<Blueprint["collections"]>;
  items: StoreItem[];
  covers: Record<string, ImageRow>;
  base: string;
}) {
  return (
    <section aria-labelledby="sf-collections" className="sf-line border-b">
      <div className="sf-wrap sf-section">
        <h2 id="sf-collections" className="sf-heading mb-10" style={{ fontSize: "var(--text-h1)" }}>
          Shop by collection
        </h2>
        <ul className="sf-tiles">
          {collections.map((c) => {
            const inCol = items.filter((i) => i.collection === c.handle);
            const cover = covers[c.handle];
            // Without a cover: the first real product photo, or else a quiet tile with the collection's initial
            // (a practice item's icon beside real covers would read as a mistake).
            const first = inCol.find((i) => i.product.images.length);
            return (
              <li key={c.handle} className="sf-card">
                <Link href={`${base}/collections/${c.handle}`} className="block">
                  <div className="sf-tile-media">
                    {cover ? (
                      // Mood picture: the link's words name the collection, so the picture stays silent.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={src(cover)} width={cover.width} height={cover.height} alt="" loading="lazy" decoding="async" />
                    ) : first ? (
                      <div className="sf-card-media h-full" style={{ aspectRatio: "auto" }}>
                        <ProductArt images={first.product.images} icon={first.product.art?.icon} title={first.product.title} sizes="(min-width: 1024px) 25vw, 70vw" />
                      </div>
                    ) : (
                      <span aria-hidden className="sf-tile-initial sf-display">
                        {c.title.trim().charAt(0)}
                      </span>
                    )}
                  </div>
                  <div className="mt-4 flex items-baseline justify-between gap-4">
                    <span className="sf-heading text-[clamp(1.2rem,1.6vw,1.45rem)]">{c.title}</span>
                    <span className="sf-muted shrink-0 text-[14px] tabular-nums">
                      {inCol.length} {inCol.length === 1 ? "product" : "products"}
                    </span>
                  </div>
                  <p className="sf-muted mt-1 text-[15px] leading-snug">{c.description}</p>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
