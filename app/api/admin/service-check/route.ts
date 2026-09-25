import { NextResponse, type NextRequest } from "next/server";
import { isPlatformAdmin } from "@/app/(app)/admin/access";
import { accountsOf, connectPageForApp, forgetServiceAccount, PdProblem, searchServiceApps } from "@/connectors/pipedream/client";
import { getSession } from "@/lib/auth/session";
import { appOrigin } from "@/lib/connections/types";

// Platform admin only: tries the connection service's apps one by one, to learn which platforms it
// can really connect in one press (its own approved app) and which ask each seller to bring their
// own. The test accounts live under their own service user, apart from the fleet's real ones.
//   ?q=instagram        the service's apps matching a search, as it describes them
//   ?app=facebook_pages the service's connect page for that app
//   ?accounts=1         what the checks connected; ?forget=<id> lets one go

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session || !(await isPlatformAdmin(session.memberId))) return new Response(null, { status: 404 });
  const q = request.nextUrl.searchParams;
  const checkUser = `armada-check-${session.workspaceId}`;
  try {
    if (q.get("q")) return NextResponse.json(await searchServiceApps(q.get("q")!.slice(0, 60)));
    if (q.get("accounts")) return NextResponse.json(await accountsOf(checkUser));
    const forget = q.get("forget");
    if (forget && /^apn_[A-Za-z0-9]+$/.test(forget)) return NextResponse.json({ forgotten: await forgetServiceAccount(forget) });
    const app = q.get("app");
    if (app && /^[a-z0-9_]{2,60}$/.test(app)) {
      const back = `${appOrigin()}/api/admin/service-check?accounts=1&tried=${app}`;
      return NextResponse.redirect(await connectPageForApp(checkUser, app, back), 303);
    }
    return NextResponse.json({ use: ["?q=<search>", "?app=<name_slug>", "?accounts=1", "?forget=<account id>"] });
  } catch (e) {
    return NextResponse.json({ problem: e instanceof PdProblem ? e.message : String(e) }, { status: 502 });
  }
}
