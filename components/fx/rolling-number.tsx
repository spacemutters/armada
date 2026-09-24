"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { cx } from "./cx";
import styles from "./fx.module.css";

export interface RollingNumberProps {
  /**
   * The number to show, already formatted ("$2,351", "13.1K", "42") or a plain number.
   * When it changes, each digit rolls to its new value; digits line up from the right,
   * so the ones stay the ones.
   */
  value: string | number;
  /** Roll every digit up from zero when it first appears (a page's one entrance, such as the home stats). */
  rollIn?: boolean;
  /** Milliseconds between neighbouring digits starting to roll. */
  stagger?: number;
  className?: string;
}

const DURATION = 600;
const isDigit = (ch: string) => ch >= "0" && ch <= "9";

/**
 * Numbers that roll when they change, like a counter. The server renders the finished number,
 * screen readers hear the whole number once, and under reduced motion it simply changes.
 */
export function RollingNumber({ value, rollIn = false, stagger = 30, className }: RollingNumberProps) {
  const text = typeof value === "number" ? value.toLocaleString("en-US") : String(value);
  const [cur, setCur] = useState(text);
  const [prev, setPrev] = useState<string | null>(null);
  if (text !== cur) {
    setPrev(cur);
    setCur(text);
  }
  useEffect(() => {
    if (prev === null) return;
    const t = setTimeout(() => setPrev(null), DURATION + stagger * 12 + 60);
    return () => clearTimeout(t);
  }, [prev, stagger]);

  const n = cur.length;
  const width = Math.max(n, prev?.length ?? 0);
  const cols = [];
  // k counts from the right: 0 is the last character.
  for (let k = width - 1; k >= 0; k--) {
    const leaving = k >= n;
    const ch = leaving ? (prev as string)[(prev as string).length - 1 - k] : cur[n - 1 - k];
    const entering = !leaving && prev !== null && k >= prev.length;
    const digit = isDigit(ch);
    const key = digit ? `${k}d` : `${k}c${ch}`;
    const cls = cx(digit ? styles.rollCol : styles.rollCh, leaving && styles.rollLeave, entering && styles.rollEnter);
    if (digit) {
      const style = { "--fx-digit": Number(ch), "--fx-delay": `${k * stagger}ms` } as CSSProperties;
      cols.push(
        <span key={key} className={cls}>
          <span className={styles.rollStrip} style={style}>
            <span>0</span>
            <span>1</span>
            <span>2</span>
            <span>3</span>
            <span>4</span>
            <span>5</span>
            <span>6</span>
            <span>7</span>
            <span>8</span>
            <span>9</span>
          </span>
        </span>,
      );
    } else {
      cols.push(
        <span key={key} className={cls}>
          {ch}
        </span>,
      );
    }
  }

  return (
    <span className={cx(styles.roll, rollIn && styles.rollIn, className)} data-fx-roll={cur}>
      <span className={styles.srOnly}>{cur}</span>
      <span className={styles.rollVis} aria-hidden>
        {cols}
      </span>
    </span>
  );
}
