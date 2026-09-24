import Link from "next/link";
import { Card, EmptyState, PageHeader, StatusPill } from "@/components/ui";
import { requireSession } from "@/lib/auth/session";
import { CHANGE_STATUS } from "@/lib/changes/labels";
import { withWorkspace } from "@/lib/db";
import { timeAgo } from "@/lib/text";

export const metadata = { title: "Changes" };

export default async function ChangesPage() {
  const session = await requireSession();
  const rows = await withWorkspace(
    session.workspaceId,
    (tx) => tx<{ id: string; summary: string; status: string; kind: string; createdAt: Date; counts: Record<string, number>; who: string | null; stores: number }[]>`
      select c.id, c.summary, c.status, c.kind, c.created_at, c.counts, m.display_name as who,
             (select count(distinct store_id) from armada.change_items i where i.change_set_id = c.id)::int as stores
      from armada.change_sets c left join armada.members m on m.id = c.created_by
      order by c.created_at desc limit 200`,
  );
  return (
    <>
      <PageHeader title="Changes" subtitle="Every change to more than one store: who asked for it, what it touched, and an Undo on each." />
      {rows.length === 0 ? (
        <EmptyState title="No changes yet" body="When you list products in several stores or change prices, each change shows up here first as a preview." />
      ) : (
        <Card>
          <ul className="flex flex-col divide-y divide-line">
            {rows.map((r) => {
              const st = CHANGE_STATUS[r.status] ?? CHANGE_STATUS.done;
              return (
                <li key={r.id}>
                  <Link href={`/changes/${r.id}`} className="flex flex-wrap items-center gap-3 px-5 py-3.5 hover:bg-sunken">
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{r.summary}</span>
                      <span className="block text-[13px] text-muted">
                        {r.who ?? "Armada"} · {timeAgo(r.createdAt)} · {r.stores} {r.stores === 1 ? "store" : "stores"}
                      </span>
                    </span>
                    <StatusPill tone={st.tone}>{st.label}</StatusPill>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </>
  );
}
