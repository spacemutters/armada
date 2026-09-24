import { verifyAuthenticationResponse, type AuthenticationResponseJSON } from "@simplewebauthn/server";
import { z } from "zod";
import { asSystem } from "@/lib/db";
import { relyingParty } from "@/lib/auth/relying-party";
import { startSession, takeChallenge } from "@/lib/auth/session";

const Body = z.object({ response: z.object({ id: z.string().min(1).max(1024) }).passthrough() });

const NOT_RECOGNISED = "This passkey isn't set up for Armada. Use the setup link first.";

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Something was missing. Try again." }, { status: 400 });
  const challenge = await takeChallenge("login");
  if (!challenge) return Response.json({ error: "That took too long. Try again." }, { status: 400 });

  const credentialId = parsed.data.response.id;
  const passkey = await asSystem(async (tx) => {
    const rows = await tx<
      { id: string; memberId: string; publicKey: Buffer; counter: string; transports: string[] }[]
    >`select id, member_id, public_key, counter, transports from armada.passkeys where credential_id = ${credentialId}`;
    return rows[0] ?? null;
  });
  if (!passkey) return Response.json({ error: NOT_RECOGNISED }, { status: 401 });

  const { rpID, origin } = relyingParty(request);
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: parsed.data.response as unknown as AuthenticationResponseJSON,
      expectedChallenge: challenge.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
      credential: {
        id: credentialId,
        publicKey: new Uint8Array(passkey.publicKey),
        counter: Number(passkey.counter),
        transports: passkey.transports,
      },
    });
  } catch {
    return Response.json({ error: NOT_RECOGNISED }, { status: 401 });
  }
  if (!verification.verified) return Response.json({ error: NOT_RECOGNISED }, { status: 401 });

  const member = await asSystem(async (tx) => {
    await tx`
      update armada.passkeys set counter = ${verification.authenticationInfo.newCounter}, last_used_at = now()
      where id = ${passkey.id}`;
    const [m] = await tx<{ id: string; sessionVersion: number }[]>`
      select id, session_version from armada.members where id = ${passkey.memberId}`;
    return m;
  });
  await startSession(member.id, member.sessionVersion);
  return Response.json({ ok: true });
}
