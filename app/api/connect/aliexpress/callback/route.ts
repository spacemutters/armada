import { NextResponse, type NextRequest } from "next/server";
import { connectAliexpress, describeAliexpressError } from "@/connectors/aliexpress/client";
import { consumeState } from "@/lib/connections/state";
import { withWorkspace } from "@/lib/db";

// AliExpress sends the person back here with a one-time code and the state Armada gave it. The state
// says whose workspace this is (the callback carries no session it can trust); the code becomes a
// sealed connection. Every failure goes back to Connections with one plain sentence.
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const back = (params: Record<string, string>) =>
    NextResponse.redirect(new URL(`/connections?${new URLSearchParams({ provider: "aliexpress", ...params })}`, request.url), 303);

  const state = await consumeState(q.get("state"), "aliexpress");
  if (!state) return back({ problem: "expired" });
  const code = q.get("code");
  if (!code) return back({ problem: "denied" });
  try {
    const meta = await connectAliexpress(state.workspaceId, code);
    await withWorkspace(
      state.workspaceId,
      (tx) => tx`
        insert into armada.audit_log (workspace_id, member_id, action, detail)
        values (${state.workspaceId}, ${state.memberId}, 'aliexpress.connected', ${tx.json({ account: meta.account ?? null } as never)})`,
    );
    return back({ connected: "aliexpress" });
  } catch (e) {
    console.error("AliExpress connect failed", describeAliexpressError(e));
    return back({ problem: "failed" });
  }
}
