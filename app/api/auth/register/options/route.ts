import { generateRegistrationOptions } from "@simplewebauthn/server";
import { z } from "zod";
import { asSystem } from "@/lib/db";
import { findOpenInvite } from "@/lib/auth/invites";
import { relyingParty } from "@/lib/auth/relying-party";
import { saveChallenge } from "@/lib/auth/session";

const Body = z.object({ token: z.string().min(20).max(200), name: z.string().trim().max(60).optional() });

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "That link doesn't look right." }, { status: 400 });

  const result = await asSystem(async (tx) => {
    const invite = await findOpenInvite(tx, parsed.data.token);
    if (!invite) return null;
    let existing: { credentialId: string; transports: string[] }[] = [];
    let displayName = parsed.data.name || "Armada owner";
    if (invite.memberId) {
      existing = await tx`select credential_id, transports from armada.passkeys where member_id = ${invite.memberId}`;
      const [m] = await tx<{ displayName: string }[]>`select display_name from armada.members where id = ${invite.memberId}`;
      if (m) displayName = m.displayName;
    }
    return { invite, existing, displayName };
  });
  if (!result) {
    return Response.json({ error: "This link has expired or was already used. Ask for a new one." }, { status: 410 });
  }

  const { rpID, rpName } = relyingParty(request);
  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: result.displayName,
    userDisplayName: result.displayName,
    attestationType: "none",
    authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
    excludeCredentials: result.existing.map((p) => ({ id: p.credentialId, transports: p.transports })),
  });
  await saveChallenge({ challenge: options.challenge, kind: "register", inviteId: result.invite.id });
  return Response.json(options);
}
