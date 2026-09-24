import { NextResponse, type NextRequest } from "next/server";
import { EbayNotReady } from "@/connectors/ebay/client";
import { finishEbaySignIn } from "@/connectors/ebay/connect";
import { EbayError } from "@/connectors/ebay/http";
import { consumeState } from "@/lib/connections/state";
import { asSystem } from "@/lib/db";
import { safeReturnPath, withProblem } from "../../facebook/bridge";

// Where eBay sends the seller back. Registered on eBay as the redirect name's Auth Accepted URL, and
// with ?declined=1 as its Auth Declined URL. The one-time state token says whose workspace this is;
// nothing else in the request is trusted. Success lands on the live setup view.

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const go = (path: string) => NextResponse.redirect(new URL(path, request.url), 303);

  const state = await consumeState(q.get("state"), "ebay");
  if (!state) return go(withProblem("/stores/new", q.get("declined") || q.get("error") ? "ebay_declined" : "expired"));
  const back = safeReturnPath(state.detail.returnTo, state.purpose === "open" ? "/stores/new" : "/connections");

  const log = (action: string, detail: Record<string, unknown>) =>
    asSystem(
      (tx) => tx`
        insert into armada.audit_log (workspace_id, member_id, action, detail)
        values (${state.workspaceId}, ${state.memberId}, ${action}, ${tx.json(detail as never)})`,
    );

  const code = q.get("code");
  if (q.get("declined") || q.get("error") || !code) {
    await log("ebay.sign_in_declined", { purpose: state.purpose });
    return go(withProblem(back, "ebay_declined"));
  }

  try {
    const result = await finishEbaySignIn({
      workspaceId: state.workspaceId,
      memberId: state.memberId,
      code,
      storeName: typeof state.detail.storeName === "string" ? state.detail.storeName : undefined,
      purpose: state.purpose,
    });
    return go(`/stores/new/setup/${result.storeId}`);
  } catch (e) {
    if (e instanceof EbayNotReady) return go(withProblem(back, "ebay_off"));
    const status = e instanceof EbayError ? e.status : null;
    if (!(e instanceof EbayError)) console.error("eBay sign-in failed", e);
    await log("ebay.sign_in_failed", { purpose: state.purpose, status, reason: e instanceof Error ? e.message.slice(0, 200) : "unknown" });
    return go(withProblem(back, status && status >= 500 ? "ebay_busy" : "ebay_failed"));
  }
}
