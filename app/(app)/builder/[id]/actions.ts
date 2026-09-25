"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import type { Deferred } from "@/lib/ai/jobs";
import { requireSession } from "@/lib/auth/session";
import { withWorkspace } from "@/lib/db";
import { publishShopToPractice } from "@/lib/practice/publish";
import { chooseShopProducts, startShopBuild } from "@/lib/shops/pipeline";
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

/** The shop page, with its data reloaded, plus a plain problem to show if there was one. */
function shopPage(shopId: string, problem?: string): string {
  revalidatePath(`/builder/${shopId}`);
  return `/builder/${shopId}${problem ? `?problem=${encodeURIComponent(problem)}` : ""}`;
}

/** Slow follow-up work (CJ's shipping check) runs after the page is sent back. */
function runAfter(work: Deferred) {
  after(async () => {
    try {
      await work();
    } catch (e) {
      console.error("follow-up work failed", e);
    }
  });
}

async function choose(shopId: string, pick: { ai: true } | { ids: unknown[] }) {
  const session = await requireSession();
  if (session.role === "viewer") redirect(shopPage(shopId, "Viewers can look at a shop but not choose its products. Ask the owner or a manager."));
  const result = await chooseShopProducts(session.workspaceId, shopId, pick, runAfter);
  redirect(shopPage(shopId, result.ok ? undefined : result.problem));
}

/** The owner's own choice: the ticked cards, which must be exactly the shop's product count. */
export async function chooseProducts(shopId: string, formData: FormData) {
  await choose(shopId, { ids: formData.getAll("pick") });
}

/** One press for anyone who doesn't want to choose: the AI's own top picks go in. */
export async function letAiPick(shopId: string) {
  await choose(shopId, { ai: true });
}
