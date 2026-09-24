"use client";

import Link from "next/link";
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { cx } from "./cx";
import { prefersReducedMotion } from "./motion";
import { RollingNumber } from "./rolling-number";
import styles from "./fx.module.css";

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const EASE = "cubic-bezier(0.3, 0, 0.2, 1)";

function boxOf(el: Element, root: HTMLElement): Box {
  const r = el.getBoundingClientRect();
  const p = root.getBoundingClientRect();
  return { x: r.left - p.left - root.clientLeft + root.scrollLeft, y: r.top - p.top - root.clientTop + root.scrollTop, w: r.width, h: r.height };
}
const frame = (b: Box) => ({ left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px` });

/**
 * Slides a highlight to the chosen item (the motion kit's tab bar). The container holds one element
 * marked `data-glide-ind` and items marked `data-glide-key`; an item may mark a child
 * `data-glide-target` to size the highlight to that child instead (an icon, say).
 * With no chosen item the highlight fades away. Under reduced motion it moves at once.
 * Returns the ref to put on the container.
 */
export function useGlide<T extends HTMLElement = HTMLElement>(active: string | null, { stretch = true, duration = 320 } = {}) {
  const root = useRef<T>(null);
  const last = useRef<Box | null>(null);
  const anim = useRef<Animation | null>(null);

  useLayoutEffect(() => {
    const el = root.current;
    const ind = el?.querySelector<HTMLElement>(":scope > [data-glide-ind]");
    if (!el || !ind) return;
    const find = () => {
      if (active == null) return null;
      const item = Array.from(el.querySelectorAll<HTMLElement>("[data-glide-key]")).find((n) => n.dataset.glideKey === active);
      return item ? (item.querySelector("[data-glide-target]") ?? item) : null;
    };
    const target = find();
    if (!target) {
      delete ind.dataset.on;
      el.dataset.ready = "";
      return;
    }
    const to = boxOf(target, el);
    const from = ind.dataset.on !== undefined ? last.current : null;
    anim.current?.cancel();
    Object.assign(ind.style, frame(to));
    ind.dataset.on = "";
    el.dataset.ready = "";
    if (from && !prefersReducedMotion() && (Math.abs(from.x - to.x) > 0.5 || Math.abs(from.y - to.y) > 0.5 || Math.abs(from.w - to.w) > 0.5)) {
      let keys: Box[] = [from, to];
      if (stretch) {
        // Reach across to the new item first, then let go of the old one.
        const x = Math.min(from.x, to.x);
        const y = Math.min(from.y, to.y);
        keys = [from, { x, y, w: Math.max(from.x + from.w, to.x + to.w) - x, h: Math.max(from.y + from.h, to.y + to.h) - y }, to];
      }
      anim.current = ind.animate(keys.map(frame), { duration, easing: EASE });
    }
    last.current = to;

    // Keep it fitted when the items change size (fonts arriving, a narrower window).
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => {
      const t = find();
      if (!t || anim.current?.playState === "running") return;
      const b = boxOf(t, el);
      Object.assign(ind.style, frame(b));
      last.current = b;
    }) : null;
    ro?.observe(el);
    el.querySelectorAll("[data-glide-key]").forEach((n) => ro?.observe(n));
    return () => ro?.disconnect();
  }, [active, stretch, duration]);
  return root;
}

export interface SegmentedNavItem {
  key: string;
  href: string;
  label: ReactNode;
  /** A number shown after the label, e.g. how many orders are in that list. It rolls when it changes. */
  count?: number;
}

/** Links shown as one segmented control, with the highlight sliding to the page you picked. */
export function SegmentedNav({ items, active, label, className }: { items: SegmentedNavItem[]; active: string; label: string; className?: string }) {
  const root = useGlide<HTMLElement>(active);
  return (
    <nav ref={root} aria-label={label} className={cx(styles.glide, "relative flex flex-wrap gap-1 rounded-xl border border-line bg-raised p-1 text-[14px]", className)}>
      <span data-glide-ind="" aria-hidden className={cx(styles.glideInd, "rounded-lg bg-sunken")} />
      {items.map((t) => {
        const on = t.key === active;
        return (
          <Link
            key={t.key}
            href={t.href}
            data-glide-key={t.key}
            data-glide-on={on ? "" : undefined}
            aria-current={on ? "page" : undefined}
            className={cx("flex min-h-11 items-center gap-2 rounded-lg px-4 transition-colors md:min-h-9", on ? "font-semibold text-ink" : "text-muted hover:text-ink")}
          >
            {t.label}
            {t.count != null ? <RollingNumber value={t.count} className="text-[12px] text-muted" /> : null}
          </Link>
        );
      })}
    </nav>
  );
}
