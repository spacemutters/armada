"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { HoldButton, ProgressBar, RollingNumber, StatusText, UndoToast, useGlide } from "@/components/fx";
import { FleetGrid } from "./fleet";
import { DESK, REDUCE, getGsap, scrollPageTo, useInView, useMedia } from "./runtime";
import { CHANGE, FLEET, money } from "./sample";

/*
 * The page's one signature moment. A price change goes out to a fleet: chosen, previewed, applied
 * store by store as the map lights up, then undone. On a wide screen with a mouse it follows the
 * scroll (GSAP's ScrollTrigger, smoothed, the section held in place with position: sticky). On a
 * phone, a tablet, or with reduced motion it is a four-step stepper you tap through, and the demo's own
 * buttons work too. The wording and the controls match the app's Changes pages: "Approve and apply" is
 * the same press-and-hold button, and the same undo note slides up once the change is applied.
 */

const STEPS = [
  { title: "Say what to change", body: "Tick products, then say it once: raise every price 8%. Prices keep their .99 endings." },
  { title: "See every change first", body: "Armada works out the new price in every store and lists them all. Nothing has changed yet." },
  {
    title: "Approve, and it goes out",
    body: `One press applies all ${CHANGE.listings} changes across ${CHANGE.stores} stores, and the map shows each store as it lands.`,
  },
  {
    title: "Put it back any time",
    body: "Every change saves what was there before. One press undoes the lot, and the Changes page keeps the record.",
  },
];

type Step = 0 | 1 | 2 | 3;
// Where each step starts on the way through the section (scroll mode).
const AT = [0, 0.2, 0.42, 0.76];
const SWEEP_FROM = 0.45;
const SWEEP_TO = 0.72;
const MORE = CHANGE.listings - CHANGE.rows.length;

function stepAt(p: number): Step {
  return p >= AT[3] ? 3 : p >= AT[2] ? 2 : p >= AT[1] ? 1 : 0;
}
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
// Changes counted in eights, so the counter rolls in steps you can read.
const doneOf = (sweep: number) => Math.min(CHANGE.listings, Math.round((sweep * CHANGE.listings) / 8) * 8);

export function ChangeSequence() {
  const desk = useMedia(DESK);
  const reduce = useMedia(REDUCE);
  const scrollMode = desk && !reduce;

  const [step, setStep] = useState<Step>(0);
  const [done, setDone] = useState(0);
  const [undone, setUndone] = useState(false);
  const [round, setRound] = useState(0);
  const track = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const stepRef = useRef<Step>(0);
  const auto = useRef(true);

  const setSweep = useCallback((sweep: number) => {
    panel.current?.style.setProperty("--p", sweep.toFixed(4));
    setDone(doneOf(sweep));
  }, []);

  const show = useCallback((s: Step) => {
    if (s !== stepRef.current) setUndone(false);
    if (s < 2 && stepRef.current >= 2) setRound((n) => n + 1);
    stepRef.current = s;
    setStep(s);
  }, []);

  // Scroll mode makes this section taller once the page is live. If the visitor arrived on a link to a
  // section further down (#tests, say), keep them there instead of letting the page shift under them.
  useEffect(() => {
    if (!scrollMode || !location.hash) return;
    const target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (target && track.current && target.compareDocumentPosition(track.current) & Node.DOCUMENT_POSITION_PRECEDING) {
      requestAnimationFrame(() => target.scrollIntoView());
    }
  }, [scrollMode]);

  // ---- scroll mode: GSAP reads the scroll, smoothed, and drives step and sweep ----
  useEffect(() => {
    if (!scrollMode || !track.current) return;
    let tl: { kill(): void; scrollTrigger?: { kill(): void } } | null = null;
    let cancelled = false;
    getGsap()
      .then(({ gsap, ScrollTrigger }) => {
        if (cancelled || !track.current) return;
        const state = { p: 0 };
        const t = gsap.timeline({
          scrollTrigger: { trigger: track.current, start: "top top", end: "bottom bottom", scrub: 0.6 },
        });
        t.to(state, {
          p: 1,
          ease: "none",
          duration: 1,
          onUpdate: () => {
            const s = stepAt(state.p);
            if (s !== stepRef.current) show(s);
            setSweep(clamp01((state.p - SWEEP_FROM) / (SWEEP_TO - SWEEP_FROM)));
          },
        });
        tl = t as unknown as typeof tl;
        ScrollTrigger.refresh();
      })
      .catch(() => {
        // Without GSAP the stepper below still works; the sticky stage simply shows step one.
      });
    return () => {
      cancelled = true;
      tl?.scrollTrigger?.kill();
      tl?.kill();
    };
  }, [scrollMode, setSweep, show]);

  // ---- stepper mode: the sweep plays over 1.6 s when step 3 is reached ----
  const sweepAnim = useRef(0);
  const playSweep = useCallback(() => {
    cancelAnimationFrame(sweepAnim.current);
    if (window.matchMedia(REDUCE).matches) {
      setSweep(1);
      return;
    }
    const start = performance.now();
    const frame = (now: number) => {
      const x = clamp01((now - start) / 1600);
      setSweep(x * x * (3 - 2 * x));
      if (x < 1) sweepAnim.current = requestAnimationFrame(frame);
    };
    sweepAnim.current = requestAnimationFrame(frame);
  }, [setSweep]);
  useEffect(() => () => cancelAnimationFrame(sweepAnim.current), []);

  const go = useCallback(
    (s: Step, fromUser = true) => {
      if (fromUser) auto.current = false;
      if (scrollMode && track.current) {
        // Scroll to the middle of that step's stretch; the scroll then sets the step.
        const rect = track.current.getBoundingClientRect();
        const span = track.current.offsetHeight - window.innerHeight;
        const mid = s === 3 ? 0.9 : s === 2 ? SWEEP_TO + 0.01 : (AT[s] + AT[s + 1]) / 2;
        scrollPageTo(window.scrollY + rect.top + span * mid);
        return;
      }
      show(s);
      if (s === 2) playSweep();
      else setSweep(s === 3 ? 1 : 0);
    },
    [scrollMode, show, playSweep, setSweep],
  );

  // In stepper mode, open the preview once it first comes into view (not under reduced motion), then
  // wait there, as the app does: nothing goes out until the visitor holds "Approve and apply".
  const seen = useInView(panel, { threshold: 0.5 });
  useEffect(() => {
    if (scrollMode || reduce || !seen || !auto.current) return;
    const t = window.setTimeout(() => auto.current && go(1, false), 900);
    return () => clearTimeout(t);
  }, [scrollMode, reduce, seen, go]);

  const steps = useGlide<HTMLDivElement>(String(step), { stretch: true, duration: 360 });
  // "On screen" means the panel crosses the middle of the window, so the undo note leaves with it.
  const onScreen = useInView(panel, { once: false, margin: "-45% 0px -45% 0px" });

  // When stepper mode reaches step 3 by the sweep finishing, move on.
  useEffect(() => {
    if (!scrollMode && step === 2 && done === CHANGE.listings) {
      const t = window.setTimeout(() => stepRef.current === 2 && show(3), 700);
      return () => clearTimeout(t);
    }
  }, [scrollMode, step, done, show]);

  const status = undone
    ? { tone: "off", text: "Undone" }
    : step === 0
      ? { tone: "off", text: "Not started" }
      : step === 1
        ? { tone: "attention", text: "Waiting for you" }
        : step === 2 && done < CHANGE.listings
          ? { tone: "working", text: "Running" }
          : { tone: "ok", text: "Done" };

  const rowState = (i: number) => {
    if (undone) return "back";
    if (step === 0) return "none";
    if (step === 1) return "waiting";
    if (step === 3) return "done";
    return done >= ((i + 1) / CHANGE.rows.length) * CHANGE.listings * 0.9 ? "done" : "waiting";
  };

  return (
    <section id="how-it-works" className="mk-change" aria-labelledby="mk-change-title" data-scroll={scrollMode ? "" : undefined}>
      <div ref={track} className="mk-change-track">
        <div className="mk-change-stage">
          <div className="mk-wrap mk-change-grid">
            <div className="mk-change-copy">
              <p className="mk-eyebrow">Changes</p>
              <h2 id="mk-change-title" className="mk-h1">
                Change a hundred stores as carefully as one.
              </h2>
              <div ref={steps} className="mk-glide mk-steps-wrap">
                <span data-glide-ind="" aria-hidden className="mk-steps-ind" />
                <ol className="mk-steps" aria-label="How a change goes out">
                  {STEPS.map((s, i) => (
                    <li key={s.title} data-on={i === step ? "" : undefined} data-past={i < step ? "" : undefined}>
                      <button
                        type="button"
                        onClick={() => go(i as Step)}
                        aria-current={i === step ? "step" : undefined}
                        data-glide-key={String(i)}
                        data-glide-on={i === step ? "" : undefined}
                      >
                        <span className="mk-step-n mk-num" aria-hidden>
                          {i + 1}
                        </span>
                        <span className="mk-step-text">
                          <span className="mk-step-title">{s.title}</span>
                          <span className="mk-step-body">{s.body}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
              </div>
            </div>

            <div
              ref={panel}
              className="mk-panel mk-change-panel"
              data-step={undone ? "undone" : step}
              style={{ "--p": 0 } as CSSProperties}
              aria-label="Example: a price change in Armada"
              role="group"
            >
              <div className="mk-panel-bar">
                <span className="mk-panel-title">{step === 0 ? "Change prices" : undone ? `Undo: ${CHANGE.summary}` : CHANGE.summary}</span>
                <span className="mk-pill" data-tone={status.tone}>
                  <span className="mk-pill-mark" aria-hidden />
                  <StatusText text={status.text} />
                </span>
              </div>

              <div className="mk-change-map">
                <FleetGrid
                  stores={FLEET}
                  cols={16}
                  sweep
                  className="mk-fleet-change"
                  label={`Example fleet of ${FLEET.length} stores. ${CHANGE.stores} of them list the products being changed.`}
                />
                <p className="mk-map-note">
                  <span className="mk-ring-key" data-solid={step >= 2 && !undone ? "" : undefined} aria-hidden />
                  {step >= 2 && !undone ? (
                    <>
                      Changed in <RollingNumber value={Math.round((done / CHANGE.listings) * CHANGE.stores)} /> of {CHANGE.stores} stores
                    </>
                  ) : (
                    <>{CHANGE.stores} stores list these 4 products</>
                  )}
                </p>
              </div>

              <div className="mk-change-card">
                <div className="mk-stack">
                  <div className="mk-layer" data-show={step === 0 && !undone ? "" : undefined}>
                    <p className="mk-muted">
                      {CHANGE.products} products, live in {CHANGE.stores} stores ({CHANGE.listings} listings).
                    </p>
                    <div className="mk-field">
                      <span className="mk-field-label">Change every price by</span>
                      <span className="mk-input mk-num">
                        {CHANGE.percent}
                        <span className="mk-muted">%</span>
                      </span>
                    </div>
                    <div className="mk-actions">
                      <button
                        type="button"
                        className="mk-btn mk-btn-primary mk-btn-sm"
                        onClick={() => go(1)}
                        tabIndex={step === 0 && !undone ? 0 : -1}
                      >
                        Preview the change
                      </button>
                    </div>
                  </div>

                  <div className="mk-layer" data-show={step === 1 && !undone ? "" : undefined}>
                    <p>This is a preview. Nothing has changed yet. Approve it to apply every change below.</p>
                    <div className="mk-actions">
                      <button type="button" className="mk-btn mk-btn-sm" onClick={() => go(0)} tabIndex={step === 1 && !undone ? 0 : -1}>
                        Cancel
                      </button>
                      <HoldButton
                        key={round}
                        type="button"
                        className="mk-btn mk-btn-sm mk-hold"
                        doneLabel="Applying"
                        onConfirm={() => go(2)}
                        tabIndex={step === 1 && !undone ? 0 : -1}
                      >
                        Approve and apply
                      </HoldButton>
                    </div>
                    <p className="mk-hint mk-muted">Press and hold to approve.</p>
                  </div>

                  <div className="mk-layer" data-show={step === 2 && !undone ? "" : undefined}>
                    <p className="mk-num">
                      <RollingNumber value={done} /> of {CHANGE.listings} changes done
                    </p>
                    <ProgressBar
                      value={done / CHANGE.listings}
                      status={step !== 2 ? "idle" : done >= CHANGE.listings ? "done" : "running"}
                      label="Applying the change"
                      className="mk-change-progress"
                    />
                  </div>

                  <div className="mk-layer" data-show={step === 3 && !undone ? "" : undefined}>
                    <p>Every change here saved what was there before, so it can be put back.</p>
                    <div className="mk-actions">
                      <button
                        type="button"
                        className="mk-btn mk-btn-sm"
                        onClick={() => {
                          auto.current = false;
                          setUndone(true);
                        }}
                        tabIndex={step === 3 && !undone ? 0 : -1}
                      >
                        Undo this change
                      </button>
                    </div>
                  </div>

                  <div className="mk-layer" data-show={undone ? "" : undefined}>
                    <p>All {CHANGE.listings} prices are back where they were. The Changes page keeps both, the change and its undo.</p>
                    <div className="mk-actions">
                      <button type="button" className="mk-btn mk-btn-sm" onClick={() => go(0)} tabIndex={undone ? 0 : -1}>
                        Start again
                      </button>
                    </div>
                  </div>
                </div>

                <ul className="mk-rows" aria-label="Changes">
                  {CHANGE.rows.map((r, i) => {
                    const st = rowState(i);
                    return (
                      <li key={i} data-state={st}>
                        <span className="mk-row-what">
                          <strong>{r.product}</strong> <span className="mk-muted">in {r.store}</span>
                        </span>
                        <span className="mk-row-price mk-num">
                          <span className="mk-before">{money(r.before)}</span>
                          <span className="mk-after">
                            <span aria-hidden> → </span>
                            <span className="mk-sr">changes to </span>
                            {money(r.after)}
                          </span>
                        </span>
                        <span className="mk-pill mk-pill-sm" data-tone={st === "done" ? "ok" : st === "waiting" ? "attention" : "off"}>
                          <span className="mk-pill-mark" aria-hidden />
                          {st === "done" ? "Done" : st === "waiting" ? "Waiting" : st === "back" ? "Put back" : "Listed"}
                        </span>
                      </li>
                    );
                  })}
                  <li className="mk-rows-more mk-muted">and {MORE} more changes</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
      {step === 3 && !undone && onScreen ? (
        <UndoToast
          key={round}
          message={`Applied ${CHANGE.listings} changes in ${CHANGE.stores} stores.`}
          onAction={() => {
            auto.current = false;
            setUndone(true);
          }}
          duration={8000}
        />
      ) : null}
    </section>
  );
}
