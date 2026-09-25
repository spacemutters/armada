import { NextResponse, type NextRequest } from "next/server";

// Google ads aren't built yet: the button never shows, and this address says so if someone finds it.
export function GET(req: NextRequest) {
  return NextResponse.redirect(new URL(`/ads?problem=${encodeURIComponent("Google ads are coming soon.")}#platforms`, req.url), 303);
}
