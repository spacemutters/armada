import { z } from "zod";
import { findOpenInvite } from "@/lib/auth/invites";
import { hashPassword, looksLikeEmail, MAX_PASSWORD_LENGTH, normalizeEmail } from "@/lib/auth/password";
import { relyingParty } from "@/lib/auth/relying-party";
import { startSession } from "@/lib/auth/session";
import { asSystem } from "@/lib/db";

// Makes the platform admin from a one-time admin setup link. The person opening the link picks their
// own email and password here, so the password is never handled by anyone else. If a member with
// that email already exists, it becomes the admin with the new password instead of a second account.

/** The floor for a password chosen here. Settings asks for 12+ when changing it later. */
const ADMIN_SETUP_MIN_PASSWORD = 8;

const Body = z.object({
  token: z.string().min(20).max(200),
  name: z.string().trim().max(60).default(""),
  workspaceName: z.string().trim().max(60).default(""),
  email: z.string().max(320),
  password: z.string().max(MAX_PASSWORD_LENGTH + 1),
});

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== relyingParty(request).origin) {
    return Response.json({ error: "Open the setup link in your browser and try again." }, { status: 403 });
  }
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Fill in every box and try again." }, { status: 400 });
  const d = parsed.data;
  const email = normalizeEmail(d.email);
  if (!looksLikeEmail(email)) return Response.json({ error: "That doesn't look like an email address." }, { status: 400 });
  if (d.password.length < ADMIN_SETUP_MIN_PASSWORD) {
    return Response.json({ error: `Use at least ${ADMIN_SETUP_MIN_PASSWORD} characters for the password.` }, { status: 400 });
  }
  if (d.password.length > MAX_PASSWORD_LENGTH) return Response.json({ error: "That password is too long." }, { status: 400 });

  const hash = await hashPassword(d.password);
  const made = await asSystem(async (tx) => {
    const invite = await findOpenInvite(tx, d.token);
    if (!invite || !invite.admin) return null;
    // Used first, inside the same transaction, so the link can't make two admins at once.
    const used = await tx`update armada.invites set used_at = now() where id = ${invite.id} and used_at is null`;
    if (used.count === 0) return null;

    const [existing] = await tx<{ id: string; workspaceId: string }[]>`
      select id, workspace_id from armada.members where email = ${email} for update`;
    let memberId: string;
    let workspaceId: string;
    if (existing) {
      await tx`
        update armada.members set password_hash = ${hash}, password_changed_at = now(), is_admin = true,
          session_version = session_version + 1
        where id = ${existing.id}`;
      memberId = existing.id;
      workspaceId = existing.workspaceId;
    } else {
      const [ws] = await tx<{ id: string }[]>`insert into armada.workspaces (name) values (${d.workspaceName || "Armada"}) returning id`;
      const [m] = await tx<{ id: string }[]>`
        insert into armada.members (workspace_id, display_name, role, email, password_hash, password_changed_at, is_admin)
        values (${ws.id}, ${d.name || "Owner"}, 'owner', ${email}, ${hash}, now(), true)
        returning id`;
      memberId = m.id;
      workspaceId = ws.id;
    }
    await tx`
      insert into armada.audit_log (workspace_id, member_id, action, detail)
      values (${workspaceId}, ${memberId}, 'admin.created', ${tx.json({ by: "admin setup link", existing: Boolean(existing) } as never)})`;
    const [s] = await tx<{ sessionVersion: number }[]>`select session_version from armada.members where id = ${memberId}`;
    return { memberId, sessionVersion: s.sessionVersion };
  });
  if (!made) return Response.json({ error: "This setup link has already been used or has run out. Ask for a new one." }, { status: 410 });

  await startSession(made.memberId, made.sessionVersion);
  return Response.json({ ok: true });
}
