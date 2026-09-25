import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { composioInstagramFinish } from "@/lib/social/accounts/connect";

// Composio sends the person back here after Instagram's Authorize page. The one-time state says
// whose workspace and which shop this is, and the browser must be signed in as the person who pressed.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getSession();
  return NextResponse.redirect(new URL(await composioInstagramFinish(new URL(request.url), session), request.url), 303);
}
