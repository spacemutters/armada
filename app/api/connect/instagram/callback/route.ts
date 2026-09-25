import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { metaFinish } from "@/lib/social/accounts/connect";

// Meta sends the person back here after the Instagram press. The one-time state says whose workspace
// and which shop this is, and the browser must be signed in as the person who pressed the button.
export async function GET(request: Request) {
  const session = await getSession();
  return NextResponse.redirect(new URL(await metaFinish("instagram", new URL(request.url), session), request.url), 303);
}
