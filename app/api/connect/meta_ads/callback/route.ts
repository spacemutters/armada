import { NextResponse, type NextRequest } from "next/server";
import { MetaProblem } from "@/connectors/meta-ads/client";
import { finishMetaConnect } from "@/connectors/meta-ads/connection";
import { metaAdsInfo } from "@/connectors/meta-ads/info";
import { consumeState } from "@/lib/connections/state";
import { withWorkspace } from "@/lib/db";

// Where Meta sends people back after they approve (or decline) Armada on their ad account. The
// one-time state, not a cookie, says whose workspace this is; it works once, for 15 minutes.

const back = (req: NextRequest, query: string) => NextResponse.redirect(new URL(`/ads?${query}#platforms`, req.url), 303);
const problem = (req: NextRequest, message: string) => back(req, `problem=${encodeURIComponent(message)}`);

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const state = await consumeState(params.get("state"), "meta_ads");
  if (!state) return problem(req, "That sign-in link has expired or was already used. Press Connect again.");
  if (params.get("error")) return problem(req, "Meta didn't connect the ad account, because the request was declined. Press Connect again to retry.");
  const code = params.get("code");
  if (!code || code.length > 2000) return problem(req, "Meta didn't send back what Armada needs. Press Connect again.");
  if (!metaAdsInfo.available()) return problem(req, "Facebook and Instagram ads are coming soon.");

  try {
    const conn = await finishMetaConnect(state.workspaceId, code);
    await withWorkspace(
      state.workspaceId,
      (tx) => tx`
        insert into armada.audit_log (workspace_id, member_id, action, detail)
        values (${state.workspaceId}, ${state.memberId}, 'ads.connected', ${tx.json({ platform: "meta", adAccounts: conn.adAccounts.length, pages: conn.pages.length } as never)})`,
    );
    if (!conn.adAccountId) return problem(req, "Connected, but this Meta sign-in has no ad account. Make one in Meta, then connect again.");
    if (!conn.pageId) return problem(req, "Connected, but ads need a Facebook Page and this sign-in has none. Make one in Meta, then connect again.");
    return back(req, "connected=meta");
  } catch (e) {
    return problem(req, e instanceof MetaProblem ? e.message : "Couldn't finish connecting to Meta. Press Connect again.");
  }
}
