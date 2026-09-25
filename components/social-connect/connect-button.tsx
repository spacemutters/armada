"use client";

import { useEffect, useState, type ReactNode } from "react";
import { BorderBeam, ShimmerText, ThinkingOrb } from "@/components/fx";
import { buttonClass } from "@/components/ui";

/**
 * The one press on a platform card: a plain link to the platform's own sign-in (it works without
 * scripts), which says what is happening while the browser leaves: a connecting orb, shimmering
 * words and a light round the button.
 */
export function ConnectButton({
  href,
  children,
  pendingLabel,
  variant = "primary",
}: {
  href: string;
  children: ReactNode;
  pendingLabel: string;
  variant?: "primary" | "secondary";
}) {
  const [going, setGoing] = useState(false);

  // Coming back with the browser's Back button restores the page as it was; show the button again.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => e.persisted && setGoing(false);
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

  return (
    <BorderBeam active={going} size="md" className="inline-flex">
      <a
        href={href}
        aria-busy={going || undefined}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
          if (going) e.preventDefault();
          else setGoing(true);
        }}
        className={buttonClass(variant, "min-h-11 px-5 text-[15px]")}
        style={going ? { cursor: "progress" } : undefined}
      >
        {going ? (
          <>
            <ThinkingOrb state="connecting" size={16} decorative ink={variant === "primary" ? "inverse" : "auto"} />
            <ShimmerText tone={variant === "primary" ? "current" : "muted"}>{pendingLabel}</ShimmerText>
          </>
        ) : (
          children
        )}
      </a>
    </BorderBeam>
  );
}
