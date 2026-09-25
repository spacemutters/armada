import { NextResponse, type NextRequest } from "next/server";
import { finishEbayViaService } from "@/connectors/ebay/connect";
import { EbayError } from "@/connectors/ebay/http";
import { PdProblem, serviceAccounts } from "@/connectors/pipedream/client";
import { externalUserFor, isPdProvider, pickNewAccount, type ViaService } from "@/connectors/pipedream/core";
import { completeShopifyViaService, ShopifyProblem } from "@/connectors/shopify/client";
import { getSession } from "@/lib/auth/session";
import { completeViaService, knownServiceAccounts } from "@/lib/connections/service";
import { metaFinishViaService, pinterestFinishViaService } from "@/lib/social/accounts/connect";
import { serviceAccountIds } from "@/lib/social/accounts/store";
import { consumeState } from "@/lib/connections/state";
import type { Provider } from "@/lib/connections/types";
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

  // The one-time state is kept under the service's platform name (a shop's Facebook Page included).
  const state = await consumeState(q.get("state"), provider as Provider);
  const fallback = provider === "ebay" ? "/stores/new" : provider === "facebook_page" || provider === "pinterest" ? "/social/connect" : "/connections";
  if (!state) return go(withProblem(`${fallback}${fallback === "/connections" ? `?provider=${provider}` : ""}`, "expired"));
  const back = safeReturnPath(state.detail.returnTo, fallback);
  const onConnections = back.startsWith("/connections");
  const problem = (code: string) => {
    // The Connections page and Open a new store word their problems differently.
    const mapped = onConnections ? code : provider === "ebay" ? ({ denied: "ebay_declined", unreachable: "ebay_busy" } as Record<string, string>)[code] ?? "ebay_failed" : code;
    // The social page names the platform from ?p=.
    const social = back.startsWith("/social/connect") ? `${back}${back.includes("?") ? "&" : "?"}p=${provider === "facebook_page" ? "facebook" : provider}` : back;
    return go(withProblem(onConnections ? `${back}${back.includes("?") ? "&" : "?"}provider=${provider}` : social, mapped));
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
    // A shop's Pinterest is kept with its social accounts; the rest are credentials.
    const known = provider === "pinterest" ? await serviceAccountIds(state.workspaceId, "pinterest") : await knownServiceAccounts(state.workspaceId, provider);
    const account = pickNewAccount(await serviceAccounts(externalUserId, provider), provider, known);
    if (!account) {
      await log(`${provider}.connect_failed`, { reason: "no new account at the service" });
      return problem("failed");
    }
    const via: ViaService = { via: "pipedream", accountId: account.id, externalUserId };
    if (provider === "facebook_page") {
      // A shop's Facebook Page: back to that shop's social media page.
      return go(await metaFinishViaService({ workspaceId: state.workspaceId, memberId: state.memberId, shopId: String(state.detail.shopId ?? "") }, via));
    }
    if (provider === "pinterest") {
      return go(await pinterestFinishViaService({ workspaceId: state.workspaceId, memberId: state.memberId, shopId: String(state.detail.shopId ?? "") }, via));
    }
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
