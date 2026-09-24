import "server-only";
import { withWorkspace } from "@/lib/db";
import { decide, describeLimit, LIMIT_WORDS, standingFrom as standingWith, type CanUse, type PlanStanding } from "./limits";
import { PLANS, type LimitFeature } from "./plans";
import { subscriptionFor, type SubscriptionRow } from "./subscriptions";

// What a workspace's plan lets it do. Nothing calls this yet; see the report for where each check goes.
//
//   const { ok, reason, upgradeTo } = await canUse(session.workspaceId, "stores");
//   if (!ok) -> show `reason`, with a "See plans" link to /billing (upgradeTo names the plan that fits).

export { describeLimit, LIMIT_WORDS, type CanUse, type PlanStanding };

/** What a subscription row means right now, with Armada's plans. */
export function standingFrom(sub: SubscriptionRow | null, now = Date.now()): PlanStanding {
  return standingWith(sub, PLANS, now);
}

/** The plan a workspace is on right now. Practice (free) when nothing is paid for. */
export async function planFor(workspaceId: string): Promise<PlanStanding> {
  return standingFrom(await subscriptionFor(workspaceId));
}

/**
 * How much of each limit a workspace is using, by the pricing file's definitions. "A month" is the
 * calendar month (UTC) for everyone, monthly or yearly.
 */
export async function usageFor(workspaceId: string): Promise<Record<LimitFeature, number>> {
  return withWorkspace(workspaceId, async (tx) => {
    const [row] = await tx<Record<LimitFeature, number>[]>`
      select
        (select count(*)::int from armada.stores where mode = 'live' and status <> 'disconnected') as stores,
        (select count(distinct l.product_id)::int
           from armada.listings l join armada.stores s on s.id = l.store_id
          where s.mode = 'live' and s.status <> 'disconnected' and l.status in ('active', 'hidden')) as products,
        (select count(*)::int from armada.shops where created_at >= date_trunc('month', now()) and status <> 'failed') as shop_builds_per_month,
        (select count(*)::int from armada.ab_tests where created_at >= date_trunc('month', now()) and status <> 'failed') as headline_tests,
        (select count(*)::int from armada.members) as seats`;
    return row;
  });
}

/**
 * Whether the workspace's plan allows one more of `feature` (or, with `count`, allows having that
 * many in total). Counts current use from the database when `count` isn't given.
 */
export async function canUse(workspaceId: string, feature: LimitFeature, count?: number): Promise<CanUse> {
  const [standing, used] = await Promise.all([planFor(workspaceId), count === undefined ? usageFor(workspaceId) : Promise.resolve(null)]);
  const wanted = count ?? used![feature] + 1;
  return decide(standing.plan, feature, wanted, PLANS, { onTrial: standing.onTrial });
}
