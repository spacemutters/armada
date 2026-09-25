import "server-only";
import { cache } from "react";
import {
  deleteWebhook,
  ensureCatalog,
  ensurePortal,
  ensureWebhook,
  retrieveAccount,
  type PriceIds,
} from "@/connectors/stripe/client";
import { checkKeyFormat, describeStripeProblem, KEY_FORMAT_MESSAGES, WEBHOOK_PATH } from "@/connectors/stripe/payloads";
import { appOrigin } from "@/lib/connections/types";
import { open, seal } from "@/lib/crypto";
import { asSystem, type Tx } from "@/lib/db";
import { plansVersion, priceSpecs, type BillingInterval, type PlanKey } from "./plans";

// Armada's one Stripe connection (armada.billing_settings, a single row). The key and the signing
// secret are sealed before they reach the database and opened only here, on the server.

export interface StripeConnection {
  accountId: string | null;
  accountName: string | null;
  livemode: boolean;
  connectedAt: Date;
  updatedAt: Date;
  connectedByName: string | null;
  webhookEndpointId: string;
  portalConfigurationId: string | null;
  priceIds: PriceIds;
  productIds: Partial<Record<PlanKey, string>>;
  /** plansVersion() when Stripe was last set up. */
  plansVersion: string | null;
  lastError: string | null;
  lastErrorAt: Date | null;
  /** Whether customers may choose paid plans yet. Off until the admin opens them. */
  plansOpen: boolean;
}

interface Row extends Omit<StripeConnection, "connectedByName"> {
  secretKey: Buffer;
  webhookSecret: Buffer;
  connectedByName: string | null;
}

async function loadRow(): Promise<Row | null> {
  const rows = await asSystem(
    (tx) => tx<Row[]>`
      select b.secret_key, b.webhook_secret, b.webhook_endpoint_id, b.portal_configuration_id, b.account_id, b.account_name,
             b.livemode, b.price_ids, b.product_ids, b.plans_version, b.connected_at, b.updated_at, b.last_error, b.last_error_at, b.plans_open,
             m.display_name as connected_by_name
      from armada.billing_settings b left join armada.members m on m.id = b.connected_by`,
  );
  return rows[0] ?? null;
}

/** The connection as the page shows it, without secrets. Null until Stripe is connected. */
export const stripeConnection = cache(async (): Promise<StripeConnection | null> => {
  const row = await loadRow();
  if (!row) return null;
  const { secretKey: _k, webhookSecret: _w, ...rest } = row;
  void _k;
  void _w;
  return rest;
});

/** The opened key and signing secret, for talking to Stripe and checking its notifications. */
export async function stripeSecrets(): Promise<{ secretKey: string; webhookSecret: string; connection: StripeConnection } | null> {
  const row = await loadRow();
  if (!row) return null;
  const { secretKey, webhookSecret, ...connection } = row;
  return { secretKey: open<string>(secretKey), webhookSecret: open<string>(webhookSecret), connection };
}

/** Price id -> plan and interval, for reading Stripe subscriptions. */
export function priceIndex(priceIds: PriceIds): Record<string, { plan: PlanKey; interval: BillingInterval }> {
  const out: Record<string, { plan: PlanKey; interval: BillingInterval }> = {};
  for (const [plan, byInterval] of Object.entries(priceIds) as [PlanKey, Partial<Record<BillingInterval, string>>][]) {
    for (const [interval, id] of Object.entries(byInterval ?? {}) as [BillingInterval, string][]) if (id) out[id] = { plan, interval };
  }
  return out;
}

/** Remembers (or clears) the last thing Stripe refused, so the admin sees it on /billing. */
export async function noteStripeProblem(message: string | null): Promise<void> {
  await asSystem(
    (tx) => tx`
      update armada.billing_settings
      set last_error = ${message}, last_error_at = ${message ? new Date() : null}`,
  );
}

/** Writes the one connection row, sealing the key and signing secret on the way in. */
export async function saveConnection(
  tx: Tx,
  c: {
    key: string;
    webhookSecret: string;
    webhookEndpointId: string;
    portalConfigurationId: string | null;
    accountId: string | null;
    accountName: string | null;
    livemode: boolean;
    priceIds: PriceIds;
    productIds: Partial<Record<PlanKey, string>>;
    memberId: string | null;
  },
): Promise<void> {
  await tx`
    insert into armada.billing_settings
      (id, secret_key, webhook_secret, webhook_endpoint_id, portal_configuration_id, account_id, account_name, livemode,
       price_ids, product_ids, plans_version, connected_by, connected_at, updated_at, last_error, last_error_at)
    values
      (true, ${seal(c.key)}, ${seal(c.webhookSecret)}, ${c.webhookEndpointId}, ${c.portalConfigurationId}, ${c.accountId}, ${c.accountName}, ${c.livemode},
       ${tx.json(c.priceIds as never)}, ${tx.json(c.productIds as never)}, ${plansVersion()}, ${c.memberId}, now(), now(), null, null)
    on conflict (id) do update set
      secret_key = excluded.secret_key,
      webhook_secret = excluded.webhook_secret,
      webhook_endpoint_id = excluded.webhook_endpoint_id,
      portal_configuration_id = excluded.portal_configuration_id,
      account_id = excluded.account_id,
      account_name = excluded.account_name,
      livemode = excluded.livemode,
      price_ids = excluded.price_ids,
      product_ids = excluded.product_ids,
      plans_version = excluded.plans_version,
      connected_by = excluded.connected_by,
      connected_at = case
        when armada.billing_settings.account_id is not distinct from excluded.account_id
         and armada.billing_settings.livemode = excluded.livemode then armada.billing_settings.connected_at
        else now() end,
      updated_at = now(),
      last_error = null,
      last_error_at = null`;
}

export type ConnectResult ={ ok: true; accountName: string | null; livemode: boolean } | { ok: false; message: string };

/**
 * Connects Stripe with a key the admin pasted, or re-runs the setup with the saved key:
 * checks the key, makes the plans' Products and Prices, turns on the customer billing page, and
 * registers the notification address. Safe to run again: everything is found before it's made.
 */
async function setUp(key: string, who: { memberId: string; workspaceId: string }, action: string): Promise<ConnectResult> {
  const format = checkKeyFormat(key);
  if (!format.ok) return { ok: false, message: KEY_FORMAT_MESSAGES[format.problem] };
  key = key.trim();

  let previous: Awaited<ReturnType<typeof stripeSecrets>> = null;
  try {
    previous = await stripeSecrets();
  } catch {
    previous = null; // unreadable (the encryption key changed): start fresh
  }
  const origin = appOrigin();
  try {
    const account = await retrieveAccount(key);
    const catalog = await ensureCatalog(key, priceSpecs());
    const prev = previous?.connection;
    const sameAccount = Boolean(prev) && prev!.livemode === (format.mode === "live") && (!prev!.accountId || !account.id || prev!.accountId === account.id);
    const portalId = await ensurePortal(key, catalog.portalProducts, `${origin}/billing`, sameAccount ? prev!.portalConfigurationId : null);
    const hook = await ensureWebhook(
      key,
      `${origin}${WEBHOOK_PATH}`,
      sameAccount && previous ? { id: previous.connection.webhookEndpointId, secret: previous.webhookSecret } : null,
    );
    const livemode = hook.livemode;
    const accountName = account.name ?? (sameAccount ? (prev!.accountName ?? null) : null);

    await asSystem(async (tx) => {
      await saveConnection(tx, {
        key,
        webhookSecret: hook.secret,
        webhookEndpointId: hook.id,
        portalConfigurationId: portalId,
        accountId: account.id,
        accountName,
        livemode,
        priceIds: catalog.priceIds,
        productIds: catalog.productIds,
        memberId: who.memberId,
      });
      await tx`
        insert into armada.audit_log (workspace_id, member_id, action, detail)
        values (${who.workspaceId}, ${who.memberId}, ${action},
                ${tx.json({ account: accountName, accountId: account.id, livemode, restrictedKey: format.restricted } as never)})`;
    });

    // Only now that the new signing secret is saved: remove Armada's older addresses, including one
    // left on a different Stripe account or mode by the key this one replaces.
    for (const id of hook.stale) await deleteWebhook(key, id).catch(() => undefined);
    if (previous && previous.connection.webhookEndpointId !== hook.id && !hook.stale.includes(previous.connection.webhookEndpointId)) {
      await deleteWebhook(previous.secretKey, previous.connection.webhookEndpointId).catch(() => undefined);
    }
    return { ok: true, accountName, livemode };
  } catch (e) {
    const message = describeStripeProblem(e);
    if (previous) await noteStripeProblem(message).catch(() => undefined);
    return { ok: false, message };
  }
}

export function connectStripe(key: string, who: { memberId: string; workspaceId: string }): Promise<ConnectResult> {
  return setUp(key, who, "billing.stripe_connected");
}

/** Runs the setup again with the saved key: new prices from lib/billing/plans.ts, a fresh address if needed. */
export async function refreshStripe(who: { memberId: string; workspaceId: string }): Promise<ConnectResult> {
  let secrets: Awaited<ReturnType<typeof stripeSecrets>>;
  try {
    secrets = await stripeSecrets();
  } catch {
    return { ok: false, message: "Armada can't read the saved Stripe key any more. Paste the key again to reconnect." };
  }
  if (!secrets) return { ok: false, message: "Stripe isn't connected yet." };
  return setUp(secrets.secretKey, who, "billing.stripe_updated");
}

/**
 * Disconnects: removes Armada's notification address from Stripe and forgets the key. Products,
 * prices and the customer billing page stay in Stripe, so reconnecting later picks them up again.
 * Subscriptions keep running in Stripe; Armada just stops hearing about them.
 */
export async function disconnectStripe(who: { memberId: string; workspaceId: string }): Promise<void> {
  let secrets: Awaited<ReturnType<typeof stripeSecrets>> = null;
  try {
    secrets = await stripeSecrets();
  } catch {
    secrets = null;
  }
  if (secrets) await deleteWebhook(secrets.secretKey, secrets.connection.webhookEndpointId).catch(() => undefined);
  await asSystem(async (tx) => {
    await tx`delete from armada.billing_settings`;
    await tx`
      insert into armada.audit_log (workspace_id, member_id, action, detail)
      values (${who.workspaceId}, ${who.memberId}, 'billing.stripe_disconnected', ${tx.json({ account: secrets?.connection.accountName ?? null } as never)})`;
  });
}

/** Opens or closes paid plans to customers. Admins can always choose a plan, to try the flow. */
export async function setPlansOpen(open: boolean, who: { memberId: string; workspaceId: string }): Promise<void> {
  await asSystem(async (tx) => {
    await tx`update armada.billing_settings set plans_open = ${open}, updated_at = now()`;
    await tx`
      insert into armada.audit_log (workspace_id, member_id, action, detail)
      values (${who.workspaceId}, ${who.memberId}, ${open ? "billing.plans_opened" : "billing.plans_closed"}, ${tx.json({})})`;
  });
}
