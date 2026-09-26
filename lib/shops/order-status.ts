import "server-only";
import { asSystem } from "@/lib/db";
import { ORDER_TOKEN } from "@/connectors/stripe/payloads";
import { trackingUrl } from "@/lib/orders/cj-order";

// A shopper's own order, for /s/<slug>/order/<code>. The code is random, made when the checkout
// started, and only the buyer has it (on the thank-you page and Stripe's receipt); the order must
// belong to this shop. Shows where the order stands and the tracking link; never the address or anyone else's order.

export type OrderStep = "paid" | "ordered" | "shipped" | "delivered";

export interface ShopperOrder {
  placedAt: Date;
  totalCents: number;
  step: OrderStep;
  problem: boolean;
  lines: { title: string; qty: number }[];
  tracking: { number: string; carrier: string | null; url: string } | null;
}

export async function shopperOrder(shopId: string, token: string): Promise<ShopperOrder | null> {
  if (!ORDER_TOKEN.test(token)) return null;
  return asSystem(async (tx) => {
    const [o] = await tx<{ id: string; placedAt: Date; totalCents: number; status: string }[]>`
      select o.id, o.placed_at, o.total_cents, o.status from armada.orders o join armada.stores s on s.id = o.store_id
      where o.lookup_token = ${token} and s.platform = 'armada' and s.shop_id = ${shopId}`;
    if (!o) return null;
    const lines = await tx<{ title: string; quantity: number }[]>`select title, quantity from armada.order_lines where order_id = ${o.id} order by title`;
    const [t] = await tx<{ trackingNumber: string; carrier: string | null }[]>`
      select so.tracking_number, so.carrier from armada.supplier_orders so join armada.order_lines l on l.id = so.order_line_id
      where l.order_id = ${o.id} and so.tracking_number is not null limit 1`;
    const step: OrderStep = o.status === "delivered" ? "delivered" : o.status === "shipped" ? "shipped" : o.status === "ordered" ? "ordered" : "paid";
    return {
      placedAt: o.placedAt,
      totalCents: o.totalCents,
      step,
      problem: o.status === "problem" || o.status === "cancelled" || o.status === "refunded",
      lines: lines.map((l) => ({ title: l.title, qty: l.quantity })),
      tracking: t ? { number: t.trackingNumber, carrier: t.carrier, url: trackingUrl(t.trackingNumber) } : null,
    };
  });
}
