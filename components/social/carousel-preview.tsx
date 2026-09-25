"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { useReducedMotion } from "@/components/fx";
import { cx } from "@/components/ui";

export interface PreviewSlide {
  src: string;
  alt: string;
}

/**
 * A carousel post as people will see it in their feed: the account row, the slides (swipe, drag
 * the scrollbar, use the arrows or the arrow keys), the page dots and the caption. The slides are the
 * real images Armada sends. Drawn with plain HTML and CSS: no platform's logo or buttons are copied.
 */
export function CarouselPreview({
  slides,
  name,
  handle,
  monogram,
  caption,
  hashtags,
}: {
  slides: PreviewSlide[];
  name: string;
  handle: string | null;
  /** The shop's accent and the words on it, for the round account picture. */
  monogram: { background: string; ink: string };
  caption: string;
  hashtags: string[];
}) {
  const id = useId();
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [loaded, setLoaded] = useState<Record<number, boolean>>({});
  const [open, setOpen] = useState(false);
  const reduced = useReducedMotion();
  const total = slides.length;

  const onScroll = useCallback(() => {
    const el = track.current;
    if (!el || !el.clientWidth) return;
    setIndex(Math.max(0, Math.min(total - 1, Math.round(el.scrollLeft / el.clientWidth))));
  }, [total]);

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [onScroll]);

  const go = (to: number) => {
    const el = track.current;
    if (!el) return;
    const n = Math.max(0, Math.min(total - 1, to));
    el.scrollTo({ left: n * el.clientWidth, behavior: reduced ? "auto" : "smooth" });
  };

  const initial = (name.trim()[0] ?? "A").toUpperCase();
  const long = caption.length > 140 || caption.includes("\n");

  return (
    <figure className="w-full max-w-[400px] overflow-hidden rounded-[22px] border border-line bg-raised shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_-18px_rgba(0,0,0,0.25)]">
      <div className="flex items-center gap-2.5 px-3.5 py-3">
        <span
          aria-hidden
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold"
          style={{ background: monogram.background, color: monogram.ink } as CSSProperties}
        >
          {initial}
        </span>
        <span className="min-w-0 leading-tight">
          <span className="block truncate text-[13px] font-semibold">{handle ? handle.replace(/^@?/, "") : name}</span>
          {handle ? <span className="block truncate text-[12px] text-muted">{name}</span> : null}
        </span>
      </div>

      <div className="relative">
        <div
          ref={track}
          id={id}
          tabIndex={0}
          role="region"
          aria-roledescription="carousel"
          aria-label={`${total} slides. Use the arrow keys to move between them.`}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") {
              e.preventDefault();
              go(index + 1);
            } else if (e.key === "ArrowLeft") {
              e.preventDefault();
              go(index - 1);
            }
          }}
          className="flex aspect-[4/5] snap-x snap-mandatory overflow-x-auto overscroll-x-contain bg-sunken [scrollbar-width:none] focus-visible:outline-offset-[-2px] [&::-webkit-scrollbar]:hidden"
        >
          {slides.map((s, i) => (
            <div key={s.src} className="relative h-full w-full shrink-0 snap-center snap-always" aria-roledescription="slide" aria-label={`${i + 1} of ${total}`}>
              {!loaded[i] ? <span aria-hidden className="absolute inset-0 animate-pulse bg-sunken motion-reduce:animate-none" /> : null}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={s.src}
                alt={s.alt}
                width={1080}
                height={1350}
                loading={i === 0 ? "eager" : "lazy"}
                decoding="async"
                draggable={false}
                onLoad={() => setLoaded((l) => ({ ...l, [i]: true }))}
                className={cx("relative h-full w-full select-none object-cover transition-opacity duration-300", loaded[i] ? "opacity-100" : "opacity-0")}
              />
            </div>
          ))}
        </div>

        {total > 1 ? (
          <span
            aria-hidden
            className="pointer-events-none absolute top-3 right-3 rounded-full px-2 py-0.5 text-[12px] font-medium tabular-nums text-white"
            // White on black at 60% reads at 5.7:1 or better over any photo, even pure white.
            style={{ background: "rgba(0,0,0,0.6)" }}
          >
            {index + 1}/{total}
          </span>
        ) : null}

        {index > 0 ? (
          <button
            type="button"
            onClick={() => go(index - 1)}
            aria-controls={id}
            aria-label="Previous slide"
            className="group absolute top-1/2 left-1 flex size-11 -translate-y-1/2 items-center justify-center"
          >
            <span className="flex size-8 items-center justify-center rounded-full bg-white/90 text-[#111418] shadow-sm transition-transform group-hover:scale-105 group-active:scale-95">
              <ChevronLeft aria-hidden className="size-4.5" strokeWidth={2.2} />
            </span>
          </button>
        ) : null}
        {index < total - 1 ? (
          <button
            type="button"
            onClick={() => go(index + 1)}
            aria-controls={id}
            aria-label="Next slide"
            className="group absolute top-1/2 right-1 flex size-11 -translate-y-1/2 items-center justify-center"
          >
            <span className="flex size-8 items-center justify-center rounded-full bg-white/90 text-[#111418] shadow-sm transition-transform group-hover:scale-105 group-active:scale-95">
              <ChevronRight aria-hidden className="size-4.5" strokeWidth={2.2} />
            </span>
          </button>
        ) : null}
      </div>

      {total > 1 ? (
        <div aria-hidden className="flex justify-center gap-1.5 pt-3">
          {slides.map((s, i) => (
            <span
              key={s.src}
              className={cx("size-1.5 rounded-full transition-[background-color,transform] duration-200", i === index ? "scale-110 bg-ink" : "bg-line-strong")}
            />
          ))}
        </div>
      ) : null}
      <p className="sr-only" aria-live="polite">
        Slide {index + 1} of {total}
      </p>

      <figcaption className="px-3.5 pt-2.5 pb-4 text-[13px] leading-[1.45]">
        <div className={cx("whitespace-pre-line", !open && long && "line-clamp-3")}>
          <span className="font-semibold">{handle ? handle.replace(/^@?/, "") : name}</span> {caption}
          {hashtags.length ? (
            <>
              {"\n"}
              <span className="text-muted">{hashtags.map((h) => `#${h}`).join(" ")}</span>
            </>
          ) : null}
        </div>
        {long ? (
          <button type="button" onClick={() => setOpen((o) => !o)} className="mt-0.5 inline-flex min-h-11 items-center text-[13px] text-muted hover:text-ink md:min-h-8">
            {open ? "Less" : "More"}
          </button>
        ) : null}
      </figcaption>
    </figure>
  );
}

