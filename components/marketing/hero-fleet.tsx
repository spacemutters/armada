"use client";

import { useEffect, useRef } from "react";
import { RollingNumber } from "@/components/fx";
import { FleetGrid, FleetLegend, fleetWords } from "./fleet";
import { REDUCE, useInView, useMedia, usePageVisible } from "./runtime";
import { FLEET, FLEET_SUMMARY, money, type Level } from "./sample";

const LEVELS: Level[] = ["quiet", "mid", "busy", "peak"];

/**
 * The hero's picture of the product: an example fleet, drawn the way the app draws it. While it is on
 * screen, a tile now and then drifts to a new brightness, the way the real map changes through a day.
 * Nothing moves offscreen, in a hidden tab, or under reduced motion.
 */
export function HeroFleet() {
  const box = useRef<HTMLDivElement>(null);
  const reduce = useMedia(REDUCE);
  const visible = usePageVisible();
  const onScreen = useInView(box, { once: false });

  useEffect(() => {
    const el = box.current;
    if (!el || reduce || !visible || !onScreen) return;
    const tiles = Array.from(el.querySelectorAll<HTMLElement>(".mk-tile:not([data-needs])"));
    let k = 0;
    const id = window.setInterval(() => {
      // A fixed walk through the map, so it never looks random-noisy: one tile every 2.4 s.
      k = (k + 37) % tiles.length;
      const t = tiles[k];
      const now = LEVELS.indexOf(t.dataset.level as Level);
      const next = now <= 0 ? 1 : now >= 3 ? 2 : now + (k % 2 ? 1 : -1);
      t.dataset.level = LEVELS[next];
    }, 2400);
    return () => window.clearInterval(id);
  }, [reduce, visible, onScreen]);

  return (
    <figure className="mk-panel mk-hero-panel" ref={box}>
      <div className="mk-panel-bar">
        <span className="mk-panel-title">Your fleet</span>
        <span className="mk-chip">Example</span>
        <span className="mk-panel-meta mk-num">
          <RollingNumber value={FLEET_SUMMARY.stores} rollIn /> stores
          <span aria-hidden> · </span>
          <RollingNumber value={money(FLEET_SUMMARY.soldYesterday * 100, true)} rollIn /> sold yesterday
          <span aria-hidden className="mk-hide-sm">
            {" "}
            ·{" "}
          </span>
          <span className="mk-hide-sm">
            <RollingNumber value={FLEET_SUMMARY.needsYou} rollIn /> need you
          </span>
        </span>
      </div>
      <FleetGrid className="mk-fleet-hero" cols={16} label={fleetWords(FLEET)} />
      <FleetLegend />
      <figcaption className="mk-caption">
        An example practice fleet. Each tile is one store: square for a Shopify store, round for an eBay account. Brighter means busier than that
        store&apos;s usual day, and a notch means it needs you.
      </figcaption>
    </figure>
  );
}
