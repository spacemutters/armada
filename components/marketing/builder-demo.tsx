"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { BorderBeam, DecodeText, ProgressBar, RollingNumber, ShimmerText, StatusText, ThinkingOrb, Tick, type OrbState } from "@/components/fx";
import { REDUCE, useInViewEvent, useMedia } from "./runtime";

const prefersReduced = () => window.matchMedia(REDUCE).matches;
import { BUILT_SHOP } from "./sample";

/*
 * The shop builder at work, replayed much faster than life: the same three steps, wording and effects
 * as the app's build page (the orb, the light round the running step, the shimmer, the ticks, the
 * brand name decoding), then the brand, the look, the products and the pages arriving in turn.
 * It opens finished (so the page reads fully without scripts), resets just before it scrolls into
 * view, and plays once when it is on screen. Under reduced motion it stays finished until Play.
 */

type StepState = "waiting" | "running" | "done";
interface Run {
  steps: StepState[];
  status: string;
  orb: OrbState;
  brand: boolean;
  products: number;
  pages: boolean;
  playing: boolean;
  /** 0..1 of the steps finished, for the progress bar. */
  value: number;
  started: number;
}

const FINISHED: Run = {
  steps: ["done", "done", "done"],
  status: "Ready to open",
  orb: "done",
  brand: true,
  products: BUILT_SHOP.products,
  pages: true,
  playing: false,
  value: 1,
  started: 0,
};
const ARMED: Run = {
  steps: ["waiting", "waiting", "waiting"],
  status: "Ready",
  orb: "idle",
  brand: false,
  products: 0,
  pages: false,
  playing: false,
  value: 0,
  started: 0,
};

// The script: [ms from start, change].
type Ev = [number, (r: Run) => Run];
const S = BUILT_SHOP.status;
const SCRIPT: Ev[] = [
  [0, (r) => ({ ...r, playing: true, started: Date.now(), steps: ["running", "waiting", "waiting"], orb: "thinking", status: S[0][0] })],
  [900, (r) => ({ ...r, status: S[0][1] })],
  [1800, (r) => ({ ...r, status: S[0][2], orb: "shaping" })],
  [2700, (r) => ({ ...r, steps: ["done", "running", "waiting"], brand: true, value: 1 / 3, orb: "searching", status: S[1][0] })],
  [3600, (r) => ({ ...r, status: S[1][1], products: 5 })],
  [4500, (r) => ({ ...r, status: S[1][2], orb: "composing", products: 9 })],
  [5500, (r) => ({ ...r, steps: ["done", "done", "running"], products: BUILT_SHOP.products, value: 2 / 3, orb: "composing", status: S[2][0] })],
  [6500, (r) => ({ ...r, status: S[2][1] })],
  [7600, (r) => ({ ...r, steps: ["done", "done", "done"], pages: true, value: 1, orb: "done", status: "Ready to open", playing: false })],
];

export function BuilderDemo() {
  const reduce = useMedia(REDUCE);
  const [run, setRun] = useState<Run>(FINISHED);
  const [justDone, setJustDone] = useState<boolean[]>([false, false, false]);
  const current = useRef<Run>(FINISHED);
  const box = useRef<HTMLDivElement>(null);
  const timers = useRef<number[]>([]);
  const played = useRef(false);

  const clear = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  const apply = useCallback((next: Run) => {
    const prev = current.current;
    current.current = next;
    setRun(next);
    setJustDone(next.steps.map((s, i) => s === "done" && prev.steps[i] !== "done"));
  }, []);

  const play = useCallback(() => {
    clear();
    apply(ARMED);
    for (const [ms, fn] of SCRIPT) timers.current.push(window.setTimeout(() => apply(fn(current.current)), ms + 350));
  }, [apply]);
  useEffect(() => clear, []);

  // Arm just before it comes on screen, play once it is well in view.
  useInViewEvent(box, { margin: "0px 0px 240px 0px" }, (inside) => {
    if (inside && !played.current && !prefersReduced()) apply(ARMED);
  });
  useInViewEvent(box, { threshold: 0.45 }, (inside) => {
    if (inside && !played.current && !prefersReduced()) {
      played.current = true;
      play();
    }
  });

  const building = run.playing;
  const sh = BUILT_SHOP;
  const shopVars = {
    "--s-page": sh.palette[0].hex,
    "--s-card": sh.palette[1].hex,
    "--s-ink": sh.palette[2].hex,
    "--s-quiet": sh.palette[3].hex,
    "--s-button": sh.palette[4].hex,
  } as CSSProperties;

  return (
    <div ref={box} className="mk-builder">
      <div className="mk-panel mk-builder-panel" data-building={building ? "" : undefined}>
        <div className="mk-panel-bar">
          <span className="mk-panel-title">Shop builder</span>
          <span className="mk-builder-status">
            <ThinkingOrb state={run.orb} size={20} decorative />
            <StatusText text={run.status} shimmer={building} />
          </span>
        </div>

        <div className="mk-prompt">
          <span className="mk-prompt-label">Your idea</span>
          <span className="mk-prompt-text">&ldquo;{sh.idea}&rdquo;</span>
          <button type="button" className="mk-btn mk-btn-primary mk-btn-sm" onClick={play} disabled={building}>
            {building ? "Building…" : run.value === 1 ? "Build it again" : "Build the shop"}
          </button>
        </div>

        <ProgressBar
          value={run.value}
          creepTo={Math.min(1, run.value + 1 / 3)}
          since={run.started || undefined}
          expected={2600}
          status={building ? "running" : run.value === 1 ? "done" : "idle"}
          label="Building the shop"
          className="mk-builder-progress"
        />

        <ol className="mk-build-steps">
          {sh.steps.map((s, i) => {
            const st = run.steps[i];
            return (
              <li key={s.label} data-state={st}>
                <BorderBeam active={st === "running"} size="md" tone="mono" radius={10} strength={0.9}>
                  <div className="mk-build-row">
                    <span className="mk-build-mark" aria-hidden>
                      {st === "done" ? <Tick size={20} look="filled" draw={justDone[i]} /> : <span className="mk-build-n mk-num">{i + 1}</span>}
                    </span>
                    <span className="mk-build-label">
                      <ShimmerText active={st === "running"}>{s.label}</ShimmerText>
                    </span>
                    <span className="mk-build-time mk-num">{st === "done" ? s.took : st === "running" ? "working" : "next"}</span>
                  </div>
                </BorderBeam>
              </li>
            );
          })}
        </ol>

        <div className="mk-shop" data-ready={run.brand ? "" : undefined} style={shopVars}>
          <div className="mk-shop-brand">
            <span className="mk-shop-mono" aria-hidden>
              {sh.brand.slice(0, 1)}
            </span>
            <div className="mk-shop-name-wrap">
              <p className="mk-shop-name">
                <span className="mk-muted">The brand is </span>
                {run.brand ? (
                  <DecodeText text={sh.brand} onMount duration={900} className="mk-shop-brandname" />
                ) : (
                  <span className="mk-skel mk-skel-word" aria-label="not named yet" />
                )}
              </p>
              <p className="mk-shop-tag mk-muted">{run.brand ? sh.tagline : " "}</p>
            </div>
          </div>

          <div className="mk-shop-look">
            <ul className="mk-swatches" aria-label="Palette">
              {sh.palette.map((p) => (
                <li key={p.role} title={`${p.role} ${p.hex}`}>
                  <span className="mk-swatch" style={{ background: p.hex }} aria-hidden />
                  <span className="mk-sr">
                    {p.role} {p.hex}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mk-shop-fonts mk-muted">
              Headings in <span className="mk-ink">{sh.fonts.display}</span>, text in <span className="mk-ink">{sh.fonts.body}</span>
            </p>
          </div>

          <div className="mk-shop-front" aria-label={`Preview of ${sh.brand}'s home page`} role="img">
            <div className="mk-shop-front-bar">
              <span className="mk-shop-front-brand">{sh.brand}</span>
              <span className="mk-shop-front-nav" aria-hidden>
                Shop <span>About</span>
              </span>
            </div>
            <p className="mk-shop-front-h">{sh.headline}</p>
            <p className="mk-shop-front-sub">{sh.subhead}</p>
            <span className="mk-shop-front-btn">{sh.cta}</span>
          </div>

          <div className="mk-shop-facts">
            <p className="mk-num">
              <RollingNumber value={run.products} /> products · {run.products ? sh.collections.length : 0} collections
            </p>
            <ul className="mk-chips" data-ready={run.products ? "" : undefined}>
              {sh.collections.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <p className="mk-shop-pages mk-muted" data-ready={run.pages ? "" : undefined}>
              About · Questions and answers · Shipping and returns · Contact · Refund and shipping policies, as drafts
            </p>
          </div>
        </div>
      </div>
      <p className="mk-caption">
        A shop the builder made in Armada&apos;s own tests, replayed much faster than life. A real build takes about 2 to 4 minutes.
        {reduce ? (
          <>
            {" "}
            <button type="button" className="mk-link" onClick={play} disabled={building}>
              Watch it build
            </button>
          </>
        ) : null}
      </p>
    </div>
  );
}
