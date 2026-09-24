import Link from "next/link";
import type { StoreTile } from "@/lib/fleet/queries";
import { formatMoney } from "@/lib/money";
import { cx } from "./ui";

// The signature element: every store as one tile. Brightness says how today compares with the
// store's usual day; a notch says it needs you; a round tile is an eBay account, a square one a
// Shopify store. No meaning rides on color alone.

type Level = "quiet" | "mid" | "busy" | "peak";

function level(t: StoreTile): Level {
  if (t.avgDayCents <= 0) return t.todayCents > 0 ? "busy" : "quiet";
  const ratio = t.todayCents / t.avgDayCents;
  return ratio < 0.5 ? "quiet" : ratio < 1.1 ? "mid" : ratio < 1.8 ? "busy" : "peak";
}

const FILL: Record<Level, string> = {
  quiet: "var(--tile-quiet)",
  mid: "var(--tile-mid)",
  busy: "var(--tile-busy)",
  peak: "var(--tile-peak)",
};

const WORD: Record<Level, string> = {
  quiet: "slower than usual",
  mid: "about usual",
  busy: "busier than usual",
  peak: "well above usual",
};

export function FleetMap({ tiles, size = "md" }: { tiles: StoreTile[]; size?: "md" | "lg" }) {
  const px = size === "lg" ? "size-11 md:size-9" : "size-11 md:size-7";
  const counts = tiles.reduce<Record<Level, number>>((acc, t) => ((acc[level(t)] += 1), acc), { quiet: 0, mid: 0, busy: 0, peak: 0 });
  return (
    <div>
      <ul className="flex flex-wrap gap-1.5" aria-label="Every store, by how today compares with its usual day">
        {tiles.map((t) => {
          const lv = level(t);
          const attention = t.status === "needs_attention" || t.status === "disconnected";
          return (
            <li key={t.id}>
              <Link
                href={`/stores/${t.id}`}
                title={`${t.name}: ${formatMoney(t.todayCents)} in the last day, ${WORD[lv]}${attention ? ". Needs you." : ""}`}
                aria-label={`${t.name}, ${t.platform === "ebay" ? "eBay" : "Shopify"}: ${formatMoney(t.todayCents)} in the last day, ${WORD[lv]}${attention ? ", needs you" : ""}`}
                className={cx("relative block transition-transform hover:scale-110", px, t.platform === "ebay" ? "rounded-full" : "rounded-[5px]")}
                style={{ background: FILL[lv] }}
              >
                {attention ? (
                  <span
                    aria-hidden
                    className="absolute -top-0.5 -right-0.5 size-3 bg-attention"
                    style={{ clipPath: "polygon(0 0, 100% 0, 100% 100%)", outline: "2px solid var(--raised)" }}
                  />
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px] text-muted">
        {(["quiet", "mid", "busy", "peak"] as Level[]).map((lv) => (
          <span key={lv} className="inline-flex items-center gap-1.5">
            <span aria-hidden className="size-3 rounded-[3px]" style={{ background: FILL[lv] }} />
            {WORD[lv].replace(/^./, (c) => c.toUpperCase())} ({counts[lv]})
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-3 rounded-full" style={{ background: "var(--tile-mid)" }} />
          eBay account
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="relative size-3 rounded-[3px]" style={{ background: "var(--tile-mid)" }}>
            <span className="absolute -top-0.5 -right-0.5 size-2 bg-attention" style={{ clipPath: "polygon(0 0, 100% 0, 100% 100%)" }} />
          </span>
          Needs you
        </span>
      </div>
    </div>
  );
}
