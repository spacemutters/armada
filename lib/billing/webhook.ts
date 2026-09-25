import "server-only";
import { retrieveSubscription } from "@/connectors/stripe/client";
import { invoiceSubscriptionId, readCheckoutSession, readShopCheckout, readSubscription, WEBHOOK_EVENTS, type SubscriptionSnapshot } from "@/connectors/stripe/payloads";
import { recordShopOrder } from "@/lib/shops/checkout";
import { asSystem } from "@/lib/db";
import { priceIndex, type StripeConnection } from "./settings";
import { saveSnapshot, workspaceForSubscription } from "./subscriptions";

// What Armada does with each notification from Stripe (already signature-checked by the route).
// Stripe may send a notification twice and in any order, so:
// - every handled event id is recorded in armada.stripe_events, in the same transaction as its
//   effect, and a repeat is skipped;
// - the subscription is always fetched fresh from Stripe, so a late, older notification can't roll
//   a plan back to an earlier state.

export type Outcome = "saved" | "duplicate" | "ignored" | "not_armada" | "no_workspace" | "unchanged";

interface StripeEvent {
  id: string;
  type: string;
  data?: { object?: unknown };
}

const HANDLED: readonly string[] = WEBHOOK_EVENTS;

async function alreadyHandled(id: string): Promise<boolean> {
  const rows = await asSystem((tx) => tx`select 1 from armada.stripe_events where id = ${id}`);
  return rows.length > 0;
}

async function record(event: StripeEvent): Promise<void> {
  await asSystem((tx) => tx`insert into armada.stripe_events (id, type) values (${event.id}, ${event.type}) on conflict (id) do nothing`);
}

export async function handleStripeEvent(event: StripeEvent, secretKey: string, connection: StripeConnection): Promise<Outcome> {
  if (await alreadyHandled(event.id)) return "duplicate";
  if (!HANDLED.includes(event.type)) {
    await record(event);
    return "ignored";
  }
  const obj = event.data?.object as Record<string, unknown> | undefined;

  let subscriptionId: string | null = null;
  let workspaceHint: string | null = null;
  let payment: "paid" | "failed" | null = null;
  switch (event.type) {
    case "checkout.session.completed": {
      // A shopper paid on one of Armada's own storefronts: the order is recorded with the event, once.
      const sale = readShopCheckout(obj);
      if (sale) {
        if (!sale.paid) {
          await record(event);
          return "ignored";
        }
        await asSystem(async (tx) => {
          await recordShopOrder(tx, sale);
          await tx`insert into armada.stripe_events (id, type) values (${event.id}, ${event.type}) on conflict (id) do nothing`;
        });
        return "saved";
      }
      const s = readCheckoutSession(obj);
      if (!s || s.mode !== "subscription") break;
      subscriptionId = s.subscriptionId;
      workspaceHint = s.workspaceId;
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      subscriptionId = typeof obj?.id === "string" ? obj.id : null;
      break;
    case "invoice.paid":
      subscriptionId = invoiceSubscriptionId(obj);
      payment = "paid";
      break;
    case "invoice.payment_failed":
      subscriptionId = invoiceSubscriptionId(obj);
      payment = "failed";
      break;
  }
  if (!subscriptionId) {
    await record(event);
    return "ignored";
  }

  const known = priceIndex(connection.priceIds);
  let snap: SubscriptionSnapshot | null;
  try {
    snap = readSubscription(await retrieveSubscription(secretKey, subscriptionId), known);
  } catch (e) {
    // If Stripe can't be asked right now, a subscription notification carries the subscription itself.
    // Anything else fails, so Stripe sends it again later.
    if (!event.type.startsWith("customer.subscription.")) throw e;
    snap = readSubscription(obj, known);
  }

  return asSystem(async (tx) => {
    const fresh = await tx`insert into armada.stripe_events (id, type) values (${event.id}, ${event.type}) on conflict (id) do nothing returning id`;
    if (!fresh.length) return "duplicate" as const;
    if (!snap || !snap.planKey) return "not_armada" as const;
    const workspaceId = await workspaceForSubscription(tx, snap, workspaceHint);
    if (!workspaceId) return "no_workspace" as const;
    const saved = await saveSnapshot(tx, workspaceId, snap, payment);
    if (saved && (event.type === "checkout.session.completed" || event.type === "customer.subscription.deleted" || event.type === "invoice.payment_failed")) {
      const action =
        event.type === "checkout.session.completed" ? "billing.subscribed" : event.type === "customer.subscription.deleted" ? "billing.ended" : "billing.payment_failed";
      await tx`
        insert into armada.audit_log (workspace_id, action, detail)
        values (${workspaceId}, ${action}, ${tx.json({ plan: snap.planKey, interval: snap.interval, status: snap.status } as never)})`;
    }
    return saved ? ("saved" as const) : ("unchanged" as const);
  });
}
