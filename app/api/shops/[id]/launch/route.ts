import { getSession } from "@/lib/auth/session";
import { advanceLaunch, launchView } from "@/lib/launch/run";

// The launch's progress view reads here. GET only reads; POST also runs one pass over the steps
// (listing a few products on eBay, scheduling posts the AI finished, creating ads switched off).
// A pass only continues what the Launch press started, so anyone on the team watching may run it.

export const dynamic = "force-dynamic";
// A pass lists up to a few products on eBay, each several calls to eBay.
export const maxDuration = 120;

export async function GET(_request: Request, { params }: RouteContext<"/api/shops/[id]/launch">) {
  const session = await getSession();
  if (!session) return new Response(null, { status: 401 });
  const { id } = await params;
  const view = await launchView(session.workspaceId, id);
  return view ? Response.json(view) : new Response(null, { status: 404 });
}

export async function POST(_request: Request, { params }: RouteContext<"/api/shops/[id]/launch">) {
  const session = await getSession();
  if (!session) return new Response(null, { status: 401 });
  const { id } = await params;
  const view = await advanceLaunch(session.workspaceId, id, { budgetMs: 45_000 });
  return view ? Response.json(view) : new Response(null, { status: 404 });
}
