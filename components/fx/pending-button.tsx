"use client";

import type { ComponentProps, ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { BorderBeam } from "./border-beam";
import { ShimmerText } from "./shimmer-text";
import { ThinkingOrb, type OrbState } from "./thinking-orb";

export interface PendingButtonProps extends Omit<ComponentProps<"button">, "children"> {
  children: ReactNode;
  /** What to say while the form is being sent: "Starting the build…". */
  pendingLabel: string;
  /** "primary" for a filled accent button (the orb and shimmer use the button's own colours). */
  variant?: "primary" | "secondary";
  /** Also run a border light round the button while it waits. */
  beam?: boolean;
  orb?: OrbState;
}

/**
 * A submit button that says what is happening while its form is being sent: a small working orb and
 * shimmering words instead of a frozen button. Must sit inside the form it submits.
 */
export function PendingButton({ children, pendingLabel, variant = "primary", beam = false, orb = "working", className, disabled, style, ...rest }: PendingButtonProps) {
  const { pending } = useFormStatus();
  const button = (
    <button
      {...rest}
      type="submit"
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={className}
      // Waiting is not "unavailable": keep full colour (a style beats the disabled fade in the class list).
      style={pending ? { ...style, opacity: 1, cursor: "progress" } : style}
    >
      {pending ? (
        <>
          <ThinkingOrb state={orb} size={16} decorative ink={variant === "primary" ? "inverse" : "auto"} />
          <ShimmerText tone={variant === "primary" ? "current" : "muted"}>{pendingLabel}</ShimmerText>
        </>
      ) : (
        children
      )}
    </button>
  );
  if (!beam) return button;
  return (
    <BorderBeam active={pending} size="md" className="inline-flex">
      {button}
    </BorderBeam>
  );
}
