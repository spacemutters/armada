"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { ProgressStep } from "@/lib/shops/types";
import { cx } from "./ui";

interface State {
  status: string;
  progress: ProgressStep[];
  error: string | null;
  brandName: string | null;
  helperOnline: boolean;
}

function elapsed(from: string | undefined, to: string | undefined, now: number | null): string {
  if (!from) return "";
  // Before the page is live in the browser there is no "now", so a running step shows no clock.
  // That keeps the server's first render and the browser's identical.
  const end = to ? new Date(to).getTime() : now;
  if (end == null) return "";
  const s = Math.max(0, Math.round((end - new Date(from).getTime()) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** Live view of a shop being built. Checks in every two seconds and refreshes the page when done. */
export function ShopProgress({ shopId, initial }: { shopId: string; initial: State }) {
  const router = useRouter();
  const [state, setState] = useState(initial);
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    if (state.status !== "building") return;
    const poll = setInterval(async () => {
      const res = await fetch(`/api/shops/${shopId}`, { cache: "no-store" }).catch(() => null);
      if (!res?.ok) return;
      const next: State = await res.json();
      setState(next);
      if (next.status !== "building") router.refresh();
    }, 2000);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(clock);
    };
  }, [shopId, state.status, router]);

  const waitingOnHelper = state.status === "building" && !state.helperOnline;

  return (
    <div className="flex flex-col gap-4">
      {state.brandName ? (
        <p className="text-muted">
          The brand is <span className="font-semibold text-ink">{state.brandName}</span>.
        </p>
      ) : null}
      <ol className="flex flex-col gap-2" aria-live="polite">
        {state.progress.map((step, i) => (
          <li key={step.key} className="flex items-start gap-3 rounded-xl border border-line bg-raised px-4 py-3">
            <span
              aria-hidden
              className={cx(
                "mt-1 flex size-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold",
                step.state === "done" && "border-positive bg-positive text-raised",
                step.state === "running" && "pulse border-accent text-accent",
                step.state === "failed" && "rounded-none border-negative bg-negative text-raised",
                step.state === "waiting" && "border-line-strong text-muted",
              )}
            >
              {step.state === "done" ? "✓" : step.state === "failed" ? "!" : i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className={cx("font-medium", step.state === "waiting" && "text-muted")}>{step.label}</span>
                <span className="tabular text-[13px] text-muted">
                  {step.state === "running"
                    ? `working${now ? ` · ${elapsed(step.startedAt, undefined, now)}` : ""}`
                    : step.state === "done"
                      ? elapsed(step.startedAt, step.finishedAt, now)
                      : step.state === "failed"
                        ? "stopped"
                        : "next"}
                </span>
              </div>
              {step.note ? <p className="mt-0.5 text-[13px] text-muted">{step.note}</p> : null}
            </div>
          </li>
        ))}
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
