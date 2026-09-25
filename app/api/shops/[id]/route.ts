import { getSession } from "@/lib/auth/session";
import { helperStatus } from "@/lib/ai/jobs";
import { getShop } from "@/lib/shops/queries";
import { chooseCount } from "@/lib/shops/types";

export async function GET(_request: Request, { params }: RouteContext<"/api/shops/[id]">) {
  const session = await getSession();
  if (!session) return new Response(null, { status: 401 });
  const { id } = await params;
  const shop = await getShop(session.workspaceId, id);
  if (!shop) return new Response(null, { status: 404 });
  const helper = await helperStatus();
  const offered = shop.blueprint.proposals?.length ?? 0;
  return Response.json({
    status: shop.status,
    progress: shop.progress,
    error: shop.error,
    brandName: shop.blueprint.brand?.name ?? null,
    helperOnline: helper.online,
    // Set while the build waits for its owner to choose `need` of the `offered` products.
    choose: shop.status === "choosing" ? { need: chooseCount(shop.brief.productCount, offered), offered } : null,
  });
}
