import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { metaStart } from "@/lib/social/accounts/connect";

// One press on the Facebook Page card: sends the person to Meta's own sign-in, where they choose
// the shop's Page (lib/social/accounts/connect.ts).
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/welcome", request.url));
  const shopId = new URL(request.url).searchParams.get("shop") ?? "";
  return NextResponse.redirect(new URL(await metaStart(session, "facebook_page", shopId), request.url));
}
