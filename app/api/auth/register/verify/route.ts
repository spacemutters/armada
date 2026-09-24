import { verifyRegistrationResponse, type RegistrationResponseJSON } from "@simplewebauthn/server";
import { z } from "zod";
import { asSystem } from "@/lib/db";
import { findOpenInvite } from "@/lib/auth/invites";
import { relyingParty } from "@/lib/auth/relying-party";
import { startSession, takeChallenge } from "@/lib/auth/session";

const Body = z.object({
  token: z.string().min(20).max(200),
  name: z.string().trim().max(60).optional(),
  workspaceName: z.string().trim().max(60).optional(),
  deviceLabel: z.string().trim().max(60).optional(),
  response: z.record(z.string(), z.unknown()),
});

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Something was missing. Try again." }, { status: 400 });
  const challenge = await takeChallenge("register");
  if (!challenge) return Response.json({ error: "That took too long. Try again." }, { status: 400 });

  const { rpID, origin } = relyingParty(request);
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: parsed.data.response as unknown as RegistrationResponseJSON,
      expectedChallenge: challenge.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
    });
  } catch {
    return Response.json({ error: "Your device didn't confirm the passkey. Try again." }, { status: 400 });
  }
  if (!verification.verified) {
    return Response.json({ error: "Your device didn't confirm the passkey. Try again." }, { status: 400 });
  }
  const { credential } = verification.registrationInfo;

  const member = await asSystem(async (tx) => {
    const invite = await findOpenInvite(tx, parsed.data.token);
    if (!invite || invite.id !== challenge.inviteId) return null;

    let memberId = invite.memberId;
    let workspaceId = invite.workspaceId;
    if (!memberId) {
      if (!workspaceId) {
        const [ws] = await tx<{ id: string }[]>`
          insert into armada.workspaces (name) values (${parsed.data.workspaceName || "My fleet"}) returning id`;
        workspaceId = ws.id;
      }
      const [m] = await tx<{ id: string }[]>`
        insert into armada.members (workspace_id, display_name, role)
        values (${workspaceId}, ${parsed.data.name || "Owner"}, ${invite.role}) returning id`;
      memberId = m.id;
    } else {
      const [m] = await tx<{ workspaceId: string }[]>`select workspace_id from armada.members where id = ${memberId}`;
      workspaceId = m.workspaceId;
    }

    await tx`
      insert into armada.passkeys (workspace_id, member_id, credential_id, public_key, counter, transports, device_label)
      values (${workspaceId}, ${memberId}, ${credential.id}, ${Buffer.from(credential.publicKey)}, ${credential.counter},
              ${credential.transports ?? []}, ${parsed.data.deviceLabel || null})`;
    await tx`update armada.invites set used_at = now() where id = ${invite.id}`;
    await tx`
      insert into armada.audit_log (workspace_id, member_id, action, detail)
      values (${workspaceId}, ${memberId}, 'passkey.added', ${tx.json({ device: parsed.data.deviceLabel ?? null })})`;
    const [row] = await tx<{ id: string; sessionVersion: number }[]>`
      select id, session_version from armada.members where id = ${memberId}`;
    return row;
  });
  if (!member) return Response.json({ error: "This link has expired or was already used." }, { status: 410 });

  await startSession(member.id, member.sessionVersion);
  return Response.json({ ok: true });
}
