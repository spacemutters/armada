"use server";

import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { withWorkspace } from "@/lib/db";
import { publishShopToPractice } from "@/lib/practice/publish";
import { startShopBuild } from "@/lib/shops/pipeline";
import type { ShopRow } from "@/lib/shops/types";

async function loadShop(workspaceId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return withWorkspace(workspaceId, async (tx) => (await tx<ShopRow[]>`select * from armada.shops where id = ${id}`)[0] ?? null);
}

export async function putInPracticeStore(shopId: string) {
  const session = await requireSession();
  const shop = await loadShop(session.workspaceId, shopId);
  if (!shop || (shop.status !== "ready" && shop.status !== "published")) redirect(`/builder/${shopId}`);
  const storeId = await withWorkspace(session.workspaceId, (tx) => publishShopToPractice(tx, shop, session.memberId));
  redirect(`/stores/${storeId}`);
}

export async function buildAgain(shopId: string) {
  const session = await requireSession();
  const shop = await loadShop(session.workspaceId, shopId);
  if (!shop) redirect("/builder");
  const { id } = await withWorkspace(session.workspaceId, (tx) => startShopBuild(tx, session.workspaceId, shop.brief));
  redirect(`/builder/${id}`);
}
