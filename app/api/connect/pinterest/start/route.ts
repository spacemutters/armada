import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { pinterestStart } from "@/lib/social/accounts/connect";

// One press on the Pinterest card: the connection service's page, then Pinterest's own Authorize
// page, then back through /api/connect/service/pinterest/done.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/welcome", request.url));
  const shopId = new URL(request.url).searchParams.get("shop") ?? "";
  return NextResponse.redirect(new URL(await pinterestStart(session, shopId), request.url), 303);
}
