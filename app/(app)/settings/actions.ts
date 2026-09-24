"use server";

import { redirect } from "next/navigation";
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

export async function removePasskey(passkeyId: string) {
  const session = await requireSession();
  await withWorkspace(session.workspaceId, async (tx) => {
    const [{ n }] = await tx<{ n: number }[]>`select count(*)::int as n from armada.passkeys where member_id = ${session.memberId}`;
    if (n <= 1) return; // never remove the last way in
    await tx`delete from armada.passkeys where id = ${passkeyId} and member_id = ${session.memberId}`;
  });
  redirect("/settings#devices");
}
