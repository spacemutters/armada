import { NextResponse, type NextRequest } from "next/server";
import { looksLikeAPerson, newVisitor, readVisitor, VISITOR_COOKIE, VISITOR_MAX_AGE } from "@/lib/abtest/visitor";

// Two quick first checks.
// - Storefronts (/s/...): give each new shopper a signed visitor id, so a headline test shows them
//   the same version every time. The id is also handed to this same request, so the first page
//   they see is already in the test.
// - Everything else: no session cookie means sign in. The real check (signature, member, session
//   version) happens on every page through requireSession().
export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/s/")) {
    if (!looksLikeAPerson(request.headers.get("user-agent"))) return NextResponse.next();
    if (await readVisitor(request.cookies.get(VISITOR_COOKIE)?.value)) return NextResponse.next();
    const value = await newVisitor();
    request.cookies.set(VISITOR_COOKIE, value);
    const response = NextResponse.next({ request: { headers: request.headers } });
    response.cookies.set(VISITOR_COOKIE, value, {
      httpOnly: true,
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
      path: "/",
      maxAge: VISITOR_MAX_AGE,
    });
    return response;
  }
  if (!request.cookies.has("armada_session")) {
    return NextResponse.redirect(new URL("/welcome", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!welcome|setup/|api/|_next/|icon\\.svg|favicon\\.ico|robots\\.txt).*)"],
};
