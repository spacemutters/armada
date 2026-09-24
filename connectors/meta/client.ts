import "server-only";
import { open, seal } from "@/lib/crypto";
import { withWorkspace, type Tx } from "@/lib/db";
import { metaConfig, type MetaAssets, type MetaConfig } from "./core";

// A Facebook and Instagram shop's access and ids, kept sealed in armada.credentials (provider
// 'meta', label = the id Armada gave the setup in Meta's window). Nothing outside this folder sees
// the raw values.

export interface MetaSecret {
  accessToken: string;
  /** "system_user": the business's lasting access. "user": a person's 60-day access (the fallback). */
  tokenType: "system_user" | "user";
  expiresAt?: string;
  externalBusinessId: string;
  assets: MetaAssets;
}

export class MetaNotReady extends Error {
  constructor() {
    super("Armada's Meta app isn't set up for shops yet");
  }
}

export function requireMetaConfig(): MetaConfig {
  const cfg = metaConfig(process.env);
  if (!cfg) throw new MetaNotReady();
  return cfg;
}

export async function saveMetaCredential(tx: Tx, workspaceId: string, secret: MetaSecret): Promise<string> {
  const meta = {
    kind: "shop",
    tokenType: secret.tokenType,
    expiresAt: secret.expiresAt ?? null,
    connectedAt: new Date().toISOString(),
  };
  const [row] = await tx<{ id: string }[]>`
    insert into armada.credentials (workspace_id, provider, label, secret, status, meta)
    values (${workspaceId}, 'meta', ${secret.externalBusinessId}, ${seal(secret)}, 'connected', ${tx.json(meta as never)})
    on conflict (workspace_id, provider, label) do update
      set secret = excluded.secret, status = 'connected', meta = armada.credentials.meta || excluded.meta, updated_at = now()
    returning id`;
  return row.id;
}

export async function loadMetaSecret(workspaceId: string, externalBusinessId: string): Promise<MetaSecret | null> {
  const rows = await withWorkspace(
    workspaceId,
    (tx) => tx<{ secret: Buffer }[]>`
      select secret from armada.credentials where provider = 'meta' and label = ${externalBusinessId} and status <> 'disconnected'`,
  );
  return rows[0] ? open<MetaSecret>(rows[0].secret) : null;
}

/** Keeps the sealed ids current after Meta reports a change (e.g. the shop was made later). */
export async function saveMetaAssets(workspaceId: string, current: MetaSecret, assets: MetaAssets): Promise<MetaSecret> {
  const next: MetaSecret = { ...current, assets: { ...current.assets, ...Object.fromEntries(Object.entries(assets).filter(([, v]) => v !== undefined)) } };
  await withWorkspace(
    workspaceId,
    (tx) => tx`
      update armada.credentials
      set secret = ${seal(next)}, updated_at = now()
      where provider = 'meta' and label = ${current.externalBusinessId}`,
  );
  return next;
}
