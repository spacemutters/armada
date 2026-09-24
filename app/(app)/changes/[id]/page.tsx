import { notFound } from "next/navigation";
import { approveChange, cancelChange, undo } from "../actions";
import { Button, Card, PageHeader, Section, StatusPill } from "@/components/ui";
import { requireSession } from "@/lib/auth/session";
import { CHANGE_STATUS } from "@/lib/changes/labels";
import { withWorkspace } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { timeAgo } from "@/lib/text";

export const metadata = { title: "Change" };

interface Item {
  id: string;
  storeName: string | null;
  productTitle: string | null;
  before: { priceCents?: number; status?: string } | null;
  after: { priceCents?: number; status?: string; removed?: boolean } | null;
  status: string;
  error: string | null;
}

function describe(it: Item): string {
  if (it.after?.removed) return "Taken back out";
  if (it.before === null && it.after?.priceCents != null) return `Listed at ${formatMoney(it.after.priceCents)}`;
  if (it.before?.priceCents != null && it.after?.priceCents != null && it.before.priceCents !== it.after.priceCents) {
    return `${formatMoney(it.before.priceCents)} → ${formatMoney(it.after.priceCents)}`;
  }
  if (it.before === null) return "Listed";
  return "Changed";
}

export default async function ChangePage({ params }: PageProps<"/changes/[id]">) {
  const session = await requireSession();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const data = await withWorkspace(session.workspaceId, async (tx) => {
    const [cs] = await tx<{ id: string; summary: string; status: string; kind: string; createdAt: Date; params: { skipped?: { storeName: string; productTitle: string; reason: string }[] }; undoOf: string | null; who: string | null }[]>`
      select c.*, m.display_name as who from armada.change_sets c left join armada.members m on m.id = c.created_by where c.id = ${id}`;
    if (!cs) return null;
    const items = await tx<Item[]>`
      select i.id, s.name as store_name,
             coalesce(p.title, (select p2.title from armada.products p2 where p2.id::text = i.after ->> 'productId')) as product_title,
             i.before, i.after, i.status, i.error
      from armada.change_items i
      left join armada.stores s on s.id = i.store_id
      left join armada.listings l on l.id = i.target_id
      left join armada.products p on p.id = l.product_id
      where i.change_set_id = ${id}
      order by s.name, product_title
      limit 2000`;
    return { cs, items };
  });
  if (!data) notFound();
  const { cs, items } = data;
  const st = CHANGE_STATUS[cs.status] ?? CHANGE_STATUS.done;
  const skipped = cs.params?.skipped ?? [];
  const stores = new Set(items.map((i) => i.storeName)).size;

  return (
    <>
      <PageHeader
        title={cs.summary}
        subtitle={`${cs.who ?? "Armada"} · ${timeAgo(cs.createdAt)} · ${items.length} ${items.length === 1 ? "change" : "changes"} in ${stores} ${stores === 1 ? "store" : "stores"}`}
        actions={<StatusPill tone={st.tone}>{st.label}</StatusPill>}
      />

      {cs.status === "preview" ? (
        <Card className="mb-4 flex flex-wrap items-center gap-3 p-5">
          <p className="mr-auto max-w-xl text-[14px]">
            This is a preview. Nothing has changed yet. {items.length === 0 ? "There's nothing to do, so there's nothing to approve." : "Approve it to apply every change below."}
          </p>
          <form action={cancelChange.bind(null, cs.id)}>
            <Button type="submit" variant="secondary">
              Cancel
            </Button>
          </form>
          {items.length ? (
            <form action={approveChange.bind(null, cs.id)}>
              <Button type="submit">Approve and apply</Button>
            </form>
          ) : null}
        </Card>
      ) : null}

      {cs.status === "done" || cs.status === "partial" ? (
        <Card className="mb-4 flex flex-wrap items-center gap-3 p-5">
          <p className="mr-auto text-[14px] text-muted">Every change here saved what was there before, so it can be put back.</p>
          <form action={undo.bind(null, cs.id)}>
            <Button type="submit" variant="secondary">
              Undo this change
            </Button>
          </form>
        </Card>
      ) : null}

      {skipped.length ? (
        <Section title={`Left out (${skipped.length})`} className="mb-4">
          <ul className="flex flex-col divide-y divide-line text-[14px]">
            {skipped.slice(0, 100).map((s, i) => (
              <li key={i} className="flex flex-wrap justify-between gap-2 py-2">
                <span>
                  {s.productTitle} <span className="text-muted">in {s.storeName}</span>
                </span>
                <span className="text-muted">{s.reason}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title="Changes">
        {items.length ? (
          <ul className="flex flex-col divide-y divide-line text-[14px]">
            {items.map((it) => (
              <li key={it.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{it.productTitle ?? "Product"}</span> <span className="text-muted">in {it.storeName ?? "a removed store"}</span>
                </span>
                <span className="tabular text-muted">{describe(it)}</span>
                <StatusPill tone={it.status === "done" ? "ok" : it.status === "failed" ? "error" : it.status === "skipped" ? "off" : "attention"}>
                  {it.status === "done" ? "Done" : it.status === "failed" ? (it.error ?? "Failed") : it.status === "skipped" ? "Skipped" : "Waiting"}
                </StatusPill>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">Nothing to change.</p>
        )}
      </Section>
    </>
  );
}
