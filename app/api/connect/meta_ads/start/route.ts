import { NextResponse, type NextRequest } from "next/server";
import { metaLoginUrl } from "@/connectors/meta-ads/connection";
import { metaAdsInfo } from "@/connectors/meta-ads/info";
import { getSession } from "@/lib/auth/session";
import { createState } from "@/lib/connections/state";

// One press on "Connect your ad account": sends the person to Meta's own sign-in and approval screen,
// carrying a one-time state that says which workspace started it. Meta sends them back to ../callback.

const back = (req: NextRequest, problem?: string) =>
  NextResponse.redirect(new URL(problem ? `/ads?problem=${encodeURIComponent(problem)}#platforms` : "/ads#platforms", req.url), 303);

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/welcome", req.url), 303);
  if (session.role !== "owner" && session.role !== "manager") return back(req, "Only the owner or a manager can connect an ad account.");
  if (!metaAdsInfo.available()) return back(req, "Facebook and Instagram ads are coming soon.");
  const state = await createState(session.workspaceId, session.memberId, "meta_ads", "connect", { returnTo: "/ads" });
  return NextResponse.redirect(metaLoginUrl(state), 303);
}
