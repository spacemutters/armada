import "server-only";
import { connectPage, forgetServiceAccount, pdSettings } from "@/connectors/pipedream/client";
import { externalUserFor, isViaService, type PdProvider, type ViaService } from "@/connectors/pipedream/core";
import { accountName } from "@/connectors/pipedream/identity";
import { seal } from "@/lib/crypto";
import { open } from "@/lib/crypto";
import { withWorkspace } from "@/lib/db";
import { CREDENTIAL_PROVIDER } from "./status";
import { appOrigin } from "./types";
import { createState } from "./state";

// Connecting a platform through the connection service (connectors/pipedream): the Connect press
// starts a one-time round trip and goes to the service's hosted page, where the seller picks the
// platform account and approves on the platform's own page; the service sends them back to
// /api/connect/service/<platform>/done, which finishes the connection.

/** Whether one-click connections through the service are switched on. */
export async function serviceOn(): Promise<boolean> {
  return (await pdSettings()) !== null;
}

export const serviceDonePath = (provider: PdProvider) => `/api/connect/service/${provider}/done`;

/** The address of the service's connect page for this workspace and platform. */
export async function startViaService(input: {
  workspaceId: string;
  memberId: string;
  provider: PdProvider;
  purpose: "connect" | "open";
  returnTo: string;
  detail?: Record<string, string>;
}): Promise<string> {
  const state = await createState(input.workspaceId, input.memberId, input.provider, input.purpose, {
    returnTo: input.returnTo,
    via: "service",
    ...(input.detail ?? {}),
  });
  await withWorkspace(
    input.workspaceId,
    (tx) => tx`
      insert into armada.audit_log (workspace_id, member_id, action, detail)
      values (${input.workspaceId}, ${input.memberId}, ${`${input.provider}.connect_started`}, ${tx.json({ via: "service", purpose: input.purpose } as never)})`,
  );
  return connectPage(externalUserFor(input.workspaceId), input.provider, `${appOrigin()}${serviceDonePath(input.provider)}?state=${encodeURIComponent(state)}`);
}

/** The service accounts this workspace already uses for a platform, so a new one can be told apart. */
export async function knownServiceAccounts(workspaceId: string, provider: PdProvider): Promise<Set<string>> {
  const rows = await withWorkspace(
    workspaceId,
    (tx) => tx<{ secret: Buffer }[]>`select secret from armada.credentials where provider = ${provider} and status <> 'disconnected'`,
  );
  const ids = new Set<string>();
  for (const r of rows) {
    try {
      const s = open<unknown>(r.secret);
      if (isViaService(s)) ids.add(s.accountId);
    } catch {
      // A credential sealed with an older key can't be one of these.
    }
  }
  return ids;
}

/** On disconnect: if the credential was made through the service, its account there is deleted too. */
export async function forgetViaService(workspaceId: string, provider: string, label: string): Promise<void> {
  const rows = await withWorkspace(
    workspaceId,
    (tx) => tx<{ secret: Buffer }[]>`select secret from armada.credentials where provider = ${provider} and label = ${label}`,
  );
  if (!rows[0]) return;
  try {
    const s = open<unknown>(rows[0].secret);
    if (isViaService(s)) await forgetServiceAccount(s.accountId);
  } catch {
    // Letting go here still disconnects it in Armada.
  }
}

/**
 * Finishes a supplier or ad account connected through the service: its credential holds only which
 * account it is at the service (sealed, never a key), named by what the platform says it's called.
 */
export async function completeViaService(input: { workspaceId: string; memberId: string | null; provider: PdProvider; via: ViaService; fallbackName: string | null }): Promise<void> {
  const name = (await accountName(input.provider, input.via)) ?? input.fallbackName;
  const credProvider = CREDENTIAL_PROVIDER[input.provider];
  const meta = { account: name, via: "service", connectedAt: new Date().toISOString(), connectedBy: input.memberId };
  await withWorkspace(input.workspaceId, async (tx) => {
    await tx`
      insert into armada.credentials (workspace_id, provider, label, secret, status, meta)
      values (${input.workspaceId}, ${credProvider}, ${input.via.accountId}, ${seal(input.via)}, 'connected', ${tx.json(meta as never)})
      on conflict (workspace_id, provider, label) do update
        set secret = excluded.secret, status = 'connected', meta = excluded.meta, updated_at = now()`;
    await tx`
      insert into armada.audit_log (workspace_id, member_id, action, detail)
      values (${input.workspaceId}, ${input.memberId}, ${`${input.provider}.connected`}, ${tx.json({ via: "service", account: name } as never)})`;
  });
}
