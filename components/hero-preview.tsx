import type { CSSProperties } from "react";
import type { HeroCopy } from "@/lib/abtest/prompt";
import type { CatalogImage } from "@/lib/types";
import { cx } from "./ui";

/**
 * A shop's home-page headline as its visitors see it: the shop's own colors, fonts and radius
 * (`vars` from storefrontVars), scaled down to sit in a card. Needs app/s/storefront.css loaded.
 * No hooks, so the same markup renders on the server and live while the owner edits.
 */
export function HeroPreview({
  vars,
  brand,
  hero,
  image,
  label,
  side,
  highlight,
}: {
  vars: CSSProperties;
  brand: string;
  hero: HeroCopy;
  image?: CatalogImage | null;
  label: string;
  side: "a" | "b";
  highlight?: boolean;
}) {
  return (
    <figure data-preview={side} className="flex min-w-0 flex-col gap-2">
      <figcaption className="flex items-center gap-2 text-[13px]">
        <span
          aria-hidden
          className={cx(
            "inline-flex size-6 items-center justify-center rounded-full text-[12px] font-semibold",
            side === "b" ? "bg-accent text-accent-ink" : "border border-line-strong text-ink",
          )}
        >
          {side.toUpperCase()}
        </span>
        <span className="font-medium">{label}</span>
      </figcaption>
      <div
        className={cx("sf overflow-hidden rounded-2xl border", highlight ? "border-accent" : "border-line")}
        style={{ ...vars, minHeight: 0, "--text-display": "clamp(1.55rem, 1rem + 1.6vw, 2.35rem)" } as CSSProperties}
      >
        <div className="sf-line flex h-10 items-center justify-between border-b px-4">
          <span className="sf-heading text-[15px]">{brand}</span>
          <span aria-hidden className="sf-muted flex gap-3 text-[11px]">
            <span>Shop</span>
            <span>About</span>
          </span>
        </div>
        <div className={cx("grid items-center gap-5 p-5 sm:p-7", image ? "grid-cols-[1.5fr_1fr]" : "grid-cols-1")}>
          <div className="flex min-w-0 flex-col gap-3">
            <p className="sf-display break-words" style={{ fontSize: "var(--text-display)" }}>
              {hero.headline}
            </p>
            <p className="sf-muted text-[14px] leading-snug">{hero.subhead}</p>
            <span className="sf-button pointer-events-none self-start" style={{ minHeight: 38, fontSize: 14, padding: "0 1rem" }}>
              {hero.cta || "Shop the range"}
            </span>
          </div>
          {image ? (
            <div className="sf-card-media overflow-hidden rounded-[var(--s-radius)]" style={{ aspectRatio: "4 / 5" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image.url} alt="" loading="lazy" className="h-full w-full object-cover" />
            </div>
          ) : null}
        </div>
      </div>
    </figure>
  );
}
