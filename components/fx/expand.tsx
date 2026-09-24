"use client";

import { ChevronRight } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "./cx";
import { prefersReducedMotion } from "./motion";
import styles from "./fx.module.css";

type Phase = "closed" | "opening" | "open" | "closing";
const DURATION = 280;

export interface ExpandProps {
  /** The always-visible row that opens and closes the rest. */
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  /** Classes for the summary button (it already fills the row and carries the chevron). */
  buttonClassName?: string;
}

/**
 * A row that opens to show more. The height eases open and the content fades in just after, so
 * nothing below jumps. Under reduced motion it opens at once. Focus never stays inside hidden content.
 */
export function Expand({ summary, children, defaultOpen = false, className, buttonClassName }: ExpandProps) {
  const id = useId();
  const [phase, setPhase] = useState<Phase>(defaultOpen ? "open" : "closed");
  const panel = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const from = useRef(0);

  useLayoutEffect(() => {
    const p = panel.current;
    if (!p) return;
    if (phase === "opening") {
      p.style.height = `${from.current}px`;
      void p.offsetHeight; // commit the start so the height animates
      p.style.height = `${p.scrollHeight}px`;
    } else if (phase === "closing") {
      p.style.height = `${from.current}px`;
      void p.offsetHeight;
      p.style.height = "0px";
    } else {
      p.style.height = "";
    }
  }, [phase]);

  useEffect(() => {
    if (phase !== "opening" && phase !== "closing") return;
    const t = setTimeout(() => setPhase(phase === "opening" ? "open" : "closed"), prefersReducedMotion() ? 0 : DURATION + 30);
    return () => clearTimeout(t);
  }, [phase]);

  const toggle = () => {
    const p = panel.current;
    from.current = p ? p.getBoundingClientRect().height : 0;
    const opening = phase === "closed" || phase === "closing";
    if (!opening && p?.contains(document.activeElement)) button.current?.focus();
    setPhase(opening ? "opening" : "closing");
  };
  const expanded = phase === "open" || phase === "opening";

  return (
    <div className={className}>
      <button
        ref={button}
        type="button"
        aria-expanded={expanded}
        aria-controls={id}
        onClick={toggle}
        className={cx("flex w-full items-center gap-2 text-left", buttonClassName)}
      >
        <ChevronRight aria-hidden className={cx(styles.discChev, "size-4 text-muted")} />
        <span className="min-w-0 flex-1">{summary}</span>
      </button>
      <div id={id} ref={panel} className={styles.disc} data-state={phase} inert={phase === "closed" || undefined}>
        <div>{children}</div>
      </div>
    </div>
  );
}
