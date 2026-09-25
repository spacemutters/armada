import "server-only";
import { createOrder, freightOptions, pickFreight } from "@/connectors/cj/api";
import { describeCjError } from "@/connectors/cj/client";
import { retrieveCheckoutSession } from "@/connectors/stripe/client";
import { readShipTo } from "@/connectors/stripe/payloads";
import { stripeSecrets } from "@/lib/billing/settings";
import type { Tx } from "@/lib/db";
import { cjAnswerProblem, cjOrderInput, cjOrderNumber } from "./cj-order";

// Sending orders to the supplier spends real money on live stores, so this is guarded twice:
// a daily cap, and a unique key per order line that makes a second supplier order impossible
// (the "no double orders" build check replays a sale to prove it).
//
// - Practice stores: a practice supplier order, as before; nothing is bought.
// - An Armada shop's own store, live: a real CJ order to the address the shopper gave Stripe, paid
//   from the CJ balance. Each line is reserved first (the unique key), so two presses can't buy twice;
//   if CJ refuses, the reservation is let go and the order says why.
// - Other live stores: not sent automatically yet; the order says so instead of pretending.

export const DAILY_ORDER_CAP = 250;

export interface SendResult {
  sent: number;
  alreadySent: number;
  overCap: number;
  /** Orders that couldn't be sent; each says why on the Orders page. */
  problems: number;
}

interface Line {
  id: string;
  orderId: string;
  costCents: number;
  mode: string;
  platform: string;
  externalId: string;
  productId: string | null;
  quantity: number;
}

const NOT_AUTOMATIC = "Order this one on CJ yourself for now: automatic ordering for this store isn't switched on yet.";

export async function sendOrdersToSupplier(tx: Tx, workspaceId: string, orderIds: string[]): Promise<SendResult> {
  const [{ today }] = await tx<{ today: number }[]>`
    select count(distinct l.order_id)::int as today
    from armada.supplier_orders s join armada.order_lines l on l.id = s.order_line_id
    where s.created_at >= now() - interval '24 hours'`;
  let room = Math.max(0, DAILY_ORDER_CAP - today);

  const lines = await tx<Line[]>`
    select l.id, l.order_id, l.cost_cents, s.mode, s.platform, o.external_id, l.product_id, l.quantity
    from armada.order_lines l join armada.orders o on o.id = l.order_id join armada.stores s on s.id = o.store_id
    where l.order_id in ${tx(orderIds)} and o.status in ('new', 'problem')
    order by o.placed_at`;

  const byOrder = new Map<string, Line[]>();
  for (const l of lines) byOrder.set(l.orderId, [...(byOrder.get(l.orderId) ?? []), l]);

  const result: SendResult = { sent: 0, alreadySent: 0, overCap: 0, problems: 0 };
  for (const [orderId, orderLines] of byOrder) {
    if (room <= 0) {
      result.overCap++;
      continue;
    }
    const { mode, platform } = orderLines[0];
    if (mode !== "practice" && platform !== "armada") {
      await tx`update armada.orders set status = 'problem', problem = ${NOT_AUTOMATIC} where id = ${orderId} and status in ('new', 'problem')`;
      result.problems++;
      continue;
    }
    const outcome = mode === "practice" ? await sendPractice(tx, workspaceId, orderLines) : await sendToCj(tx, workspaceId, orderId, orderLines);
    if (outcome === "already") result.alreadySent++;
    else if (outcome === "problem") result.problems++;
    else {
      result.sent++;
      room--;
    }
    if (outcome !== "problem") await tx`update armada.orders set status = 'ordered', problem = null where id = ${orderId} and status in ('new', 'problem')`;
  }
  return result;
}

/** A practice supplier order for each line: nothing is bought. */
async function sendPractice(tx: Tx, workspaceId: string, lines: Line[]): Promise<"sent" | "already"> {
  let inserted = 0;
  for (const l of lines) {
    const rows = await tx`
      insert into armada.supplier_orders (workspace_id, order_line_id, supplier, external_id, cost_cents, status)
      values (${workspaceId}, ${l.id}, 'practice', ${"PS-" + Math.floor(Math.random() * 1e9)}, ${l.costCents}, 'placed')
      on conflict (order_line_id) do nothing
      returning id`;
    inserted += rows.length;
  }
  return inserted ? "sent" : "already";
}

/** A real CJ order for a paid storefront order. Reserves every line first, so it can only ever be bought once. */
async function sendToCj(tx: Tx, workspaceId: string, orderId: string, lines: Line[]): Promise<"sent" | "already" | "problem"> {
  const ids = lines.map((l) => l.id);
  let reserved = 0;
  for (const l of lines) {
    const rows = await tx`
      insert into armada.supplier_orders (workspace_id, order_line_id, supplier, external_id, cost_cents, status)
      values (${workspaceId}, ${l.id}, 'cj', null, ${l.costCents}, 'placed')
      on conflict (order_line_id) do nothing
      returning id`;
    reserved += rows.length;
  }
  if (reserved === 0) return "already";

  const giveUp = async (problem: string): Promise<"problem"> => {
    await tx`delete from armada.supplier_orders where order_line_id in ${tx(ids)} and supplier = 'cj' and external_id is null`;
    await tx`update armada.orders set status = 'problem', problem = ${problem} where id = ${orderId}`;
    return "problem";
  };
  if (reserved < lines.length) return giveUp("Part of this order was already sent to CJ. Check it in CJ before sending the rest by hand.");

  // What to buy: each line's CJ variant.
  const productIds = lines.map((l) => l.productId).filter((x): x is string => Boolean(x));
  const found = productIds.length
    ? await tx<{ id: string; source: string | null; attributes: { cj?: { defaultVid?: string; variants?: { vid: string }[] } } | null }[]>`
        select p.id, c.source, c.attributes from armada.products p left join armada.catalog_items c on c.id = p.catalog_item_id
        where p.id in ${tx(productIds)}`
    : [];
  const qty = new Map<string, number>();
  for (const l of lines) {
    const p = found.find((f) => f.id === l.productId);
    const vid = p?.source === "cj" ? (p.attributes?.cj?.defaultVid ?? p.attributes?.cj?.variants?.[0]?.vid) : undefined;
    if (!vid) return giveUp("One of these items isn't a CJ product Armada can order, so order it by hand.");
    qty.set(vid, (qty.get(vid) ?? 0) + l.quantity);
  }
  const items = [...qty].map(([vid, n]) => ({ vid, qty: n }));

  // Where to: the address the shopper gave Stripe (Armada doesn't keep it).
  const secrets = await stripeSecrets();
  if (!secrets) return giveUp("Payments aren't connected, so Armada can't read where to send this order.");
  let ship;
  try {
    ship = readShipTo(await retrieveCheckoutSession(secrets.secretKey, lines[0].externalId));
  } catch {
    return giveUp("Stripe didn't answer, so the address couldn't be read. Try again in a minute.");
  }
  if (!ship) return giveUp("Stripe has no shipping address for this order.");

  try {
    const freight = pickFreight(await freightOptions(workspaceId, items[0].vid, ship.country));
    if (!freight) return giveUp(`CJ can't ship this to ${ship.country}.`);
    const answer = await createOrder(workspaceId, cjOrderInput(orderId, ship, items, freight.name));
    const problem = cjAnswerProblem(answer);
    if (problem) return giveUp(problem);
    await tx`update armada.supplier_orders set external_id = ${answer.orderId} where order_line_id in ${tx(ids)} and supplier = 'cj' and external_id is null`;
    return "sent";
  } catch (e) {
    // Never sent again here: the first try may have placed it. The same order number can't be bought twice at CJ.
    return giveUp(`CJ didn't confirm (${describeCjError(e)}). Look for order ${cjOrderNumber(orderId)} in CJ before sending again.`);
  }
}
