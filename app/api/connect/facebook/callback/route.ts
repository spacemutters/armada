import { NextResponse, type NextRequest } from "next/server";
import { MetaNotReady } from "@/connectors/meta/client";
import { finishMetaSetup } from "@/connectors/meta/connect";
import { MetaError } from "@/connectors/meta/http";
import { consumeState } from "@/lib/connections/state";
import { asSystem } from "@/lib/db";
import { bridgePage, safeReturnPath, withProblem } from "../bridge";

// Where Meta's setup window sends the business owner back (register it in Facebook Login's Valid
// OAuth Redirect URIs). The one-time state token says whose workspace this is and which Shopify
// store the shop checks out on. In a popup, the answer is a tiny page that moves the Armada tab on.

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const state = await consumeState(q.get("state"), "facebook");
  const popup = state?.detail.popup === true;
  const leave = (path: string) => (popup ? bridgePage(path, request.nextUrl.origin) : NextResponse.redirect(new URL(path, request.url), 303));
  if (!state) return bridgePage(withProblem("/stores/new#facebook", q.get("error") ? "meta_declined" : "expired"), request.nextUrl.origin);

  const back = safeReturnPath(state.detail.returnTo, state.purpose === "open" ? "/stores/new" : "/connections");
  const problem = (code: string) => leave(withProblem(`${back}#facebook`, code));
  const log = (action: string, detail: Record<string, unknown>) =>
    asSystem(
      (tx) => tx`
        insert into armada.audit_log (workspace_id, member_id, action, detail)
        values (${state.workspaceId}, ${state.memberId}, ${action}, ${tx.json(detail as never)})`,
    );

  const code = q.get("code");
  if (q.get("error") || !code) {
    await log("facebook.setup_declined", { purpose: state.purpose, reason: (q.get("error_reason") ?? "").slice(0, 60) });
    return problem("meta_declined");
  }
  const externalBusinessId = state.detail.externalBusinessId;
  const shopifyStoreId = state.detail.shopifyStoreId;
  if (typeof externalBusinessId !== "string" || typeof shopifyStoreId !== "string") return problem("expired");

  try {
    const { storeId } = await finishMetaSetup({
      workspaceId: state.workspaceId,
      memberId: state.memberId,
      code,
      purpose: state.purpose,
      detail: { externalBusinessId, shopifyStoreId, storeName: typeof state.detail.storeName === "string" ? state.detail.storeName : undefined },
    });
    return leave(`/stores/new/setup/${storeId}`);
  } catch (e) {
    if (e instanceof MetaNotReady) return problem("meta_off");
    const status = e instanceof MetaError ? e.status : null;
    if (!(e instanceof MetaError)) console.error("Facebook shop setup failed", e);
    await log("facebook.setup_failed", { purpose: state.purpose, status, code: e instanceof MetaError ? (e.body?.code ?? null) : null, reason: e instanceof Error ? e.message.slice(0, 200) : "unknown" });
    return problem(status === 409 ? "meta_unfinished" : status && status >= 500 ? "meta_busy" : "meta_failed");
  }
}
