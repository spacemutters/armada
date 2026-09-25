"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { socialAccountsFor } from "@/lib/social/accounts";
import { signedNote } from "@/lib/social/accounts/config";
import { PostProblem, startProductAds, uuid } from "@/lib/social/posts/queries";
import type { SocialAccount } from "@/lib/social/types";

/**
 * "Make an ad with AI": the AI writes a few carousel ads about this product in the chosen shop's
 * look. They arrive as drafts on that shop's Social posts page, which is where this goes next.
 */
export async function makeProductAdsAction(productId: string, formData: FormData) {
  const session = await requireSession();
  const back = `/products/${uuid(productId) ? productId : ""}`;
  if (session.role === "viewer" || !uuid(productId)) redirect(back);
  const shopId = String(formData.get("shop") ?? "");
  if (!uuid(shopId)) redirect(`${back}?${new URLSearchParams(signedNote("Choose a shop for the ads first."))}`);
  let problem: string | null = null;
  try {
    const accounts = await socialAccountsFor(session.workspaceId, shopId).catch(() => [] as SocialAccount[]);
    await startProductAds(session.workspaceId, shopId, productId, session.memberId, accounts.map((a) => a.platform));
  } catch (e) {
    if (!(e instanceof PostProblem)) throw e;
    problem = e.message;
  }
  if (problem) redirect(`${back}?${new URLSearchParams(signedNote(problem))}`);
  revalidatePath("/social");
  redirect(`/social?shop=${shopId}#writing`);
}
