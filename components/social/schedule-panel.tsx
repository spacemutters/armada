"use client";

import { useId, useMemo, useState } from "react";
import { useMountedInBrowser } from "@/components/fx";
import { PendingButton } from "@/components/fx/pending-button";
import { buttonClass, cx, inputClass } from "@/components/ui";
import { formatLocal } from "./local-time";

export interface TargetAccount {
  id: string;
  /** "Instagram" */
  platform: string;
  /** "@evenfall.home" or the page name */
  name: string;
  practice: boolean;
}

/** "2026-09-29T18:30" in the viewer's time, for a datetime-local field. */
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Where the time field starts: the given moment, or (if that has passed) the same time tomorrow. */
function startingTime(iso: string | null, now: number): Date {
  const d = iso ? new Date(iso) : null;
  if (d && d.getTime() >= now + 5 * 60_000) return d;
  const next = new Date(now + 86_400_000);
  if (d) next.setHours(d.getHours(), d.getMinutes(), 0, 0);
  return next;
}

/**
 * Where and when a post goes: the shop's accounts (all ticked to start with), a day and time
 * (the AI's suggestion to start with, in the viewer's own time), then Schedule or Post now.
 */
export function SchedulePanel({
  accounts,
  chosen,
  suggestedIso,
  currentIso,
  schedule,
  postNow,
  scheduleLabel = "Schedule",
}: {
  accounts: TargetAccount[];
  /** Accounts already chosen for this post; all of them when empty. */
  chosen: string[];
  suggestedIso: string | null;
  currentIso: string | null;
  schedule: (formData: FormData) => Promise<void>;
  postNow: (formData: FormData) => Promise<void>;
  scheduleLabel?: string;
}) {
  const mounted = useMountedInBrowser();
  const whenId = useId();
  const [picked, setPicked] = useState<Set<string>>(() => new Set(chosen.length ? chosen.filter((id) => accounts.some((a) => a.id === id)) : accounts.map((a) => a.id)));
  const [value, setValue] = useState<string | null>(null);

  // The moment the panel opened; times are judged against it, so the panel doesn't shift while it's open.
  const [openedAt] = useState(() => Date.now());
  const start = useMemo(() => startingTime(currentIso ?? suggestedIso, openedAt), [currentIso, suggestedIso, openedAt]);

  const local = value ?? (mounted ? toLocalInput(start) : "");
  const atDate = local ? new Date(local) : null;
  const atIso = atDate && !Number.isNaN(atDate.getTime()) ? atDate.toISOString() : "";
  const suggested = suggestedIso && mounted && new Date(suggestedIso).getTime() > openedAt + 5 * 60_000 ? new Date(suggestedIso) : null;
  const none = picked.size === 0;
  const ids = [...picked];

  return (
    <div className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1.5 text-[13px] font-medium text-muted">Post to</legend>
        {accounts.map((a) => (
          <label key={a.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-2 hover:bg-sunken md:min-h-9">
            <input
              type="checkbox"
              checked={picked.has(a.id)}
              onChange={(e) =>
                setPicked((s) => {
                  const next = new Set(s);
                  if (e.target.checked) next.add(a.id);
                  else next.delete(a.id);
                  return next;
                })
              }
              className="size-4.5 accent-[var(--accent)]"
            />
            <span className="min-w-0 flex-1 text-[14px]">
              <span className="font-medium">{a.platform}</span> <span className="text-muted">{a.name}</span>
            </span>
            {a.practice ? <span className="rounded-full border border-line px-2 py-0.5 text-[12px] text-muted">Practice</span> : null}
          </label>
        ))}
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={whenId} className="text-[13px] font-medium text-muted">
          When
        </label>
        <input
          id={whenId}
          type="datetime-local"
          value={local}
          min={mounted ? toLocalInput(new Date(openedAt)) : undefined}
          onChange={(e) => setValue(e.target.value)}
          className={cx(inputClass, "min-h-11 tabular-nums md:min-h-10")}
        />
        {suggested ? (
          <p className="flex flex-wrap items-center gap-x-2 text-[12px] text-muted">
            <span>The AI suggests {formatLocal(suggested)}, your time.</span>
            {local !== toLocalInput(start) ? (
              <button type="button" onClick={() => setValue(null)} className="inline-flex min-h-11 items-center text-accent hover:underline md:min-h-6">
                Use that
              </button>
            ) : null}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <form action={schedule}>
          {ids.map((id) => (
            <input key={id} type="hidden" name="account" value={id} />
          ))}
          <input type="hidden" name="at" value={atIso} />
          <PendingButton pendingLabel="Scheduling" disabled={none || !atIso} className={buttonClass("primary", "min-h-11 md:min-h-10")}>
            {scheduleLabel}
          </PendingButton>
        </form>
        <form action={postNow}>
          {ids.map((id) => (
            <input key={id} type="hidden" name="account" value={id} />
          ))}
          <PendingButton pendingLabel="Sending" variant="secondary" disabled={none} className={buttonClass("secondary", "min-h-11 md:min-h-10")}>
            Post now
          </PendingButton>
        </form>
      </div>
      {none ? <p className="text-[12px] text-muted">Tick at least one account.</p> : null}
    </div>
  );
}
