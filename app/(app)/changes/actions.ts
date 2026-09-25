"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { applyChange, drainLiveEbayItems, undoChange } from "@/lib/changes/engine";
import { withWorkspace } from "@/lib/db";

const uuid = (v: string) => /^[0-9a-f-]{36}$/i.test(v);

export async function approveChange(id: string) {
  const session = await requireSession();
  if (!uuid(id) || session.role === "viewer") redirect("/changes");
  const result = await withWorkspace(session.workspaceId, async (tx) => {
    const result = await applyChange(tx, id);
    await tx`
      insert into armada.audit_log (workspace_id, member_id, action, detail)
      values (${session.workspaceId}, ${session.memberId}, 'change.applied', ${tx.json({ changeSetId: id, ...result } as never)})`;
    return result;
  });
  // New listings on a real eBay account go out one product at a time; the helper's sweep finishes any left.
  if (result.live) {
    const workspaceId = session.workspaceId;
    after(() => drainLiveEbayItems(workspaceId, id).catch((e) => console.error("eBay listings failed", id, e)));
  }
  // The page shows a note with an Undo button once, then drops this from the address.
  redirect(`/changes/${id}?done=applied`);
}

export async function cancelChange(id: string) {
  const session = await requireSession();
  if (!uuid(id)) redirect("/changes");
  await withWorkspace(session.workspaceId, (tx) => tx`update armada.change_sets set status = 'cancelled', finished_at = now() where id = ${id} and status = 'preview'`);
  redirect("/changes");
}

export async function undo(id: string) {
  const session = await requireSession();
  if (!uuid(id) || session.role === "viewer") redirect("/changes");
  const undoId = await withWorkspace(session.workspaceId, async (tx) => {
    const u = await undoChange(tx, id, session.memberId);
    if (u) {
      await tx`
        insert into armada.audit_log (workspace_id, member_id, action, detail)
        values (${session.workspaceId}, ${session.memberId}, 'change.undone', ${tx.json({ changeSetId: id, undoId: u } as never)})`;
    }
    return u;
  });
  redirect(undoId ? `/changes/${undoId}?done=undone` : `/changes/${id}`);
}
