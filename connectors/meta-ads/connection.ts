import "server-only";
import { open, seal } from "@/lib/crypto";
import { appOrigin } from "@/lib/connections/types";
import { withWorkspace } from "@/lib/db";
import { exchangeCode, extendToken, listAdAccounts, listPages, loginDialogUrl, MetaProblem, whoAmI, type MetaAdAccount, type MetaPage } from "./client";

// A workspace's Meta ad account connection. The sign-in is stored sealed (lib/crypto.ts) in
// armada.credentials as provider 'meta', label 'ads' (Facebook shops and social posting keep their
// own labels). Only non-secret facts sit in `meta`: which ad account and Page ads use.

export const CALLBACK_PATH = "/api/connect/meta_ads/callback";
const LABEL = "ads";

/** What Armada asks Meta for. Each needs Advanced Access through Meta's App Review before real customers can connect. */
export const META_ADS_SCOPES = [
  "ads_management",
  "ads_read",
  "business_management",
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_ads",
  "instagram_basic",
];

export interface MetaConnection {
  status: "connected" | "needs_attention" | "disconnected";
  personName: string;
  adAccounts: MetaAdAccount[];
  adAccountId: string | null;
  pages: MetaPage[];
  pageId: string | null;
  expiresAt: string | null;
  lastError: string | null;
  connectedAt: string;
}

export function metaLoginUrl(state: string): string {
  return loginDialogUrl({ appId: process.env.META_APP_ID ?? "", redirectUri: appOrigin() + CALLBACK_PATH, state, scopes: META_ADS_SCOPES });
}

/** Finishes the round trip through Meta's sign-in: swaps the code for a long sign-in and saves it sealed. */
export async function finishMetaConnect(workspaceId: string, code: string): Promise<MetaConnection> {
  const short = await exchangeCode(code, appOrigin() + CALLBACK_PATH);
  const long = await extendToken(short.token).catch(() => short);
  const [me, adAccounts, pages] = await Promise.all([whoAmI(long.token), listAdAccounts(long.token), listPages(long.token)]);
  const firstActive = adAccounts.find((a) => a.active) ?? adAccounts[0] ?? null;
  const conn: MetaConnection = {
    status: "connected",
    personName: me.name,
    adAccounts,
    adAccountId: firstActive?.id ?? null,
    pages,
    pageId: pages[0]?.id ?? null,
    expiresAt: long.expiresIn ? new Date(Date.now() + long.expiresIn * 1000).toISOString() : null,
    lastError: null,
    connectedAt: new Date().toISOString(),
  };
  await withWorkspace(workspaceId, async (tx) => {
    await tx`
      insert into armada.credentials (workspace_id, provider, label, secret, status, meta)
      values (${workspaceId}, 'meta', ${LABEL}, ${seal({ accessToken: long.token })}, 'connected', ${tx.json(conn as never)})
      on conflict (workspace_id, provider, label)
      do update set secret = excluded.secret, status = 'connected', meta = excluded.meta, updated_at = now()`;
  });
  return conn;
}

export async function metaConnection(workspaceId: string): Promise<MetaConnection | null> {
  const rows = await withWorkspace(
    workspaceId,
    (tx) => tx<{ status: MetaConnection["status"]; meta: MetaConnection }[]>`
      select status, meta from armada.credentials where provider = 'meta' and label = ${LABEL}`,
  );
  const r = rows[0];
  return r && r.status !== "disconnected" ? { ...r.meta, status: r.status } : null;
}

/** The sign-in, opened only for the moment a request needs it. */
export async function metaSession(workspaceId: string): Promise<{ token: string; conn: MetaConnection }> {
  const rows = await withWorkspace(
    workspaceId,
    (tx) => tx<{ status: MetaConnection["status"]; secret: Buffer; meta: MetaConnection }[]>`
      select status, secret, meta from armada.credentials where provider = 'meta' and label = ${LABEL}`,
  );
  const r = rows[0];
  if (!r || r.status === "disconnected") throw new MetaProblem("No Meta ad account is connected.");
  const { accessToken } = open<{ accessToken: string }>(r.secret);
  return { token: accessToken, conn: { ...r.meta, status: r.status } };
}

/** Picks which ad account and Page this workspace's ads use. Only ids Meta listed at sign-in are accepted. */
export async function chooseMetaAccount(workspaceId: string, adAccountId: string, pageId: string): Promise<void> {
  await withWorkspace(workspaceId, async (tx) => {
    const [row] = await tx<{ meta: MetaConnection }[]>`select meta from armada.credentials where provider = 'meta' and label = ${LABEL} for update`;
    if (!row) return;
    const next = { ...row.meta };
    if (next.adAccounts.some((a) => a.id === adAccountId)) next.adAccountId = adAccountId;
    if (next.pages.some((p) => p.id === pageId)) next.pageId = pageId;
    await tx`update armada.credentials set meta = ${tx.json(next as never)}, updated_at = now() where provider = 'meta' and label = ${LABEL}`;
  });
}

/** Remembers that Meta stopped accepting the sign-in, so the Ads page can ask for a reconnect. */
export async function markMetaProblem(workspaceId: string, problem: string, signedOut: boolean): Promise<void> {
  await withWorkspace(
    workspaceId,
    (tx) => tx`
      update armada.credentials
      set meta = jsonb_set(meta, '{lastError}', to_jsonb(${problem}::text)),
          status = case when ${signedOut} then 'needs_attention' else status end,
          updated_at = now()
      where provider = 'meta' and label = ${LABEL}`,
  );
}

/** Forgets the sign-in. Ads already made stay in the ad account, switched however they were. */
export async function disconnectMeta(workspaceId: string): Promise<void> {
  await withWorkspace(workspaceId, (tx) => tx`delete from armada.credentials where provider = 'meta' and label = ${LABEL}`);
}
