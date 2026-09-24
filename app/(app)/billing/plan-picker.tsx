"use client";

import { Check } from "lucide-react";
import { useState, type KeyboardEvent } from "react";
import { RollingNumber, useGlide } from "@/components/fx";
import fx from "@/components/fx/fx.module.css";
import { cx, StatusPill } from "@/components/ui";
import type { BillingInterval, Plan, PlanKey } from "@/lib/billing/plans";
import { formatMoney } from "@/lib/money";
import { PendingButton } from "./pending-button";

// The plans side by side. The switch between monthly and yearly is instant (no page load), and the
// prices roll to their new amounts: the page's one moment of motion.
//
// The signature: each plan's real-store allowance drawn as fleet tiles, the same tiles as the fleet map
// on the home page; Practice draws hollow ones (a practice fleet). The first sentence under each plan
// says the number in words, so nothing rides on the drawing alone.
//
// The plans come in as props from the server page. This file must not import lib/billing/plans.ts for
// values: that would ship the whole pricing research (margins included) to every browser.

const priceFor = (plan: Plan, interval: BillingInterval) => (interval === "year" ? plan.yearlyCents : plan.monthlyCents);

function FleetTiles({ plan }: { plan: Plan }) {
  const n = plan.limits.stores;
  const practice = n === 0;
  const count = practice ? 8 : Math.min(n ?? 120, 120);
  const crowded = n === null || count > 66;
  return (
    <div
      aria-hidden
      className="mt-5 flex h-[35px] flex-wrap content-start gap-[3px] overflow-hidden"
      style={crowded ? { maskImage: "linear-gradient(to bottom, #000 55%, transparent)" } : undefined}
    >
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          className={cx("size-[9px] rounded-[2.5px]", practice && "border border-dashed border-line-strong")}
          style={practice ? undefined : { background: i < 3 ? "var(--tile-peak)" : i < 10 ? "var(--tile-busy)" : "var(--tile-mid)" }}
        />
      ))}
    </div>
  );
}

function IntervalSwitch({ value, onChange, yearlyNote }: { value: BillingInterval; onChange: (v: BillingInterval) => void; yearlyNote: string | null }) {
  const root = useGlide<HTMLDivElement>(value);
  const options: { key: BillingInterval; label: string; note?: string | null }[] = [
    { key: "month", label: "Monthly" },
    { key: "year", label: "Yearly", note: yearlyNote },
  ];
  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
    e.preventDefault();
    const next = value === "month" ? "year" : "month";
    onChange(next);
    root.current?.querySelector<HTMLButtonElement>(`[data-glide-key="${next}"]`)?.focus();
  };
  return (
    <div ref={root} role="radiogroup" aria-label="How often to pay" className={cx(fx.glide, "relative inline-flex gap-1 rounded-xl border border-line bg-raised p-1 text-[14px]")}>
      <span data-glide-ind="" aria-hidden className={cx(fx.glideInd, "rounded-lg bg-sunken")} />
      {options.map((o) => {
        const on = o.key === value;
        return (
          <button
            key={o.key}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            data-glide-key={o.key}
            data-glide-on={on ? "" : undefined}
            onClick={() => onChange(o.key)}
            onKeyDown={onKey}
            className={cx("flex min-h-11 items-center gap-2 rounded-lg px-4 transition-colors md:min-h-9", on ? "font-semibold text-ink" : "text-muted hover:text-ink")}
          >
            {o.label}
            {o.note ? <span className="text-[12px] font-normal text-muted">{o.note}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/** "2 months free" when every paid plan saves the same whole number of months by paying yearly. */
function yearlySaving(plans: Plan[]): string | null {
  const months = plans.filter((p) => p.monthlyCents > 0).map((p) => (p.monthlyCents * 12 - p.yearlyCents) / p.monthlyCents);
  if (!months.length || months.some((m) => m !== months[0]) || !Number.isInteger(months[0]) || months[0] < 1) return null;
  return `${months[0]} month${months[0] === 1 ? "" : "s"} free`;
}

export interface PlanPickerProps {
  plans: Plan[];
  /** `ending`: the paid plan is already cancelled and runs out at the end of the period. */
  current: { planKey: PlanKey; interval: BillingInterval | null; paying: boolean; ending: boolean };
  /** True for the owner once Stripe is connected; everyone else just reads. */
  canChoose: boolean;
  /** No paid plan yet, so a first paid plan starts with its free days. */
  trialEligible: boolean;
  choose: (formData: FormData) => Promise<void>;
}

export function PlanPicker({ plans, current, canChoose, trialEligible, choose }: PlanPickerProps) {
  const [interval, setEvery] = useState<BillingInterval>(current.interval ?? "month");
  const saving = yearlySaving(plans);

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 id="plans" className="text-[20px] font-semibold tracking-tight">
            Plans
          </h2>
          <p className="mt-1 text-[14px] text-muted">Prices in US dollars. Change plan or cancel any time.</p>
        </div>
        <IntervalSwitch value={interval} onChange={setEvery} yearlyNote={saving} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 min-[1400px]:grid-cols-4">
        {plans.map((plan) => {
          const free = plan.monthlyCents === 0;
          const cents = priceFor(plan, interval);
          const isCurrent = plan.key === current.planKey;
          const sameInterval = free || current.interval === interval;
          let action: string | null = null;
          if (canChoose) {
            if (isCurrent && sameInterval) action = null;
            else if (isCurrent) action = interval === "year" ? "Switch to yearly" : "Switch to monthly";
            else if (free) action = current.paying && !current.ending ? "Switch to Practice" : null;
            else action = current.paying ? `Switch to ${plan.name}` : `Choose ${plan.name}`;
          }
          const primary = !current.paying && plan.recommended;
          const trialBuilds = plan.trialLimits.shopBuildsPerMonth;
          return (
            <article
              key={plan.key}
              aria-labelledby={`plan-${plan.key}`}
              className={cx("relative flex flex-col rounded-2xl border bg-raised p-5", plan.recommended ? "border-accent shadow-[0_0_0_1px_var(--accent)]" : "border-line")}
            >
              <div className="flex min-h-7 items-center justify-between gap-2">
                <h3 id={`plan-${plan.key}`} className="text-[17px] font-semibold tracking-tight">
                  {plan.name}
                </h3>
                {isCurrent ? (
                  <StatusPill tone="ok">Your plan</StatusPill>
                ) : plan.recommended ? (
                  <span className="text-[13px] font-medium text-accent">Recommended</span>
                ) : null}
              </div>
              <p className="mt-1 text-[14px] leading-snug text-muted sm:min-h-[2.75em]">{plan.tagline}</p>

              <div className="mt-5 flex items-baseline gap-1.5">
                {free ? (
                  <span className="text-[34px] leading-none font-semibold tracking-tight">Free</span>
                ) : (
                  <>
                    <span className="tabular text-[34px] leading-none font-semibold tracking-tight">
                      <RollingNumber value={formatMoney(cents)} />
                    </span>
                    <span className="text-[14px] text-muted">{interval === "year" ? "a year" : "a month"}</span>
                  </>
                )}
              </div>
              <p className="mt-2 min-h-5 text-[13px] text-muted">
                {free
                  ? "Free for as long as you like"
                  : interval === "year"
                    ? `${formatMoney(Math.round(plan.yearlyCents / 12), "USD", { whole: true })} a month, paid yearly`
                    : trialEligible && plan.trialDays > 0
                      ? `First ${plan.trialDays} days free${trialBuilds != null ? `, with ${trialBuilds} shop builds` : ""}`
                      : "Paid monthly"}
              </p>

              <FleetTiles plan={plan} />

              <ul className="mt-4 space-y-2 border-t border-line pt-4 text-[14px]">
                {plan.includes.map((line) => (
                  <li key={line} className="flex gap-2">
                    <Check aria-hidden className="mt-[3px] size-4 shrink-0 text-muted" strokeWidth={2} />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-auto pt-5">
                {action ? (
                  <form action={choose}>
                    <input type="hidden" name="plan" value={plan.key} />
                    <input type="hidden" name="interval" value={interval} />
                    <PendingButton variant={primary ? "primary" : "secondary"} pendingLabel="Opening Stripe…" className="w-full">
                      {action}
                    </PendingButton>
                  </form>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
