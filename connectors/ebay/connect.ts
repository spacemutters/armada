import "server-only";
import { withWorkspace } from "@/lib/db";
import { EBAY_STEPS, freshSteps, MARKETPLACE_CURRENCY, MARKETPLACE_COUNTRY, type SetupStep } from "./core";
import { saveEbayCredential, requireEbayConfig } from "./client";
import { ebayRequest, exchangeCode } from "./http";

// What happens when a seller comes back from eBay's own sign-in page: swap the one-time code for
// their access, read who they are, keep the access sealed, and create (or refresh) their store in
// Armada, ready for the automatic setup (setup.ts).

interface IdentityUser {
  userId?: string;
  username?: string;
  registrationMarketplaceId?: string;
  accountType?: string;
}

export interface EbaySignInResult {
  storeId: string;
  username: string;
  reconnected: boolean;
}

export async function finishEbaySignIn(input: {
  workspaceId: string;
  memberId: string | null;
  code: string;
  storeName?: string;
  purpose: "connect" | "open";
}): Promise<EbaySignInResult> {
  const cfg = requireEbayConfig();
  const tokens = await exchangeCode(cfg, input.code);
  const user = (await ebayRequest<IdentityUser>(cfg.env, tokens.accessToken, { host: "apiz", path: "/commerce/identity/v1/user/" })) ?? {};
  if (!user.userId || !user.username) throw new Error("eBay didn't say which account signed in");
  const marketplaceId = user.registrationMarketplaceId && MARKETPLACE_CURRENCY[user.registrationMarketplaceId] ? user.registrationMarketplaceId : "EBAY_US";

  const steps: SetupStep[] = freshSteps(EBAY_STEPS).map((s) =>
    s.key === "account" ? { ...s, state: "done", note: `Signed in as ${user.username}.`, finishedAt: new Date().toISOString() } : s,
  );

  return withWorkspace(input.workspaceId, async (tx) => {
    await saveEbayCredential(tx, input.workspaceId, { ...tokens, env: cfg.env, userId: user.userId!, username: user.username! });

    const meta = {
      ebayUserId: user.userId,
      ebayUsername: user.username,
      marketplaceId,
      accountType: user.accountType ?? null,
      env: cfg.env,
      openedWith: input.purpose,
      connectedAt: new Date().toISOString(),
      setup: { steps, startedAt: new Date().toISOString() },
    };
    // One live row per eBay account in a workspace (the unique index in migration 0008). Coming back
    // again refreshes it and runs setup again; every step is safe to repeat.
    // All of a workspace's eBay accounts count as one seller for eBay's one-listing-per-item rule,
    // the cautious reading: eBay applies it across every account the same person or business runs.
    const [existing] = await tx<{ id: string; name: string }[]>`
      select id, name from armada.stores
      where platform = 'ebay' and mode = 'live' and meta ->> 'ebayUserId' = ${user.userId!}`;
    const name = existing?.name ?? (input.storeName?.trim() || user.username!);
    const [row] = await tx<{ id: string }[]>`
      insert into armada.stores (workspace_id, platform, mode, name, domain, currency, country, status, seller_key, meta)
      values (${input.workspaceId}, 'ebay', 'live', ${name}, ${`ebay.com/usr/${user.username}`}, ${MARKETPLACE_CURRENCY[marketplaceId]},
              ${MARKETPLACE_COUNTRY[marketplaceId]}, 'setting_up', ${`workspace:${input.workspaceId}`}, ${tx.json(meta as never)})
      on conflict (workspace_id, (meta ->> 'ebayUserId')) where platform = 'ebay' and mode = 'live'
      do update set status = 'setting_up', domain = excluded.domain, seller_key = excluded.seller_key,
                    meta = armada.stores.meta || excluded.meta
      returning id`;

    await tx`
      insert into armada.audit_log (workspace_id, member_id, action, detail)
      values (${input.workspaceId}, ${input.memberId}, ${existing ? "ebay.reconnected" : "ebay.store_opened"},
              ${tx.json({ storeId: row.id, username: user.username, marketplaceId, purpose: input.purpose } as never)})`;
    return { storeId: row.id, username: user.username!, reconnected: Boolean(existing) };
  });
}
