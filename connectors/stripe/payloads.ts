import type { BillingInterval, Plan, PlanKey, PriceSpec } from "@/lib/billing/plans";
import type { FormParams } from "./form";

// What Armada sends to Stripe and how it reads what comes back. Pure: type imports only, so the
// offline check (scripts/check-stripe.mjs) can load it and test the exact request bodies.

/** The Stripe API version every request and the notification address are pinned to. */
export const STRIPE_API_VERSION = "2026-08-26.dahlia";

/** Everything Armada creates in Stripe carries this in its metadata, so it can find its own things again. */
export const ARMADA_METADATA = { armada: "billing" } as const;

export const WEBHOOK_PATH = "/api/stripe/webhook";

/** The notifications the billing page needs from Stripe. */
export const WEBHOOK_EVENTS = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
] as const;

// ---------- Products and Prices ----------

/** The Product's id in Stripe, chosen by Armada so a second connect finds it instead of making another. */
export function productId(plan: Plan): string {
  return `armada_${plan.key}`;
}

/** A plan sentence shortened to Stripe's 80 characters for a feature: first the full stop, then whole words. */
export function featureName(sentence: string): string {
  const s = sentence.trim();
  if (s.length <= 80) return s;
  const bare = s.replace(/\.$/, "");
  if (bare.length <= 80) return bare;
  const cut = bare.slice(0, 79);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 40)).trimEnd()}…`;
}

/** Name, description and features for a plan's Product (for creating or bringing it up to date). */
export function productParams(plan: Plan): FormParams {
  return {
    name: `Armada ${plan.name}`,
    description: plan.tagline,
    // Stripe allows 15 features of up to 80 characters each.
    marketing_features: plan.includes.slice(0, 15).map((s) => ({ name: featureName(s) })),
    metadata: { ...ARMADA_METADATA, armada_plan: plan.key },
  };
}

export function newProductParams(plan: Plan, withId = true): FormParams {
  return { ...(withId ? { id: productId(plan) } : {}), ...productParams(plan) };
}

export function priceParams(spec: PriceSpec, product: string, opts: { transferLookupKey?: boolean } = {}): FormParams {
  return {
    product,
    currency: spec.currency,
    unit_amount: spec.unitAmount,
    recurring: { interval: spec.interval },
    lookup_key: spec.lookupKey,
    transfer_lookup_key: opts.transferLookupKey ? true : undefined,
    nickname: `${spec.plan.name}, ${spec.interval === "year" ? "yearly" : "monthly"}`,
    metadata: { ...ARMADA_METADATA, armada_plan: spec.plan.key, armada_interval: spec.interval },
  };
}

/** Whether an existing Stripe Price is exactly the one a spec asks for. */
export function priceMatches(price: StripePriceLike, spec: PriceSpec): boolean {
  return (
    price.unit_amount === spec.unitAmount &&
    (price.currency ?? "").toLowerCase() === spec.currency &&
    price.recurring?.interval === spec.interval &&
    (price.recurring?.interval_count ?? 1) === 1 &&
    price.type !== "one_time"
  );
}

// ---------- Customer portal ----------

// A type (not an interface) so it fits FormParams' index signature.
export type PortalProduct = {
  product: string;
  prices: string[];
};

/** The billing page Stripe hosts for customers: card, invoices, switching plan, cancelling. */
export function portalConfigParams(opts: { products: PortalProduct[]; returnUrl: string }): FormParams {
  return {
    name: "Armada billing",
    business_profile: { headline: "Armada: your plan and billing" },
    default_return_url: opts.returnUrl,
    features: {
      customer_update: { enabled: true, allowed_updates: ["email", "name", "address"] },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: {
        enabled: true,
        mode: "at_period_end",
        cancellation_reason: { enabled: true, options: ["too_expensive", "missing_features", "switched_service", "unused", "other"] },
      },
      subscription_update: {
        enabled: true,
        default_allowed_updates: ["price"],
        proration_behavior: "create_prorations",
        // A move to a cheaper plan waits for the end of the paid period instead of refunding the difference.
        schedule_at_period_end: { conditions: [{ type: "decreasing_item_amount" }] },
        products: opts.products.slice(0, 10),
      },
    },
    metadata: { ...ARMADA_METADATA },
  };
}

// ---------- Notifications ----------

export function webhookParams(url: string): FormParams {
  return {
    url,
    enabled_events: [...WEBHOOK_EVENTS],
    api_version: STRIPE_API_VERSION,
    description: "Armada billing: plan changes and payments",
    metadata: { ...ARMADA_METADATA },
  };
}

/** For an endpoint Armada made earlier: same address and events, switched on. (Its version can't change.) */
export function webhookUpdateParams(url: string): FormParams {
  return { url, enabled_events: [...WEBHOOK_EVENTS], disabled: false, description: "Armada billing: plan changes and payments", metadata: { ...ARMADA_METADATA } };
}

// ---------- Checkout and portal sessions ----------

export interface CheckoutInput {
  workspaceId: string;
  plan: Plan;
  interval: BillingInterval;
  priceId: string;
  /** Free days before the first charge; 0 for none (a workspace only gets one trial). */
  trialDays: number;
  /** The workspace's Stripe customer from an earlier plan, so its card and invoices stay together. */
  customerId?: string | null;
  email?: string | null;
  origin: string;
}

export function checkoutParams(input: CheckoutInput): FormParams {
  const meta = { workspace_id: input.workspaceId, plan_key: input.plan.key, interval: input.interval };
  return {
    mode: "subscription",
    line_items: [{ price: input.priceId, quantity: 1 }],
    client_reference_id: input.workspaceId,
    metadata: meta,
    subscription_data: {
      metadata: meta,
      description: `Armada ${input.plan.name}`,
      trial_period_days: input.trialDays > 0 ? input.trialDays : undefined,
    },
    allow_promotion_codes: true,
    customer: input.customerId || undefined,
    customer_email: input.customerId ? undefined : input.email || undefined,
    // Stripe fills in {CHECKOUT_SESSION_ID}, so the page can confirm the payment the moment they're back.
    success_url: `${input.origin}/billing?checkout=done&session={CHECKOUT_SESSION_ID}`,
    cancel_url: `${input.origin}/billing?checkout=cancelled`,
  };
}

export type PortalFlow =
  | { type: "switch"; subscriptionId: string; itemId: string; priceId: string }
  | { type: "cancel"; subscriptionId: string }
  | { type: "payment_method" };

export function portalSessionParams(opts: { customerId: string; configurationId?: string | null; returnUrl: string; flow?: PortalFlow }): FormParams {
  const done = { type: "redirect", redirect: { return_url: opts.returnUrl } };
  const flow = opts.flow;
  return {
    customer: opts.customerId,
    configuration: opts.configurationId || undefined,
    return_url: opts.returnUrl,
    flow_data:
      flow?.type === "switch"
        ? {
            type: "subscription_update_confirm",
            subscription_update_confirm: { subscription: flow.subscriptionId, items: [{ id: flow.itemId, price: flow.priceId, quantity: 1 }] },
            after_completion: done,
          }
        : flow?.type === "cancel"
          ? { type: "subscription_cancel", subscription_cancel: { subscription: flow.subscriptionId }, after_completion: done }
          : flow?.type === "payment_method"
            ? { type: "payment_method_update", after_completion: done }
            : undefined,
  };
}

// ---------- Reading what Stripe sends back ----------

export interface StripePriceLike {
  id?: string;
  unit_amount?: number | null;
  currency?: string;
  type?: string;
  active?: boolean;
  lookup_key?: string | null;
  product?: string | { id?: string };
  recurring?: { interval?: string; interval_count?: number } | null;
  metadata?: Record<string, string>;
}

/** A Stripe id that may arrive as a plain id or as an expanded object. */
export function idOf(v: unknown): string | null {
  if (typeof v === "string" && v) return v;
  if (v && typeof v === "object" && typeof (v as { id?: unknown }).id === "string") return (v as { id: string }).id;
  return null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function asWorkspaceId(v: unknown): string | null {
  return typeof v === "string" && UUID.test(v) ? v.toLowerCase() : null;
}

const PLAN_KEYS: readonly string[] = ["practice", "starter", "growth", "fleet"];
const LOOKUP = /^armada_([a-z]+)_(month|year)_\d+[a-z]{3}$/;

/** Which Armada plan and interval a Stripe Price is, from its metadata, its lookup key, or the saved price ids. */
export function planOfPrice(price: StripePriceLike | null | undefined, known: Record<string, { plan: PlanKey; interval: BillingInterval }> = {}): { plan: PlanKey; interval: BillingInterval } | null {
  if (!price) return null;
  const interval = price.recurring?.interval === "year" ? "year" : price.recurring?.interval === "month" ? "month" : null;
  const metaPlan = price.metadata?.armada_plan;
  if (metaPlan && PLAN_KEYS.includes(metaPlan) && interval) return { plan: metaPlan as PlanKey, interval };
  const m = LOOKUP.exec(price.lookup_key ?? "");
  if (m && PLAN_KEYS.includes(m[1])) return { plan: m[1] as PlanKey, interval: m[2] as BillingInterval };
  if (price.id && known[price.id]) return known[price.id];
  return null;
}

export interface SubscriptionSnapshot {
  subscriptionId: string;
  customerId: string | null;
  /** From the subscription's metadata (set at checkout). */
  workspaceId: string | null;
  planKey: PlanKey | null;
  interval: BillingInterval | null;
  /** The subscription item that carries the plan, for switching plans. */
  itemId: string | null;
  status: string;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  trialEnd: Date | null;
  livemode: boolean;
}

const toDate = (s: unknown) => (typeof s === "number" && s > 0 ? new Date(s * 1000) : null);

/**
 * The parts of a Stripe Subscription Armada keeps. Since the 2025 "basil" versions the billing period
 * lives on each subscription item (items.data[].current_period_end), not on the subscription.
 */
export function readSubscription(sub: unknown, known: Record<string, { plan: PlanKey; interval: BillingInterval }> = {}): SubscriptionSnapshot | null {
  if (!sub || typeof sub !== "object") return null;
  const s = sub as Record<string, unknown>;
  if (s.object !== "subscription" || typeof s.id !== "string") return null;
  const items = ((s.items as { data?: unknown[] } | undefined)?.data ?? []) as Record<string, unknown>[];
  let chosen: { item: Record<string, unknown>; plan: { plan: PlanKey; interval: BillingInterval } } | null = null;
  for (const item of items) {
    const plan = planOfPrice(item.price as StripePriceLike, known);
    if (plan) {
      chosen = { item, plan };
      break;
    }
  }
  const meta = (s.metadata ?? {}) as Record<string, string>;
  const metaPlan = PLAN_KEYS.includes(meta.plan_key) ? (meta.plan_key as PlanKey) : null;
  const periodEnds = items.map((i) => i.current_period_end).filter((n): n is number => typeof n === "number");
  const cancelAt = toDate(s.cancel_at);
  return {
    subscriptionId: s.id,
    customerId: idOf(s.customer),
    workspaceId: asWorkspaceId(meta.workspace_id),
    planKey: chosen?.plan.plan ?? metaPlan,
    interval: chosen?.plan.interval ?? (meta.interval === "year" || meta.interval === "month" ? meta.interval : null),
    itemId: typeof (chosen?.item ?? items[0])?.id === "string" ? ((chosen?.item ?? items[0]).id as string) : null,
    status: typeof s.status === "string" ? s.status : "incomplete",
    currentPeriodEnd: periodEnds.length ? new Date(Math.max(...periodEnds) * 1000) : null,
    // The portal may set a cancel date instead of the flag; either way the plan ends and won't renew.
    cancelAtPeriodEnd: s.cancel_at_period_end === true || (cancelAt !== null && s.status !== "canceled"),
    trialEnd: toDate(s.trial_end),
    livemode: s.livemode === true,
  };
}

export interface CheckoutSnapshot {
  sessionId: string;
  workspaceId: string | null;
  subscriptionId: string | null;
  customerId: string | null;
  mode: string | null;
  complete: boolean;
}

export function readCheckoutSession(session: unknown): CheckoutSnapshot | null {
  if (!session || typeof session !== "object") return null;
  const s = session as Record<string, unknown>;
  if (s.object !== "checkout.session" || typeof s.id !== "string") return null;
  const meta = (s.metadata ?? {}) as Record<string, string>;
  return {
    sessionId: s.id,
    workspaceId: asWorkspaceId(s.client_reference_id) ?? asWorkspaceId(meta.workspace_id),
    subscriptionId: idOf(s.subscription),
    customerId: idOf(s.customer),
    mode: typeof s.mode === "string" ? s.mode : null,
    complete: s.status === "complete",
  };
}

/** The subscription an invoice belongs to (invoice.parent.subscription_details.subscription since "basil"). */
export function invoiceSubscriptionId(invoice: unknown): string | null {
  if (!invoice || typeof invoice !== "object") return null;
  const inv = invoice as { parent?: { subscription_details?: { subscription?: unknown } } | null; subscription?: unknown };
  return idOf(inv.parent?.subscription_details?.subscription) ?? idOf(inv.subscription);
}

// ---------- Keys and errors, in plain words ----------

export type KeyCheck = { ok: true; mode: "test" | "live"; restricted: boolean } | { ok: false; problem: "empty" | "publishable" | "webhook_secret" | "format" };

/** Whether pasted text looks like a Stripe secret or restricted key, before asking Stripe. */
export function checkKeyFormat(raw: string): KeyCheck {
  const key = raw.trim();
  if (!key) return { ok: false, problem: "empty" };
  if (/^pk_(test|live)_/.test(key)) return { ok: false, problem: "publishable" };
  if (/^whsec_/.test(key)) return { ok: false, problem: "webhook_secret" };
  const m = /^(sk|rk)_(test|live)_[A-Za-z0-9]{16,247}$/.exec(key);
  if (!m) return { ok: false, problem: "format" };
  return { ok: true, mode: m[2] as "test" | "live", restricted: m[1] === "rk" };
}

export const KEY_FORMAT_MESSAGES: Record<Exclude<KeyCheck, { ok: true }>["problem"], string> = {
  empty: "Paste your Stripe key first.",
  publishable: "That's your publishable key (it starts with pk_). Paste the restricted key instead: it starts with rk_.",
  webhook_secret: "That's a signing secret (it starts with whsec_). Armada makes its own. Paste the restricted key instead: it starts with rk_.",
  format: "That doesn't look like a Stripe key. A restricted key starts with rk_test_ or rk_live_. Copy it again and paste all of it.",
};

/** What went wrong with a Stripe request, in words the owner can act on. Never includes the key. */
export function describeStripeProblem(e: unknown): string {
  const err = (e && typeof e === "object" ? e : {}) as { status?: number; type?: string; message?: string };
  const perm = missingPermission(err.message);
  if (perm) return `Your Stripe key needs one more permission: set ${perm.resource} to ${perm.access}. In Stripe, open the key's menu, choose Edit key, change it, then press the button here again.`;
  if (err.status === 401 || err.type === "authentication_error") return "Stripe didn't accept that key. It may have been deleted or rolled. Copy it again from Stripe and paste all of it.";
  if (err.status === 0 || err.type === "network_error") return "Armada couldn't reach Stripe just now. Try again in a minute.";
  if (err.status === 429 || (err.status ?? 0) >= 500) return "Stripe is busy right now. Try again in a minute.";
  // Stripe's own sentence, minus anything that looks like a key.
  const said = (err.message ?? "")
    .replace(/\b(sk|rk|pk)_(test|live)_[A-Za-z0-9*]+/g, "your key")
    .replace(/\bwhsec_[A-Za-z0-9]+/g, "the signing secret")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
  return said ? `Stripe said: “${said}”` : "Stripe turned the request down. Try again in a minute.";
}

/** The permission names Stripe's restricted-key screen shows, for the ones Armada needs. */
export const PERMISSION_NAMES: Record<string, string> = {
  product: "Products",
  plan: "Prices",
  price: "Prices",
  checkout_session: "Checkout Sessions",
  customer_portal: "Customer portal",
  webhook: "Webhook Endpoints",
  subscription: "Subscriptions",
  customer: "Customers",
  connected_account: "Accounts",
  invoice: "Invoices",
};

/** From Stripe's "Having the 'rak_product_write' permission would allow this request" message. */
export function missingPermission(message: string | null | undefined): { resource: string; access: "Read" | "Write"; code: string } | null {
  const m = /rak_([a-z_]+?)_(read|write)\b/.exec(message ?? "");
  if (!m) return null;
  return { resource: PERMISSION_NAMES[m[1]] ?? m[1].replace(/_/g, " "), access: m[2] === "write" ? "Write" : "Read", code: `${m[1]}_${m[2]}` };
}

// ---------- Checkout on Armada's own storefronts ----------

/** Shop sales carry this in their metadata, apart from Armada's own plan billing. */
export const SHOP_ORDER_METADATA = { armada: "shop_order" } as const;

export interface ShopCheckoutInput {
  workspaceId: string;
  shopId: string;
  /** The storefront's address, like https://armada-pi.vercel.app/s/abc123 */
  shopUrl: string;
  currency: string;
  pay: { name: string; unitCents: number; qty: number; image: string | null }[];
  /** What was sold, one key per product (lib/shops/checkout-core soldMetadata). */
  sold: Record<string, string>;
  countries: readonly string[];
}

/** One payment on Stripe's own checkout page for a storefront bag. Cards only, so it's paid the moment it completes. */
export function shopCheckoutParams(input: ShopCheckoutInput): FormParams {
  const meta = { ...SHOP_ORDER_METADATA, workspace_id: input.workspaceId, shop_id: input.shopId };
  return {
    mode: "payment",
    line_items: input.pay.map((p) => ({
      quantity: p.qty,
      price_data: {
        currency: input.currency.toLowerCase(),
        unit_amount: p.unitCents,
        product_data: { name: p.name.slice(0, 250), images: p.image && /^https:\/\//.test(p.image) ? [p.image] : undefined },
      },
    })),
    payment_method_types: ["card"],
    shipping_address_collection: { allowed_countries: [...input.countries] },
    // The supplier needs a phone number to deliver.
    phone_number_collection: { enabled: true },
    shipping_options: [
      { shipping_rate_data: { type: "fixed_amount", display_name: "Free shipping", fixed_amount: { amount: 0, currency: input.currency.toLowerCase() } } },
    ],
    metadata: { ...meta, ...input.sold },
    payment_intent_data: { metadata: meta },
    success_url: `${input.shopUrl}/thanks?session={CHECKOUT_SESSION_ID}`,
    cancel_url: `${input.shopUrl}/cart`,
  };
}

export interface ShopCheckoutSnapshot {
  sessionId: string;
  workspaceId: string;
  shopId: string;
  paid: boolean;
  livemode: boolean;
  amountTotal: number;
  currency: string;
  country: string | null;
  metadata: Record<string, unknown>;
}

/** A storefront checkout, or null when the session is anything else (plan billing, someone else's). */
export function readShopCheckout(session: unknown): ShopCheckoutSnapshot | null {
  if (!session || typeof session !== "object") return null;
  const s = session as Record<string, unknown>;
  if (s.object !== "checkout.session" || typeof s.id !== "string" || s.mode !== "payment") return null;
  const meta = (s.metadata ?? {}) as Record<string, unknown>;
  if (meta.armada !== SHOP_ORDER_METADATA.armada) return null;
  const workspaceId = asWorkspaceId(meta.workspace_id);
  const shopId = asWorkspaceId(meta.shop_id);
  if (!workspaceId || !shopId) return null;
  const collected = (s.collected_information ?? {}) as { shipping_details?: { address?: { country?: unknown } } };
  const shipping = (collected.shipping_details ?? s.shipping_details ?? null) as { address?: { country?: unknown } } | null;
  const customer = (s.customer_details ?? null) as { address?: { country?: unknown } } | null;
  const country = shipping?.address?.country ?? customer?.address?.country;
  return {
    sessionId: s.id,
    workspaceId,
    shopId,
    paid: s.status === "complete" && s.payment_status === "paid",
    livemode: s.livemode === true,
    amountTotal: typeof s.amount_total === "number" ? s.amount_total : 0,
    currency: typeof s.currency === "string" ? s.currency.toUpperCase() : "USD",
    country: typeof country === "string" ? country : null,
    metadata: meta,
  };
}

/** Where to send an order, from a paid storefront checkout: Stripe collected it, and Armada doesn't keep it. */
export interface ShipTo {
  name: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  phone: string | null;
  email: string | null;
}

export function readShipTo(session: unknown): ShipTo | null {
  const s = (session ?? {}) as Record<string, unknown>;
  const collected = (s.collected_information ?? {}) as { shipping_details?: unknown };
  const shipping = (collected.shipping_details ?? s.shipping_details ?? null) as { name?: unknown; address?: Record<string, unknown> } | null;
  const customer = (s.customer_details ?? {}) as { name?: unknown; phone?: unknown; email?: unknown };
  const a = shipping?.address;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const name = str(shipping?.name) ?? str(customer.name);
  if (!a || !name || !str(a.line1) || !str(a.city) || !str(a.country)) return null;
  return {
    name,
    line1: str(a.line1)!,
    line2: str(a.line2),
    city: str(a.city)!,
    state: str(a.state) ?? "",
    postalCode: str(a.postal_code) ?? "",
    country: str(a.country)!,
    phone: str(customer.phone),
    email: str(customer.email),
  };
}
