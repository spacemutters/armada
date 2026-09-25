import { NextResponse, type NextRequest } from "next/server";
import { consentUrl, ebayConfig } from "@/connectors/ebay/core";
import { getSession } from "@/lib/auth/session";
import { createState } from "@/lib/connections/state";
import { withWorkspace } from "@/lib/db";
import { clip } from "@/lib/text";
import { serviceOn, startViaService } from "@/lib/connections/service";
import { withProblem } from "../../facebook/bridge";

// One press → eBay's own sign-in and approval page. ?purpose=open opens a new store (the sign-in page
// is always shown, so a different or brand-new account can be used); ?purpose=connect links an
// account already selling. ?store=<id> signs an existing store in again. Every refusal goes back to
// where the press came from with a short problem code the page turns into a sentence.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const purpose = q.get("purpose") === "connect" ? "connect" : "open";
  const storeId = q.get("store") && UUID.test(q.get("store")!) ? q.get("store")! : null;
  const back = storeId ? `/stores/new/setup/${storeId}` : purpose === "open" ? "/stores/new" : "/connections";
  const go = (path: string) => NextResponse.redirect(new URL(path, request.url), 303);
  const problem = (code: string) => go(withProblem(back, code));

  const session = await getSession();
  if (!session) return go("/welcome");
  if (session.role !== "owner" && session.role !== "manager") return problem("role");
  const cfg = ebayConfig(process.env);
  const storeName = clip(q.get("name") ?? "", 60);
  if (!cfg) {
    // No eBay app of Armada's own: the connection service's approved app instead.
    if (!(await serviceOn())) return problem("ebay_off");
    try {
      const to = await startViaService({
        workspaceId: session.workspaceId,
        memberId: session.memberId,
        provider: "ebay",
        purpose,
        returnTo: back,
        detail: { ...(storeName ? { storeName } : {}), ...(storeId ? { storeId } : {}) },
      });
      return NextResponse.redirect(to, 303);
    } catch {
      return problem("ebay_busy");
    }
  }

  const state = await createState(session.workspaceId, session.memberId, "ebay", purpose, {
    returnTo: back,
    ...(storeName ? { storeName } : {}),
    ...(storeId ? { storeId } : {}),
  });
  await withWorkspace(
    session.workspaceId,
    (tx) => tx`
      insert into armada.audit_log (workspace_id, member_id, action, detail)
      values (${session.workspaceId}, ${session.memberId}, 'ebay.sign_in_started', ${tx.json({ purpose, storeId } as never)})`,
  );
  return NextResponse.redirect(consentUrl(cfg, state, { forceSignIn: purpose === "open" }), 303);
}
