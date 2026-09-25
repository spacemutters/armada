import "server-only";
import { open, seal } from "@/lib/crypto";
import { asSystem, withWorkspace, type Tx } from "@/lib/db";
import { appOrigin } from "@/lib/connections/types";
import { isShopDomain } from "./address";
import { missingScopes, SHOPIFY_API_VERSION, SHOPIFY_PATHS } from "./config";
import { shopifyRequest, ShopifyUnreachable } from "./http";
import { exchangeCode, refreshAccess, shopifyApp, type ShopifySecret } from "./oauth";
import { forgetServiceAccount, relay } from "@/connectors/pipedream/client";
import { isViaService, type ViaService } from "@/connectors/pipedream/core";

// The one door to a connected Shopify store: its sealed access in armada.credentials (provider
// 'shopify', label = the store's permanent address), renewing that access before it runs out, a
// small GraphQL Admin API client pinned to one version, and what happens when a store connects,
// disconnects, or removes Armada on Shopify's side.
//
// A store can also be connected through the connection service (connectors/pipedream): then the
// credential holds only which account at the service it is, and every request goes through the
// service's relay, which adds the store's access. Everything above the transport is the same.

/** Plain reasons a Shopify step stopped. The Connections page turns each code into words. */
export type ShopifyProblemCode = "off" | "refused" | "scopes" | "unreachable" | "approval" | "elsewhere" | "paused" | "failed" | "missing";

export class ShopifyProblem extends Error {
  code: ShopifyProblemCode;
  constructor(code: ShopifyProblemCode, message?: string) {
    super(message ?? code);
    this.code = code;
  }
}

export interface ShopifyMeta {
  shop?: string;
  shopName?: string;
  storeId?: string;
  scope?: string;
  apiVersion?: string;
  connectedAt?: string;
  connectedBy?: string | null;
  devStore?: boolean;
  /**
   * Whether Shopify will tell Armada when the store removes it ("ok"), registering that failed, or
   * the store is connected through the connection service, whose notices Armada can't check.
   */
  watching?: "ok" | "failed" | "service";
  /** Connected through the connection service rather than Armada's own Shopify app. */
  viaService?: boolean;
  lastError?: string;
  lastErrorAt?: string;
}

const APPROVAL_NEEDED = "Shopify asked for a fresh approval for this store. Connect it again.";

// ---------- sealed access ----------

/** What a store's credential holds: Armada's own access, or which account at the connection service. */
type Stored = ShopifySecret | ViaService;
/** How a request reaches the store: with an access token, or through the connection service. */
export type ShopifyAccess = string | ViaService;

async function readSecret(tx: Tx, shop: string, lock = false): Promise<{ secret: Stored; status: string } | null> {
  const rows = lock
    ? await tx<{ secret: Buffer; status: string }[]>`
        select secret, status from armada.credentials where provider = 'shopify' and label = ${shop} for update`
    : await tx<{ secret: Buffer; status: string }[]>`
        select secret, status from armada.credentials where provider = 'shopify' and label = ${shop}`;
  if (!rows[0]) return null;
  return { secret: open<Stored>(rows[0].secret), status: rows[0].status };
}

async function markNeedsApproval(workspaceId: string, shop: string, message = APPROVAL_NEEDED) {
  await withWorkspace(workspaceId, async (tx) => {
    await tx`
      update armada.credentials
      set status = 'needs_attention', meta = meta || ${tx.json({ lastError: message, lastErrorAt: new Date().toISOString() } as never)}, updated_at = now()
      where provider = 'shopify' and label = ${shop}`;
    await tx`
      update armada.stores set status = 'needs_attention'
      where platform = 'shopify' and mode = 'live' and domain = ${shop} and status = 'connected'`;
  });
}

/** Renew five minutes early, so a request never leaves with access that runs out on the way. */
const needsRenewal = (s: ShopifySecret) => Boolean(s.accessExpiresAt) && Date.parse(s.accessExpiresAt as string) - Date.now() < 5 * 60_000;

/**
 * Current access for a connected store, renewed first if it's about to run out (or `force`, after
 * Shopify refused it). Renewal holds a lock on the credential row: Shopify warns that two renewals
 * at once retire each other's result, so a second caller waits and then uses the first one's.
 */
export async function accessFor(workspaceId: string, shop: string, { force = false } = {}): Promise<ShopifyAccess> {
  const found = await withWorkspace(workspaceId, (tx) => readSecret(tx, shop));
  if (!found || found.status === "disconnected") throw new ShopifyProblem("missing", "This store isn't connected.");
  const stored = found.secret;
  // The connection service keeps the store's access fresh itself; a refusal means approve again.
  if (isViaService(stored)) {
    if (!force) return stored;
    await markNeedsApproval(workspaceId, shop);
    throw new ShopifyProblem("approval", APPROVAL_NEEDED);
  }
  if (!force && !needsRenewal(stored)) return stored.accessToken;
  if (!stored.refreshToken) {
    if (!force) return stored.accessToken;
    await markNeedsApproval(workspaceId, shop);
    throw new ShopifyProblem("approval", APPROVAL_NEEDED);
  }

  const outcome = await withWorkspace(workspaceId, async (tx) => {
    const locked = await readSecret(tx, shop, true);
    if (!locked || isViaService(locked.secret)) return { kind: "missing" as const };
    // Someone renewed it while this call waited for the lock.
    if (locked.secret.accessToken !== stored.accessToken && !needsRenewal(locked.secret)) return { kind: "ok" as const, token: locked.secret.accessToken };
    const r = await refreshAccess(shop, locked.secret);
    if (r.kind !== "refreshed") return r;
    await tx`
      update armada.credentials
      set secret = ${seal(r.secret)}, status = 'connected', meta = meta - 'lastError' - 'lastErrorAt', updated_at = now()
      where provider = 'shopify' and label = ${shop}`;
    return { kind: "ok" as const, token: r.secret.accessToken };
  });
  if (outcome.kind === "ok") return outcome.token;
  if (outcome.kind === "missing") throw new ShopifyProblem("missing", "This store isn't connected.");
  if (outcome.kind === "retry") throw new ShopifyProblem("unreachable", "Couldn't reach Shopify just now. Try again in a minute.");
  if (outcome.kind === "reauthorize") {
    await markNeedsApproval(workspaceId, shop);
    throw new ShopifyProblem("approval", APPROVAL_NEEDED);
  }
  throw new ShopifyProblem("failed", `Shopify refused to renew access (status ${outcome.status}).`);
}

// ---------- GraphQL Admin API ----------

interface GraphqlError {
  message: string;
  extensions?: { code?: string };
}
interface GraphqlBody<T> {
  data?: T;
  errors?: GraphqlError[];
  extensions?: { cost?: { requestedQueryCost?: number; throttleStatus?: { currentlyAvailable?: number; restoreRate?: number } } };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function post<T>(shop: string, access: ShopifyAccess, query: string, variables?: Record<string, unknown>) {
  const path = `/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
  if (typeof access !== "string") {
    // Through the connection service: a path, not a full address, because the service fills in the
    // store's own <store>.myshopify.com from the connected account.
    let r: Awaited<ReturnType<typeof relay>>;
    try {
      r = await relay(access.externalUserId, access.accountId, path, {
        method: "POST",
        headers: { accept: "application/json" },
        body: JSON.stringify({ query, variables }),
      });
    } catch (e) {
      throw new ShopifyUnreachable(shop, e);
    }
    let body: GraphqlBody<T> = {};
    try {
      body = JSON.parse(r.text) as GraphqlBody<T>;
    } catch {
      body = {};
    }
    return { status: r.status, retryAfter: Number(r.headers.get("retry-after")) || 0, body };
  }
  const res = await shopifyRequest(shop, path, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", "X-Shopify-Access-Token": access },
    body: JSON.stringify({ query, variables }),
  });
  const body = (await res.json().catch(() => ({}))) as GraphqlBody<T>;
  return { status: res.status, retryAfter: Number(res.headers.get("retry-after")) || 0, body };
}

/** How long Shopify's cost bucket needs to refill enough for this query, from its own numbers. */
function throttleWait(body: GraphqlBody<unknown>, attempt: number): number {
  const cost = body.extensions?.cost;
  const need = (cost?.requestedQueryCost ?? 0) - (cost?.throttleStatus?.currentlyAvailable ?? 0);
  const rate = cost?.throttleStatus?.restoreRate ?? 50;
  return Math.min(10_000, Math.max(1000 * (attempt + 1), (need / rate) * 1000 + 250));
}

/**
 * Sends one GraphQL query with the given access, retrying only what Shopify marks as temporary:
 * throttling (by its cost numbers), 429 and 5xx. `onRefused` is asked once for fresh access if
 * Shopify answers 401. Throws ShopifyProblem with a plain message for everything else.
 */
async function run<T>(shop: string, token: ShopifyAccess, query: string, variables: Record<string, unknown> | undefined, onRefused?: () => Promise<ShopifyAccess>): Promise<T> {
  let renewed = false;
  for (let attempt = 0; attempt < 4; attempt++) {
    let r: Awaited<ReturnType<typeof post<T>>>;
    try {
      r = await post<T>(shop, token, query, variables);
    } catch (e) {
      if (e instanceof ShopifyUnreachable && attempt < 2) {
        await sleep(1000 * (attempt + 1));
        continue;
      }
      if (e instanceof ShopifyUnreachable) throw new ShopifyProblem("unreachable", "Couldn't reach Shopify just now. Try again in a minute.");
      throw e;
    }
    if (r.status === 401) {
      if (onRefused && !renewed) {
        renewed = true;
        token = await onRefused();
        continue;
      }
      throw new ShopifyProblem("approval", APPROVAL_NEEDED);
    }
    if (r.status === 402 || r.status === 423) throw new ShopifyProblem("paused", "Shopify has paused this store, usually because of its plan or bill.");
    if (r.status === 404) throw new ShopifyProblem("missing", "Shopify can't find this store any more.");
    if (r.status === 403) throw new ShopifyProblem("failed", "Shopify didn't allow that for this store.");
    if (r.status === 429 || r.status >= 500) {
      await sleep(Math.min(10_000, (r.retryAfter || attempt + 1) * 1000));
      continue;
    }
    const errors = r.body.errors ?? [];
    if (errors.some((e) => e.extensions?.code === "THROTTLED")) {
      await sleep(throttleWait(r.body, attempt));
      continue;
    }
    if (errors.length) throw new ShopifyProblem("failed", `Shopify said: ${errors[0].message}`);
    if (r.status !== 200 || !r.body.data) throw new ShopifyProblem("failed", `Shopify answered with status ${r.status}.`);
    return r.body.data;
  }
  throw new ShopifyProblem("unreachable", "Shopify is busy right now. Try again in a minute.");
}

/** Runs a GraphQL Admin API query for a connected store, renewing its access when needed. */
export async function shopifyGraphql<T>(workspaceId: string, shop: string, query: string, variables?: Record<string, unknown>): Promise<T> {
  const token = await accessFor(workspaceId, shop);
  return run<T>(shop, token, query, variables, () => accessFor(workspaceId, shop, { force: true }));
}

// ---------- what Armada reads and registers ----------

export interface ShopInfo {
  id: string;
  name: string;
  myshopifyDomain: string;
  currencyCode: string;
  primaryDomain: string | null;
  country: string | null;
  devStore: boolean;
}

const SHOP_QUERY = `query ArmadaShop {
  shop {
    id
    name
    myshopifyDomain
    currencyCode
    primaryDomain { host }
    billingAddress { countryCodeV2 }
    plan { partnerDevelopment }
  }
}`;

interface ShopQuery {
  shop: {
    id: string;
    name: string;
    myshopifyDomain: string;
    currencyCode: string;
    primaryDomain: { host: string } | null;
    billingAddress: { countryCodeV2: string | null } | null;
    plan: { partnerDevelopment: boolean } | null;
  };
}

function toShopInfo(d: ShopQuery): ShopInfo {
  return {
    id: d.shop.id,
    name: d.shop.name,
    myshopifyDomain: d.shop.myshopifyDomain,
    currencyCode: d.shop.currencyCode,
    primaryDomain: d.shop.primaryDomain?.host ?? null,
    country: d.shop.billingAddress?.countryCodeV2 ?? null,
    devStore: Boolean(d.shop.plan?.partnerDevelopment),
  };
}

/** The store's name, currency and addresses. */
export async function shopInfo(workspaceId: string, shop: string): Promise<ShopInfo> {
  return toShopInfo(await shopifyGraphql<ShopQuery>(workspaceId, shop, SHOP_QUERY));
}

const WEBHOOK_MUTATION = `mutation ArmadaWatch($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
  webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
    webhookSubscription { id }
    userErrors { field message }
  }
}`;

interface WebhookResult {
  webhookSubscriptionCreate: { webhookSubscription: { id: string } | null; userErrors: { field: string[] | null; message: string }[] };
}

/**
 * Asks Shopify to tell Armada when this store removes the app (topic app/uninstalled), so the store
 * shows as disconnected straight away. Registering twice is harmless: Shopify answers that the
 * address is already taken, which counts as done.
 */
async function watchForRemoval(shop: string, token: ShopifyAccess): Promise<"ok" | "failed" | "service"> {
  // Shopify signs its notices with the approved app's secret, which is the connection service's,
  // not Armada's, so Armada couldn't check they're real. Those stores aren't watched this way.
  if (typeof token !== "string") return "service";
  try {
    const d = await run<WebhookResult>(shop, token, WEBHOOK_MUTATION, {
      topic: "APP_UNINSTALLED",
      webhookSubscription: { uri: appOrigin() + SHOPIFY_PATHS.uninstalled },
    });
    const errors = d.webhookSubscriptionCreate.userErrors;
    return !errors.length || errors.every((e) => /already been taken|already exists/i.test(e.message)) ? "ok" : "failed";
  } catch {
    return "failed";
  }
}

/** Registers the removal notice again for a connected store (e.g. after Armada's address changes). */
export async function rewatchForRemoval(workspaceId: string, shop: string): Promise<"ok" | "failed" | "service"> {
  const token = await accessFor(workspaceId, shop);
  const result = await watchForRemoval(shop, token);
  await withWorkspace(
    workspaceId,
    (tx) => tx`update armada.credentials set meta = meta || ${tx.json({ watching: result } as never)} where provider = 'shopify' and label = ${shop}`,
  );
  return result;
}

// ---------- connecting ----------

/** This workspace's live row for a store that's connected and working, if there is one. */
export async function connectedStoreId(workspaceId: string, shop: string): Promise<string | null> {
  const rows = await withWorkspace(
    workspaceId,
    (tx) => tx<{ id: string }[]>`
      select s.id from armada.stores s
      join armada.credentials c on c.provider = 'shopify' and c.label = s.domain and c.status = 'connected'
      where s.platform = 'shopify' and s.mode = 'live' and s.domain = ${shop} and s.status = 'connected'`,
  );
  return rows[0]?.id ?? null;
}

/**
 * The store is live-connected in another workspace. Its access can't be shared: a second approval
 * retires the first workspace's access, so connecting it here would silently break it there.
 */
export async function connectedElsewhere(workspaceId: string, shop: string): Promise<boolean> {
  const rows = await asSystem(
    (tx) => tx<{ n: number }[]>`
      select count(*)::int as n from armada.credentials c
      where c.provider = 'shopify' and c.label = ${shop} and c.workspace_id <> ${workspaceId} and c.status <> 'disconnected'`,
  );
  return (rows[0]?.n ?? 0) > 0;
}

/**
 * Finishes a connection after Shopify's approval: trades the code for access, checks every
 * permission was granted, seals the access, reads the store's name, creates or updates its live row
 * in Stores, notes it in the audit log, and asks Shopify for the removal notice.
 */
export async function completeShopifyConnection(input: { workspaceId: string; memberId: string | null; shop: string; code: string }): Promise<{ storeId: string; name: string }> {
  const { workspaceId, memberId, shop, code } = input;
  if (!shopifyApp()) throw new ShopifyProblem("off");
  if (!isShopDomain(shop)) throw new ShopifyProblem("refused");
  if (await connectedElsewhere(workspaceId, shop)) throw new ShopifyProblem("elsewhere");

  const exchanged = await exchangeCode(shop, code);
  if (exchanged.kind === "unreachable") throw new ShopifyProblem("unreachable");
  if (exchanged.kind === "refused") throw new ShopifyProblem("refused");
  const secret = exchanged.secret;
  if (missingScopes(secret.scope).length) throw new ShopifyProblem("scopes");

  // The store's own details. If Shopify is slow to answer, the connection still stands, named after its address.
  let info: ShopInfo;
  try {
    info = toShopInfo(await run<ShopQuery>(shop, secret.accessToken, SHOP_QUERY, undefined));
  } catch {
    info = { id: "", name: shop.replace(/\.myshopify\.com$/, ""), myshopifyDomain: shop, currencyCode: "USD", primaryDomain: null, country: null, devStore: false };
  }

  const now = new Date().toISOString();
  const storeId = await withWorkspace(workspaceId, async (tx) => {
    const meta: ShopifyMeta = { shop, shopName: info.name, scope: secret.scope, apiVersion: SHOPIFY_API_VERSION, connectedAt: now, connectedBy: memberId, devStore: info.devStore };
    await tx`
      insert into armada.credentials (workspace_id, provider, label, secret, status, meta)
      values (${workspaceId}, 'shopify', ${shop}, ${seal(secret)}, 'connected', ${tx.json(meta as never)})
      on conflict (workspace_id, provider, label) do update
        set secret = excluded.secret, status = 'connected', meta = excluded.meta, updated_at = now()`;
    const storeMeta = {
      credentialLabel: shop,
      shopifyShopId: info.id || null,
      primaryDomain: info.primaryDomain,
      devStore: info.devStore,
      connectedAt: now,
    };
    const [row] = await tx<{ id: string }[]>`
      insert into armada.stores (workspace_id, platform, mode, name, domain, currency, country, status, meta)
      values (${workspaceId}, 'shopify', 'live', ${info.name.slice(0, 120)}, ${shop}, ${info.currencyCode || "USD"}, ${info.country || "US"}, 'connected', ${tx.json(storeMeta as never)})
      on conflict (workspace_id, domain) where platform = 'shopify' and mode = 'live' do update
        set name = excluded.name, currency = excluded.currency, country = excluded.country, status = 'connected',
            meta = armada.stores.meta - 'disconnectedAt' - 'disconnectedBy' - 'removedInShopifyAt' - 'stillInShopify' || excluded.meta
      returning id`;
    await tx`update armada.credentials set meta = meta || ${tx.json({ storeId: row.id } as never)} where provider = 'shopify' and label = ${shop}`;
    await tx`
      insert into armada.audit_log (workspace_id, member_id, action, detail)
      values (${workspaceId}, ${memberId}, 'shopify.connected', ${tx.json({ shop, storeId: row.id, name: info.name } as never)})`;
    return row.id;
  });

  const watching = await watchForRemoval(shop, secret.accessToken);
  await withWorkspace(
    workspaceId,
    (tx) => tx`update armada.credentials set meta = meta || ${tx.json({ watching } as never)} where provider = 'shopify' and label = ${shop}`,
  );
  return { storeId, name: info.name };
}

/**
 * Finishes a connection made through the connection service: reads which store it is through the
 * service, keeps only which account it is (never a key), and creates or updates its live row.
 */
export async function completeShopifyViaService(input: { workspaceId: string; memberId: string | null; account: ViaService }): Promise<{ storeId: string; name: string }> {
  const { workspaceId, memberId, account } = input;
  const d = await run<ShopQuery>("service", account, SHOP_QUERY, undefined);
  const info = toShopInfo(d);
  const shop = info.myshopifyDomain.toLowerCase();
  if (!isShopDomain(shop)) throw new ShopifyProblem("refused");
  if (await connectedElsewhere(workspaceId, shop)) throw new ShopifyProblem("elsewhere");

  const now = new Date().toISOString();
  return withWorkspace(workspaceId, async (tx) => {
    const meta: ShopifyMeta = {
      shop,
      shopName: info.name,
      apiVersion: SHOPIFY_API_VERSION,
      connectedAt: now,
      connectedBy: memberId,
      devStore: info.devStore,
      watching: "service",
      viaService: true,
    };
    await tx`
      insert into armada.credentials (workspace_id, provider, label, secret, status, meta)
      values (${workspaceId}, 'shopify', ${shop}, ${seal(account)}, 'connected', ${tx.json(meta as never)})
      on conflict (workspace_id, provider, label) do update
        set secret = excluded.secret, status = 'connected', meta = excluded.meta, updated_at = now()`;
    const storeMeta = { credentialLabel: shop, shopifyShopId: info.id || null, primaryDomain: info.primaryDomain, devStore: info.devStore, connectedAt: now, viaService: true };
    const [row] = await tx<{ id: string }[]>`
      insert into armada.stores (workspace_id, platform, mode, name, domain, currency, country, status, meta)
      values (${workspaceId}, 'shopify', 'live', ${info.name.slice(0, 120)}, ${shop}, ${info.currencyCode || "USD"}, ${info.country || "US"}, 'connected', ${tx.json(storeMeta as never)})
      on conflict (workspace_id, domain) where platform = 'shopify' and mode = 'live' do update
        set name = excluded.name, currency = excluded.currency, country = excluded.country, status = 'connected',
            meta = armada.stores.meta - 'disconnectedAt' - 'disconnectedBy' - 'removedInShopifyAt' - 'stillInShopify' || excluded.meta
      returning id`;
    await tx`update armada.credentials set meta = meta || ${tx.json({ storeId: row.id } as never)} where provider = 'shopify' and label = ${shop}`;
    await tx`
      insert into armada.audit_log (workspace_id, member_id, action, detail)
      values (${workspaceId}, ${memberId}, 'shopify.connected', ${tx.json({ shop, storeId: row.id, name: info.name, via: "service" } as never)})`;
    return { storeId: row.id, name: info.name };
  });
}

// ---------- disconnecting ----------

const UNINSTALL_MUTATION = `mutation ArmadaLeave { appUninstall { app { id } userErrors { field message } } }`;

/**
 * Disconnects a store: Armada removes itself from the store in Shopify (appUninstall, which takes
 * no arguments and removes only the calling app), forgets the access, and marks the store
 * disconnected. Its products and orders stay in Armada. If Shopify can't be reached, Armada still
 * lets go, and says so.
 */
export async function disconnectShopify(workspaceId: string, memberId: string, shop: string): Promise<{ removedInShopify: boolean }> {
  let removedInShopify = false;
  try {
    const token = await accessFor(workspaceId, shop);
    if (typeof token === "string") {
      const d = await run<{ appUninstall: { userErrors: { message: string }[] } }>(shop, token, UNINSTALL_MUTATION, undefined);
      removedInShopify = d.appUninstall.userErrors.length === 0;
    } else {
      // The approved app is the connection service's, and the store may use it for other things, so
      // Armada only deletes its own access there.
      await forgetServiceAccount(token.accountId).catch(() => false);
      removedInShopify = false;
    }
  } catch {
    removedInShopify = false;
  }
  await withWorkspace(workspaceId, async (tx) => {
    await tx`delete from armada.credentials where provider = 'shopify' and label = ${shop}`;
    await tx`
      update armada.stores
      set status = 'disconnected',
          meta = meta || ${tx.json({ disconnectedAt: new Date().toISOString(), disconnectedBy: memberId, stillInShopify: !removedInShopify } as never)}
      where platform = 'shopify' and mode = 'live' and domain = ${shop}`;
    await tx`
      insert into armada.audit_log (workspace_id, member_id, action, detail)
      values (${workspaceId}, ${memberId}, 'shopify.disconnected', ${tx.json({ shop, removedInShopify } as never)})`;
  });
  return { removedInShopify };
}

// ---------- notices from Shopify ----------

/**
 * Shopify says a store removed Armada (app/uninstalled). The access is already dead, so it's
 * deleted, and every workspace's live row for that store shows as disconnected. Safe to receive
 * twice. `triggeredAt` (Shopify's X-Shopify-Triggered-At) keeps a late notice from undoing a
 * connection made after the removal, e.g. disconnect then connect again straight away.
 */
export async function shopifyRemovedArmada(shop: string, triggeredAt: Date = new Date()): Promise<number> {
  if (!isShopDomain(shop)) return 0;
  const at = triggeredAt.toISOString();
  return asSystem(async (tx) => {
    const creds = await tx<{ workspaceId: string }[]>`
      delete from armada.credentials
      where provider = 'shopify' and label = ${shop} and coalesce((meta ->> 'connectedAt')::timestamptz, created_at) <= ${at}::timestamptz
      returning workspace_id`;
    const stores = await tx<{ workspaceId: string; id: string }[]>`
      update armada.stores
      set status = 'disconnected', meta = meta || ${tx.json({ removedInShopifyAt: new Date().toISOString() } as never)}
      where platform = 'shopify' and mode = 'live' and domain = ${shop} and status <> 'disconnected'
        and coalesce((meta ->> 'connectedAt')::timestamptz, created_at) <= ${at}::timestamptz
      returning workspace_id, id`;
    const workspaces = new Set([...creds.map((c) => c.workspaceId), ...stores.map((s) => s.workspaceId)]);
    for (const w of workspaces) {
      await tx`
        insert into armada.audit_log (workspace_id, action, detail)
        values (${w}, 'shopify.removed_in_shopify', ${tx.json({ shop } as never)})`;
    }
    return stores.length;
  });
}

/**
 * Shopify's privacy notices, required for every public app. Armada keeps no shopper names,
 * emails, phone numbers or addresses from Shopify (orders hold totals and a country), so a
 * shopper's data request or erase request is recorded for the owner and needs nothing erased.
 * shop/redact arrives 48 hours after a store removed Armada: that store's rows are erased, unless
 * it was connected again since.
 */
export async function shopifyPrivacyNotice(topic: string, shop: string, payload: Record<string, unknown>): Promise<void> {
  if (!isShopDomain(shop)) return;
  await asSystem(async (tx) => {
    const owners = await tx<{ workspaceId: string }[]>`
      select distinct workspace_id from armada.stores where platform = 'shopify' and mode = 'live' and domain = ${shop}`;
    if (topic === "shop/redact") {
      await tx`delete from armada.credentials where provider = 'shopify' and label = ${shop} and status = 'disconnected'`;
      await tx`delete from armada.stores where platform = 'shopify' and mode = 'live' and domain = ${shop} and status = 'disconnected'`;
    }
    // Only ids: the notice itself carries a shopper's email and phone, which Armada doesn't keep.
    const customer = payload.customer as { id?: unknown } | undefined;
    const detail = {
      topic,
      shop,
      customerId: customer?.id ?? null,
      orders: Array.isArray(payload.orders_requested) ? payload.orders_requested.length : Array.isArray(payload.orders_to_redact) ? payload.orders_to_redact.length : null,
    };
    for (const o of owners.length ? owners : [{ workspaceId: null }]) {
      await tx`insert into armada.audit_log (workspace_id, action, detail) values (${o.workspaceId}, 'shopify.privacy_notice', ${tx.json(detail as never)})`;
    }
  });
}
