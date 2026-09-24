"use server";

import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { withWorkspace } from "@/lib/db";
import { createPracticeFleet } from "@/lib/practice/fleet";

export async function startPracticeFleet(formData: FormData) {
  const session = await requireSession();
  if (session.role !== "owner" && session.role !== "manager") redirect("/");
  const count = Math.min(120, Math.max(6, Number(formData.get("count")) || 24));
  const result = await withWorkspace(session.workspaceId, async (tx) => {
    const [existing] = await tx<{ n: number }[]>`select count(*)::int as n from armada.stores where mode = 'practice' and (meta ->> 'builtByAi') is null`;
    if (existing.n > 0) return null;
    const r = await createPracticeFleet(tx, session.workspaceId, count);
    await tx`
      insert into armada.audit_log (workspace_id, member_id, action, detail)
      values (${session.workspaceId}, ${session.memberId}, 'practice.fleet_created', ${tx.json(r as never)})`;
    return r;
  });
  redirect(result ? "/?fleet=ready" : "/");
}
