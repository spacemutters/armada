import { NextResponse, type NextRequest } from "next/server";
import { normalizeShopAddress } from "@/connectors/shopify/address";
import { connectedStoreId } from "@/connectors/shopify/client";
import { SHOPIFY_PATHS, SHOPIFY_STATE_COOKIE } from "@/connectors/shopify/config";
import { shopifyInfo } from "@/connectors/shopify/info";
import { authorizeUrl, shopifyApp } from "@/connectors/shopify/oauth";
import { timestampIsFresh, verifyQueryHmac } from "@/connectors/shopify/verify";
import { getSession } from "@/lib/auth/session";
import { safeReturnTo } from "@/lib/connections/registry";
import { createState } from "@/lib/connections/state";
import { serviceOn, startViaService } from "@/lib/connections/service";
import { canManageConnections } from "@/lib/connections/status";

// "Connect Shopify": checks the store's address, starts a one-time round trip, and sends the
// person straight to Shopify's approval screen for that store.
//
// Two ways in:
// - From Armada's Connections page: /api/connect/shopify/start?purpose=connect&shop=<what they typed>.
// - From Shopify: this is the app's address in Shopify's Dev Dashboard, so opening Armada from a
//   store's admin (or installing it from the Shopify App Store) lands here with the store's
//   address, a timestamp and Shopify's signature. The signature and a fresh timestamp are checked
//   before that address is trusted.
//
// The one-time state is also put in a cookie scoped to /api/connect/shopify, so the callback only
// finishes in the browser that started it.

export const dynamic = "force-dynamic";

function back(request: NextRequest, problem: string, extra: Record<string, string> = {}) {
  const q = new URLSearchParams({ problem, provider: "shopify", ...extra });
  return NextResponse.redirect(new URL(`/connections?${q}`, request.url), 303);
}

export async function GET(request: NextRequest) {
  const q = new URL(request.url).searchParams;
  const app = shopifyApp();
  if (!app || !shopifyInfo.available()) {
    // No Shopify app of Armada's own: the connection service's approved app instead, where the
    // seller types their store's address on the service's page and approves on Shopify's.
    if (!(await serviceOn())) return back(request, "off");
    const session = await getSession();
    if (!session) return NextResponse.redirect(new URL("/welcome", request.url), 303);
    if (!canManageConnections(session.role)) return back(request, "role");
    try {
      const to = await startViaService({
        workspaceId: session.workspaceId,
        memberId: session.memberId,
        provider: "shopify",
        purpose: "connect",
        returnTo: safeReturnTo(q.get("returnTo")),
      });
      return NextResponse.redirect(to, 303);
    } catch {
      return back(request, "unreachable");
    }
  }

  const fromShopify = q.has("hmac");
  if (fromShopify && (!verifyQueryHmac(q, app.clientSecret) || !timestampIsFresh(q.get("timestamp")))) return back(request, "link");

  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/welcome", request.url), 303);
  if (!canManageConnections(session.role)) return back(request, "role");

  const typed = q.get("shop") ?? "";
  const address = normalizeShopAddress(typed);
  if (!address.ok) {
    const code = address.reason === "empty" ? "address_empty" : address.reason === "custom_domain" ? "address_custom" : "address";
    return back(request, code, typed ? { shop: typed.slice(0, 120) } : {});
  }

  // Opening Armada from a store's Shopify admin when that store is already connected here just
  // shows the store; a fresh approval would only replace access that works.
  if (fromShopify) {
    const storeId = await connectedStoreId(session.workspaceId, address.shop);
    if (storeId) return NextResponse.redirect(new URL(`/stores/${storeId}`, request.url), 303);
  }

  const returnTo = safeReturnTo(q.get("returnTo"));
  const state = await createState(session.workspaceId, session.memberId, "shopify", "connect", { returnTo, shop: address.shop });
  const response = NextResponse.redirect(authorizeUrl(address.shop, state), 303);
  response.cookies.set(SHOPIFY_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: SHOPIFY_PATHS.callback.replace(/\/callback$/, ""),
    maxAge: 15 * 60,
  });
  return response;
}
