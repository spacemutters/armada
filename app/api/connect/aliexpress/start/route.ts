import { NextResponse, type NextRequest } from "next/server";
import { authorizeUrl } from "@/connectors/aliexpress/client";
import { aliexpressInfo } from "@/connectors/aliexpress/info";
import { getSession } from "@/lib/auth/session";
import { createState } from "@/lib/connections/state";

// One press → AliExpress's own sign-in and approval page, then back to the callback.
export async function GET(request: NextRequest) {
  const go = (path: string) => NextResponse.redirect(new URL(path, request.url), 303);
  const session = await getSession();
  if (!session) return go("/welcome");
  if (session.role !== "owner" && session.role !== "manager") return go("/connections?problem=role&provider=aliexpress");
  if (!aliexpressInfo.available()) return go("/connections?problem=off&provider=aliexpress");
  const state = await createState(session.workspaceId, session.memberId, "aliexpress", "connect", { returnTo: "/connections" });
  return NextResponse.redirect(authorizeUrl(state), 303);
}
