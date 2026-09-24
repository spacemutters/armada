import { cx } from "./cx";
import styles from "./fx.module.css";
import { ShimmerText } from "./shimmer-text";
import { ThinkingOrb, type OrbState } from "./thinking-orb";

export interface LoadingProps {
  /** Plain words for what is loading: "Loading your stores". */
  label: string;
  state?: OrbState;
  className?: string;
}

/**
 * A calm loading view for a route's loading file: an orb and a line of words. It only fades in if
 * loading takes longer than about a third of a second, so quick pages never flash it.
 */
export function Loading({ label, state = "searching", className }: LoadingProps) {
  return (
    <div role="status" className={cx(styles.lateIn, "flex min-h-[40vh] flex-col items-center justify-center gap-4 text-center", className)}>
      <ThinkingOrb state={state} size={48} decorative />
      <ShimmerText className="text-[14px]">{label}</ShimmerText>
    </div>
  );
}
