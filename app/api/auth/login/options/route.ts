import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { relyingParty } from "@/lib/auth/relying-party";
import { saveChallenge } from "@/lib/auth/session";

export async function POST(request: Request) {
  const { rpID } = relyingParty(request);
  // No allow-list: the device offers whichever Armada passkey it holds.
  const options = await generateAuthenticationOptions({ rpID, userVerification: "preferred" });
  await saveChallenge({ challenge: options.challenge, kind: "login" });
  return Response.json(options);
}
