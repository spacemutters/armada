import type { CSSProperties } from "react";
import { FLEET, LEVEL_WORD, type Level, type SampleStore } from "./sample";

// The fleet map, drawn the way the app draws it (components/fleet-map.tsx): one tile per store,
// brightness for how today compares with that store's usual day, a round tile for an eBay account and a
// square one for a Shopify store, a notch for "needs you". Here it is a picture of the product, so it is
// one image to a screen reader, described in words.

type Vars = CSSProperties & Record<`--${string}`, string | number>;

export function FleetGrid({
  stores = FLEET,
  cols = 12,
  label,
  className,
  sweep = false,
}: {
  stores?: SampleStore[];
  cols?: number;
  label: string;
  className?: string;
  /** Give each store in the price change a point (0..1) where the change lands on it, left to right. */
  sweep?: boolean;
}) {
  const rows = Math.ceil(stores.length / cols);
  return (
    <div className={`mk-fleet ${className ?? ""}`} role="img" aria-label={label} style={{ "--cols": cols } as Vars}>
      {stores.map((s, i) => {
        const r = Math.floor(i / cols);
        const c = i % cols;
        const style: Vars = { "--r": r, "--c": c };
        // Land between 0 and 0.88 of the sweep, so the last store is fully changed before the sweep ends.
        if (sweep && s.inChange) style["--t"] = ((0.88 * (c + r * 0.4)) / (cols - 1 + (rows - 1) * 0.4)).toFixed(3);
        return (
          <span
            key={s.id}
            className="mk-tile"
            data-level={s.level}
            data-platform={s.platform}
            data-needs={s.needsYou ? "" : undefined}
            data-change={s.inChange ? "" : undefined}
            style={style}
          >
            {s.needsYou ? <i className="mk-notch" /> : null}
          </span>
        );
      })}
    </div>
  );
}

export function FleetLegend({ stores = FLEET }: { stores?: SampleStore[] }) {
  const count = (lv: Level) => stores.filter((s) => s.level === lv).length;
  return (
    <ul className="mk-legend" aria-label="What the tiles mean">
      {(["quiet", "mid", "busy", "peak"] as Level[]).map((lv) => (
        <li key={lv}>
          <span aria-hidden className="mk-key" data-level={lv} />
          {LEVEL_WORD[lv]} <span className="mk-num">({count(lv)})</span>
        </li>
      ))}
      <li>
        <span aria-hidden className="mk-key" data-level="mid" data-platform="ebay" />
        eBay account
      </li>
      <li>
        <span aria-hidden className="mk-key" data-level="mid">
          <i className="mk-notch" />
        </span>
        Needs you
      </li>
    </ul>
  );
}

export function fleetWords(stores: SampleStore[] = FLEET): string {
  const ebay = stores.filter((s) => s.platform === "ebay").length;
  const n = (lv: Level) => stores.filter((s) => s.level === lv).length;
  return (
    `Example fleet map of ${stores.length} stores: ${stores.length - ebay} Shopify stores and ${ebay} eBay accounts. ` +
    `${n("peak")} well above their usual day, ${n("busy")} busier than usual, ${n("mid")} about usual, ${n("quiet")} slower than usual. ` +
    `${stores.filter((s) => s.needsYou).length} need you.`
  );
}
