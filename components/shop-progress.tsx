"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { ProgressStep } from "@/lib/shops/types";
import { BorderBeam } from "./fx/border-beam";
import { DecodeText } from "./fx/decode-text";
import { ProgressBar } from "./fx/progress-bar";
import { ShimmerText } from "./fx/shimmer-text";
import { StatusText } from "./fx/status-text";
import { ThinkingOrb, type OrbState } from "./fx/thinking-orb";
import { Tick } from "./fx/tick";
import { cx } from "./ui";

interface State {
  status: string;
  progress: ProgressStep[];
  error: string | null;
  brandName: string | null;
  helperOnline: boolean;
}

// What each step looks like while it runs, and roughly how long it takes (only used to pace the bar,
// which never runs past the end of the step on time alone).
const STEP_LOOK: Record<string, { orb: OrbState; expected: number }> = {
  concept: { orb: "thinking", expected: 45_000 },
  products: { orb: "searching", expected: 90_000 },
  pages: { orb: "composing", expected: 60_000 },
};

function elapsed(from: string | undefined, to: string | undefined, now: number | null): string {
  if (!from) return "";
  // Before the page is live in the browser there is no "now", so a running step shows no clock.
  // That keeps the server's first render and the browser's identical.
  const end = to ? new Date(to).getTime() : now;
  if (end == null) return "";
  const s = Math.max(0, Math.round((end - new Date(from).getTime()) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

/**
 * Live view of a shop being built. Checks in every two seconds. The running step carries the moving
 * parts (a travelling border light, an orb for the kind of work, shimmering words); finished steps get
 * a drawn tick. When the build finishes, the bar completes and the page refreshes a moment later, so
 * the finish is seen rather than cut.
 */
export function ShopProgress({ shopId, initial }: { shopId: string; initial: State }) {
  const router = useRouter();
  const [state, setState] = useState(initial);
  const [now, setNow] = useState<number | null>(null);
  // Steps that finished while this page was open draw their tick; ones already done just show it.
  const [seen, setSeen] = useState(initial.progress);
  const [justDone, setJustDone] = useState<string[]>([]);
  if (seen !== state.progress) {
    const fresh = state.progress.filter((s) => s.state === "done" && seen.find((o) => o.key === s.key)?.state !== "done").map((s) => s.key);
    setSeen(state.progress);
    if (fresh.length) setJustDone([...justDone, ...fresh]);
  }

  useEffect(() => {
    const first = setTimeout(() => setNow(Date.now()), 0);
    if (state.status !== "building") {
      clearTimeout(first);
      return;
    }
    const poll = setInterval(async () => {
      const res = await fetch(`/api/shops/${shopId}`, { cache: "no-store" }).catch(() => null);
      if (!res?.ok) return;
      const next: State = await res.json();
      setState(next);
    }, 2000);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearTimeout(first);
      clearInterval(poll);
      clearInterval(clock);
    };
  }, [shopId, state.status]);

  // Finished or stopped: let the last tick draw and the bar complete, then show the finished page.
  useEffect(() => {
    if (initial.status !== "building" || state.status === "building") return;
    const t = setTimeout(() => router.refresh(), state.status === "failed" ? 0 : 1100);
    return () => clearTimeout(t);
  }, [initial.status, state.status, router]);

  const building = state.status === "building";
  const waitingOnHelper = building && !state.helperOnline;
  const steps = state.progress;
  const doneCount = steps.filter((s) => s.state === "done").length;
  const running = steps.find((s) => s.state === "running");
  const total = Math.max(1, steps.length);

  return (
    <div className="flex flex-col gap-4">
      <ProgressBar
        label="Building the shop"
        value={doneCount / total}
        creepTo={running && !waitingOnHelper ? (doneCount + 1) / total : undefined}
        since={running?.startedAt ? new Date(running.startedAt).getTime() : undefined}
        expected={running ? (STEP_LOOK[running.key]?.expected ?? 60_000) : undefined}
        status={state.status === "failed" ? "failed" : building || state.status === "draft" ? "running" : "done"}
      />
      {state.brandName ? (
        <p className="text-muted">
          The brand is <DecodeText text={state.brandName} onMount className="font-semibold text-ink" />.
        </p>
      ) : building ? (
        <p>
          <ShimmerText>Naming the brand…</ShimmerText>
        </p>
      ) : null}
      <ol className="flex flex-col gap-2" aria-live="polite">
        {steps.map((step, i) => {
          const isRunning = step.state === "running";
          const live = isRunning && !waitingOnHelper;
          const look = STEP_LOOK[step.key] ?? { orb: "working" as OrbState };
          return (
            <li key={step.key}>
              <BorderBeam active={live}>
                <div className="flex items-start gap-3 rounded-xl border border-line bg-raised px-4 py-3">
                  <span aria-hidden className="mt-0.5 flex size-5 shrink-0 items-center justify-center">
                    {isRunning ? (
                      <ThinkingOrb state={live ? look.orb : "idle"} size={20} decorative />
                    ) : step.state === "done" ? (
                      <Tick size={20} look="filled" draw={justDone.includes(step.key)} className="text-positive" />
                    ) : step.state === "failed" ? (
                      <span className="flex size-5 items-center justify-center bg-negative text-[11px] font-semibold text-raised">!</span>
                    ) : (
                      <span className="flex size-5 items-center justify-center rounded-full border border-line-strong text-[11px] font-semibold text-muted">{i + 1}</span>
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className={cx("font-medium", step.state === "waiting" && "text-muted")}>
                        {live ? <ShimmerText>{step.label}</ShimmerText> : step.label}
                      </span>
                      <span className="tabular text-[13px] text-muted">
                        {isRunning
                          ? waitingOnHelper
                            ? "waiting"
                            : `working${now ? ` · ${elapsed(step.startedAt, undefined, now)}` : ""}`
                          : step.state === "done"
                            ? elapsed(step.startedAt, step.finishedAt, now)
                            : step.state === "failed"
                              ? "stopped"
                              : "next"}
                      </span>
                    </div>
                    {step.note ? <StatusText text={step.note} wrap className="mt-0.5 text-[13px] text-muted" /> : null}
                  </div>
                </div>
              </BorderBeam>
            </li>
          );
        })}
      </ol>
      {waitingOnHelper ? (
        <p className="rounded-xl bg-attention-soft px-4 py-3 text-[13px] text-attention">
          The AI helper on your computer is off, so this build is waiting. When it comes back on, the build picks up where it left off.
        </p>
      ) : null}
      {state.status === "failed" && state.error ? (
        <p role="alert" className="rounded-xl border border-line px-4 py-3 text-[13px] text-negative">
          {state.error}
        </p>
      ) : null}
    </div>
  );
}
