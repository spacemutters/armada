import "server-only";
import { randomBytes } from "node:crypto";
import { createShopCheckoutSession, retrieveCheckoutSession } from "@/connectors/stripe/client";
import { describeStripeProblem, readShopCheckout, type ShopCheckoutSnapshot } from "@/connectors/stripe/payloads";
import { stripeConnection, stripeSecrets } from "@/lib/billing/settings";
import { appOrigin } from "@/lib/connections/types";
import { asSystem, withWorkspace, type Tx } from "@/lib/db";
import { feesCents } from "@/lib/pricing";
import { CHECKOUT_COUNTRIES, planCheckout, readSoldMetadata, soldMetadata, type CheckoutItem } from "./checkout-core";
import { loadStorefront, storeItems } from "./storefront";
import type { ShopRow } from "./types";

// Checkout on Armada's own storefronts. The shopper pays on Stripe's own page, into the Stripe
// account connected on Plan and billing; the paid checkout becomes an order on the shop's own store
// (platform 'armada'), and the Orders page sends it to the supplier like any other order.
// Prices always come from the shop, never from the shopper's browser (checkout-core.ts).

export type CheckoutState = { open: true; test: boolean } | { open: false; why: "practice" | "closed" | "payments" };

/**
 * The workspace whose shops the connected Stripe account takes payments for: the one of the person
 * who connected it (the Armada owner). Stripe on Plan and billing is Armada's own account, so another
 * workspace's shoppers must never pay into it; their shops need their own payments first.
 */
async function paymentsWorkspace(): Promise<string | null> {
  const rows = await asSystem(
    (tx) => tx<{ workspaceId: string }[]>`select m.workspace_id from armada.billing_settings b join armada.members m on m.id = b.connected_by`,
  );
  return rows[0]?.workspaceId ?? null;
}

/** Whether payments are connected for this shop's workspace, and in test mode or live. */
export async function paymentsFor(workspaceId: string): Promise<{ connected: boolean; test: boolean }> {
  const conn = await stripeConnection();
  if (!conn || (await paymentsWorkspace()) !== workspaceId) return { connected: false, test: false };
  return { connected: true, test: !conn.livemode };
}

/** Whether this shop takes payments right now, and if not, why. */
export async function checkoutState(shop: ShopRow): Promise<CheckoutState> {
  if (shop.brief?.source === "practice") return { open: false, why: "practice" };
  if (!shop.checkoutOpen) return { open: false, why: "closed" };
  const pay = await paymentsFor(shop.workspaceId);
  if (!pay.connected) return { open: false, why: "payments" };
  return { open: true, test: pay.test };
}

/** Short words for a closed checkout, for the shop's bag. */
export const CLOSED_WORDS: Record<Exclude<CheckoutState, { open: true }>["why"], string> = {
  practice: "This is a practice shop, so checkout is off.",
  closed: "Checkout opens when the shop launches.",
  payments: "Checkout opens when payments are connected.",
};

function absoluteImage(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url, `${appOrigin()}/`);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Stripe's checkout page for a shopper's bag. Returns its address, or a plain problem. */
export async function startShopCheckout(slug: string, rawBag: unknown): Promise<{ url: string } | { problem: string }> {
  const data = await loadStorefront(slug);
  if (!data) return { problem: "This shop isn't open." };
  const state = await checkoutState(data.shop);
  if (!state.open) return { problem: CLOSED_WORDS[state.why] };
  const items: CheckoutItem[] = storeItems(data.shop, data.products).map((i) => ({
    handle: i.handle,
    productId: i.product.id,
    title: i.product.title,
    priceCents: i.priceCents,
    image: absoluteImage(i.product.images[0]?.url),
    imagined: i.imagined,
  }));
  const plan = planCheckout(rawBag, items, data.shop.blueprint.sets ?? []);
  if (!plan.ok) return { problem: plan.problem };
  const secrets = await stripeSecrets();
  if (!secrets) return { problem: CLOSED_WORDS.payments };
  try {
    const s = await createShopCheckoutSession(secrets.secretKey, {
      workspaceId: data.shop.workspaceId,
      shopId: data.shop.id,
      shopUrl: `${appOrigin()}/s/${slug}`,
      currency: "USD",
      pay: plan.pay,
      sold: soldMetadata(plan.sold),
      countries: CHECKOUT_COUNTRIES,
      shopName: data.shop.blueprint.brand?.name || data.shop.niche,
      orderToken: randomBytes(18).toString("base64url"),
    });
    return { url: s.url };
  } catch (e) {
    console.error("storefront checkout: Stripe refused", e instanceof Error ? e.message : e);
    return { problem: `Checkout couldn't start: ${describeStripeProblem(e)}` };
  }
}

/** The shop's own store for this payment mode (test payments get a practice store), made on first use. */
async function shopStore(tx: Tx, shop: ShopRow, live: boolean): Promise<string> {
  const mode = live ? "live" : "practice";
  const [found] = await tx<{ id: string }[]>`select id from armada.stores where shop_id = ${shop.id} and platform = 'armada' and mode = ${mode}`;
  if (found) return found.id;
  const name = `${shop.blueprint.brand?.name || shop.niche}${live ? "" : " (test payments)"}`;
  const domain = `${appOrigin().replace(/^https?:\/\//, "")}/s/${shop.slug}`;
  const [made] = await tx<{ id: string }[]>`
    insert into armada.stores (workspace_id, platform, mode, name, domain, currency, country, status, shop_id)
    values (${shop.workspaceId}, 'armada', ${mode}, ${name}, ${domain}, 'USD', 'US', 'connected', ${shop.id})
    on conflict (shop_id, mode) where platform = 'armada' do update set name = excluded.name
    returning id`;
  return made.id;
}

/**
 * Records a paid storefront checkout as an order (once: a repeat of the same checkout is skipped by
 * the orders table's unique key). Runs as the system, from Stripe's notification or the thank-you page.
 */
export async function recordShopOrder(tx: Tx, snap: ShopCheckoutSnapshot): Promise<"saved" | "duplicate" | "no_shop" | "unpaid"> {
  if (!snap.paid) return "unpaid";
  const [shop] = await tx<ShopRow[]>`select * from armada.shops where id = ${snap.shopId} and workspace_id = ${snap.workspaceId}`;
  if (!shop) return "no_shop";
  const storeId = await shopStore(tx, shop, snap.livemode);
  const [order] = await tx<{ id: string }[]>`
    insert into armada.orders (workspace_id, store_id, external_id, placed_at, customer_country, total_cents, fees_cents, lookup_token)
    values (${shop.workspaceId}, ${storeId}, ${snap.sessionId}, now(), ${snap.country}, ${snap.amountTotal}, ${feesCents(snap.amountTotal, "armada")}, ${snap.orderToken})
    on conflict (store_id, external_id) do nothing
    returning id`;
  if (!order) return "duplicate";
  const sold = readSoldMetadata(snap.metadata);
  const products = sold.length
    ? await tx<{ id: string; title: string; costCents: number; shipCents: number }[]>`
        select id, title, cost_cents, ship_cents from armada.products where id in ${tx(sold.map((s) => s.productId))} and workspace_id = ${shop.workspaceId}`
    : [];
  for (const s of sold) {
    const p = products.find((x) => x.id === s.productId);
    if (!p) continue;
    await tx`
      insert into armada.order_lines (workspace_id, order_id, product_id, title, quantity, price_cents, cost_cents)
      values (${shop.workspaceId}, ${order.id}, ${p.id}, ${p.title}, ${s.qty}, ${s.unitCents}, ${p.costCents + p.shipCents})`;
  }
  await tx`
    insert into armada.audit_log (workspace_id, action, detail)
    values (${shop.workspaceId}, 'shop.order_paid', ${tx.json({ shopId: shop.id, orderId: order.id, totalCents: snap.amountTotal, test: !snap.livemode } as never)})`;
  return "saved";
}

/** For the thank-you page: whether this checkout was paid, for this shop. Records the order too, in case Stripe's notification is late. */
export async function confirmShopCheckout(shop: ShopRow, sessionId: string): Promise<{ paid: boolean; test: boolean; orderToken?: string | null }> {
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) return { paid: false, test: false };
  const secrets = await stripeSecrets();
  if (!secrets) return { paid: false, test: false };
  try {
    const snap = readShopCheckout(await retrieveCheckoutSession(secrets.secretKey, sessionId));
    if (!snap || snap.shopId !== shop.id || !snap.paid) return { paid: false, test: false };
    await asSystem((tx) => recordShopOrder(tx, snap));
    return { paid: true, test: !snap.livemode, orderToken: snap.orderToken };
  } catch (e) {
    console.error("storefront checkout: couldn't confirm", e instanceof Error ? e.message : e);
    return { paid: false, test: false };
  }
}

/** Launch's checkout line: opens a real shop for sales once payments are connected. */
export async function openShopCheckout(workspaceId: string, shopId: string): Promise<void> {
  await withWorkspace(workspaceId, (tx) => tx`update armada.shops set checkout_open = true where id = ${shopId} and not checkout_open`);
}
