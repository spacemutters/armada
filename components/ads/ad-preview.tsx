import { Bookmark, ChevronRight, Heart, MessageCircle, MoreHorizontal, Music2, Send, Share2 } from "lucide-react";
import type { CSSProperties } from "react";
import { cx } from "@/components/ui";

// How an ad looks where people meet it: a post in a Facebook or Instagram feed, and a full-screen card
// between short videos (the TikTok style). Drawn in plain HTML and CSS with the ad's own pictures
// (composed by Armada: each product in its real photo, scenes made with AI), the shop's name and
// colours; no platform logos. The words are real text, never part of a picture. No hooks, so the same
// markup renders on the server and live while someone edits the words.

export interface PreviewProduct {
  id: string;
  title: string;
  imageUrl: string | null;
  icon: string | null;
  priceCents: number;
}

/** One of an ad's pictures: a square, 4:5 and 9:16 version once it's ready. */
export interface PreviewPicture {
  key: string;
  state: "ready" | "making" | "failed" | "waiting";
  src: { square: string | null; portrait: string | null; story: string | null };
  /** A practice item's picture is labelled as practice on the picture itself. */
  practiceItem: boolean;
  alt: string;
}

export interface PreviewAd {
  format: "single" | "carousel";
  primaryText: string;
  headline: string;
  description: string;
  /** The button's words, e.g. "Shop now". */
  cta: string;
  productIds: string[];
  cards: { key: string; productId: string | null; headline: string; description: string }[];
  /** In the order the ad shows them: one for a single-photo ad, one per card. */
  pictures: PreviewPicture[];
}

export interface PreviewShop {
  brand: string;
  /** What the ad shows as the shop's address. */
  domain: string;
  /** The shop's accent and the text colour that reads on it (checked at 4.5:1 when the shop was built). */
  accent: string;
  accentInk: string;
  /** The shop's surface and background, for the quiet panel shown while a picture is being made. */
  artBg: string;
  artFg: string;
  /** Practice ads say so on every preview. */
  practice?: boolean;
  /** The AI helper on the owner's computer is off, so pictures being made are waiting for it. */
  helperOff?: boolean;
}

const SHOWN = 125;

function waitingWords(p: PreviewPicture | undefined, shop: PreviewShop): string {
  if (!p) return "No picture yet";
  if (p.state === "failed") return "This picture couldn't be made";
  if (shop.helperOff) return "Waiting for the AI helper on your computer";
  return "Making this picture";
}

/** A picture, or a quiet panel in the shop's colours that says in plain words what's happening. */
function Picture({ picture, shape, shop, className }: { picture: PreviewPicture | undefined; shape: keyof PreviewPicture["src"]; shop: PreviewShop; className?: string }) {
  const src = picture?.src[shape] ?? null;
  if (src) {
    return (
      <div className={cx("relative overflow-hidden", className)} style={{ background: shop.artBg }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={picture?.alt ?? ""} loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
        {picture?.practiceItem ? (
          // White on 62% black reads at 6:1 or better over any picture.
          <span className="absolute bottom-2.5 left-2.5 rounded-full px-2 py-0.5 text-[11px] font-medium text-white" style={{ background: "rgba(0,0,0,0.62)" }}>
            Practice item
          </span>
        ) : null}
        {picture?.state === "making" ? (
          <span className="absolute top-2.5 right-2.5 rounded-full px-2 py-0.5 text-[11px] font-medium text-white" style={{ background: "rgba(0,0,0,0.62)" }}>
            Making a new one
          </span>
        ) : null}
      </div>
    );
  }
  const busy = picture?.state !== "failed";
  return (
    <div
      role="img"
      aria-label={waitingWords(picture, shop)}
      className={cx("relative overflow-hidden", busy && "picture-making", className)}
      style={{ background: `linear-gradient(165deg, ${shop.artBg} 0%, color-mix(in srgb, ${shop.artBg} 82%, ${shop.artFg}) 100%)` } as CSSProperties}
    >
      <span className="absolute inset-x-0 bottom-3 mx-auto flex w-fit max-w-[88%] items-center gap-1.5 rounded-full bg-raised/95 px-3 py-1 text-center text-[12px] leading-snug font-medium text-ink shadow-sm">
        {busy ? <span aria-hidden className="pulse size-1.5 shrink-0 rounded-full bg-ink" /> : null}
        {waitingWords(picture, shop)}
      </span>
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
export function FeedPreview({ ad, shop, className }: { ad: PreviewAd; shop: PreviewShop; products?: Record<string, PreviewProduct>; className?: string }) {
  const long = ad.primaryText.length > SHOWN;
  const text = long ? ad.primaryText.slice(0, SHOWN).replace(/\s+\S*$/, "") : ad.primaryText;
  const pictureFor = (key: string) => ad.pictures.find((p) => p.key === key);
  return (
    <figure
      className={cx(
        "m-0 flex w-full max-w-[360px] flex-col overflow-hidden rounded-[22px] border border-line bg-raised shadow-[0_1px_2px_rgba(0,0,0,0.04),0_14px_36px_-20px_rgba(0,0,0,0.3)]",
        className,
      )}
      aria-label="How it looks in a Facebook or Instagram feed"
    >
      <div className="flex items-center gap-2.5 px-3.5 py-3">
        <Monogram shop={shop} />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-[13px] font-semibold">{shop.brand}</div>
          <div className="text-[12px] text-muted">Sponsored</div>
        </div>
        {shop.practice ? (
          <span className="shrink-0 rounded-full border border-line-strong px-2 py-0.5 text-[11px] font-medium text-muted">Practice ad</span>
        ) : (
          <MoreHorizontal aria-hidden className="size-4 text-muted" />
        )}
      </div>
      <p className="px-3.5 pb-3 text-[13px] leading-[1.45] whitespace-pre-line break-words">
        {text}
        {long ? <span className="text-muted">… more</span> : null}
      </p>

      {ad.format === "carousel" ? (
        <div className="flex snap-x snap-mandatory scroll-px-3.5 gap-2 overflow-x-auto px-3.5 pb-3.5 [scrollbar-width:thin]" tabIndex={0} aria-label={`${ad.cards.length} carousel cards, scroll sideways`}>
          {ad.cards.map((c, i) => (
            <div key={c.key} className="flex w-[78%] shrink-0 snap-start flex-col overflow-hidden rounded-2xl border border-line bg-raised">
              <Picture picture={pictureFor(c.key)} shape="square" shop={shop} className="aspect-square" />
              <div className="flex items-center gap-2 px-3 py-2.5">
                <div className="min-w-0 flex-1 leading-tight">
                  <div className="truncate text-[13px] font-semibold">{c.headline || ad.headline}</div>
                  <div className="truncate text-[12px] text-muted">{c.description || `${i + 1} of ${ad.cards.length}`}</div>
                </div>
                <span className="shrink-0 rounded-lg bg-sunken px-2.5 py-1.5 text-[12px] font-semibold">{ad.cta}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <>
          <Picture picture={ad.pictures[0]} shape="portrait" shop={shop} className="aspect-[4/5]" />
          <div className="flex items-center gap-3 px-3.5 py-3">
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate text-[11px] tracking-[0.06em] text-muted uppercase">{shop.domain}</div>
              <div className="mt-0.5 truncate text-[15px] font-semibold">{ad.headline}</div>
              {ad.description ? <div className="truncate text-[12px] text-muted">{ad.description}</div> : null}
            </div>
            <span className="shrink-0 rounded-lg bg-sunken px-3 py-2 text-[13px] font-semibold">{ad.cta}</span>
          </div>
        </>
      )}

      <div aria-hidden className="flex items-center gap-4 border-t border-line px-3.5 py-2.5 text-muted">
        <Heart className="size-[18px]" strokeWidth={1.8} />
        <MessageCircle className="size-[18px]" strokeWidth={1.8} />
        <Send className="size-[18px]" strokeWidth={1.8} />
        <Bookmark className="ml-auto size-[18px]" strokeWidth={1.8} />
      </div>
    </figure>
  );
}

/** A full-screen card between short videos (the TikTok style). Always dark, like a video frame. */
export function ShortPreview({ ad, shop, className }: { ad: PreviewAd; shop: PreviewShop; products?: Record<string, PreviewProduct>; className?: string }) {
  const count = ad.format === "carousel" ? ad.cards.length : 1;
  return (
    <figure
      className={cx("relative m-0 aspect-[9/16] w-[220px] shrink-0 overflow-hidden rounded-[22px] bg-[#0b0d10] text-white shadow-[0_14px_36px_-20px_rgba(0,0,0,0.5)]", className)}
      aria-label="How it looks as a full-screen card between short videos"
    >
      <Picture picture={ad.pictures[0]} shape="story" shop={shop} className="absolute inset-0 h-full w-full" />
      {count > 1 ? (
        <div aria-hidden className="absolute inset-x-3 top-3 flex gap-1">
          {Array.from({ length: count }, (_, i) => (
            <span key={i} className="h-[3px] flex-1 rounded-full" style={{ background: i === 0 ? "#ffffff" : "rgba(255,255,255,0.45)" }} />
          ))}
        </div>
      ) : null}
      {shop.practice ? (
        <span className="absolute top-6 left-3 rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ background: "rgba(0,0,0,0.62)" }}>
          Practice ad
        </span>
      ) : null}
      <div aria-hidden className="absolute right-2 bottom-[38%] flex flex-col items-center gap-3.5 drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]">
        <span className="rounded-full ring-2 ring-white">
          <Monogram shop={shop} size={30} />
        </span>
        <Heart className="size-6" strokeWidth={1.8} />
        <MessageCircle className="size-6" strokeWidth={1.8} />
        <Bookmark className="size-6" strokeWidth={1.8} />
        <Share2 className="size-6" strokeWidth={1.8} />
      </div>
      {/* The words sit on a strong shade so they read over any picture (white on 70% black or more is above 7:1). */}
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
    <div aria-hidden className="flex w-full max-w-[360px] flex-col overflow-hidden rounded-[22px] border border-line bg-raised">
      <div className="flex items-center gap-2.5 px-3.5 py-3">
        <span className="size-8 rounded-full bg-sunken" />
        <span className="h-3 w-24 rounded-full bg-sunken" />
      </div>
      <div className="flex flex-col gap-1.5 px-3.5 pb-3">
        <span className="h-2.5 w-full rounded-full bg-sunken" />
        <span className="h-2.5 w-4/5 rounded-full bg-sunken" />
      </div>
      <div className="picture-making relative aspect-[4/5] bg-sunken" />
      <div className="flex items-center gap-3 px-3.5 py-3">
        <span className="h-3 flex-1 rounded-full bg-sunken" />
        <span className="h-7 w-20 rounded-lg bg-sunken" />
      </div>
    </div>
  );
}
