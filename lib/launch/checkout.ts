import "server-only";
import type { ShopRow } from "@/lib/shops/types";
import type { LaunchStep } from "./core";

/**
 * The launch's checkout line. Real checkout for Armada's own storefronts (payments, then opening
 * the shop for sales) is built separately. Until that says whether a shop takes payments, this line
 * says plainly what switches it on, and it never holds the rest of the launch up (core.ts).
 *
 * When checkout lands, replace the body with a read of it: "done" once the shop takes payments,
 * "needs-you" with its one press when it's waiting on the owner.
 */
export async function checkoutStep(workspaceId: string, shop: ShopRow): Promise<Pick<LaunchStep, "state" | "note" | "actions" | "ask">> {
  void workspaceId;
  void shop;
  return {
    state: "waiting",
    note: "Switches on when payments are connected (Plan and billing).",
    actions: [{ label: "Plan and billing", href: "/billing" }],
  };
}
