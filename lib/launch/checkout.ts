import "server-only";
import { openShopCheckout, paymentsFor } from "@/lib/shops/checkout";
import type { ShopRow } from "@/lib/shops/types";
import type { LaunchStep } from "./core";

/**
 * The launch's checkout line: a real shop takes payments into the connected Stripe account from here
 * on (lib/shops/checkout.ts). A practice shop never takes payments. Without payments connected, it's
 * one paste on Plan and billing; it never holds the rest of the launch up (core.ts).
 */
export async function checkoutStep(workspaceId: string, shop: ShopRow): Promise<Pick<LaunchStep, "state" | "note" | "actions" | "ask">> {
  if (shop.brief?.source === "practice") return { state: "skipped", note: "Practice shop: no real payments." };
  const pay = await paymentsFor(workspaceId);
  if (!pay.connected) {
    return {
      state: "needs-you",
      ask: "Connect payments",
      note: "Paste your Stripe key once. Sales then go straight to your Stripe.",
      actions: [{ label: "Connect Stripe", href: "/billing", primary: true }],
    };
  }
  await openShopCheckout(workspaceId, shop.id);
  return {
    state: "done",
    note: pay.test ? "Takes test payments (no real cards charged)." : "Takes payments into your Stripe.",
    actions: [{ label: "See the bag", href: `/s/${shop.slug}/cart`, external: true }],
  };
}
