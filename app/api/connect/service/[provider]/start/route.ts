import { NextResponse, type NextRequest } from "next/server";
import { isPdProvider } from "@/connectors/pipedream/core";
import { getSession } from "@/lib/auth/session";
import { serviceOn, startViaService } from "@/lib/connections/service";
import { canManageConnections } from "@/lib/connections/status";

// One press → the connection service's page for this platform, then the platform's own Authorize
// page, then back to /api/connect/service/<platform>/done. For platforms Armada connects only through
// the service (Shopify and eBay start from their own routes, which fall back to this).

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const go = (path: string) => NextResponse.redirect(new URL(path, request.url), 303);
  const back = (code: string) => go(`/connections?problem=${code}&provider=${encodeURIComponent(provider)}`);
  if (!isPdProvider(provider)) return go("/connections");
  const session = await getSession();
  if (!session) return go("/welcome");
  if (!canManageConnections(session.role)) return back("role");
  if (!(await serviceOn())) return back("off");
  try {
    const to = await startViaService({ workspaceId: session.workspaceId, memberId: session.memberId, provider, purpose: "connect", returnTo: "/connections" });
    return NextResponse.redirect(to, 303);
  } catch {
    return back("unreachable");
  }
}
