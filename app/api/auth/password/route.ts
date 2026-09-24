import { z } from "zod";
import { asSystem } from "@/lib/db";
import {
  beginAttempt,
  clientIp,
  DUMMY_HASH,
  LOCKED_MESSAGE,
  looksLikeEmail,
  markAttemptOk,
  normalizeEmail,
  verifyPassword,
} from "@/lib/auth/password";
import { relyingParty } from "@/lib/auth/relying-party";
import { startSession } from "@/lib/auth/session";

// Email and password sign-in. A wrong email and a wrong password get the same answer and take about
// as long, and after too many wrong tries the password isn't checked at all (see lib/auth/password.ts).

const Body = z.object({ email: z.string().max(320), password: z.string().max(4096) });

const NO_MATCH = "That email and password don't match. Check them and try again, or use your passkey.";

export async function POST(request: Request) {
  // Only Armada's own sign-in page may post here.
  const origin = request.headers.get("origin");
  if (origin && origin !== relyingParty(request).origin) {
    return Response.json({ error: "Sign in from Armada's own sign-in page." }, { status: 403 });
  }

  const parsed = Body.safeParse(await request.json().catch(() => null));
  const email = parsed.success ? normalizeEmail(parsed.data.email) : "";
  const password = parsed.success ? parsed.data.password : "";
  if (!email || !password) return Response.json({ error: "Enter your email and your password." }, { status: 400 });
  if (!looksLikeEmail(email)) return Response.json({ error: "That doesn't look like an email address." }, { status: 400 });

  const ip = clientIp(request.headers);
  const start = await asSystem(async (tx) => {
    const attempt = await beginAttempt(tx, email, ip);
    if (attempt.locked) return null;
    const [member] = await tx<{ id: string; workspaceId: string; passwordHash: string | null; sessionVersion: number }[]>`
      select id, workspace_id, password_hash, session_version from armada.members where email = ${email}`;
    return { attemptId: attempt.id, member: member ?? null };
  });
  if (!start) return Response.json({ error: LOCKED_MESSAGE }, { status: 429 });

  // Unknown email, or a member without a password: check against a stand-in hash so it takes as long.
  const hash = start.member?.passwordHash ?? null;
  const matches = await verifyPassword(password, hash ?? DUMMY_HASH);
  const member = start.member;
  if (!matches || !hash || !member) return Response.json({ error: NO_MATCH }, { status: 401 });

  await asSystem(async (tx) => {
    await markAttemptOk(tx, start.attemptId);
    await tx`
      insert into armada.audit_log (workspace_id, member_id, action, detail)
      values (${member.workspaceId}, ${member.id}, 'signed_in_password', ${tx.json({})})`;
  });
  await startSession(member.id, member.sessionVersion);
  return Response.json({ ok: true });
}
