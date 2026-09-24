"use client";

import { Dumbbell, Footprints, PanelTop } from "lucide-react";
import { Expand } from "@/components/fx";
import { SCORED, money, type ScoredProduct } from "./sample";

/*
 * Three products from the catalog with their 1–100 scores. Each opens to show how its score was
 * built: five parts, their weights, and whether each was measured or estimated. Measured parts are
 * drawn as solid bars and estimated ones as outlined, hatched bars, so the difference never rests on
 * colour.
 */

const ICONS = [Dumbbell, PanelTop, Footprints];

function Parts({ p }: { p: ScoredProduct }) {
  return (
    <ul className="mk-parts">
      {p.parts.map((part) => (
        <li key={part.name}>
          <span className="mk-part-name">
            {part.name} <span className="mk-muted mk-num">{part.weight}%</span>
          </span>
          <span className="mk-part-bar" data-measured={part.measured ? "" : undefined} aria-hidden>
            <span style={{ width: `${Math.round(part.value * 100)}%` }} />
          </span>
          <span className="mk-part-tag" data-measured={part.measured ? "" : undefined}>
            {part.measured ? "Measured" : "Estimated"}
          </span>
          <span className="mk-part-note mk-muted">{part.note}</span>
        </li>
      ))}
    </ul>
  );
}

export function ScoreDemo() {
  return (
    <div className="mk-panel mk-score-panel">
      <div className="mk-panel-bar">
        <span className="mk-panel-title">Products</span>
        <span className="mk-chip">Example</span>
        <span className="mk-panel-meta">Score · Price from your rule</span>
      </div>
      <ul className="mk-products">
        {SCORED.map((p, i) => {
          const Icon = ICONS[i];
          return (
            <li key={p.title}>
              <Expand
                defaultOpen={i === 0}
                buttonClassName="mk-product-row"
                summary={
                  <span className="mk-product">
                    <span className="mk-product-art" aria-hidden>
                      <Icon strokeWidth={1.6} />
                    </span>
                    <span className="mk-product-title">{p.title}</span>
                    <span className="mk-product-meta mk-muted">
                      Costs {money(p.landed)} delivered{p.shippingConfirmed ? "" : " (shipping estimated)"} · keeps about {money(p.keeps)} after fees
                      and ads
                    </span>
                    <span className="mk-product-score">
                      <span className="mk-score-n mk-num" data-band={p.band}>
                        {p.score}
                      </span>
                      <span className="mk-muted">{p.band}</span>
                    </span>
                    <span className="mk-product-price mk-num">{money(p.price)}</span>
                  </span>
                }
              >
                <Parts p={p} />
              </Expand>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
