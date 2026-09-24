import { getSession } from "@/lib/auth/session";
import { helperStatus } from "@/lib/ai/jobs";
import { getShop } from "@/lib/shops/queries";

export async function GET(_request: Request, { params }: RouteContext<"/api/shops/[id]">) {
  const session = await getSession();
  if (!session) return new Response(null, { status: 401 });
  const { id } = await params;
  const shop = await getShop(session.workspaceId, id);
  if (!shop) return new Response(null, { status: 404 });
  const helper = await helperStatus();
  return Response.json({
    status: shop.status,
    progress: shop.progress,
    error: shop.error,
    brandName: shop.blueprint.brand?.name ?? null,
    helperOnline: helper.online,
  });
}
