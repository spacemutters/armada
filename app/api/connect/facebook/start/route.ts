import { NextResponse, type NextRequest } from "next/server";
import { cleanShopDomain, externalBusinessId, metaConfig, setupWindowUrl } from "@/connectors/meta/core";
import { META_CALLBACK_PATH } from "@/connectors/meta/connect";
import { getSession } from "@/lib/auth/session";
import { createState } from "@/lib/connections/state";
import { appOrigin } from "@/lib/connections/types";
import { withWorkspace } from "@/lib/db";
import { clip, randomSlug } from "@/lib/text";
import { bridgePage, withProblem } from "../bridge";

// One press → Meta's own setup window (the Business Extension), which makes the business, catalog,
// Page and shop. ?shopify=<store id> is the Shopify store buyers will check out on (required: Meta
// shops check out on the seller's website). ?popup=1 when opened as a popup, so problems close the
// popup and show on the Armada page instead of inside it. ?tz= is the browser's time zone.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const purpose = q.get("purpose") === "connect" ? "connect" : "open";
  const popup = q.get("popup") === "1";
  const back = purpose === "open" ? "/stores/new" : "/connections";
  const leave = (path: string) => (popup ? bridgePage(path, request.nextUrl.origin) : NextResponse.redirect(new URL(path, request.url), 303));
  const problem = (code: string) => leave(withProblem(`${back}#facebook`, code));

  const session = await getSession();
  if (!session) return leave("/welcome");
  if (session.role !== "owner" && session.role !== "manager") return problem("role");
  const cfg = metaConfig(process.env);
  if (!cfg) return problem("meta_off");

  const shopifyStoreId = q.get("shopify");
  if (!shopifyStoreId || !UUID.test(shopifyStoreId)) return problem("needs_shopify");
  const [shop] = await withWorkspace(
    session.workspaceId,
    (tx) => tx<{ id: string; name: string; domain: string | null; currency: string }[]>`
      select id, name, domain, currency from armada.stores
      where id = ${shopifyStoreId} and platform = 'shopify' and mode = 'live' and status <> 'disconnected'`,
  );
  const shopDomain = cleanShopDomain(shop?.domain);
  if (!shop || !shopDomain) return problem("needs_shopify");

  const storeName = clip(q.get("name") ?? "", 60);
  const extId = externalBusinessId(session.workspaceId, randomSlug(10));
  const state = await createState(session.workspaceId, session.memberId, "facebook", purpose, {
    returnTo: back,
    externalBusinessId: extId,
    shopifyStoreId: shop.id,
    popup,
    ...(storeName ? { storeName } : {}),
  });
  await withWorkspace(
    session.workspaceId,
    (tx) => tx`
      insert into armada.audit_log (workspace_id, member_id, action, detail)
      values (${session.workspaceId}, ${session.memberId}, 'facebook.setup_started', ${tx.json({ purpose, shopifyStoreId: shop.id } as never)})`,
  );

  return NextResponse.redirect(
    setupWindowUrl(cfg, {
      redirectUri: appOrigin() + META_CALLBACK_PATH,
      state,
      externalBusinessId: extId,
      businessName: storeName || shop.name,
      currency: shop.currency,
      timezone: q.get("tz") ?? "",
      shopDomain,
      display: popup ? "popup" : "page",
    }),
    303,
  );
}
