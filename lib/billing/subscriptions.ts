import "server-only";
import { retrieveCheckoutSession, retrieveSubscription } from "@/connectors/stripe/client";
import { readCheckoutSession, readSubscription, type SubscriptionSnapshot } from "@/connectors/stripe/payloads";
import { asSystem, withWorkspace, type Tx } from "@/lib/db";
import { isEntitledStatus } from "./limits";
import type { BillingInterval, PlanKey } from "./plans";
import { priceIndex, stripeSecrets } from "./settings";

// A workspace's subscription (armada.subscriptions): what Stripe last said it pays for.

export interface SubscriptionRow {
  workspaceId: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  planKey: PlanKey;
  interval: BillingInterval | null;
  status: string;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  trialEnd: Date | null;
  paymentFailedAt: Date | null;
  livemode: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export async function subscriptionFor(workspaceId: string): Promise<SubscriptionRow | null> {
  const rows = await withWorkspace(workspaceId, (tx) => tx<SubscriptionRow[]>`select * from armada.subscriptions where workspace_id = ${workspaceId}`);
  return rows[0] ?? null;
}

/**
 * Which workspace a subscription belongs to: the one already holding it, else the one named at
 * checkout, else the one holding the same Stripe customer. Null if none exists (a deleted workspace).
 */
export async function workspaceForSubscription(tx: Tx, snap: SubscriptionSnapshot, hint: string | null = null): Promise<string | null> {
  const [held] = await tx<{ workspaceId: string }[]>`select workspace_id from armada.subscriptions where stripe_subscription_id = ${snap.subscriptionId}`;
  if (held) return held.workspaceId;
  for (const id of [hint, snap.workspaceId]) {
    if (!id) continue;
    const [ws] = await tx<{ id: string }[]>`select id from armada.workspaces where id = ${id}`;
    if (ws) return ws.id;
  }
  if (snap.customerId) {
    const [byCustomer] = await tx<{ workspaceId: string }[]>`select workspace_id from armada.subscriptions where stripe_customer_id = ${snap.customerId} limit 1`;
    if (byCustomer) return byCustomer.workspaceId;
  }
  return null;
}

/**
 * Saves what Stripe says about a subscription. A workspace has one row. A row that holds a live plan
 * is never replaced by news about a different, ended subscription (say, an old one that was cancelled
 * after the workspace moved to a new one).
 */
export async function saveSnapshot(tx: Tx, workspaceId: string, snap: SubscriptionSnapshot, payment: "paid" | "failed" | null = null): Promise<boolean> {
  if (!snap.planKey) return false;
  const rows = await tx`
    insert into armada.subscriptions as s
      (workspace_id, stripe_customer_id, stripe_subscription_id, plan_key, interval, status, current_period_end,
       cancel_at_period_end, trial_end, payment_failed_at, livemode, updated_at)
    values
      (${workspaceId}, ${snap.customerId}, ${snap.subscriptionId}, ${snap.planKey}, ${snap.interval}, ${snap.status}, ${snap.currentPeriodEnd},
       ${snap.cancelAtPeriodEnd}, ${snap.trialEnd}, ${payment === "failed" ? new Date() : null}, ${snap.livemode}, now())
    on conflict (workspace_id) do update set
      stripe_customer_id = coalesce(excluded.stripe_customer_id, s.stripe_customer_id),
      stripe_subscription_id = excluded.stripe_subscription_id,
      plan_key = excluded.plan_key,
      interval = excluded.interval,
      status = excluded.status,
      current_period_end = excluded.current_period_end,
      cancel_at_period_end = excluded.cancel_at_period_end,
      trial_end = excluded.trial_end,
      livemode = excluded.livemode,
      payment_failed_at = case ${payment ?? "none"}::text when 'failed' then now() when 'paid' then null else s.payment_failed_at end,
      updated_at = now()
    where s.stripe_subscription_id is not distinct from excluded.stripe_subscription_id
       or s.stripe_subscription_id is null
       or excluded.status in ('trialing', 'active', 'past_due')
       or s.status not in ('trialing', 'active', 'past_due')
    returning s.workspace_id`;
  return rows.length > 0;
}

/** Fetches a subscription from Stripe and saves it for the workspace. Used by the page to catch up. */
export async function syncSubscription(workspaceId: string, subscriptionId: string): Promise<SubscriptionSnapshot | null> {
  const secrets = await stripeSecrets();
  if (!secrets) return null;
  const snap = readSubscription(await retrieveSubscription(secrets.secretKey, subscriptionId), priceIndex(secrets.connection.priceIds));
  if (!snap) return null;
  await asSystem(async (tx) => {
    const owner = await workspaceForSubscription(tx, snap, workspaceId);
    if (owner === workspaceId) await saveSnapshot(tx, workspaceId, snap);
  });
  return snap;
}

/**
 * The workspace's subscription, first catching up with Stripe when the saved period has already
 * ended while the plan still shows as live (a renewal whose news hasn't arrived). If Stripe can't be
 * reached, it's what was last heard.
 */
export async function currentSubscription(workspaceId: string, connected: boolean): Promise<SubscriptionRow | null> {
  const sub = await subscriptionFor(workspaceId);
  const ended = sub?.currentPeriodEnd && new Date(sub.currentPeriodEnd).getTime() < Date.now();
  if (!connected || !sub?.stripeSubscriptionId || !isEntitledStatus(sub.status) || !ended) return sub;
  try {
    await syncSubscription(workspaceId, sub.stripeSubscriptionId);
    return await subscriptionFor(workspaceId);
  } catch {
    return sub;
  }
}

/**
 * Right after Stripe's checkout sends someone back: confirms the payment with Stripe and saves the
 * plan, so the page is right even before Stripe's notification arrives. Only for this workspace's own
 * checkout. Returns the plan now saved, or null.
 */
export async function confirmCheckout(workspaceId: string, sessionId: string): Promise<SubscriptionSnapshot | null> {
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) return null;
  const secrets = await stripeSecrets();
  if (!secrets) return null;
  const session = readCheckoutSession(await retrieveCheckoutSession(secrets.secretKey, sessionId));
  if (!session || session.workspaceId !== workspaceId || !session.complete || !session.subscriptionId) return null;
  return syncSubscription(workspaceId, session.subscriptionId);
}
