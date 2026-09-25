import { NextResponse, type NextRequest } from "next/server";

// Registered with TikTok ahead of time; TikTok ads aren't built yet, so it only says so.
export function GET(req: NextRequest) {
  return NextResponse.redirect(new URL(`/ads?problem=${encodeURIComponent("TikTok ads are coming soon.")}#platforms`, req.url), 303);
}
