import "server-only";
import { orderDetail } from "@/connectors/cj/api";
import { asSystem, type Tx } from "@/lib/db";
import { cjOrderState, orderStatusFrom } from "./cj-order";

// Real CJ orders on their way to a shopper: the helper's once-a-minute sweep asks CJ where a few of
// them stand (each at most every 30 minutes), keeps the tracking number, and moves the order along:
// shipped once everything in it has shipped, delivered once it has all arrived. Nothing moves back.

const RANK: Record<string, number> = { placed: 0, shipped: 1, delivered: 2, cancelled: 3, failed: 3 };

async function moveOrders(tx: Tx, externalId: string): Promise<number> {
  const orders = await tx<{ orderId: string }[]>`
    select distinct l.order_id from armada.order_lines l join armada.supplier_orders so on so.order_line_id = l.id
    where so.supplier = 'cj' and so.external_id = ${externalId}`;
  let moved = 0;
  for (const { orderId } of orders) {
    const states = (await tx<{ status: string }[]>`
      select so.status from armada.supplier_orders so join armada.order_lines l on l.id = so.order_line_id where l.order_id = ${orderId}`).map((r) => r.status);
    const next = orderStatusFrom(states);
    if (!next) continue;
    const rows = await tx`
      update armada.orders set status = ${next.status}, problem = ${next.problem ?? null}
      where id = ${orderId} and status in ('ordered', 'shipped') and status <> ${next.status}
      returning id`;
    moved += rows.length;
  }
  return moved;
}

/** One pass: asks CJ about up to `limit` orders that are due a check. */
export async function syncCjOrders(limit = 6): Promise<{ checked: number; changed: number }> {
  const due = await asSystem(
    (tx) => tx<{ workspaceId: string; externalId: string; status: string }[]>`
      select workspace_id, external_id, min(status) as status from armada.supplier_orders
      where supplier = 'cj' and external_id is not null and status in ('placed', 'shipped')
      group by workspace_id, external_id
      having max(updated_at) < now() - interval '30 minutes'
      order by max(updated_at)
      limit ${limit}`,
  );
  let changed = 0;
  for (const d of due) {
    let s: ReturnType<typeof cjOrderState> | null = null;
    try {
      s = cjOrderState(await orderDetail(d.workspaceId, d.externalId));
    } catch (e) {
      console.error("CJ order check failed", d.externalId, e instanceof Error ? e.message : e);
    }
    await asSystem(async (tx) => {
      if (!s) {
        // Couldn't ask CJ: try again in 30 minutes.
        await tx`update armada.supplier_orders set updated_at = now() where supplier = 'cj' and external_id = ${d.externalId}`;
        return;
      }
      const rows = await tx<{ status: string }[]>`
        update armada.supplier_orders set
          status = case when ${RANK[s.state]}::int > (case status when 'placed' then 0 when 'shipped' then 1 when 'delivered' then 2 else 3 end) then ${s.state} else status end,
          tracking_number = coalesce(${s.tracking}, tracking_number),
          carrier = coalesce(${s.carrier}, carrier),
          updated_at = now()
        where supplier = 'cj' and external_id = ${d.externalId}
        returning status`;
      if (rows.some((r) => r.status !== d.status)) changed += await moveOrders(tx, d.externalId);
    });
  }
  return { checked: due.length, changed };
}
