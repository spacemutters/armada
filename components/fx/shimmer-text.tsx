import type { ElementType, ReactNode } from "react";
import { cx } from "./cx";
import styles from "./fx.module.css";

export interface ShimmerTextProps {
  children: ReactNode;
  /** Sweep only while the work is still going. Off, the words look like any other text. */
  active?: boolean;
  /**
   * "muted" (default) sweeps between the quiet-text and text colours, both readable on every Armada surface.
   * "current" keeps the words' own colour, for coloured surfaces such as a primary button.
   */
  tone?: "muted" | "current";
  as?: ElementType;
  className?: string;
}

/**
 * Words that are still being worked on: a soft highlight sweeps across them.
 * Pure CSS, so it works in server components. Still under reduced motion.
 */
export function ShimmerText({ children, active = true, tone = "muted", as: Tag = "span", className }: ShimmerTextProps) {
  return (
    <Tag className={cx(active && styles.shimmer, active && tone === "current" && styles.shimmerCurrent, className)} data-fx-shimmer={active ? "" : undefined}>
      {children}
    </Tag>
  );
}
