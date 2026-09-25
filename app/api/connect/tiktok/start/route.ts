import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { tiktokStart } from "@/lib/social/accounts/connect";

// One press on the TikTok card: sends the person to TikTok's own sign-in (where they can also sign up).
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/welcome", request.url));
  const shopId = new URL(request.url).searchParams.get("shop") ?? "";
  return NextResponse.redirect(new URL(await tiktokStart(session, shopId), request.url));
}
