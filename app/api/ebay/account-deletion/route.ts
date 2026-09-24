import crypto from "node:crypto";
import { asSystem } from "@/lib/db";

// eBay's marketplace account deletion address. eBay keeps a developer's live keys switched off
// until this answers its check, and afterwards sends a notice whenever an eBay user asks to be
// deleted. See https://developer.ebay.com/marketplace-account-deletion
//
// The check: GET ?challenge_code=... must return
// {"challengeResponse": sha256(challengeCode + verificationToken + endpoint)} as JSON.

function settings() {
  const token = process.env.EBAY_VERIFICATION_TOKEN ?? "";
  const endpoint = process.env.EBAY_DELETION_ENDPOINT ?? "";
  return { token, endpoint, ready: /^[A-Za-z0-9_-]{32,80}$/.test(token) && endpoint.startsWith("https://") };
}

export async function GET(request: Request) {
  const { token, endpoint, ready } = settings();
  const challenge = new URL(request.url).searchParams.get("challenge_code");
  if (!ready || !challenge) return new Response(null, { status: ready ? 400 : 503 });
  const challengeResponse = crypto.createHash("sha256").update(challenge).update(token).update(endpoint).digest("hex");
  return Response.json({ challengeResponse });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const data = body?.notification?.data ?? {};
  const userId = typeof data.userId === "string" ? data.userId : null;
  const username = typeof data.username === "string" ? data.username : null;

  // Delete everything Armada holds about that eBay user: the connected account and its access.
  // Signature checking (X-EBAY-SIGNATURE against eBay's public key) switches on with the eBay keys.
  await asSystem(async (tx) => {
    if (userId || username) {
      await tx`
        update armada.stores
        set status = 'disconnected', meta = jsonb_build_object('deletedByEbay', now()), seller_key = null, domain = null
        where platform = 'ebay' and (meta ->> 'ebayUserId' = ${userId} or meta ->> 'ebayUsername' = ${username})`;
    }
    await tx`
      insert into armada.audit_log (workspace_id, action, detail)
      values (null, 'ebay.account_deletion', ${tx.json({ received: true, notificationId: body?.notification?.notificationId ?? null } as never)})`;
  });
  // eBay expects a quick 200; anything else makes it retry.
  return new Response(null, { status: 200 });
}
