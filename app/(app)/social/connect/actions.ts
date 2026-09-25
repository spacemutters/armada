"use server";

import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { applyKitToPage, backTo, canConnect, choosePage } from "@/lib/social/accounts/connect";
import { usernameIdeas } from "@/lib/social/accounts/kit";
import { createPracticeAccount, dropPageChoices, removeAccount } from "@/lib/social/accounts/store";
import { getShop } from "@/lib/shops/queries";
import type { SocialPlatform } from "@/lib/social/types";

const PLATFORMS: SocialPlatform[] = ["instagram", "facebook", "tiktok"];

/** A practice account for one platform: posts to it stay in Armada, so the whole flow works before the platforms approve Armada. */
export async function makePracticeAccount(shopId: string, platform: SocialPlatform) {
  const session = await requireSession();
  if (!PLATFORMS.includes(platform)) redirect(backTo(shopId));
  if (session.role === "viewer") redirect(backTo(shopId, { problem: "role" }));
  const shop = await getShop(session.workspaceId, shopId);
  if (!shop) redirect(backTo(null, { problem: "shop" }));
  const name = shop.blueprint.brand?.name || shop.niche;
  const handle = usernameIdeas(name, platform === "facebook" ? "instagram" : platform)[0] ?? "practice.shop";
  await createPracticeAccount(session.workspaceId, session.memberId, { id: shop.id, name, handle }, platform);
  redirect(backTo(shop.id, { practice: platform }));
}

/** Disconnects a real account (the owner or a manager) or removes a practice one (anyone who can make one). */
export async function removeSocialAccount(shopId: string, accountId: string) {
  const session = await requireSession();
  if (session.role === "viewer") redirect(backTo(shopId, { problem: "role" }));
  const row = await removeAccount(session.workspaceId, session.memberId, accountId, canConnect(session));
  redirect(backTo(shopId, row ? { removed: row.platform, kind: row.kind } : canConnect(session) ? {} : { problem: "role" }));
}

export async function pickPage(shopId: string, choiceId: string, pageId: string) {
  const session = await requireSession();
  redirect(await choosePage(session, shopId, choiceId, pageId));
}

export async function skipPageChoice(shopId: string) {
  const session = await requireSession();
  await dropPageChoices(session.workspaceId, shopId);
  redirect(backTo(shopId));
}

/** Replaces the Page's description, website, profile picture and cover with the kit's. */
export async function applyKit(shopId: string) {
  const session = await requireSession();
  redirect(await applyKitToPage(session, shopId));
}
