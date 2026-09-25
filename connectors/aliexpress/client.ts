import "server-only";
import { appOrigin } from "@/lib/connections/types";
import { open, seal } from "@/lib/crypto";
import { withWorkspace } from "@/lib/db";
import { waitForSlot } from "@/lib/lanes";
import { AliexpressError, requestUrl, unwrap, type Params } from "./sign";

// The one door to AliExpress's Open Platform (dropshipping). A seller signs in on AliExpress's own
// page and approves Armada's app; AliExpress sends back a code that becomes an access token (and a
// refresh token). Every call waits for this account's slot in a speed lane, renews access before it
// runs out, and reports refusals in plain words. Switched on by ALIEXPRESS_APP_KEY and
// ALIEXPRESS_APP_SECRET from Armada's app on openservice.aliexpress.com.

export const ALIEXPRESS_ENV = ["ALIEXPRESS_APP_KEY", "ALIEXPRESS_APP_SECRET"];
export const ALIEXPRESS_CALLBACK = "/api/connect/aliexpress/callback";
const GAP_MS = 350;

interface Secret {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms. */
  accessExpires: number;
  refreshExpires: number;
}

export interface AliexpressMeta {
  account?: string;
  sellerId?: string;
  connectedAt?: string;
  lastError?: string;
}

export class AliexpressNotConnected extends Error {
  constructor() {
    super("AliExpress isn't connected");
  }
}

function app(): { key: string; secret: string } {
  const key = process.env.ALIEXPRESS_APP_KEY;
  const secret = process.env.ALIEXPRESS_APP_SECRET;
  if (!key || !secret) throw new AliexpressError("not_set_up", "AliExpress isn't switched on in Armada yet.");
  return { key, secret };
}

async function send(method: string, params: Params): Promise<Record<string, unknown>> {
  const { key, secret } = app();
  const res = await fetch(requestUrl(key, secret, method, params), { method: "POST", signal: AbortSignal.timeout(20_000), cache: "no-store" });
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new AliexpressError(String(res.status), `AliExpress answered with something unreadable (status ${res.status}).`);
  }
  return unwrap(body);
}

/** Where "Connect AliExpress" sends the person: AliExpress's own sign-in and approval page. */
export function authorizeUrl(state: string): string {
  const q = new URLSearchParams({
    response_type: "code",
    force_auth: "true",
    redirect_uri: `${appOrigin()}${ALIEXPRESS_CALLBACK}`,
    client_id: app().key,
    state,
  });
  return `https://api-sg.aliexpress.com/oauth/authorize?${q}`;
}

function toSecret(t: Record<string, unknown>): Secret {
  const now = Date.now();
  const num = (v: unknown, fallback: number) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : fallback);
  return {
    accessToken: String(t.access_token ?? ""),
    refreshToken: String(t.refresh_token ?? ""),
    // AliExpress gives epoch-ms expiry times (expire_time / refresh_token_valid_time); fall back to its "expires_in" seconds.
    accessExpires: num(t.expire_time, now + num(t.expires_in, 86_400) * 1000),
    refreshExpires: num(t.refresh_token_valid_time, now + num(t.refresh_expires_in, 30 * 86_400) * 1000),
  };
}

/** Turns the code from AliExpress's approval page into a saved, sealed connection. */
export async function connectAliexpress(workspaceId: string, code: string): Promise<AliexpressMeta> {
  await waitForSlot(workspaceId, "aliexpress", GAP_MS);
  const t = await send("/auth/token/create", { code });
  const secret = toSecret(t);
  if (!secret.accessToken) throw new AliexpressError("no_token", "AliExpress didn't hand over access. Try connecting again.");
  const meta: AliexpressMeta = {
    account: String(t.user_nick ?? t.account ?? t.seller_id ?? "") || undefined,
    sellerId: t.seller_id != null ? String(t.seller_id) : t.user_id != null ? String(t.user_id) : undefined,
    connectedAt: new Date().toISOString(),
  };
  await withWorkspace(
    workspaceId,
    (tx) => tx`
      insert into armada.credentials (workspace_id, provider, label, secret, status, meta)
      values (${workspaceId}, 'aliexpress', '', ${seal(secret)}, 'connected', ${tx.json(meta as never)})
      on conflict (workspace_id, provider, label) do update
        set secret = excluded.secret, status = 'connected', meta = excluded.meta, updated_at = now()`,
  );
  return meta;
}

export async function disconnectAliexpress(workspaceId: string): Promise<void> {
  await withWorkspace(workspaceId, (tx) => tx`delete from armada.credentials where provider = 'aliexpress' and label = ''`);
}

export async function aliexpressStatus(workspaceId: string): Promise<{ connected: boolean; meta: AliexpressMeta }> {
  const rows = await withWorkspace(
    workspaceId,
    (tx) => tx<{ status: string; meta: AliexpressMeta }[]>`select status, meta from armada.credentials where provider = 'aliexpress' and label = ''`,
  );
  return { connected: Boolean(rows[0] && rows[0].status !== "disconnected"), meta: rows[0]?.meta ?? {} };
}

async function token(workspaceId: string): Promise<string> {
  const rows = await withWorkspace(
    workspaceId,
    (tx) => tx<{ secret: Buffer; status: string; updatedAt: Date }[]>`
      select secret, status, updated_at from armada.credentials where provider = 'aliexpress' and label = ''`,
  );
  if (!rows[0] || rows[0].status === "disconnected") throw new AliexpressNotConnected();
  let secret = open<Secret>(rows[0].secret);
  // Renew a day early; if the renewal fails but access still works, carry on with it.
  if (secret.accessExpires - Date.now() < 86_400_000 && secret.refreshToken) {
    try {
      await waitForSlot(workspaceId, "aliexpress", GAP_MS);
      const fresh = toSecret(await send("/auth/token/refresh", { refresh_token: secret.refreshToken }));
      if (fresh.accessToken) {
        secret = fresh;
        await withWorkspace(
          workspaceId,
          (tx) => tx`
            update armada.credentials set secret = ${seal(secret)}, updated_at = now()
            where provider = 'aliexpress' and label = '' and updated_at = ${rows[0].updatedAt}`,
        );
      }
    } catch (e) {
      if (secret.accessExpires <= Date.now()) {
        await withWorkspace(
          workspaceId,
          (tx) => tx`
            update armada.credentials set status = 'needs_attention',
              meta = meta || ${tx.json({ lastError: "AliExpress stopped accepting Armada's access. Connect AliExpress again." } as never)}
            where provider = 'aliexpress' and label = ''`,
        );
        throw e;
      }
    }
  }
  return secret.accessToken;
}

/** Calls a dropshipping method as this workspace's connected AliExpress account. */
export async function ae(workspaceId: string, method: string, params: Params = {}): Promise<Record<string, unknown>> {
  const session = await token(workspaceId);
  for (let attempt = 0; attempt < 3; attempt++) {
    await waitForSlot(workspaceId, "aliexpress", GAP_MS);
    try {
      return await send(method, { ...params, session });
    } catch (e) {
      // Only retry what looks like a busy gateway or a dropped connection.
      const busy = e instanceof AliexpressError ? /limit|frequen|busy|timeout|isp/i.test(`${e.code} ${e.message}`) : /timeout|abort|fetch failed/i.test(String(e));
      if (!busy || attempt === 2) throw e;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  throw new AliexpressError("busy", "AliExpress is busy right now. Try again in a minute.");
}

export function describeAliexpressError(e: unknown): string {
  if (e instanceof AliexpressNotConnected) return "AliExpress isn't connected yet. Connect it on the Connections page.";
  if (e instanceof AliexpressError) {
    if (e.code === "not_set_up") return e.message;
    if (/token|session|auth/i.test(`${e.code} ${e.message}`)) return "AliExpress stopped accepting Armada's access. Connect AliExpress again.";
    return `AliExpress said: ${e.message}`;
  }
  return "Couldn't reach AliExpress just now. Try again in a minute.";
}
