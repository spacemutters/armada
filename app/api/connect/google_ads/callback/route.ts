import { NextResponse, type NextRequest } from "next/server";

// Registered with Google ahead of time; Google ads aren't built yet, so it only says so.
export function GET(req: NextRequest) {
  return NextResponse.redirect(new URL(`/ads?problem=${encodeURIComponent("Google ads are coming soon.")}#platforms`, req.url), 303);
}
