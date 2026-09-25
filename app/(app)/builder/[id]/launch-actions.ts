"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { advanceLaunch, startLaunch } from "@/lib/launch/run";

/**
 * The Launch press (and pressing it again). Viewers can watch a launch but not start one: it lists
 * products on the team's real eBay account. The first pass starts right away, after the page is
 * sent back; the progress view carries it on.
 */
export async function launchShop(shopId: string) {
  const session = await requireSession();
  const page = (problem?: string) => {
    revalidatePath(`/builder/${shopId}`);
    return `/builder/${shopId}${problem ? `?problem=${encodeURIComponent(problem)}` : ""}#launch`;
  };
  if (!/^[0-9a-f-]{36}$/i.test(shopId)) redirect("/builder");
  if (session.role === "viewer") redirect(page("Viewers can watch a launch but not start one. Ask the owner or a manager."));
  const result = await startLaunch(session.workspaceId, shopId, session.memberId);
  if (!result.ok) redirect(page(result.problem));
  const workspaceId = session.workspaceId;
  after(() => advanceLaunch(workspaceId, shopId).catch((e) => console.error("launch pass failed", shopId, e)));
  redirect(page());
}
