import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { tiktokFinish } from "@/lib/social/accounts/connect";

// TikTok sends the person back here. The one-time state says whose workspace and which shop this is,
// and the browser must be signed in as the person who pressed the button.
export async function GET(request: Request) {
  const session = await getSession();
  return NextResponse.redirect(new URL(await tiktokFinish(new URL(request.url), session), request.url), 303);
}
