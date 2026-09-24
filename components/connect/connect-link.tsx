"use client";

import { useId, type ReactNode } from "react";
import { ShimmerText, ThinkingOrb } from "@/components/fx";
import { buttonClass, cx } from "@/components/ui";
import { useCardBusy } from "./card-shell";

/**
 * A button that takes the person to a platform's own approval page. A plain link underneath (the
 * start route answers with a redirect), so it works before scripts load. Once pressed it says
 * where it's going, with the connecting orb, and the card's light runs until the page changes.
 */
export function ConnectLink({
  href,
  children,
  busyLabel,
  variant = "primary",
  className,
}: {
  href: string;
  children: ReactNode;
  busyLabel: string;
  variant?: "primary" | "secondary";
  className?: string;
}) {
  const id = useId();
  const { busyKey, setBusyKey } = useCardBusy();
  const busy = busyKey === id;
  return (
    <a
      href={href}
      aria-busy={busy || undefined}
      onClick={(e) => {
        // A new tab or window leaves this page where it is, so nothing here is "going" anywhere.
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        setBusyKey(id);
      }}
      className={buttonClass(variant, cx("min-h-11 md:min-h-10", busy && "cursor-progress", className))}
    >
      {busy ? (
        <>
          <ThinkingOrb state="connecting" size={16} decorative ink={variant === "primary" ? "inverse" : "auto"} />
          <ShimmerText tone={variant === "primary" ? "current" : "muted"}>{busyLabel}</ShimmerText>
        </>
      ) : (
        children
      )}
    </a>
  );
}
