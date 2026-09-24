"use client";

import { X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "./cx";
import { prefersReducedMotion } from "./motion";
import styles from "./fx.module.css";

export interface UndoToastProps {
  /** What just happened, in plain words: "Applied 24 changes in 6 stores." */
  message: ReactNode;
  /** The button's words. */
  actionLabel?: string;
  /** A server action to run when the button is pressed (it is posted from a form, so it works like any other). */
  action?: (formData: FormData) => void | Promise<void>;
  /** Or a function to call in the browser. */
  onAction?: () => void;
  /** How long the note stays, in ms. The ring drains over this time; pointing at the note or focusing it pauses it. */
  duration?: number;
  /** Remove this search parameter from the address once shown, so a reload doesn't show the note again. */
  clearParam?: string;
  onClose?: () => void;
}

/**
 * A note that slides up after something changed, with an Undo button and a ring that drains while the
 * chance lasts. Swipe it sideways, press Escape or the cross to close it early.
 */
export function UndoToast({ message, actionLabel = "Undo", action, onAction, duration = 8000, clearParam, onClose }: UndoToastProps) {
  const [open, setOpen] = useState(true);
  const card = useRef<HTMLDivElement>(null);
  const ring = useRef<SVGCircleElement>(null);
  const drain = useRef<Animation | null>(null);
  const closing = useRef(false);
  const drag = useRef<{ x: number; id: number } | null>(null);
  const latest = useRef(onClose);

  useEffect(() => {
    latest.current = onClose;
  }, [onClose]);

  const close = (dx = 0) => {
    const el = card.current;
    if (closing.current) return;
    closing.current = true;
    drain.current?.cancel();
    const finish = () => {
      setOpen(false);
      latest.current?.();
    };
    if (!el || prefersReducedMotion()) return finish();
    const to = dx ? `translateX(${dx > 0 ? 110 : -110}%)` : "translateY(24px) scale(0.97)";
    el.animate([{ transform: el.style.transform || "none", opacity: 1 }, { transform: to, opacity: 0 }], { duration: 260, easing: "cubic-bezier(0.4, 0, 1, 1)", fill: "forwards" }).onfinish = finish;
  };
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });

  // Arrive from below, then drain the ring over the undo window (a real animation, so pausing is exact).
  useLayoutEffect(() => {
    const el = card.current;
    const r = ring.current;
    if (!el || !r) return;
    if (!prefersReducedMotion()) {
      el.animate([{ transform: "translateY(110%)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 380, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)" });
    }
    const a = r.animate([{ strokeDashoffset: 0 }, { strokeDashoffset: 1 }], { duration, fill: "forwards" });
    a.onfinish = () => closeRef.current();
    drain.current = a;
    return () => a.cancel();
  }, [duration]);

  useEffect(() => {
    if (!clearParam) return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has(clearParam)) return;
    url.searchParams.delete(clearParam);
    window.history.replaceState(null, "", url.pathname + (url.search || "") + url.hash);
  }, [clearParam]);

  if (!open) return null;
  const hold = (on: boolean) => {
    if (closing.current) return;
    if (on) drain.current?.pause();
    else drain.current?.play();
  };

  return (
    <div className={styles.toast} role="status" aria-live="polite">
      <div
        ref={card}
        className={styles.toastCard}
        data-fx-toast=""
        onPointerEnter={() => hold(true)}
        onPointerLeave={() => hold(false)}
        onFocus={() => hold(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) hold(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            close();
          }
        }}
        onPointerDown={(e) => {
          if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
          drag.current = { x: e.clientX, id: e.pointerId };
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            /* older browsers */
          }
        }}
        onPointerMove={(e) => {
          if (drag.current?.id !== e.pointerId) return;
          e.currentTarget.style.transform = `translateX(${e.clientX - drag.current.x}px)`;
        }}
        onPointerUp={(e) => {
          if (drag.current?.id !== e.pointerId) return;
          const dx = e.clientX - drag.current.x;
          drag.current = null;
          if (Math.abs(dx) > 80) close(dx);
          else e.currentTarget.style.transform = "";
        }}
        onPointerCancel={(e) => {
          drag.current = null;
          e.currentTarget.style.transform = "";
        }}
      >
        <svg className={styles.toastRing} viewBox="0 0 20 20" aria-hidden>
          <circle className={styles.toastTrack} cx="10" cy="10" r="7" />
          <circle ref={ring} className={styles.toastFill} cx="10" cy="10" r="7" pathLength={1} />
        </svg>
        <p className="min-w-0 flex-1 text-[14px] leading-snug">{message}</p>
        {action ? (
          <form action={action}>
            <button type="submit" className={cx(actionClass)}>
              {actionLabel}
            </button>
          </form>
        ) : onAction ? (
          <button
            type="button"
            className={actionClass}
            onClick={() => {
              onAction();
              close();
            }}
          >
            {actionLabel}
          </button>
        ) : null}
        <button type="button" aria-label="Close" onClick={() => close()} className="flex size-11 shrink-0 items-center justify-center rounded-xl text-muted hover:bg-sunken hover:text-ink md:size-8">
          <X aria-hidden className="size-4" />
        </button>
      </div>
    </div>
  );
}

const actionClass = "inline-flex min-h-11 items-center rounded-xl bg-ink px-4 text-[14px] font-semibold text-raised hover:opacity-90 md:min-h-8 md:px-3";
