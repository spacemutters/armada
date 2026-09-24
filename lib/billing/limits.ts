import type { BillingInterval, LimitFeature, Plan, PlanLimits } from "./plans";
import type { SubscriptionRow } from "./subscriptions";

// The decisions behind a workspace's plan: which plan a subscription row means right now, and whether
// a plan allows one more of something. Pure (type imports only; the plan list is passed in), so the
// offline check can test every sentence and every upgrade suggestion. lib/billing/entitlements.ts
// wraps these with the real plans and the database.

/** Stripe statuses that still get the plan: paying, in a free trial, or a payment being retried. */
export const ENTITLED = ["trialing", "active", "past_due"] as const;

export function isEntitledStatus(status: string | null | undefined): boolean {
  return (ENTITLED as readonly string[]).includes(status ?? "");
}

/** If Stripe's renewal news is late, a paid plan keeps working this long past its period end. */
export const GRACE_MS = 3 * 24 * 3600 * 1000;

export interface PlanStanding {
  plan: Plan;
  /** The limits that apply right now: the plan's, tightened by its trial limits during a free trial. */
  limits: PlanLimits;
  /** Stripe's status, or "free" when the workspace pays for nothing. */
  status: string;
  paying: boolean;
  onTrial: boolean;
  interval: BillingInterval | null;
  /** When the next charge happens (null when free or ending). */
  renewsAt: Date | null;
  /** When a cancelled plan stops (it runs to the end of what was paid for). */
  endsAt: Date | null;
  trialEndsAt: Date | null;
  /** The last payment failed; Stripe is retrying. The plan still works meanwhile. */
  paymentProblem: boolean;
  subscription: SubscriptionRow | null;
}

type RowLike = Pick<SubscriptionRow, "planKey" | "status" | "interval" | "currentPeriodEnd" | "cancelAtPeriodEnd" | "trialEnd" | "paymentFailedAt">;

/** The limits in force: the plan's, with any trial limit taking the smaller value. */
export function limitsFor(plan: Plan, onTrial: boolean): PlanLimits {
  if (!onTrial) return plan.limits;
  const out = { ...plan.limits };
  for (const [f, t] of Object.entries(plan.trialLimits) as [LimitFeature, number | null | undefined][]) {
    if (t === undefined || t === null) continue;
    const base = out[f];
    out[f] = base === null ? t : Math.min(base, t);
  }
  return out;
}

/** What a subscription row means right now. Anything not live falls back to the free plan. */
export function standingFrom(sub: RowLike | null, plans: readonly Plan[], now = Date.now()): PlanStanding {
  const free = plans.find((p) => p.monthlyCents === 0) ?? plans[0];
  const plan = plans.find((p) => p.key === sub?.planKey) ?? null;
  const live = Boolean(
    sub && plan && isEntitledStatus(sub.status) && (!sub.currentPeriodEnd || new Date(sub.currentPeriodEnd).getTime() + GRACE_MS > now),
  );
  const row = (sub as SubscriptionRow | null) ?? null;
  if (!sub || !plan || !live) {
    return {
      plan: free,
      limits: free.limits,
      status: "free",
      paying: false,
      onTrial: false,
      interval: null,
      renewsAt: null,
      endsAt: null,
      trialEndsAt: null,
      paymentProblem: false,
      subscription: row,
    };
  }
  const onTrial = sub.status === "trialing" && sub.trialEnd !== null && new Date(sub.trialEnd).getTime() > now;
  return {
    plan,
    limits: limitsFor(plan, onTrial),
    status: sub.status,
    paying: true,
    onTrial,
    interval: sub.interval,
    renewsAt: sub.cancelAtPeriodEnd ? null : sub.currentPeriodEnd,
    endsAt: sub.cancelAtPeriodEnd ? sub.currentPeriodEnd : null,
    trialEndsAt: onTrial ? sub.trialEnd : null,
    paymentProblem: sub.status === "past_due" || Boolean(sub.paymentFailedAt),
    subscription: row,
  };
}

/** How each limit reads in a sentence: [one, many]. */
export const LIMIT_WORDS: Record<LimitFeature, [string, string]> = {
  stores: ["real store", "real stores"],
  products: ["product in real stores", "products in real stores"],
  shopBuildsPerMonth: ["shop build a month", "shop builds a month"],
  headlineTests: ["headline test a month", "headline tests a month"],
  seats: ["person", "people"],
};

/** "5 real stores", "1 person", "No limit on shop builds a month". */
export function describeLimit(feature: LimitFeature, limit: number | null): string {
  const [one, many] = LIMIT_WORDS[feature];
  if (limit === null) return `No limit on ${many}`;
  if (limit === 0) return `No ${many}`;
  return `${limit.toLocaleString("en-US")} ${limit === 1 ? one : many}`;
}

export interface CanUse {
  ok: boolean;
  /** One plain sentence for the person: what their plan allows, and what would allow more. */
  reason: string;
  /** The cheapest plan that would allow it, when the current one doesn't. Null when upgrading wouldn't help. */
  upgradeTo: Plan["key"] | null;
  limit: number | null;
  /** What was checked: in use now plus the one being added, or the `count` asked about. */
  wanted: number;
}

/**
 * Whether `plan` allows having `wanted` of `feature`; `plans` must be in order, cheapest first.
 * During a free trial the trial's tighter limits apply, and upgrading doesn't lift them.
 */
export function decide(plan: Plan, feature: LimitFeature, wanted: number, plans: readonly Plan[], opts: { onTrial?: boolean } = {}): CanUse {
  const full = plan.limits[feature];
  const limit = limitsFor(plan, Boolean(opts.onTrial))[feature];
  const ok = limit === null || wanted <= limit;
  const [, many] = LIMIT_WORDS[feature];
  const lower = (f: LimitFeature, n: number | null) => describeLimit(f, n).toLowerCase();

  if (ok) {
    const reason = limit === null ? `Your ${plan.name} plan has no limit on ${many}.` : `Your ${plan.name} plan includes ${lower(feature, limit)}.`;
    return { ok, reason, upgradeTo: null, limit, wanted };
  }
  if (limit !== full && (full === null || wanted <= full)) {
    // Only the trial's limit stands in the way, and every plan's trial has it.
    const after = full === null ? `no limit on ${many}` : lower(feature, full);
    const during = lower(feature, limit).replace(/ a month$/, ""); // a trial is shorter than a month
    return { ok, reason: `During the free trial, ${plan.name} includes ${during}. You get ${after} once the trial ends.`, upgradeTo: null, limit, wanted };
  }
  const rank = plans.findIndex((p) => p.key === plan.key);
  const upgrade = plans.find((p, i) => i > rank && (p.limits[feature] === null || (p.limits[feature] as number) >= wanted)) ?? null;
  // Past the plan's own limit (trial or not), so talk about the plan's full limit and the way up.
  const have = full === 0 ? `Your ${plan.name} plan doesn't include ${many}.` : `Your ${plan.name} plan includes ${lower(feature, full)}.`;
  const next = upgrade
    ? upgrade.limits[feature] === null
      ? ` ${upgrade.name} has no limit.`
      : ` ${upgrade.name} includes ${lower(feature, upgrade.limits[feature])}.`
    : " That's the most any plan includes.";
  return { ok, reason: have + next, upgradeTo: upgrade?.key ?? null, limit, wanted };
}
