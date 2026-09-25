"use client";

import { useState } from "react";
import { PendingButton } from "@/components/fx/pending-button";
import { buttonClass, cx, inputClass } from "@/components/ui";

// The budget (and, before the ads are made, who sees them), with the total worked out as you type:
// "never more than $70 in total" is the number that matters, so it is always in view.

type Result = { problem?: string } | void;

const touch = "min-h-11 md:min-h-9";

export function BudgetForm({
  daily,
  days,
  currency,
  minDaily,
  maxDaily,
  maxDays,
  audience,
  spentCents,
  save,
  onDone,
}: {
  /** Whole currency units a day. */
  daily: number;
  days: number;
  currency: string;
  minDaily: number;
  maxDaily: number;
  maxDays: number;
  /** Only before the ads are made. */
  audience?: { description: string; ageMin: number; ageMax: number };
  spentCents: number;
  save: (form: FormData) => Promise<Result>;
  onDone?: () => void;
}) {
  const [d, setD] = useState(String(daily));
  const [n, setN] = useState(String(days));
  const [problem, setProblem] = useState<string | null>(null);
  const money = (x: number) => new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: x % 1 ? 2 : 0 }).format(x);
  const total = (Number(d) || 0) * (Number(n) || 0);
  const tooLow = total * 100 < spentCents;

  return (
    <form
      action={async (fd) => {
        const r = await save(fd);
        if (r && r.problem) setProblem(r.problem);
        else {
          setProblem(null);
          onDone?.();
        }
      }}
      className="flex flex-col gap-4"
    >
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-[14px] font-medium">Each day</span>
          <span className="relative mt-2 block">
            <span aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted">
              {currency === "USD" ? "$" : currency}
            </span>
            <input
              name="daily"
              type="number"
              inputMode="numeric"
              min={minDaily}
              max={maxDaily}
              step={1}
              required
              value={d}
              onChange={(e) => setD(e.target.value)}
              className={cx(inputClass, "pl-7 tabular")}
            />
          </span>
        </label>
        <label className="block">
          <span className="text-[14px] font-medium">For how many days</span>
          <input name="days" type="number" inputMode="numeric" min={1} max={maxDays} step={1} required value={n} onChange={(e) => setN(e.target.value)} className={cx(inputClass, "mt-2 tabular")} />
        </label>
      </div>
      <p className={cx("text-[14px]", tooLow && "text-negative")} aria-live="polite">
        {tooLow ? `That's less than the ${money(spentCents / 100)} already spent.` : <>Never more than <span className="font-semibold tabular">{money(total)}</span> in total.</>}
      </p>

      {audience ? (
        <fieldset className="flex flex-col gap-3 border-t border-line pt-4">
          <legend className="sr-only">Who sees them</legend>
          <label className="block">
            <span className="text-[14px] font-medium">Who sees them</span>
            <textarea name="audience" rows={3} maxLength={220} defaultValue={audience.description} className={cx(inputClass, "mt-2 resize-y leading-snug")} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[14px] font-medium">Youngest</span>
              <input name="ageMin" type="number" inputMode="numeric" min={18} max={65} defaultValue={audience.ageMin} className={cx(inputClass, "mt-2 tabular")} />
            </label>
            <label className="block">
              <span className="text-[14px] font-medium">Oldest</span>
              <input name="ageMax" type="number" inputMode="numeric" min={18} max={65} defaultValue={audience.ageMax} className={cx(inputClass, "mt-2 tabular")} />
            </label>
          </div>
        </fieldset>
      ) : null}

      {problem ? (
        <p role="alert" className="rounded-xl bg-sunken px-3 py-2 text-[13px] text-negative">
          {problem}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <PendingButton pendingLabel="Saving…" disabled={tooLow} className={buttonClass("primary", touch)}>
          Save
        </PendingButton>
        {onDone ? (
          <button type="button" onClick={onDone} className={buttonClass("quiet", touch)}>
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}

/** The budget line with a "Change" button that opens the form in place. */
export function BudgetPanel(props: Omit<Parameters<typeof BudgetForm>[0], "onDone"> & { canChange: boolean; summary: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const { canChange, summary, ...form } = props;
  if (open) return <BudgetForm {...form} onDone={() => setOpen(false)} />;
  return (
    <div className="flex flex-col gap-3">
      {summary}
      {canChange ? (
        <button type="button" onClick={() => setOpen(true)} className={buttonClass("secondary", cx(touch, "self-start"))}>
          Change
        </button>
      ) : null}
    </div>
  );
}
