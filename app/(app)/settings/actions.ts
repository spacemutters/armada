"use server";

import { redirect } from "next/navigation";
import { connectCj, describeCjError, disconnectCj } from "@/connectors/cj/client";
import { requireSession } from "@/lib/auth/session";
import { createInvite } from "@/lib/auth/invites";
import { asSystem, withWorkspace } from "@/lib/db";
import type { Role } from "@/lib/types";

export async function renameWorkspace(formData: FormData) {
  const session = await requireSession();
  const name = String(formData.get("name") ?? "").trim().slice(0, 60);
  if (session.role !== "owner" || !name) redirect("/settings");
  await withWorkspace(session.workspaceId, (tx) => tx`update armada.workspaces set name = ${name} where id = ${session.workspaceId}`);
  redirect("/settings?saved=1");
}

export async function makeDeviceLink() {
  const session = await requireSession();
  const token = await asSystem((tx) => createInvite(tx, { memberId: session.memberId, hours: 24 }));
  redirect(`/settings?link=${encodeURIComponent(token)}&for=device#devices`);
}

export async function makeTeamInvite(formData: FormData) {
  const session = await requireSession();
  if (session.role !== "owner") redirect("/settings");
  const role = (["manager", "assistant", "viewer"] as Role[]).includes(formData.get("role") as Role) ? (formData.get("role") as Role) : "assistant";
  const token = await asSystem((tx) => createInvite(tx, { workspaceId: session.workspaceId, role, hours: 72 }));
  redirect(`/settings?link=${encodeURIComponent(token)}&for=team#team`);
}

export async function connectCjAction(formData: FormData) {
  const session = await requireSession();
  if (session.role !== "owner" && session.role !== "manager") redirect("/settings#connections");
  const apiKey = String(formData.get("apiKey") ?? "").trim();
  if (apiKey.length < 10 || apiKey.length > 300) redirect(`/settings?cj=${encodeURIComponent("Paste the whole CJ API key.")}#connections`);
  let error: string | null = null;
  try {
    const meta = await connectCj(session.workspaceId, apiKey);
    await withWorkspace(
      session.workspaceId,
      (tx) => tx`
        insert into armada.audit_log (workspace_id, member_id, action, detail)
        values (${session.workspaceId}, ${session.memberId}, 'cj.connected', ${tx.json({ account: meta.account ?? null } as never)})`,
    );
  } catch (e) {
    error = describeCjError(e);
  }
  redirect(error ? `/settings?cj=${encodeURIComponent(error)}#connections` : "/settings?cj=ok#connections");
}

export async function disconnectCjAction() {
  const session = await requireSession();
  if (session.role !== "owner") redirect("/settings#connections");
  await disconnectCj(session.workspaceId);
  redirect("/settings#connections");
}

export async function removePasskey(passkeyId: string) {
  const session = await requireSession();
  await withWorkspace(session.workspaceId, async (tx) => {
    const [{ n }] = await tx<{ n: number }[]>`select count(*)::int as n from armada.passkeys where member_id = ${session.memberId}`;
    if (n <= 1) return; // never remove the last way in
    await tx`delete from armada.passkeys where id = ${passkeyId} and member_id = ${session.memberId}`;
  });
  redirect("/settings#devices");
}
