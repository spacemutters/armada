import { NextResponse, type NextRequest } from "next/server";
import { finishEbayViaService } from "@/connectors/ebay/connect";
import { EbayError } from "@/connectors/ebay/http";
import { PdProblem, serviceAccounts } from "@/connectors/pipedream/client";
import { externalUserFor, isPdProvider, pickNewAccount, type ViaService } from "@/connectors/pipedream/core";
import { completeShopifyViaService, ShopifyProblem } from "@/connectors/shopify/client";
import { getSession } from "@/lib/auth/session";
import { completeViaService, knownServiceAccounts } from "@/lib/connections/service";
import { consumeState } from "@/lib/connections/state";
import { asSystem } from "@/lib/db";
import { safeReturnPath, withProblem } from "../../../facebook/bridge";

// Where the connection service sends a seller back after they approved Armada on Shopify's or
// eBay's own page. The one-time state says whose workspace this is, and the round trip must end in
// the browser, and as the person, that started it. The new account is found at the service, and the
// store is created or refreshed from what the platform says through the service.

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const q = request.nextUrl.searchParams;
  const go = (path: string) => NextResponse.redirect(new URL(path, request.url), 303);
  if (!isPdProvider(provider)) return go("/connections");

  const state = await consumeState(q.get("state"), provider);
  const fallback = provider === "ebay" ? "/stores/new" : "/connections";
  if (!state) return go(withProblem(`${fallback}${fallback === "/connections" ? `?provider=${provider}` : ""}`, "expired"));
  const back = safeReturnPath(state.detail.returnTo, fallback);
  const onConnections = back.startsWith("/connections");
  const problem = (code: string) => {
    // The Connections page and Open a new store word their problems differently.
    const mapped = onConnections ? code : provider === "ebay" ? ({ denied: "ebay_declined", unreachable: "ebay_busy" } as Record<string, string>)[code] ?? "ebay_failed" : code;
    return go(withProblem(onConnections ? `${back}${back.includes("?") ? "&" : "?"}provider=${provider}` : back, mapped));
  };
  const log = (action: string, detail: Record<string, unknown>) =>
    asSystem(
      (tx) => tx`
        insert into armada.audit_log (workspace_id, member_id, action, detail)
        values (${state.workspaceId}, ${state.memberId}, ${action}, ${tx.json({ via: "service", ...detail } as never)})`,
    );

  const session = await getSession();
  if (!session || session.workspaceId !== state.workspaceId || session.memberId !== state.memberId) return problem("browser");
  if (q.get("pd") !== "done") {
    await log(`${provider}.connect_declined`, {});
    return problem("denied");
  }

  try {
    const externalUserId = externalUserFor(state.workspaceId);
    const account = pickNewAccount(await serviceAccounts(externalUserId, provider), provider, await knownServiceAccounts(state.workspaceId, provider));
    if (!account) {
      await log(`${provider}.connect_failed`, { reason: "no new account at the service" });
      return problem("failed");
    }
    const via: ViaService = { via: "pipedream", accountId: account.id, externalUserId };
    if (provider !== "shopify" && provider !== "ebay") {
      // Suppliers and ad accounts: keep which account it is (never a key) and name it.
      await completeViaService({ workspaceId: state.workspaceId, memberId: state.memberId, provider, via, fallbackName: account.name });
      return go(`/connections?connected=${provider}`);
    }
    if (provider === "shopify") {
      const r = await completeShopifyViaService({ workspaceId: state.workspaceId, memberId: state.memberId, account: via });
      const next = new URLSearchParams({ connected: "shopify", store: r.storeId });
      return go(`/connections?${next}`);
    }
    const r = await finishEbayViaService({
      workspaceId: state.workspaceId,
      memberId: state.memberId,
      account: via,
      storeName: typeof state.detail.storeName === "string" ? state.detail.storeName : undefined,
      purpose: state.purpose,
    });
    return go(`/stores/new/setup/${r.storeId}`);
  } catch (e) {
    const code =
      e instanceof ShopifyProblem
        ? e.code === "elsewhere" || e.code === "unreachable" || e.code === "paused"
          ? e.code
          : "failed"
        : e instanceof PdProblem || (e instanceof EbayError && e.status >= 500)
          ? "unreachable"
          : "failed";
    if (!(e instanceof ShopifyProblem) && !(e instanceof PdProblem) && !(e instanceof EbayError)) console.error(`${provider} connect through the service failed`, e);
    await log(`${provider}.connect_failed`, { reason: e instanceof Error ? e.message.slice(0, 200) : "unknown" });
    return problem(code);
  }
}
