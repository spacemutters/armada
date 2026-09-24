import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { isShopDomain } from "@/connectors/shopify/address";
import { completeShopifyConnection, ShopifyProblem } from "@/connectors/shopify/client";
import { SHOPIFY_PATHS, SHOPIFY_STATE_COOKIE } from "@/connectors/shopify/config";
import { shopifyApp } from "@/connectors/shopify/oauth";
import { verifyQueryHmac } from "@/connectors/shopify/verify";
import { getSession } from "@/lib/auth/session";
import { safeReturnTo } from "@/lib/connections/registry";
import { consumeState } from "@/lib/connections/state";
import { canManageConnections } from "@/lib/connections/status";

// Where Shopify sends the person back after they approve Armada for their store. In order:
// 1. the store address is well formed and Shopify's signature over the whole address checks out;
// 2. the one-time state is used up (unknown, used or older than 15 minutes fails);
// 3. the same browser started it (the state cookie) and the same person is signed in;
// 4. then the code is traded for access and the store is set up (connectors/shopify/client.ts).
// Every failure goes back to /connections with a short code the page turns into plain words.

export const dynamic = "force-dynamic";

const cookiePath = SHOPIFY_PATHS.callback.replace(/\/callback$/, "");

function finish(request: NextRequest, path: string, params: Record<string, string>) {
  const url = new URL(`${path}?${new URLSearchParams(params)}`, request.url);
  const response = NextResponse.redirect(url, 303);
  response.cookies.set(SHOPIFY_STATE_COOKIE, "", { path: cookiePath, maxAge: 0, httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
  return response;
}

const fail = (request: NextRequest, problem: string) => finish(request, "/connections", { problem, provider: "shopify" });

function sameText(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function GET(request: NextRequest) {
  const q = new URL(request.url).searchParams;
  const app = shopifyApp();
  if (!app) return fail(request, "off");

  const shop = q.get("shop");
  const code = q.get("code");
  const state = q.get("state");
  // Declining on Shopify's screen normally just leaves Shopify, but if Shopify ever sends the
  // person back with an error instead of a code, say so plainly. Nothing is changed either way.
  if (!code && q.get("error")) return fail(request, "denied");
  if (!isShopDomain(shop) || !code || !state || code.length > 512) return fail(request, "link");
  if (!verifyQueryHmac(q, app.clientSecret)) return fail(request, "link");

  const consumed = await consumeState(state, "shopify");
  if (!consumed) return fail(request, "expired");

  const cookie = request.cookies.get(SHOPIFY_STATE_COOKIE)?.value ?? "";
  if (!cookie || !sameText(cookie, state)) return fail(request, "browser");
  const session = await getSession();
  if (!session || session.memberId !== consumed.memberId || session.workspaceId !== consumed.workspaceId) return fail(request, "browser");
  if (typeof consumed.detail.shop === "string" && consumed.detail.shop !== shop) return fail(request, "link");
  if (!canManageConnections(session.role)) return fail(request, "role");

  try {
    const { storeId } = await completeShopifyConnection({ workspaceId: session.workspaceId, memberId: session.memberId, shop, code });
    const returnTo = safeReturnTo(typeof consumed.detail.returnTo === "string" ? consumed.detail.returnTo : null);
    return finish(request, returnTo, { connected: "shopify", store: storeId });
  } catch (e) {
    if (e instanceof ShopifyProblem) return fail(request, e.code === "missing" ? "failed" : e.code);
    console.error("shopify connect failed", e instanceof Error ? e.message : e);
    return fail(request, "failed");
  }
}
