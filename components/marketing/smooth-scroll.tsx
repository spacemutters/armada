"use client";

import { useEffect } from "react";
import { DESK, REDUCE, getGsap, loadVendor, setLenis, useMedia } from "./runtime";

/**
 * Weighted, smooth scrolling for the homepage (Lenis by darkroom.engineering, MIT), driven from
 * GSAP's clock so the scroll-driven showpiece reads the exact same scroll position every frame.
 * Only on wide screens with a mouse or trackpad, never on touch, never under reduced motion. It
 * waits until the browser is idle, so it never competes with the first paint, and it is removed
 * the moment the visitor leaves the page.
 */
export function SmoothScroll() {
  const desk = useMedia(DESK);
  const reduce = useMedia(REDUCE);

  useEffect(() => {
    if (!desk || reduce) return;
    let cancelled = false;
    let stop = () => {};
    const start = async () => {
      try {
        const [{ gsap, ScrollTrigger }] = await Promise.all([getGsap(), loadVendor("lenis.js")]);
        if (cancelled || !window.Lenis) return;
        const lenis = new window.Lenis({ autoRaf: false, anchors: true, lerp: 0.11, wheelMultiplier: 0.9 });
        const off = lenis.on("scroll", () => ScrollTrigger.update());
        const tick = (time: number) => lenis.raf(time * 1000);
        gsap.ticker.add(tick);
        gsap.ticker.lagSmoothing(0);
        setLenis(lenis);
        stop = () => {
          setLenis(null);
          gsap.ticker.remove(tick);
          off();
          lenis.destroy();
        };
      } catch {
        // Native scrolling is fine; nothing to tell the visitor.
      }
    };
    const idle = window.requestIdleCallback ? window.requestIdleCallback(start, { timeout: 1500 }) : window.setTimeout(start, 600);
    return () => {
      cancelled = true;
      if (window.cancelIdleCallback) window.cancelIdleCallback(idle);
      else window.clearTimeout(idle);
      stop();
    };
  }, [desk, reduce]);

  return null;
}
