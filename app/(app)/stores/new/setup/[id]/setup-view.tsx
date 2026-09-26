"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { advanceSetup, type SetupState } from "../../actions";
import { bigPrimary, bigSecondary } from "../../styles";
import { ProgressBar, ShimmerText, ThinkingOrb, Tick } from "@/components/fx";
import { cx } from "@/components/ui";
import type { SetupStep } from "@/connectors/ebay/core";

// The live setup view. It asks the server to do one step at a time and shows each one land: a
// working orb on the step in hand, a tick that draws itself when it's done, and, when a step is
// the person's to do on eBay or Meta, one sentence and one button. Coming back to this tab after
// finishing something on the platform checks again on its own.

const current = (steps: SetupStep[]) => steps.find((s) => s.state !== "done") ?? null;

export function SetupView({ initial, canAct }: { initial: SetupState; canAct: boolean }) {
  const router = useRouter();
  const [view, setView] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [trouble, setTrouble] = useState<string | null>(null);
  const [since, setSince] = useState<number | undefined>(undefined);
  const running = useRef(false);
  // Steps already done when the page opened don't animate; fixed once, so it's safe to read while drawing.
  const [doneAtLoad] = useState(() => new Set(initial.steps.filter((s) => s.state === "done").map((s) => s.key)));
  const storeId = initial.storeId;

  const run = useCallback(
    async (input?: { retry?: boolean; confirm?: boolean; postalCode?: string }) => {
      if (running.current || !canAct) return;
      running.current = true;
      setBusy(true);
      setSince(Date.now());
      setTrouble(null);
      try {
        let next = await advanceSetup(storeId, input);
        // Keep going while the next step is one Armada can do by itself.
        while (next && !next.finished) {
          setView(next);
          if (current(next.steps)?.state !== "waiting") break;
          setSince(Date.now());
          next = await advanceSetup(storeId);
        }
        if (next) setView(next);
        else setTrouble("Armada couldn't carry on with this store. Refresh the page.");
      } catch {
        setTrouble("Couldn't reach Armada. Check the connection and press Try again.");
      } finally {
        running.current = false;
        setBusy(false);
      }
    },
    [storeId, canAct],
  );

  // Start (or carry on) as soon as the page opens.
  useEffect(() => {
    if (current(initial.steps)?.state !== "waiting") return;
    // A tick later, so the first update happens outside the effect.
    const t = setTimeout(() => void run(), 0);
    return () => clearTimeout(t);
  }, [initial.steps, run]);

  // Back from eBay or Meta's page: check again by itself.
  const step = current(view.steps);
  useEffect(() => {
    const autoCheck = step && (step.state === "later" || (step.state === "needs_you" && step.action?.external && !step.copy && !step.ask));
    if (!autoCheck) return;
    const onFocus = () => void run({ retry: true });
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [step, run]);

  // All done: a moment to see it, then the store.
  useEffect(() => {
    if (!view.finished) return;
    const t = window.setTimeout(() => {
      router.push(`/stores/${storeId}`);
      router.refresh();
    }, 1600);
    return () => window.clearTimeout(t);
  }, [view.finished, router, storeId]);

  const total = view.steps.length;
  const done = view.steps.filter((s) => s.state === "done").length;
  const blocked = step && step.state !== "waiting" && !busy;
  const failed = step?.state === "failed";
  const headline = view.finished
    ? "All set."
    : busy
      ? step?.label ?? "Working"
      : step?.state === "later"
        ? "Waiting on the platform"
        : step?.state === "failed"
          ? "Stopped"
          : step?.state === "needs_you" || blocked
            ? "One thing for you"
            : "Ready to carry on";

  return (
    <section className="rounded-2xl border border-line bg-raised p-6" aria-labelledby="setup-now">
      <div className="flex items-center gap-4">
        <ThinkingOrb
          size={44}
          state={view.finished ? "done" : busy ? "working" : failed ? "error" : step?.state === "needs_you" ? "listening" : "idle"}
          label={view.finished ? "Done" : busy ? "Working" : "Waiting"}
        />
        <div className="min-w-0 flex-1">
          <h2 id="setup-now" className="text-[17px] font-semibold tracking-tight" aria-live="polite">
            {busy && !view.finished ? <ShimmerText>{headline}</ShimmerText> : headline}
          </h2>
          <p className="tabular text-[13px] text-muted">
            {done} of {total} done
          </p>
        </div>
      </div>
      <ProgressBar
        className="mt-4"
        label="Store setup"
        value={done / total}
        creepTo={busy ? Math.min(1, (done + 1) / total) : undefined}
        since={since}
        expected={6000}
        status={view.finished ? "done" : failed ? "failed" : "running"}
      />

      <ol className="mt-6 flex flex-col">
        {view.steps.map((s, i) => {
          const isCurrent = step?.key === s.key;
          const working = isCurrent && busy;
          return (
            <li key={s.key} className={cx("flex gap-3 py-3", i > 0 && "border-t border-line")}>
              <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center">
                <StepMark step={s} working={working} index={i} animate={!doneAtLoad.has(s.key)} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className={cx("font-medium", s.state === "waiting" && !working && "text-muted")}>{s.label}</span>
                  <span className="text-[13px] text-muted">{working ? "working" : stateWord(s)}</span>
                </div>
                {s.note && !working ? <p className="mt-0.5 text-[14px] text-muted">{s.note}</p> : null}
                {isCurrent && !busy && s.state !== "waiting" && s.state !== "done" ? <StepHelp step={s} canAct={canAct} onRun={run} /> : null}
              </div>
            </li>
          );
        })}
      </ol>

      {trouble ? (
        <div role="alert" className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-line px-4 py-3 text-[14px]">
          <span className="text-negative">{trouble}</span>
          <button type="button" onClick={() => void run({ retry: true })} className={bigSecondary}>
            Try again
          </button>
        </div>
      ) : null}

      {view.finished ? (
        <div className="mt-5">
          <a href={`/stores/${storeId}`} className={bigPrimary}>
            Open {view.name}
          </a>
        </div>
      ) : null}
      {!canAct ? <p className="mt-4 text-[13px] text-muted">Only the owner or a manager can carry this on.</p> : null}
    </section>
  );
}

function stateWord(s: SetupStep): string {
  switch (s.state) {
    case "done":
      return "done";
    case "needs_you":
      return "needs you";
    case "later":
      return "waiting on the platform";
    case "failed":
      return "stopped";
    default:
      return "next";
  }
}

/** Shape says the state, never colour alone: tick, orb, diamond, square, ring, number. */
function StepMark({ step, working, index, animate }: { step: SetupStep; working: boolean; index: number; animate: boolean }) {
  if (working) return <ThinkingOrb state="working" size={22} decorative />;
  if (step.state === "done") return <Tick size={22} look="filled" draw={animate} />;
  if (step.state === "needs_you") return <span aria-hidden className="size-3 rotate-45 rounded-[2px] bg-attention" />;
  if (step.state === "failed") return <span aria-hidden className="size-3 rounded-[2px] bg-negative" />;
  if (step.state === "later") return <span aria-hidden className="size-4 rounded-full border-2 border-dashed border-muted" />;
  return (
    <span aria-hidden className="tabular flex size-6 items-center justify-center rounded-full border border-line-strong text-[12px] text-muted">
      {index + 1}
    </span>
  );
}

function StepHelp({ step, canAct, onRun }: { step: SetupStep; canAct: boolean; onRun: (input?: { retry?: boolean; confirm?: boolean; postalCode?: string }) => Promise<void> }) {
  const [copied, setCopied] = useState(false);
  const [zip, setZip] = useState("");
  if (!canAct) return null;
  const external = step.action?.external;
  return (
    <div className="mt-3 flex flex-col gap-3">
      {step.copy ? (
        <div>
          <label className="text-[13px] text-muted" htmlFor={`copy-${step.key}`}>
            {step.copy.label}
          </label>
          <div className="mt-1.5 flex flex-wrap gap-2">
            <input
              id={`copy-${step.key}`}
              readOnly
              value={step.copy.value}
              onFocus={(e) => e.currentTarget.select()}
              className="min-h-11 min-w-0 flex-1 rounded-xl border border-line-strong bg-sunken px-3 text-[14px] text-ink"
            />
            <button
              type="button"
              className={bigSecondary}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(step.copy!.value);
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 2000);
                } catch {
                  document.getElementById(`copy-${step.key}`)?.focus();
                }
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      ) : null}

      {step.ask ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void onRun({ postalCode: zip });
          }}
        >
          <label className="block min-w-[12rem] flex-1">
            <span className="text-[13px] text-muted">{step.ask.label}</span>
            <input
              value={zip}
              onChange={(e) => setZip(e.target.value)}
              required
              maxLength={12}
              autoComplete="postal-code"
              inputMode="text"
              className="mt-1.5 block min-h-11 w-full rounded-xl border border-line-strong bg-raised px-3 text-[15px] text-ink focus:border-accent focus:outline-none"
            />
            {step.ask.hint ? <span className="mt-1 block text-[12px] text-muted">{step.ask.hint}</span> : null}
          </label>
          <button type="submit" className={bigPrimary}>
            Save and carry on
          </button>
        </form>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        {step.action ? (
          <a
            href={step.action.href}
            target={external ? "_blank" : undefined}
            rel={external ? "noopener noreferrer" : undefined}
            className={step.ask ? bigSecondary : bigPrimary}
          >
            {step.action.label}
            {external ? <span className="sr-only"> (opens in a new tab)</span> : null}
          </a>
        ) : null}
        {step.confirmLabel ? (
          <button type="button" onClick={() => void onRun({ confirm: true })} className={step.action ? bigSecondary : bigPrimary}>
            {step.confirmLabel}
          </button>
        ) : null}
        {!step.ask && !step.confirmLabel && (step.state !== "needs_you" || external) ? (
          <button type="button" onClick={() => void onRun({ retry: true })} className={step.action ? bigSecondary : bigPrimary}>
            {step.state === "needs_you" ? "I've done it, carry on" : "Try again"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
