"use client";

import { useEffect, useRef, useState } from "react";
import { RollingNumber, ShimmerText, useGlide } from "@/components/fx";
import { REDUCE, useInViewEvent } from "./runtime";
import { HEADLINE_TEST } from "./sample";

/*
 * A headline test, the way the app runs one: the AI writes three new versions, you pick one (and may
 * edit it), half the visitors see it, and the results say which gets more people to add something to
 * their bag. The three versions arrive one by one when the demo comes into view, the pick glides to
 * the first, and the numbers roll in. Pick another version to see it in B. Under reduced motion it
 * opens with everything in place.
 */

type Phase = "writing" | 1 | 2 | 3 | "picked" | "results";
const T = HEADLINE_TEST;
const pct = (adds: number, visitors: number) => ((adds / visitors) * 100).toFixed(1) + "%";

function Front({
  side,
  brand,
  copy,
  label,
}: {
  side: "a" | "b";
  brand: string;
  copy: { headline: string; subhead: string; cta: string };
  label: string;
}) {
  return (
    <figure className="mk-ab" data-side={side}>
      <figcaption>
        <span className="mk-ab-badge" aria-hidden>
          {side.toUpperCase()}
        </span>
        {label}
      </figcaption>
      <div className="mk-ab-front">
        <div className="mk-ab-bar">
          <span className="mk-ab-brand">{brand}</span>
          <span className="mk-ab-nav" aria-hidden>
            Shop <span>About</span>
          </span>
        </div>
        <p className="mk-ab-h">{copy.headline}</p>
        <p className="mk-ab-sub">{copy.subhead}</p>
        <span className="mk-ab-btn">{copy.cta}</span>
      </div>
    </figure>
  );
}

export function TestDemo() {
  const box = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>("results");
  const [pick, setPick] = useState(0);
  const played = useRef(false);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // Clear the versions just before it comes on screen, then write them once it is in view.
  useInViewEvent(box, { margin: "0px 0px 240px 0px" }, (inside) => {
    if (inside && !played.current && !window.matchMedia(REDUCE).matches) setPhase("writing");
  });
  useInViewEvent(box, { threshold: 0.35 }, (inside) => {
    if (!inside || played.current || window.matchMedia(REDUCE).matches) return;
    played.current = true;
    const steps: [number, Phase][] = [
      [0, "writing"],
      [1100, 1],
      [1700, 2],
      [2300, 3],
      [3200, "picked"],
      [4300, "results"],
    ];
    timers.current = steps.map(([ms, ph]) => window.setTimeout(() => setPhase(ph), ms));
  });

  const shown = phase === "writing" ? 0 : typeof phase === "number" ? phase : 3;
  const picked = phase === "picked" || phase === "results";
  const results = phase === "results";
  const chosen = T.candidates[pick];
  const list = useGlide<HTMLDivElement>(picked ? String(pick) : null, { stretch: true, duration: 340 });

  return (
    <div ref={box} className="mk-panel mk-test-panel">
      <div className="mk-panel-bar">
        <span className="mk-panel-title">Headline test · {T.brand}</span>
        <span className="mk-chip">Example</span>
      </div>

      <div className="mk-test-write">
        <p className="mk-test-label">
          {shown < 3 ? <ShimmerText active>Writing three new versions</ShimmerText> : <span>Written by AI. Choose one to test.</span>}
        </p>
        <div ref={list} className="mk-glide">
          <span data-glide-ind="" aria-hidden className="mk-cands-ind" />
          <ul className="mk-cands" aria-label="New versions to test">
            {T.candidates.map((c, i) => (
              <li key={c.headline} data-shown={i < shown ? "" : undefined}>
                <button
                  type="button"
                  data-glide-key={String(i)}
                  data-glide-on={picked && pick === i ? "" : undefined}
                  aria-pressed={picked && pick === i}
                  disabled={i >= shown}
                  onClick={() => {
                    played.current = true;
                    timers.current.forEach(clearTimeout);
                    setPick(i);
                    setPhase("results");
                  }}
                >
                  <span className="mk-cand-h">{c.headline}</span>
                  <span className="mk-cand-idea mk-muted">{c.idea}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mk-ab-pair">
        <Front side="a" brand={T.brand} copy={T.original} label="The original" />
        <Front side="b" brand={T.brand} copy={picked ? chosen : T.original} label="The new version" />
      </div>

      <div className="mk-results" data-on={results ? "" : undefined}>
        <p className="mk-results-head">
          {pick === 0 ? T.verdict : "Too early to tell. Each version needs at least 100 visitors before the numbers mean anything."}
        </p>
        <dl className="mk-rates">
          {(
            [
              ["The original", T.a],
              ["The new version", T.b],
            ] as const
          ).map(([name, side], i) => {
            const on = results && pick === 0;
            const rate = on ? side.adds / side.visitors : 0;
            return (
              <div key={name} className="mk-rate" data-b={i === 1 ? "" : undefined}>
                <dt>{name}</dt>
                <dd className="mk-rate-bar" aria-hidden>
                  <span style={{ transform: `scaleX(${Math.min(1, rate / 0.07)})` }} />
                </dd>
                <dd className="mk-rate-n mk-num">
                  <strong>
                    <RollingNumber value={on ? pct(side.adds, side.visitors) : "0.0%"} />
                  </strong>{" "}
                  added to bag · {on ? side.adds : 0} of {on ? side.visitors.toLocaleString("en-US") : 0} visitors
                </dd>
              </div>
            );
          })}
        </dl>
        <p className="mk-chance">
          Chance the new version is really better:{" "}
          <strong className="mk-num">{results && pick === 0 ? <RollingNumber value={`${T.chancePercent}%`} /> : "not enough visitors yet"}</strong>
          <span className="mk-muted"> A winner is called at 95% either way.</span>
        </p>
      </div>
    </div>
  );
}
