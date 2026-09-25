import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { metaStart } from "@/lib/social/accounts/connect";

// One press on the Instagram card. Instagram connects through Facebook Login for Business: the
// Instagram professional account linked to the shop's Facebook Page (see connectors/social-accounts/meta.ts
// for why). If the Page is already connected, Armada first checks for a newly linked account itself.
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/welcome", request.url));
  const shopId = new URL(request.url).searchParams.get("shop") ?? "";
  return NextResponse.redirect(new URL(await metaStart(session, "instagram", shopId), request.url));
}
