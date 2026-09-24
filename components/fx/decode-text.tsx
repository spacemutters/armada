"use client";

import { useEffect, useRef } from "react";
import { cx } from "./cx";
import { prefersReducedMotion, useMountedInBrowser } from "./motion";
import styles from "./fx.module.css";

const SETS = {
  letters: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  digits: "0123456789",
  blocks: "▖▗▘▙▚▛▜▝▞▟░▒▓",
} as const;

export interface DecodeTextProps {
  text: string;
  /** Also decode when it first appears in the browser (never during the first page load). */
  onMount?: boolean;
  /** How long the whole word takes to lock in, in ms. */
  duration?: number;
  charset?: keyof typeof SETS;
  /** Which letters lock in first. */
  order?: "left" | "centre" | "random";
  className?: string;
}

/**
 * Text that decodes into place: each letter flickers through random letters, then locks in, left to right.
 * For a word that has just been decided (a brand the AI just named). Each letter keeps its real width
 * while it flickers, so nothing around it moves. Screen readers hear the real words straight away;
 * under reduced motion the words simply change.
 */
export function DecodeText({ text, onMount = false, duration = 900, charset = "letters", order = "left", className }: DecodeTextProps) {
  const vis = useRef<HTMLSpanElement>(null);
  const inBrowser = useMountedInBrowser();
  const firstWasClient = useRef(inBrowser);
  const seen = useRef<string | null>(null);

  useEffect(() => {
    const root = vis.current;
    const first = seen.current === null;
    seen.current = text;
    if (!root || (first && !(onMount && firstWasClient.current)) || prefersReducedMotion() || !duration) return;
    const chars = Array.from(root.querySelectorAll<HTMLElement>("[data-ch]"));
    const slots = chars.map((el) => ({ el, node: el.firstChild as Text | null, ch: el.dataset.ch ?? "", at: 0, flip: -Infinity, set: false }));
    const widths = slots.map((s) => s.el.getBoundingClientRect().width);
    if (!widths.some(Boolean)) return; // not on screen
    const pool = SETS[charset];
    const n = slots.length;
    slots.forEach((s, i) => {
      const rank = n < 2 ? 0 : order === "random" ? Math.random() : order === "centre" ? Math.abs(i - (n - 1) / 2) / ((n - 1) / 2) : i / (n - 1);
      s.el.style.width = `${widths[i]}px`;
      s.at = duration * (0.2 + 0.8 * rank);
      s.el.classList.remove(styles.dcSet);
    });
    const settle = () =>
      slots.forEach((s) => {
        if (s.node) s.node.nodeValue = s.ch;
        s.el.classList.add(styles.dcSet);
        s.el.style.width = "";
      });
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = now - t0;
      let left = 0;
      for (const s of slots) {
        if (s.set) continue;
        if (t >= s.at) {
          s.set = true;
          if (s.node) s.node.nodeValue = s.ch;
          s.el.classList.add(styles.dcSet);
          continue;
        }
        left++;
        if (now - s.flip >= 45 && s.node) {
          s.node.nodeValue = pool.charAt(Math.floor(Math.random() * pool.length));
          s.flip = now;
        }
      }
      if (left) raf = requestAnimationFrame(tick);
      else settle();
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      settle();
    };
  }, [text, onMount, duration, charset, order]);

  const words = text.split(/(\s+)/).filter(Boolean);
  return (
    <span className={className}>
      <span className={styles.srOnly}>{text}</span>
      <span ref={vis} aria-hidden>
        {words.map((w, wi) =>
          /^\s+$/.test(w) ? (
            w
          ) : (
            <span key={wi} className={styles.dcWord}>
              {Array.from(w).map((ch, ci) => (
                <span key={ci} data-ch={ch} className={cx(styles.dcCh, styles.dcSet)}>
                  {ch}
                </span>
              ))}
            </span>
          ),
        )}
      </span>
    </span>
  );
}
