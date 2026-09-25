"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession, startSession } from "@/lib/auth/session";
import { createInvite } from "@/lib/auth/invites";
import {
  beginAttempt,
  clientIp,
  hashPassword,
  looksLikeEmail,
  markAttemptOk,
  MAX_PASSWORD_LENGTH,
  MIN_NEW_PASSWORD_LENGTH,
  normalizeEmail,
  verifyPassword,
} from "@/lib/auth/password";
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
  revalidatePath("/settings");
  redirect("/settings#devices");
}

// ---------- Password ----------

/** Back to the Password section with a short code the page turns into a message (see PASSWORD_MESSAGES there). */
type PasswordResult = "ok" | "reload" | "email" | "short" | "long" | "mismatch" | "current" | "wrong" | "locked" | "taken";
function passwordMessage(code: PasswordResult): never {
  redirect(`/settings?pw=${code}#password`);
}

/**
 * Sets or changes the signed-in member's password. The current password is required when one
 * exists, and wrong tries count toward the same lockout as sign-in. Changing a password signs the
 * member out everywhere else; this device gets a fresh sign-in.
 */
export async function setPasswordAction(formData: FormData) {
  const session = await requireSession();
  const current = String(formData.get("currentPassword") ?? "");
  const next = String(formData.get("newPassword") ?? "");
  const again = String(formData.get("confirmPassword") ?? "");

  const me = await withWorkspace(session.workspaceId, async (tx) => {
    const [m] = await tx<{ email: string | null; passwordHash: string | null }[]>`
      select email, password_hash from armada.members where id = ${session.memberId}`;
    return m;
  });
  if (!me) passwordMessage("reload");

  const email = me.email ?? normalizeEmail(String(formData.get("email") ?? ""));
  if (!email || !looksLikeEmail(email)) passwordMessage("email");
  if (next.length < MIN_NEW_PASSWORD_LENGTH) passwordMessage("short");
  if (next.length > MAX_PASSWORD_LENGTH) passwordMessage("long");
  if (next !== again) passwordMessage("mismatch");

  const changing = Boolean(me.passwordHash);
  if (me.passwordHash) {
    if (!current) passwordMessage("current");
    const ip = clientIp(await headers());
    const attempt = await asSystem((tx) => beginAttempt(tx, email, ip));
    if (attempt.locked) passwordMessage("locked");
    if (!(await verifyPassword(current, me.passwordHash))) passwordMessage("wrong");
    await asSystem((tx) => markAttemptOk(tx, attempt.id));
  }

  const hash = await hashPassword(next);
  let sessionVersion: number;
  try {
    sessionVersion = await withWorkspace(session.workspaceId, async (tx) => {
      const [row] = await tx<{ sessionVersion: number }[]>`
        update armada.members
        set password_hash = ${hash}, password_changed_at = now(), email = ${email},
            session_version = session_version + ${changing ? 1 : 0}
        where id = ${session.memberId}
        returning session_version`;
      await tx`
        insert into armada.audit_log (workspace_id, member_id, action, detail)
        values (${session.workspaceId}, ${session.memberId}, ${changing ? "password.changed" : "password.set"}, ${tx.json({})})`;
      return row.sessionVersion;
    });
  } catch (e) {
    // Another member already signs in with this email.
    if ((e as { code?: string })?.code === "23505") passwordMessage("taken");
    throw e;
  }
  if (changing) await startSession(session.memberId, sessionVersion);
  passwordMessage("ok");
}
