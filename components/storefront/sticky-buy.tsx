"use client";

import { useEffect, useRef, useState } from "react";
import { addToBag, type BagLine } from "./cart-store";
import { countVisit } from "./visit";

/**
 * Phones only: once the product page's own "Add to bag" button has scrolled out of view, this bar
 * keeps the product, its price and the button within thumb reach. It steps aside at the footer so
 * the footer's last lines are never covered. `targetId` is the id of the main button's wrapper.
 */
export function StickyBuy({ slug, line, price, targetId }: { slug: string; line: Omit<BagLine, "qty">; price: string; targetId: string }) {
  const [shown, setShown] = useState(false);
  const [added, setAdded] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const target = document.getElementById(targetId);
    const footer = document.querySelector("footer");
    if (!target || typeof IntersectionObserver === "undefined") return;
    let pastButton = false;
    let atFooter = false;
    const update = () => setShown(pastButton && !atFooter);
    const buttonWatch = new IntersectionObserver(([e]) => {
      // Only once the button has gone off the top: above it, the page's own button is still ahead.
      pastButton = !e.isIntersecting && e.boundingClientRect.top < 0;
      update();
    });
    buttonWatch.observe(target);
    const footerWatch = footer
      ? new IntersectionObserver(([e]) => {
          atFooter = e.isIntersecting;
          update();
        })
      : null;
    if (footer) footerWatch?.observe(footer);
    return () => {
      buttonWatch.disconnect();
      footerWatch?.disconnect();
    };
  }, [targetId]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return (
    <div className="sf-sticky-buy" data-shown={shown ? "true" : "false"} inert={!shown} aria-hidden={!shown}>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-medium">{line.title}</p>
        <p className="sf-muted text-[14px] tabular-nums">{price}</p>
      </div>
      <button
        className="sf-button shrink-0"
        onClick={() => {
          addToBag(slug, line);
          countVisit(slug, "add");
          setAdded(true);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => setAdded(false), 1600);
        }}
      >
        <span aria-live="polite">{added ? "Added" : "Add to bag"}</span>
      </button>
    </div>
  );
}
