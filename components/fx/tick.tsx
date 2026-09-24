import { cx } from "./cx";
import styles from "./fx.module.css";

export interface TickProps {
  /** Size in CSS pixels. */
  size?: number;
  /** "circled" draws a ring then the mark; "filled" pops a solid disc then draws the mark; "plain" is the mark alone. */
  look?: "circled" | "filled" | "plain";
  /** Draw it now (for something that just finished while you watched). Off, it simply shows. */
  draw?: boolean;
  /** Line weight in screen pixels, whatever the size. */
  weight?: number;
  className?: string;
  /** Words for screen readers; leave out when the text beside it already says "done". */
  label?: string;
}

/** A check mark that draws itself once when something finishes. Pure CSS, still under reduced motion. */
export function Tick({ size = 20, look = "circled", draw = false, weight = 2, className, label }: TickProps) {
  const sw = (weight * 24) / size;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cx(styles.tick, look === "filled" && styles.tickFilled, draw && styles.tickDraw, className)}
    >
      {look === "plain" ? null : <circle className={styles.tickRing} cx="12" cy="12" r="10" pathLength={1} strokeWidth={sw} />}
      <path className={styles.tickMark} d="M7.2 12.4l3.3 3.3 6.4-6.9" pathLength={1} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
