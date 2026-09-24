import "server-only";
import { appOrigin } from "@/lib/connections/types";
import { withWorkspace } from "@/lib/db";
import { freshSteps, META_SCOPES, META_STEPS, readInstall, type SetupStep } from "./core";
import { requireMetaConfig, saveMetaCredential, type MetaSecret } from "./client";
import { businessAccess, exchangeCode, fbeInstalls, longLivedUserAccess, MetaError } from "./http";

// What happens when Meta's setup window finishes: swap the one-time code for access, read what the
// Business Extension made (business, catalog, shop, page, Instagram, pixel), swap to the business's
// own lasting access, keep it all sealed, and create the Facebook shop in Armada, linked to the
// Shopify store its buyers check out on.

export const META_CALLBACK_PATH = "/api/connect/facebook/callback";

export interface MetaSetupDetail {
  externalBusinessId: string;
  shopifyStoreId: string;
  storeName?: string;
}

export async function finishMetaSetup(input: { workspaceId: string; memberId: string | null; code: string; detail: MetaSetupDetail; purpose: "connect" | "open" }): Promise<{ storeId: string }> {
  const cfg = requireMetaConfig();
  const { externalBusinessId, shopifyStoreId } = input.detail;

  const shopify = await withWorkspace(
    input.workspaceId,
    (tx) => tx<{ id: string; name: string; domain: string | null; currency: string; country: string }[]>`
      select id, name, domain, currency, country from armada.stores
      where id = ${shopifyStoreId} and platform = 'shopify' and mode = 'live'`,
  );
  if (!shopify[0]) throw new MetaError(400, null, "The linked Shopify store is gone");
  const shop = shopify[0];

  const person = await exchangeCode(cfg, input.code, appOrigin() + META_CALLBACK_PATH);
  const assets = readInstall(await fbeInstalls(cfg, person.accessToken, externalBusinessId));
  if (!assets?.businessId) throw new MetaError(409, null, "Meta's window closed before the business was set up");

  // The business's own access doesn't run out; a person's lasts 60 days. Prefer the first.
  let secret: MetaSecret;
  try {
    const token = await businessAccess(cfg, assets.businessId, person.accessToken, externalBusinessId, META_SCOPES.slice(0, 2).join(","));
    secret = { accessToken: token, tokenType: "system_user", externalBusinessId, assets };
  } catch (e) {
    if (!(e instanceof MetaError)) throw e;
    const long = await longLivedUserAccess(cfg, person.accessToken);
    secret = {
      accessToken: long.accessToken,
      tokenType: "user",
      expiresAt: long.expiresIn ? new Date(Date.now() + long.expiresIn * 1000).toISOString() : undefined,
      externalBusinessId,
      assets,
    };
  }

  const steps: SetupStep[] = freshSteps(META_STEPS).map((s) =>
    s.key === "business"
      ? { ...s, state: "done", note: "Meta made the business, its catalog and its Page.", finishedAt: new Date().toISOString() }
      : s,
  );

  return withWorkspace(input.workspaceId, async (tx) => {
    await saveMetaCredential(tx, input.workspaceId, secret);
    const meta = {
      fbeExternalId: externalBusinessId,
      shopifyStoreId: shop.id,
      shopifyDomain: shop.domain,
      tokenType: secret.tokenType,
      openedWith: input.purpose,
      connectedAt: new Date().toISOString(),
      setup: { steps, startedAt: new Date().toISOString() },
    };
    const name = input.detail.storeName?.trim() || shop.name;
    const [row] = await tx<{ id: string }[]>`
      insert into armada.stores (workspace_id, platform, mode, name, domain, currency, country, status, meta)
      values (${input.workspaceId}, 'facebook', 'live', ${name}, ${assets.pageId ? `facebook.com/${assets.pageId}` : null},
              ${shop.currency}, ${shop.country}, 'setting_up', ${tx.json(meta as never)})
      on conflict (workspace_id, (meta ->> 'fbeExternalId')) where platform = 'facebook' and mode = 'live'
      do update set status = 'setting_up', domain = excluded.domain, meta = armada.stores.meta || excluded.meta
      returning id`;
    await tx`
      insert into armada.audit_log (workspace_id, member_id, action, detail)
      values (${input.workspaceId}, ${input.memberId}, 'facebook.shop_opened',
              ${tx.json({ storeId: row.id, shopifyStoreId: shop.id, tokenType: secret.tokenType, hasShop: Boolean(assets.commerceId) } as never)})`;
    return { storeId: row.id };
  });
}
