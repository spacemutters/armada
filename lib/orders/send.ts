import "server-only";
import type { Tx } from "@/lib/db";

// Sending orders to the supplier spends real money on live stores, so this is guarded twice:
// a daily cap, and a unique key per order line that makes a second supplier order impossible
// (the "no double orders" build check replays a sale to prove it).

export const DAILY_ORDER_CAP = 250;

export interface SendResult {
  sent: number;
  alreadySent: number;
  overCap: number;
}

export async function sendOrdersToSupplier(tx: Tx, workspaceId: string, orderIds: string[]): Promise<SendResult> {
  const [{ today }] = await tx<{ today: number }[]>`
    select count(distinct l.order_id)::int as today
    from armada.supplier_orders s join armada.order_lines l on l.id = s.order_line_id
    where s.created_at >= now() - interval '24 hours'`;
  let room = Math.max(0, DAILY_ORDER_CAP - today);

  const lines = await tx<{ id: string; orderId: string; costCents: number; mode: string }[]>`
    select l.id, l.order_id, l.cost_cents, s.mode
    from armada.order_lines l join armada.orders o on o.id = l.order_id join armada.stores s on s.id = o.store_id
    where l.order_id in ${tx(orderIds)} and o.status in ('new', 'problem')
    order by o.placed_at`;

  const byOrder = new Map<string, (typeof lines)[number][]>();
  for (const l of lines) byOrder.set(l.orderId, [...(byOrder.get(l.orderId) ?? []), l]);

  const result: SendResult = { sent: 0, alreadySent: 0, overCap: 0 };
  for (const [orderId, orderLines] of byOrder) {
    if (room <= 0) {
      result.overCap++;
      continue;
    }
    let inserted = 0;
    for (const l of orderLines) {
      const rows = await tx`
        insert into armada.supplier_orders (workspace_id, order_line_id, supplier, external_id, cost_cents, status)
        values (${workspaceId}, ${l.id}, ${l.mode === "practice" ? "practice" : "cj"}, ${"PS-" + Math.floor(Math.random() * 1e9)}, ${l.costCents}, 'placed')
        on conflict (order_line_id) do nothing
        returning id`;
      inserted += rows.length;
    }
    if (inserted === 0) {
      result.alreadySent++;
    } else {
      result.sent++;
      room--;
    }
    await tx`update armada.orders set status = 'ordered', problem = null where id = ${orderId} and status in ('new', 'problem')`;
  }
  return result;
}
