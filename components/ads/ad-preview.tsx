import { Bookmark, ChevronRight, Heart, MessageCircle, MoreHorizontal, Music2, Send, Share2 } from "lucide-react";
import type { CSSProperties } from "react";
import { ProductArt } from "@/components/product-art";
import { cx } from "@/components/ui";

// How an ad looks where people meet it: a post in a Facebook or Instagram feed, and a full-screen card
// between short videos (the TikTok style). Drawn in plain HTML and CSS with the shop's own photos, name
// and colours; no platform logos. No hooks, so the same markup renders on the server and live while
// someone edits the words.

export interface PreviewProduct {
  id: string;
  title: string;
  imageUrl: string | null;
  icon: string | null;
  priceCents: number;
}

export interface PreviewAd {
  format: "single" | "carousel";
  primaryText: string;
  headline: string;
  description: string;
  /** The button's words, e.g. "Shop now". */
  cta: string;
  productIds: string[];
  cards: { productId: string; headline: string; description: string }[];
}

export interface PreviewShop {
  brand: string;
  /** What the ad shows as the shop's address. */
  domain: string;
  /** The shop's accent and the text colour that reads on it (checked at 4.5:1 when the shop was built). */
  accent: string;
  accentInk: string;
  /** The shop's surface and accent, for practice items drawn as illustrations. */
  artBg: string;
  artFg: string;
}

const SHOWN = 125;

function Photo({ product, shop, className }: { product: PreviewProduct | undefined; shop: PreviewShop; className?: string }) {
  return (
    <div className={cx("overflow-hidden bg-sunken", className)} style={{ "--art-bg": shop.artBg, "--art-fg": shop.artFg } as CSSProperties}>
      {product ? <ProductArt images={product.imageUrl ? [{ url: product.imageUrl }] : []} icon={product.icon ?? undefined} title={product.title} sizes="360px" /> : null}
    </div>
  );
}

function Monogram({ shop, size = 32 }: { shop: PreviewShop; size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold"
      style={{ width: size, height: size, background: shop.accent, color: shop.accentInk, fontSize: size * 0.42 }}
    >
      {shop.brand.trim().charAt(0).toUpperCase() || "A"}
    </span>
  );
}

const handle = (brand: string) => brand.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** A post in a Facebook or Instagram feed. */
export function FeedPreview({ ad, shop, products, className }: { ad: PreviewAd; shop: PreviewShop; products: Record<string, PreviewProduct>; className?: string }) {
  const long = ad.primaryText.length > SHOWN;
  const text = long ? ad.primaryText.slice(0, SHOWN).replace(/\s+\S*$/, "") : ad.primaryText;
  const first = products[ad.productIds[0]];
  return (
    <figure className={cx("m-0 flex w-full max-w-[360px] flex-col overflow-hidden rounded-2xl border border-line bg-raised", className)} aria-label="How it looks in a Facebook or Instagram feed">
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <Monogram shop={shop} />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-[13px] font-semibold">{shop.brand}</div>
          <div className="text-[12px] text-muted">Sponsored</div>
        </div>
        <MoreHorizontal aria-hidden className="size-4 text-muted" />
      </div>
      <p className="px-3 pb-2.5 text-[13px] leading-snug whitespace-pre-line break-words">
        {text}
        {long ? <span className="text-muted">… more</span> : null}
      </p>

      {ad.format === "carousel" ? (
        <div className="flex snap-x snap-mandatory gap-2 overflow-x-auto px-3 pb-3" tabIndex={0} aria-label="Carousel cards, scroll sideways">
          {ad.cards.map((c, i) => (
            <div key={`${c.productId}-${i}`} className="flex w-[72%] shrink-0 snap-start flex-col overflow-hidden rounded-xl border border-line">
              <Photo product={products[c.productId]} shop={shop} className="aspect-square" />
              <div className="flex items-end gap-2 bg-sunken px-2.5 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold">{c.headline || products[c.productId]?.title}</div>
                  <div className="truncate text-[12px] text-muted">{c.description || " "}</div>
                </div>
                <span className="shrink-0 rounded-md border border-line-strong bg-raised px-2 py-1 text-[12px] font-semibold">{ad.cta}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <>
          <Photo product={first} shop={shop} className="aspect-square" />
          <div className="flex items-center gap-3 border-t border-line bg-sunken px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12px] text-muted">{shop.domain}</div>
              <div className="truncate text-[14px] leading-snug font-semibold">{ad.headline}</div>
              {ad.description ? <div className="truncate text-[12px] text-muted">{ad.description}</div> : null}
            </div>
            <span className="shrink-0 rounded-lg border border-line-strong bg-raised px-3 py-1.5 text-[13px] font-semibold">{ad.cta}</span>
          </div>
        </>
      )}

      <div aria-hidden className="flex items-center gap-4 border-t border-line px-3 py-2 text-muted">
        <Heart className="size-[18px]" strokeWidth={1.8} />
        <MessageCircle className="size-[18px]" strokeWidth={1.8} />
        <Send className="size-[18px]" strokeWidth={1.8} />
        <Bookmark className="ml-auto size-[18px]" strokeWidth={1.8} />
      </div>
    </figure>
  );
}

/** A full-screen card between short videos (the TikTok style). Always dark, like a video frame. */
export function ShortPreview({ ad, shop, products, className }: { ad: PreviewAd; shop: PreviewShop; products: Record<string, PreviewProduct>; className?: string }) {
  const shownIds = ad.format === "carousel" ? ad.cards.map((c) => c.productId) : ad.productIds.slice(0, 1);
  const first = products[shownIds[0]];
  return (
    <figure
      className={cx("relative m-0 aspect-[9/16] w-[220px] shrink-0 overflow-hidden rounded-2xl bg-[#0b0d10] text-white", className)}
      aria-label="How it looks as a full-screen card between short videos"
    >
      <Photo product={first} shop={shop} className="absolute inset-0 h-full w-full" />
      {ad.format === "carousel" && shownIds.length > 1 ? (
        <div aria-hidden className="absolute inset-x-3 top-3 flex gap-1">
          {shownIds.map((id, i) => (
            <span key={`${id}-${i}`} className="h-[3px] flex-1 rounded-full" style={{ background: i === 0 ? "#ffffff" : "rgba(255,255,255,0.45)" }} />
          ))}
        </div>
      ) : null}
      <div aria-hidden className="absolute right-2 bottom-[38%] flex flex-col items-center gap-3.5">
        <span className="rounded-full ring-2 ring-white">
          <Monogram shop={shop} size={30} />
        </span>
        <Heart className="size-6" strokeWidth={1.8} />
        <MessageCircle className="size-6" strokeWidth={1.8} />
        <Bookmark className="size-6" strokeWidth={1.8} />
        <Share2 className="size-6" strokeWidth={1.8} />
      </div>
      {/* The words sit on a strong shade so they read over any photo (white on 70% black or more is above 7:1). */}
      <div
        className="absolute inset-x-0 bottom-0 flex flex-col gap-1.5 px-3 pt-24 pb-3"
        style={{ background: "linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.78) 55%, rgba(0,0,0,0) 100%)" }}
      >
        <div className="flex items-center gap-1.5 text-[13px] font-semibold">
          @{handle(shop.brand) || "shop"}
          <span className="rounded-sm bg-white/20 px-1 py-px text-[11px] font-medium">Sponsored</span>
        </div>
        <p className="line-clamp-3 text-[12px] leading-snug break-words">{ad.primaryText}</p>
        <div aria-hidden className="flex items-center gap-1 text-[11px]">
          <Music2 className="size-3" />
          <span className="truncate">Original sound · {shop.brand}</span>
        </div>
        <div className="mt-1 flex items-center justify-between rounded-md px-2.5 py-2 text-[13px] font-semibold" style={{ background: shop.accent, color: shop.accentInk }}>
          {ad.cta}
          <ChevronRight aria-hidden className="size-4" />
        </div>
      </div>
    </figure>
  );
}

/** Placeholder shapes while the AI writes, in the same size as the real previews. */
export function PreviewSkeleton() {
  return (
    <div aria-hidden className="flex w-full max-w-[360px] flex-col overflow-hidden rounded-2xl border border-line bg-raised">
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <span className="size-8 rounded-full bg-sunken" />
        <span className="h-3 w-24 rounded-full bg-sunken" />
      </div>
      <div className="flex flex-col gap-1.5 px-3 pb-3">
        <span className="h-2.5 w-full rounded-full bg-sunken" />
        <span className="h-2.5 w-4/5 rounded-full bg-sunken" />
      </div>
      <div className="aspect-square bg-sunken" />
      <div className="flex items-center gap-3 px-3 py-3">
        <span className="h-3 flex-1 rounded-full bg-sunken" />
        <span className="h-7 w-20 rounded-lg bg-sunken" />
      </div>
    </div>
  );
}
