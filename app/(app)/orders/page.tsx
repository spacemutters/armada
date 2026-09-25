import Link from "next/link";
import { sendToSupplier } from "./actions";
import { SegmentedNav } from "@/components/fx/glide";
import { PendingButton } from "@/components/fx/pending-button";
import { buttonClass, Card, EmptyState, PageHeader, StatusPill, type Tone } from "@/components/ui";
import { requireSession } from "@/lib/auth/session";
import { withWorkspace } from "@/lib/db";
import { formatMoney } from "@/lib/money";

export const metadata = { title: "Orders" };

const TABS = [
  { key: "needs", label: "Needs you", where: "o.status = 'problem' or (o.status = 'new' and o.placed_at < now() - interval '12 hours')" },
  { key: "new", label: "New", where: "o.status = 'new'" },
  { key: "supplier", label: "With the supplier", where: "o.status = 'ordered'" },
  { key: "shipped", label: "Shipped", where: "o.status = 'shipped'" },
  { key: "done", label: "Done", where: "o.status in ('delivered', 'refunded', 'cancelled')" },
] as const;

const STATUS: Record<string, { tone: Tone; label: string }> = {
  new: { tone: "working", label: "New" },
  ordered: { tone: "working", label: "With supplier" },
  shipped: { tone: "ok", label: "Shipped" },
  delivered: { tone: "ok", label: "Delivered" },
  problem: { tone: "attention", label: "Stuck" },
  refunded: { tone: "off", label: "Refunded" },
  cancelled: { tone: "off", label: "Cancelled" },
};

export default async function OrdersPage({ searchParams }: PageProps<"/orders">) {
  const session = await requireSession();
  const sp = await searchParams;
  const tab = TABS.find((t) => t.key === sp.tab) ?? TABS[0];

  const { orders, counts } = await withWorkspace(session.workspaceId, async (tx) => {
    const orders = await tx.unsafe<
      { id: string; externalId: string; storeName: string; storeId: string; placedAt: Date; totalCents: number; status: string; problem: string | null; items: number; tracking: string | null; title: string }[]
    >(`
      select o.id, o.external_id, s.name as store_name, s.id as store_id, o.placed_at, o.total_cents, o.status, o.problem,
             (select coalesce(sum(quantity), 0) from armada.order_lines l where l.order_id = o.id)::int as items,
             (select l.title from armada.order_lines l where l.order_id = o.id limit 1) as title,
             (select so.tracking_number from armada.supplier_orders so join armada.order_lines l on l.id = so.order_line_id
              where l.order_id = o.id and so.tracking_number is not null limit 1) as tracking
      from armada.orders o join armada.stores s on s.id = o.store_id
      where ${tab.where}
      order by o.placed_at desc
      limit 300`);
    const counts = await tx<{ key: string; n: number }[]>`
      select 'needs' as key, count(*)::int as n from armada.orders o where o.status = 'problem' or (o.status = 'new' and o.placed_at < now() - interval '12 hours')
      union all select 'new', count(*)::int from armada.orders o where o.status = 'new'
      union all select 'supplier', count(*)::int from armada.orders o where o.status = 'ordered'
      union all select 'shipped', count(*)::int from armada.orders o where o.status = 'shipped'
      union all select 'done', count(*)::int from armada.orders o where o.status in ('delivered', 'refunded', 'cancelled')`;
    return { orders, counts: Object.fromEntries(counts.map((c) => [c.key, c.n])) as Record<string, number> };
  });

  const sent = Number(sp.sent);
  const canSend = tab.key === "needs" || tab.key === "new";

  return (
    <>
      <PageHeader title="Orders" subtitle="Every order from every store in one inbox. New orders go to the supplier, and tracking numbers flow back to the store." />
      <SegmentedNav
        label="Orders"
        active={tab.key}
        className="mb-5"
        items={TABS.map((t) => ({ key: t.key, href: `/orders?tab=${t.key}`, label: t.label, count: counts[t.key] ?? 0 }))}
      />
      {sp.sent !== undefined ? (
        <p className="mb-4 rounded-xl bg-accent-soft px-4 py-3 text-[14px]">
          Sent {sent} {sent === 1 ? "order" : "orders"} to the supplier.
          {Number(sp.dupes) ? ` ${sp.dupes} had already been sent, so they weren't sent again.` : ""}
          {Number(sp.capped) ? ` ${sp.capped} waited because today's safety limit was reached.` : ""}
        </p>
      ) : null}
      {orders.length === 0 ? (
        <EmptyState title="Nothing here" body={tab.key === "needs" ? "No order needs you right now." : "No orders in this list."} />
      ) : (
        <form action={sendToSupplier}>
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-[14px]">
              <thead className="text-[12px] text-muted">
                <tr className="border-b border-line">
                  {canSend ? <th className="w-10 px-4 py-3"><span className="sr-only">Choose</span></th> : null}
                  <th className="px-4 py-3 font-medium">Order</th>
                  <th className="px-3 py-3 font-medium">Store</th>
                  <th className="px-3 py-3 font-medium">What</th>
                  <th className="px-3 py-3 text-right font-medium">Total</th>
                  <th className="px-3 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Tracking</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => {
                  const st = STATUS[o.status] ?? STATUS.new;
                  return (
                    <tr key={o.id} className="border-b border-line last:border-0 hover:bg-sunken">
                      {canSend ? (
                        <td className="px-4 py-2.5">
                          <input type="checkbox" name="orders" value={o.id} defaultChecked={o.status === "new"} className="size-5 accent-[var(--accent)]" aria-label={`Choose order ${o.externalId}`} />
                        </td>
                      ) : null}
                      <td className="px-4 py-2.5">
                        <div className="tabular font-medium">{o.externalId}</div>
                        <div className="text-[12px] text-muted">{new Date(o.placedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</div>
                      </td>
                      <td className="px-3 py-2.5">
                        <Link href={`/stores/${o.storeId}`} className="hover:underline">
                          {o.storeName}
                        </Link>
                      </td>
                      <td className="max-w-[260px] px-3 py-2.5">
                        <div className="truncate">{o.title}</div>
                        <div className="text-[12px] text-muted">
                          {o.items} {o.items === 1 ? "item" : "items"}
                          {o.problem ? ` · ${o.problem}` : ""}
                        </div>
                      </td>
                      <td className="tabular px-3 py-2.5 text-right">{formatMoney(o.totalCents)}</td>
                      <td className="px-3 py-2.5">
                        <StatusPill tone={st.tone}>{st.label}</StatusPill>
                      </td>
                      <td className="tabular px-4 py-2.5 text-[13px] text-muted">{o.tracking ?? "Not yet"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
          {canSend ? (
            <div className="glass sticky bottom-[calc(88px+env(safe-area-inset-bottom))] mt-4 flex items-center justify-end gap-3 rounded-2xl p-3 md:bottom-6">
              <span className="mr-auto px-2 text-[13px] text-ink">An order can only ever be sent once. Today&apos;s limit is 250 orders.</span>
              <PendingButton pendingLabel="Sending to the supplier…" className={buttonClass("primary")}>
                Send chosen to the supplier
              </PendingButton>
            </div>
          ) : null}
        </form>
      )}
    </>
  );
}
