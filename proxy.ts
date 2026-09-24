import { NextResponse, type NextRequest } from "next/server";

// A quick first check only: no session cookie means sign in. The real check (signature, member,
// session version) happens on every page through requireSession().
export function proxy(request: NextRequest) {
  if (!request.cookies.has("armada_session")) {
    return NextResponse.redirect(new URL("/welcome", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!welcome|setup/|s/|api/|_next/|icon\\.svg|favicon\\.ico|robots\\.txt).*)"],
};
