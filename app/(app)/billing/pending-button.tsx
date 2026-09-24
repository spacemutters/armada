"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { BorderBeam, ShimmerText } from "@/components/fx";
import { Button, cx } from "@/components/ui";

/**
 * A form's submit button that says what's happening while the form is being sent ("Opening Stripe…"),
 * and can't be pressed twice. `beam` adds the travelling light, for the one long wait on the page.
 */
export function PendingButton({
  children,
  pendingLabel,
  variant = "primary",
  className,
  beam = false,
}: {
  children: ReactNode;
  pendingLabel: string;
  variant?: "primary" | "secondary" | "quiet";
  className?: string;
  beam?: boolean;
}) {
  const { pending } = useFormStatus();
  const button = (
    <Button
      type="submit"
      variant={variant}
      disabled={pending}
      className={cx("min-h-11 md:min-h-10", pending && "disabled:cursor-progress disabled:opacity-100", className)}
    >
      {pending ? (
        <ShimmerText tone={variant === "primary" ? "current" : "muted"}>
          <span role="status">{pendingLabel}</span>
        </ShimmerText>
      ) : (
        children
      )}
    </Button>
  );
  return beam ? (
    <BorderBeam active={pending} size="sm" tone="accent" radius={12}>
      {button}
    </BorderBeam>
  ) : (
    button
  );
}
