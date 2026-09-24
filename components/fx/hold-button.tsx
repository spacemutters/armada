"use client";

import { useEffect, useId, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { cx } from "./cx";
import { prefersReducedMotion } from "./motion";
import styles from "./fx.module.css";

export interface HoldButtonProps extends Omit<ComponentProps<"button">, "children" | "onClick"> {
  /** The button's words, e.g. "Approve and apply". */
  children: ReactNode;
  /** Shown once the hold completes (and while its form is being sent), e.g. "Applying…". */
  doneLabel?: ReactNode;
  /** How long to hold, in ms. */
  duration?: number;
  /** Called when the hold completes. Inside a form, the form is also submitted by this button. */
  onConfirm?: () => void;
  /** Said to screen readers. Show the same words near the button, e.g. "Press and hold to approve". */
  hint?: string;
}

/**
 * The motion kit's hold engine: fills at a steady rate while held, drains (faster) once let go, and
 * calls done() at the top. It writes one CSS variable, --fx-p, so nothing re-renders per frame.
 */
function createHold(btn: HTMLButtonElement, opts: () => { duration: number; done: () => void }) {
  let p = 0;
  let raf = 0;
  let last = 0;
  let mode: "idle" | "holding" | "draining" | "done" = "idle";
  const paint = () => btn.style.setProperty("--fx-p", p.toFixed(4));
  const loop = (now: number) => {
    const dt = now - last;
    last = now;
    if (mode === "holding") {
      p = Math.min(1, p + dt / opts().duration);
      paint();
      if (p >= 1) {
        mode = "done";
        if (!prefersReducedMotion()) btn.animate([{ transform: "scale(1)" }, { transform: "scale(0.97)" }, { transform: "scale(1)" }], { duration: 240, easing: "ease-out" });
        opts().done();
        return;
      }
    } else if (mode === "draining") {
      p = Math.max(0, p - dt / 320);
      paint();
      if (p <= 0) {
        mode = "idle";
        return;
      }
    } else return;
    raf = requestAnimationFrame(loop);
  };
  const run = () => {
    cancelAnimationFrame(raf);
    last = performance.now();
    raf = requestAnimationFrame(loop);
  };
  return {
    press() {
      if (mode === "holding" || mode === "done") return;
      mode = "holding";
      run();
    },
    release() {
      if (mode !== "holding") return;
      mode = "draining";
      run();
    },
    destroy() {
      cancelAnimationFrame(raf);
    },
  };
}

/**
 * Press and hold to confirm something that changes many things at once. The fill sweeps across while
 * held and drains if you let go early. Works with a mouse, touch, and Space or Enter held down.
 * Without scripts it is an ordinary submit button.
 */
export function HoldButton({ children, doneLabel, duration = 1100, onConfirm, hint = "Press and hold to confirm", className, type = "submit", disabled, ...rest }: HoldButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const hintId = useId();
  const [done, setDone] = useState(false);
  const { pending } = useFormStatus();
  const engine = useRef<ReturnType<typeof createHold> | null>(null);
  const pointer = useRef(-1);
  const submitting = useRef(false);
  const latest = useRef({ duration, onConfirm, type });

  useEffect(() => {
    latest.current = { duration, onConfirm, type };
  }, [duration, onConfirm, type]);

  useEffect(() => {
    const btn = ref.current;
    if (!btn) return;
    const h = createHold(btn, () => ({
      duration: latest.current.duration,
      done: () => {
        setDone(true);
        latest.current.onConfirm?.();
        if (latest.current.type === "submit" && btn.form) {
          submitting.current = true;
          btn.form.requestSubmit(btn);
          submitting.current = false;
        }
      },
    }));
    engine.current = h;
    return () => {
      h.destroy();
      engine.current = null;
    };
  }, []);

  const busy = done || pending;
  const label = busy && doneLabel ? doneLabel : children;
  const release = () => {
    pointer.current = -1;
    engine.current?.release();
  };

  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      disabled={disabled}
      aria-describedby={hintId}
      aria-disabled={busy || undefined}
      data-state={busy ? "done" : "idle"}
      className={cx(styles.hold, className)}
      onClick={(e) => {
        // A quick click (or Enter in a field of the same form) does nothing: only a full hold confirms.
        if (!submitting.current) e.preventDefault();
      }}
      onPointerDown={(e) => {
        if (e.button !== 0 || disabled || busy) return;
        e.preventDefault(); // no text selection or long-press menu
        pointer.current = e.pointerId;
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          /* older browsers */
        }
        e.currentTarget.focus({ preventScroll: true });
        engine.current?.press();
      }}
      onPointerMove={(e) => {
        if (e.pointerId !== pointer.current) return;
        const b = e.currentTarget.getBoundingClientRect();
        if (e.clientX < b.left || e.clientX > b.right || e.clientY < b.top || e.clientY > b.bottom) release(); // dragged off: let go
      }}
      onPointerUp={(e) => {
        if (e.pointerId === pointer.current) release();
      }}
      onPointerCancel={release}
      onLostPointerCapture={release}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          if (!e.repeat && !busy && !disabled) engine.current?.press();
        }
      }}
      onKeyUp={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          release();
        }
      }}
      onBlur={release}
    >
      <span className="inline-flex items-center gap-2">{label}</span>
      <span aria-hidden className={styles.holdOn}>
        {label}
      </span>
      <span id={hintId} className={styles.srOnly}>
        {hint}
      </span>
    </button>
  );
}
