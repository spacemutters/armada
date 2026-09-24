"use server";

import { redirect } from "next/navigation";
import { createCheckoutSession, createPortalSession, retrieveSubscription } from "@/connectors/stripe/client";
import { describeStripeProblem, readSubscription } from "@/connectors/stripe/payloads";
import { requireSession } from "@/lib/auth/session";
import { isBillingAdmin, leaveNote } from "@/lib/billing/access";
import { standingFrom } from "@/lib/billing/entitlements";
import { isInterval, isPlanKey, planByKey } from "@/lib/billing/plans";
import { connectStripe, disconnectStripe, noteStripeProblem, priceIndex, refreshStripe, stripeSecrets } from "@/lib/billing/settings";
import { subscriptionFor } from "@/lib/billing/subscriptions";
import { appOrigin } from "@/lib/connections/types";
import { asSystem } from "@/lib/db";

// Every redirect happens outside try/catch: Next's redirect() works by throwing.

const SOMETHING_WRONG = "Stripe couldn't open that page just now. Try again in a minute.";

async function backWithNote(tone: "ok" | "error", text: string, hash = ""): Promise<never> {
  const id = await leaveNote(tone, text);
  redirect(`/billing?note=${id}${hash}`);
}

/**
 * "Choose <plan>": a workspace on the free plan goes to Stripe's checkout; one already paying goes
 * to Stripe's own confirm page for the switch (or for cancelling, when the choice is Practice).
 */
export async function choosePlan(formData: FormData) {
  const session = await requireSession();
  const planKey = formData.get("plan");
  const interval = formData.get("interval");
  if (session.role !== "owner" || !isPlanKey(planKey) || !isInterval(interval)) redirect("/billing");
  const secrets = await stripeSecrets();
  if (!secrets) redirect("/billing");
  const plan = planByKey(planKey)!;
  const sub = await subscriptionFor(session.workspaceId);
  const standing = standingFrom(sub);
  const returnUrl = `${appOrigin()}/billing`;

  let url: string | null = null;
  let problem: string | null = null;
  try {
    if (standing.paying && sub?.stripeCustomerId && sub.stripeSubscriptionId) {
      const portal = { customerId: sub.stripeCustomerId, configurationId: secrets.connection.portalConfigurationId, returnUrl };
      if (plan.key === "practice") {
        url = await createPortalSession(secrets.secretKey, { ...portal, flow: { type: "cancel", subscriptionId: sub.stripeSubscriptionId } });
      } else {
        const priceId = secrets.connection.priceIds[plan.key]?.[interval];
        const live = readSubscription(await retrieveSubscription(secrets.secretKey, sub.stripeSubscriptionId), priceIndex(secrets.connection.priceIds));
        url =
          priceId && live?.itemId
            ? await createPortalSession(secrets.secretKey, { ...portal, flow: { type: "switch", subscriptionId: sub.stripeSubscriptionId, itemId: live.itemId, priceId } })
            : await createPortalSession(secrets.secretKey, portal);
      }
    } else if (plan.key !== "practice") {
      const priceId = secrets.connection.priceIds[plan.key]?.[interval];
      if (!priceId) {
        problem = `${plan.name} isn't set up in Stripe yet. The Armada owner needs to press "Update plans in Stripe" on this page.`;
      } else {
        const [me] = await asSystem((tx) => tx<{ email: string | null }[]>`select email from armada.members where id = ${session.memberId}`);
        const checkout = await createCheckoutSession(secrets.secretKey, {
          workspaceId: session.workspaceId,
          plan,
          interval,
          priceId,
          // One free trial per workspace: only before its first paid plan.
          trialDays: sub ? 0 : plan.trialDays,
          customerId: sub?.stripeCustomerId ?? null,
          email: me?.email ?? null,
          origin: appOrigin(),
        });
        url = checkout.url;
      }
    }
  } catch (e) {
    await noteStripeProblem(describeStripeProblem(e)).catch(() => undefined);
    problem = SOMETHING_WRONG;
  }
  if (problem) await backWithNote("error", problem);
  redirect(url ?? "/billing");
}

/** "Manage billing": Stripe's page for the card, invoices and cancelling. `flow=card` opens straight on the card. */
export async function manageBilling(formData: FormData) {
  const session = await requireSession();
  if (session.role !== "owner") redirect("/billing");
  const [secrets, sub] = await Promise.all([stripeSecrets(), subscriptionFor(session.workspaceId)]);
  if (!secrets || !sub?.stripeCustomerId) redirect("/billing");
  let url: string | null = null;
  try {
    url = await createPortalSession(secrets.secretKey, {
      customerId: sub.stripeCustomerId,
      configurationId: secrets.connection.portalConfigurationId,
      returnUrl: `${appOrigin()}/billing`,
      flow: formData.get("flow") === "card" ? { type: "payment_method" } : undefined,
    });
  } catch (e) {
    await noteStripeProblem(describeStripeProblem(e)).catch(() => undefined);
  }
  if (!url) await backWithNote("error", SOMETHING_WRONG);
  redirect(url!);
}

// ---------- The Stripe connection (platform admins only) ----------

async function requireAdmin() {
  const session = await requireSession();
  if (!(await isBillingAdmin(session.memberId))) redirect("/billing");
  return { memberId: session.memberId, workspaceId: session.workspaceId };
}

export async function connectStripeAction(formData: FormData) {
  const who = await requireAdmin();
  const key = String(formData.get("key") ?? "");
  const result = await connectStripe(key, who);
  if (!result.ok) await backWithNote("error", result.message, "#stripe");
  await backWithNote("ok", `Stripe is connected${result.ok && result.accountName ? ` to ${result.accountName}` : ""}. Fleets can now choose a plan.`, "#stripe");
}

export async function refreshStripeAction() {
  const who = await requireAdmin();
  const result = await refreshStripe(who);
  if (!result.ok) await backWithNote("error", result.message, "#stripe");
  await backWithNote("ok", "Plans in Stripe are up to date.", "#stripe");
}

export async function disconnectStripeAction() {
  const who = await requireAdmin();
  await disconnectStripe(who);
  await backWithNote("ok", "Stripe is disconnected. Armada has forgotten the key.", "#stripe");
}
