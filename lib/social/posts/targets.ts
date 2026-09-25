import "server-only";
import { withWorkspace } from "@/lib/db";
import { socialAccountsFor } from "@/lib/social/accounts";
import type { SocialAccount } from "@/lib/social/types";

// Which of a shop's social accounts a post may go to.

export interface ShopAccounts {
  /** Every account the shop has, for showing. */
  all: SocialAccount[];
  /** The ones a post can go to now: connected or practice, able to take carousels, and practice only for a practice shop. */
  eligible: SocialAccount[];
  /** The accounts list couldn't be read. */
  failed: boolean;
  practiceShop: boolean;
}

export async function shopAccounts(workspaceId: string, shopId: string): Promise<ShopAccounts> {
  const [all, failed, practiceShop] = await Promise.all([
    socialAccountsFor(workspaceId, shopId).catch((e) => {
      console.error("loading social accounts failed", shopId, e);
      return null;
    }),
    Promise.resolve(false),
    withWorkspace(workspaceId, (tx) => tx<{ source: string | null }[]>`select brief ->> 'source' as source from armada.shops where id = ${shopId}`).then(
      (r) => r[0]?.source === "practice",
    ),
  ]);
  const list = all ?? [];
  return {
    all: list,
    eligible: list.filter((a) => a.canPostCarousel && a.status !== "needs_attention" && (!practiceShop || a.status === "practice")),
    failed: failed || all === null,
    practiceShop,
  };
}
