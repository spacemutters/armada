"use client";

import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { PendingButton } from "@/components/fx/pending-button";
import { ThinkingOrb } from "@/components/fx/thinking-orb";
import { Tick } from "@/components/fx/tick";
import { buttonClass, cx } from "@/components/ui";
import { STATE_WORDS, stepsNeedingYou, type LaunchAction, type LaunchStep, type LaunchView } from "@/lib/launch/core";
import { LaunchKitRows } from "./launch-kit";

// The launch as it happens: every step with its state in words and in shape (a tick when done, a
// quiet orb while working, the "needs you" diamond when a press is the person's, an open ring while
// waiting, a dash for a step that isn't for this shop). It runs the next pass itself: every few
// seconds while something is working, every quarter minute while it waits on a press made in
// another tab, and not at all once the launch is done.

function Mark({ step, drawn }: { step: LaunchStep; drawn: boolean }) {
  switch (step.state) {
    case "done":
      return <Tick size={20} look="filled" draw={drawn} className="text-positive" />;
    case "working":
      return <ThinkingOrb state="working" size={20} decorative />;
    case "needs-you":
      return <span className="block size-2.5 rotate-45 rounded-[1px] bg-attention" />;
    case "failed":
      return <span className="flex size-5 items-center justify-center rounded-[4px] bg-negative text-[12px] font-semibold text-raised">!</span>;
    case "skipped":
      return <span className="block h-0.5 w-3 rounded-full bg-muted" />;
    default:
      return <span className="block size-3 rounded-full border border-line-strong" />;
  }
}

function ActionLink({ a }: { a: LaunchAction }) {
  const cls = buttonClass(a.primary ? "primary" : "secondary", "min-h-11 md:min-h-9");
  if (a.external || a.href.startsWith("/api/") || a.href.startsWith("/s/")) {
    return (
      <a href={a.href} target={a.external ? "_blank" : undefined} rel={a.external ? "noreferrer" : undefined} className={cls}>
        {a.label}
        {a.external ? <ExternalLink aria-hidden className="size-4" /> : null}
        {a.external ? <span className="sr-only"> (opens in a new tab)</span> : null}
      </a>
    );
  }
  return (
    <Link href={a.href} className={cls}>
      {a.label}
    </Link>
  );
}

function summary(v: LaunchView): string {
  const counted = v.steps.filter((s) => s.key !== "checkout");
  const finished = counted.filter((s) => s.state === "done" || s.state === "skipped").length;
  const yours = stepsNeedingYou(v.steps);
  if (v.status === "done") return "Launched. Everything Armada can do for this shop is done.";
  if (v.status === "working") return `Working on it: ${finished} of ${counted.length} steps finished.${yours.length ? ` ${yours.length === 1 ? "One step needs" : `${yours.length} steps need`} a press from you.` : ""}`;
  if (v.status === "needs_you") {
    return yours.length === 1 ? `One press from you and the launch carries on: ${yours[0].label}.` : `${yours.length} steps need a press from you. Everything else carries on by itself.`;
  }
  return `${finished} of ${counted.length} steps finished. The rest start by themselves.`;
}

export function LaunchProgress({ initial, relaunch, canLaunch }: { initial: LaunchView; relaunch: () => Promise<void>; canLaunch: boolean }) {
  const [view, setView] = useState(initial);
  // A new press re-renders the page with a fresh launch: take it over.
  const [seenInitial, setSeenInitial] = useState(initial);
  if (initial !== seenInitial) {
    setSeenInitial(initial);
    setView(initial);
  }
  // Steps that finish while the page is open draw their tick.
  const [drawn, setDrawn] = useState<string[]>([]);
  const [seenSteps, setSeenSteps] = useState(view.steps);
  if (seenSteps !== view.steps) {
    const fresh = view.steps.filter((s) => s.state === "done" && seenSteps.find((o) => o.key === s.key)?.state !== "done").map((s) => s.key);
    setSeenSteps(view.steps);
    if (fresh.length) setDrawn([...drawn, ...fresh]);
  }

  const status = useRef(view.status);
  useEffect(() => {
    status.current = view.status;
  });
  const active = view.status !== "done";
  const shopId = view.shopId;
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pass = async () => {
      if (stopped) return;
      if (document.visibilityState === "visible") {
        const res = await fetch(`/api/shops/${shopId}/launch`, { method: "POST", cache: "no-store" }).catch(() => null);
        if (res?.ok && !stopped) {
          const next: LaunchView = await res.json();
          status.current = next.status;
          setView(next);
        }
      }
      if (stopped || status.current === "done") return;
      timer = setTimeout(pass, status.current === "working" ? 3000 : 15000);
    };
    timer = setTimeout(pass, 1500);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [active, shopId]);

  const hasFailed = view.steps.some((s) => s.state === "failed");

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-[14px] text-muted" aria-live="polite">
          {summary(view)}
        </p>
        {hasFailed && canLaunch ? (
          <form action={relaunch}>
            <PendingButton pendingLabel="Trying again…" className={buttonClass("primary", "min-h-11 md:min-h-9")}>
              Try again
            </PendingButton>
          </form>
        ) : null}
      </div>
      {!view.helperOnline && view.status === "working" ? (
        <p className="mt-3 rounded-xl bg-attention-soft px-4 py-3 text-[13px] text-attention">
          The AI helper on your computer is off, so posts and ads wait. The rest carries on.
        </p>
      ) : null}
      <ol className="mt-3 flex flex-col">
        {view.steps.map((step) => {
          const yours = step.state === "needs-you";
          const kitFor = yours && view.kit && (step.key === "facebook" || step.key === "instagram") ? step.key : null;
          return (
            <li key={step.key} className="flex items-start gap-3 border-t border-line py-3.5 first:border-t-0">
              <span aria-hidden className="mt-0.5 flex size-5 shrink-0 items-center justify-center">
                <Mark step={step} drawn={drawn.includes(step.key)} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <span className={cx("font-medium", (step.state === "waiting" || step.state === "skipped") && "text-muted")}>{step.label}</span>
                  <span
                    className={cx(
                      "tabular text-[13px]",
                      yours ? "font-medium text-attention" : step.state === "failed" ? "text-negative" : "text-muted",
                    )}
                  >
                    {step.progress && step.state === "working" ? `${step.progress.done} of ${step.progress.total}` : STATE_WORDS[step.state]}
                  </span>
                </div>
                {step.note ? <p className={cx("mt-0.5 max-w-2xl text-[13px]", yours ? "text-ink" : "text-muted")}>{step.note}</p> : null}
                {kitFor && view.kit ? (
                  // In the order it's done: open the platform's own page, fill it in from the kit, connect.
                  <>
                    <div className="mt-2.5 flex flex-wrap gap-2">
                      {(step.actions ?? []).filter((a) => a.primary).map((a) => (
                        <ActionLink key={a.label} a={a} />
                      ))}
                    </div>
                    <LaunchKitRows platform={kitFor} kit={view.kit} />
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {(step.actions ?? []).filter((a) => !a.primary).map((a) => (
                        <ActionLink key={a.label} a={a} />
                      ))}
                      <span className="text-[13px] text-muted">This page notices by itself once it&apos;s connected.</span>
                    </div>
                  </>
                ) : step.actions?.length ? (
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    {step.actions.map((a) => (
                      <ActionLink key={a.label} a={a} />
                    ))}
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
