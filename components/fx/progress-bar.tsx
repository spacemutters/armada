"use client";

import { useEffect, useRef, useState } from "react";
import { cx } from "./cx";
import { prefersReducedMotion } from "./motion";
import styles from "./fx.module.css";

export interface ProgressBarProps {
  /** What is really known, 0 to 1 (for a build, the steps already finished). The bar never goes backwards. */
  value?: number;
  /**
   * While running, how far the bar may creep on time alone (for a build, the end of the step that's
   * running). It eases towards 90% of the way there and waits, so it never claims more than is true.
   */
  creepTo?: number;
  /** When the running stretch started (ms since 1970), so the creep survives a page refresh. */
  since?: number;
  /** How long the running stretch usually takes, in ms. Past 1.6 times that, the bar says it is slow. */
  expected?: number;
  status?: "idle" | "running" | "done" | "failed";
  /** Words for screen readers, e.g. "Building the shop". */
  label: string;
  className?: string;
}

/**
 * An honest progress bar: real numbers when there are some, a gentle creep when there aren't,
 * a quick finish to 100% when the work is really done, and a hatched bar when it stopped.
 */
export function ProgressBar({ value = 0, creepTo, since, expected = 60_000, status = "running", label, className }: ProgressBarProps) {
  const root = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const fill = useRef<HTMLDivElement>(null);
  const shown = useRef<number | null>(null);
  // The server paints the known part, so the bar never starts empty and jumps.
  const [first] = useState(() => (status === "done" ? 1 : status === "idle" ? 0 : Math.min(1, Math.max(0, value))));

  useEffect(() => {
    const el = root.current;
    const b = bar.current;
    const f = fill.current;
    if (!el || !b || !f) return;
    const known = Math.min(1, Math.max(0, value));
    const ceiling = creepTo == null ? known : Math.min(1, Math.max(known, creepTo));
    const t0 = since ?? performance.timeOrigin + performance.now();
    let raf = 0;
    let last = performance.now();
    let finishFrom = 0;
    let finishAt = 0;

    const paint = (x: number, state: string) => {
      shown.current = x;
      f.style.width = `${(x * 100).toFixed(2)}%`;
      el.dataset.state = state;
      const pct = Math.round(x * 100);
      b.setAttribute("aria-valuenow", String(pct));
      const words = state === "failed" ? "Stopped" : state === "slow" ? "Taking longer than usual" : state === "done" ? "Done" : state === "idle" ? "Not started" : "Working";
      b.setAttribute("aria-valuetext", state === "done" || state === "idle" ? words : `${words}, about ${pct}%`);
    };

    const start = shown.current ?? (status === "done" ? 1 : known);
    if (status === "idle") {
      paint(0, "idle");
      return;
    }
    if (status === "failed") {
      paint(Math.max(start, known), "failed");
      return;
    }
    if (status === "done") {
      if (start >= 1 || prefersReducedMotion()) {
        paint(1, "done");
        return;
      }
      finishFrom = start;
      finishAt = performance.now();
    }

    const tick = (now: number) => {
      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
      last = now;
      const still = prefersReducedMotion();
      if (status === "done") {
        const p = still ? 1 : Math.min(1, (now - finishAt) / 260);
        const x = finishFrom + (1 - finishFrom) * (1 - Math.pow(1 - p, 3));
        paint(x, p >= 1 ? "done" : "finishing");
        if (p < 1) raf = requestAnimationFrame(tick);
        return;
      }
      const elapsed = performance.timeOrigin + now - t0;
      const creep = ceiling > known ? (ceiling - known) * 0.9 * (1 - Math.exp(-elapsed / Math.max(200, expected / 2.3))) : 0;
      const target = Math.min(0.99, known + creep);
      const cur = shown.current ?? start;
      const next = Math.max(cur, cur + (target - cur) * (still ? 1 : 1 - Math.exp(-dt / 0.25)));
      paint(next, elapsed > expected * 1.6 && creepTo != null ? "slow" : "running");
      raf = requestAnimationFrame(tick);
    };
    paint(start, status === "done" ? "finishing" : "running");
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, creepTo, since, expected, status]);

  return (
    <div ref={root} className={cx(styles.prog, className)} data-state={status}>
      <div ref={bar} className={styles.progBar} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100}>
        <div ref={fill} className={styles.progFill} style={{ width: `${first * 100}%` }} />
      </div>
    </div>
  );
}
