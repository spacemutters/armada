"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { REDUCE, loadVendor, useInView, useMedia, usePageVisible, type VantaEffect } from "./runtime";

/*
 * The sea under the fleet: the closing section's background is Vanta's rolling waves (Teng Bao, MIT,
 * drawn with three.js r134, MIT), in the page's own deep navy. It loads only when the section is about
 * to be seen, only on screens 768 px and wider, never with reduced motion or Save-Data, and only if
 * the browser can draw WebGL. It stops drawing when scrolled away or when the tab is hidden, and is
 * removed when the visitor leaves the page. Until (or unless) it loads, the section is a still
 * gradient of the same colours, so the words on top read the same either way.
 */

function canDraw(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

export function NightSea({ children }: { children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const sea = useRef<HTMLDivElement>(null);
  const fx = useRef<VantaEffect | null>(null);
  const reduce = useMedia(REDUCE);
  const wide = useMedia("(min-width: 768px)");
  const visible = usePageVisible();
  const near = useInView(box, { margin: "0px 0px 600px 0px" });
  const onScreen = useInView(box, { once: false });
  const [live, setLive] = useState(false);

  // Load and start once, when it first comes near.
  useEffect(() => {
    if (!near || reduce || !wide || fx.current) return;
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
    if (saveData || !canDraw()) return;
    let cancelled = false;
    loadVendor("vanta-waves.js")
      .then(() => {
        if (cancelled || !sea.current || !window.VANTA || !window.THREE) return;
        fx.current = window.VANTA.WAVES({
          el: sea.current,
          THREE: window.THREE,
          mouseControls: false,
          touchControls: false,
          gyroControls: false,
          minHeight: 200,
          minWidth: 200,
          scale: 1,
          scaleMobile: 1,
          color: 0x0d1a2c,
          shininess: 40,
          waveHeight: 17,
          waveSpeed: 0.42,
          zoom: 0.72,
        });
        setLive(true);
      })
      .catch(() => {
        // The still gradient stays.
      });
    return () => {
      cancelled = true;
    };
  }, [near, reduce, wide]);

  // Pause off screen and in hidden tabs (Vanta has no pause of its own: stop and restart its frame loop).
  useEffect(() => {
    const f = fx.current;
    if (!f || !live) return;
    const run = onScreen && visible && !reduce;
    if (run) {
      if (!f.req) {
        f.prevNow = 0;
        f.animationLoop();
      }
    } else {
      cancelAnimationFrame(f.req);
      f.req = 0;
    }
    if (box.current) box.current.dataset.running = run ? "yes" : "no";
  }, [onScreen, visible, reduce, live]);

  // Remove it when the visitor leaves, or when reduced motion is switched on.
  useEffect(() => {
    if (!reduce || !fx.current) return;
    fx.current.destroy();
    fx.current = null;
    setLive(false);
  }, [reduce]);
  useEffect(
    () => () => {
      fx.current?.destroy();
      fx.current = null;
    },
    [],
  );

  return (
    <div ref={box} className="mk-sea" data-live={live ? "" : undefined}>
      <div ref={sea} className="mk-sea-canvas" aria-hidden />
      <div className="mk-sea-shade" aria-hidden />
      <div className="mk-sea-content">{children}</div>
    </div>
  );
}
