import { verifySignature } from "@/connectors/stripe/signature";
import { stripeSecrets } from "@/lib/billing/settings";
import { handleStripeEvent } from "@/lib/billing/webhook";

// Stripe's notifications about plans and payments (registered by the connect step on /billing).
// The body is read raw, as bytes, because the signature covers exactly what Stripe sent; parsing it
// first would change it. /api/ is outside the sign-in check in proxy.ts, so Stripe can reach this.
// Answers: 200 handled (or safely skipped), 400 not from Stripe, 500 try again later.

export async function POST(request: Request) {
  const raw = new Uint8Array(await request.arrayBuffer());

  let secrets: Awaited<ReturnType<typeof stripeSecrets>>;
  try {
    secrets = await stripeSecrets();
  } catch {
    return Response.json({ error: "Billing settings can't be read right now." }, { status: 500 });
  }
  if (!secrets) return Response.json({ error: "Billing isn't connected." }, { status: 400 });

  const check = verifySignature(raw, request.headers.get("stripe-signature"), secrets.webhookSecret);
  if (!check.ok) return Response.json({ error: "The signature didn't check out.", reason: check.reason }, { status: 400 });

  let event: { id?: unknown; type?: unknown; data?: { object?: unknown } };
  try {
    event = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return Response.json({ error: "Not readable." }, { status: 400 });
  }
  if (typeof event.id !== "string" || typeof event.type !== "string") return Response.json({ error: "Not an event." }, { status: 400 });

  try {
    const outcome = await handleStripeEvent({ id: event.id, type: event.type, data: event.data }, secrets.secretKey, secrets.connection);
    return Response.json({ received: true, outcome });
  } catch (e) {
    console.error("stripe webhook: couldn't handle", event.type, event.id, e instanceof Error ? e.message : e);
    return Response.json({ error: "Couldn't handle it yet; Stripe will send it again." }, { status: 500 });
  }
}
