"use server";

import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { withWorkspace } from "@/lib/db";
import { sendOrdersToSupplier } from "@/lib/orders/send";

export async function sendToSupplier(formData: FormData) {
  const session = await requireSession();
  if (session.role !== "owner" && session.role !== "manager") redirect("/orders");
  const ids = formData.getAll("orders").filter((v): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v)).slice(0, 500);
  if (!ids.length) redirect("/orders");
  const r = await withWorkspace(session.workspaceId, async (tx) => {
    const result = await sendOrdersToSupplier(tx, session.workspaceId, ids);
    await tx`
      insert into armada.audit_log (workspace_id, member_id, action, detail)
      values (${session.workspaceId}, ${session.memberId}, 'orders.sent_to_supplier', ${tx.json(result as never)})`;
    return result;
  });
  redirect(`/orders?sent=${r.sent}&dupes=${r.alreadySent}&capped=${r.overCap}&problems=${r.problems}`);
}
