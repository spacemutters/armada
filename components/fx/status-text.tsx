"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cx } from "./cx";
import { prefersReducedMotion } from "./motion";
import styles from "./fx.module.css";

export interface StatusTextProps {
  /** The words to show. When they change, the old words slide up and out and the new ones rise in. */
  text: string;
  /** Sweep a soft highlight across the words while the work is still going. */
  shimmer?: boolean;
  /** Read each change out to screen readers (a polite live region). */
  announce?: boolean;
  /** Let long words wrap onto more lines (the width then no longer eases). */
  wrap?: boolean;
  className?: string;
}

const DURATION = 280;

/** A one-line status that changes its words smoothly, and eases its width to fit them. */
export function StatusText({ text, shimmer = false, announce = false, wrap = false, className }: StatusTextProps) {
  const [cur, setCur] = useState({ text, key: 0 });
  const [old, setOld] = useState<{ text: string; key: number } | null>(null);
  if (text !== cur.text) {
    setOld(cur);
    setCur({ text, key: cur.key + 1 });
  }

  useEffect(() => {
    if (!old) return;
    const t = setTimeout(() => setOld(null), DURATION + 40);
    return () => clearTimeout(t);
  }, [old]);

  const track = useRef<HTMLSpanElement>(null);
  const now = useRef<HTMLSpanElement>(null);
  const lastWidth = useRef(0);
  useLayoutEffect(() => {
    const t = track.current;
    const n = now.current;
    if (!t || !n) return;
    const to = n.getBoundingClientRect().width;
    const from = lastWidth.current;
    lastWidth.current = to;
    if (wrap || !from || Math.abs(from - to) < 0.5 || prefersReducedMotion()) return;
    // The row eases from the old words' width to the new ones'.
    t.style.width = `${from}px`;
    void t.offsetWidth;
    t.style.width = `${to}px`;
    const done = setTimeout(() => {
      t.style.width = "";
    }, DURATION + 40);
    return () => {
      clearTimeout(done);
      t.style.width = "";
    };
  }, [cur.key, wrap]);

  return (
    <span className={cx(styles.status, wrap && styles.statusWrap, className)} role={announce ? "status" : undefined}>
      <span ref={track} className={styles.statusTrack}>
        {old ? (
          <span key={old.key} aria-hidden className={cx(styles.statusText, styles.statusLeaving)}>
            {old.text}
          </span>
        ) : null}
        <span key={cur.key} ref={now} className={cx(styles.statusText, cur.key > 0 && styles.statusEnter, shimmer && styles.shimmer)}>
          {cur.text}
        </span>
      </span>
    </span>
  );
}
