"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { makeShopImages, redoShopImage } from "@/lib/shops/images";

// The "Brand images" section's two buttons (components/shop-images.tsx). Each picture is one run of
// ChatGPT's image maker on the helper computer; the new one replaces the old only once it's ready.

/** "Make images": queues the pictures the shop doesn't have yet (the hero and collection covers). */
export async function makeImages(shopId: string): Promise<void> {
  const session = await requireSession();
  if (session.role === "viewer") return;
  await makeShopImages(session.workspaceId, shopId);
  revalidatePath(`/builder/${shopId}`);
}

/** "Make again": a new picture for the same place, from the shop's current plan. */
export async function makeImageAgain(shopId: string, imageId: string): Promise<void> {
  const session = await requireSession();
  if (session.role === "viewer") return;
  await redoShopImage(session.workspaceId, imageId);
  revalidatePath(`/builder/${shopId}`);
}
