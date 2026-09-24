"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { BorderBeam } from "@/components/fx";
import { cx } from "@/components/ui";

// A connection card. While one of its buttons is taking the person to the platform (or checking a
// key), a light travels round the card's border: the page's one moving moment. The button that
// started it says what's happening, so the light is never the only sign.

interface Busy {
  /** Which control in this card is working, if any. */
  busyKey: string | null;
  setBusyKey: (key: string | null) => void;
}

const CardBusy = createContext<Busy>({ busyKey: null, setBusyKey: () => {} });

export function useCardBusy(): Busy {
  return useContext(CardBusy);
}

export function CardShell({ children, labelledBy, id, className }: { children: ReactNode; labelledBy: string; id?: string; className?: string }) {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  useEffect(() => {
    // Coming back with the browser's Back button can restore the page exactly as it was left,
    // light still running. Put it back to rest.
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) setBusyKey(null);
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);
  return (
    <CardBusy.Provider value={{ busyKey, setBusyKey }}>
      <BorderBeam active={busyKey !== null} size="md" radius={16} className={cx("h-full min-w-0", className)}>
        <section
          id={id}
          aria-labelledby={labelledBy}
          aria-busy={busyKey !== null || undefined}
          className="flex h-full scroll-mt-6 flex-col rounded-2xl border border-line bg-raised p-5 md:p-6"
        >
          {children}
        </section>
      </BorderBeam>
    </CardBusy.Provider>
  );
}
