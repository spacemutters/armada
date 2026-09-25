import "server-only";
import { open, seal } from "@/lib/crypto";
import { withWorkspace, type Tx } from "@/lib/db";
import { accessIsStale, ebayConfig, type EbayConfig, type EbayEnv, type EbayTokens } from "./core";
import { EbayError, ebayRequest, ebayRequestVia, refreshAccess } from "./http";
import { isViaService, type ViaService } from "@/connectors/pipedream/core";

// A seller's eBay access, kept sealed in armada.credentials (provider 'ebay', label = eBay's
// permanent user id). Nothing outside this file sees the raw values.

export interface EbaySecret extends EbayTokens {
  env: EbayEnv;
  userId: string;
  username: string;
}

/** A seller connected through the connection service: which account there, never a key. */
export interface EbayViaService extends ViaService {
  env: "production";
  userId: string;
  username: string;
}

type Stored = EbaySecret | EbayViaService;

export class EbayNotReady extends Error {
  constructor() {
    super("Armada's eBay app isn't set up yet");
  }
}

export function requireEbayConfig(): EbayConfig {
  const cfg = ebayConfig(process.env);
  if (!cfg) throw new EbayNotReady();
  return cfg;
}

/** Saves (or replaces) a seller's sealed access. Returns the credential's id. */
export async function saveEbayCredential(tx: Tx, workspaceId: string, secret: Stored): Promise<string> {
  const meta = isViaService(secret)
    ? { username: secret.username, env: secret.env, connectedAt: new Date().toISOString(), viaService: true }
    : {
        username: secret.username,
        env: secret.env,
        connectedAt: new Date().toISOString(),
        accessExpiresAt: secret.accessExpiresAt,
        refreshExpiresAt: secret.refreshExpiresAt,
      };
  const [row] = await tx<{ id: string }[]>`
    insert into armada.credentials (workspace_id, provider, label, secret, status, meta)
    values (${workspaceId}, 'ebay', ${secret.userId}, ${seal(secret)}, 'connected', ${tx.json(meta as never)})
    on conflict (workspace_id, provider, label) do update
      set secret = excluded.secret, status = 'connected', meta = armada.credentials.meta || excluded.meta, updated_at = now()
    returning id`;
  return row.id;
}

async function loadSecret(workspaceId: string, userId: string): Promise<Stored> {
  const rows = await withWorkspace(
    workspaceId,
    (tx) => tx<{ secret: Buffer }[]>`select secret from armada.credentials where provider = 'ebay' and label = ${userId} and status <> 'disconnected'`,
  );
  if (!rows[0]) throw new EbayError(401, [{ message: "No eBay access saved for this account" }]);
  return open<Stored>(rows[0].secret);
}

async function storeRenewed(workspaceId: string, next: EbaySecret): Promise<void> {
  await withWorkspace(
    workspaceId,
    (tx) => tx`
      update armada.credentials
      set secret = ${seal(next)}, status = 'connected', updated_at = now(),
          meta = meta || ${tx.json({ accessExpiresAt: next.accessExpiresAt } as never)}
      where provider = 'ebay' and label = ${next.userId}`,
  );
}

async function markNeedsSignIn(workspaceId: string, userId: string): Promise<void> {
  await withWorkspace(
    workspaceId,
    (tx) => tx`
      update armada.credentials set status = 'needs_attention', updated_at = now(),
        meta = meta || ${tx.json({ lastError: "eBay needs the seller to sign in again", lastErrorAt: new Date().toISOString() } as never)}
      where provider = 'ebay' and label = ${userId}`,
  );
}

/**
 * The seller's current access, renewed first when it has under five minutes left (or when `force`
 * is set after eBay refused it). A refusal to renew means the seller must sign in to eBay again.
 */
export async function ebayAccess(workspaceId: string, userId: string, force = false): Promise<{ token: string; env: EbayEnv }> {
  const secret = await loadSecret(workspaceId, userId);
  if (isViaService(secret)) throw new EbayError(401, [{ message: "This account is connected through the connection service" }]);
  if (!force && !accessIsStale(secret.accessExpiresAt, Date.now())) return { token: secret.accessToken, env: secret.env };
  const cfg = requireEbayConfig();
  if (cfg.env !== secret.env) throw new EbayError(401, [{ message: "This account was connected on the other eBay site" }]);
  try {
    const renewed = await refreshAccess(cfg, secret);
    const next: EbaySecret = { ...secret, ...renewed };
    await storeRenewed(workspaceId, next);
    return { token: next.accessToken, env: next.env };
  } catch (e) {
    if (e instanceof EbayError && e.status === 401) await markNeedsSignIn(workspaceId, userId);
    throw e;
  }
}

/** A call on a seller's behalf. If eBay says the access is no longer good, it's renewed once and retried. */
export async function ebayCall<T>(workspaceId: string, userId: string, opts: Parameters<typeof ebayRequest>[2]): Promise<T | null> {
  const stored = await loadSecret(workspaceId, userId);
  if (isViaService(stored)) {
    // The connection service keeps the access fresh; a refusal means the seller signs in again.
    try {
      return await ebayRequestVia<T>(stored, opts);
    } catch (e) {
      if (e instanceof EbayError && e.status === 401) await markNeedsSignIn(workspaceId, userId);
      throw e;
    }
  }
  const first = await ebayAccess(workspaceId, userId);
  try {
    return await ebayRequest<T>(first.env, first.token, opts);
  } catch (e) {
    if (!(e instanceof EbayError) || e.status !== 401) throw e;
    const again = await ebayAccess(workspaceId, userId, true);
    return ebayRequest<T>(again.env, again.token, opts);
  }
}
