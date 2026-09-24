import "server-only";
import { open, seal } from "@/lib/crypto";
import { withWorkspace } from "@/lib/db";
import { waitForSlot } from "@/lib/lanes";

// The one door to CJ Dropshipping (API v2). Every call goes through `cj()`, which:
// - reserves a slot in the account's speed lane first (CJ allows about one call a second),
// - renews the access token before it expires, and again if CJ says it's no longer valid,
// - retries only what CJ marks as busy or timed out, and reports everything else plainly.
// Docs: https://developers.cjdropshipping.com/en/api/api2/

const BASE = (process.env.CJ_BASE_URL || "https://developers.cjdropshipping.com/api2.0/v1").replace(/\/$/, "");

interface CjSecret {
  apiKey: string;
  accessToken: string;
  accessTokenExpiry: string;
  refreshToken: string;
  refreshTokenExpiry: string;
}

export interface CjMeta {
  account?: string;
  email?: string;
  qpsLimit?: number;
  isSandbox?: boolean;
  connectedAt?: string;
  lastError?: string;
  lastErrorAt?: string;
}

interface Envelope<T> {
  code: number;
  result: boolean;
  message: string;
  data: T;
  requestId?: string;
}

export class CjError extends Error {
  constructor(
    public code: number,
    message: string,
    public requestId?: string,
  ) {
    super(message);
  }
}

export class CjNotConnected extends Error {
  constructor() {
    super("CJ isn't connected");
  }
}

// Answers worth retrying after a pause: CJ busy, over the per-second limit, or read timed out.
const BUSY = new Set([1600000, 1600200, 1600301]);
// The account's API points are used up (CJ answers HTTP 429 with code 429, or 16900500). Points refill
// through the day, so retrying straight away only burns time.
const OUT_OF_POINTS = new Set([429, 16900500, 1600201]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type QueryValue = string | number | undefined | null | (string | number)[];

async function raw<T>(
  method: "GET" | "POST",
  path: string,
  opts: { token?: string; query?: Record<string, QueryValue>; body?: unknown },
): Promise<Envelope<T>> {
  const url = new URL(BASE + path);
  // An array repeats the parameter (features=a&features=b), which is how CJ takes lists.
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    for (const item of Array.isArray(v) ? v : [v]) if (item !== undefined && item !== null && item !== "") url.searchParams.append(k, String(item));
  }
  const res = await fetch(url, {
    method,
    headers: { "content-type": "application/json", ...(opts.token ? { "CJ-Access-Token": opts.token } : {}) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  const text = await res.text();
  try {
    return JSON.parse(text) as Envelope<T>;
  } catch {
    throw new CjError(res.status, `CJ answered with something unreadable (status ${res.status}).`);
  }
}

// ---------- tokens ----------

interface TokenData {
  accessToken: string;
  accessTokenExpiryDate: string;
  refreshToken: string;
  refreshTokenExpiryDate: string;
}

function toSecret(apiKey: string, t: TokenData): CjSecret {
  return {
    apiKey,
    accessToken: t.accessToken,
    accessTokenExpiry: t.accessTokenExpiryDate,
    refreshToken: t.refreshToken,
    refreshTokenExpiry: t.refreshTokenExpiryDate,
  };
}

/**
 * The only way a request leaves for CJ: wait for this account's next slot, then send. Token calls
 * count against CJ's limit like any other, so they go through here too.
 */
async function laned<T>(
  workspaceId: string,
  gapMs: number,
  method: "GET" | "POST",
  path: string,
  opts: Parameters<typeof raw>[2],
): Promise<Envelope<T>> {
  await waitForSlot(workspaceId, "cj", gapMs);
  return raw<T>(method, path, opts);
}

async function exchangeKey(workspaceId: string, gapMs: number, apiKey: string): Promise<CjSecret> {
  const env = await laned<TokenData>(workspaceId, gapMs, "POST", "/authentication/getAccessToken", { body: { apiKey } });
  if (!env.result || !env.data?.accessToken) throw new CjError(env.code, env.message, env.requestId);
  return toSecret(apiKey, env.data);
}

async function refreshTokens(workspaceId: string, gapMs: number, secret: CjSecret): Promise<CjSecret> {
  const env = await laned<TokenData>(workspaceId, gapMs, "POST", "/authentication/refreshAccessToken", {
    body: { refreshToken: secret.refreshToken },
  });
  if (env.result && env.data?.accessToken) return toSecret(secret.apiKey, env.data);
  if (BUSY.has(env.code)) throw new CjError(env.code, env.message, env.requestId);
  // A refresh token that no longer works falls back to the API key itself.
  return exchangeKey(workspaceId, gapMs, secret.apiKey);
}

/** CJ's answers that mean the key itself was refused, as opposed to CJ being busy. */
const KEY_REFUSED = new Set([1600001, 1600003, 1600004, 1600005, 1600006, 1600008, 1601000]);

interface Credential {
  secret: CjSecret;
  meta: CjMeta;
  /** The row's updated_at when it was read, so a renewal can't overwrite a newer change. */
  version: Date;
}

async function loadCredential(workspaceId: string): Promise<Credential> {
  const rows = await withWorkspace(
    workspaceId,
    (tx) => tx<{ secret: Buffer; meta: CjMeta; status: string; updatedAt: Date }[]>`
      select secret, meta, status, updated_at from armada.credentials where provider = 'cj' and label = ''`,
  );
  if (!rows[0] || rows[0].status === "disconnected") throw new CjNotConnected();
  return { secret: open<CjSecret>(rows[0].secret), meta: rows[0].meta ?? {}, version: rows[0].updatedAt };
}

/**
 * Saves renewed tokens only onto the row they were renewed from. If the connection was removed or
 * replaced (a different key) meanwhile, nothing is written and the current row is returned instead,
 * so a renewal can never bring back a disconnected account or overwrite a new key.
 */
async function saveRenewed(workspaceId: string, from: Credential, secret: CjSecret): Promise<Credential> {
  const updated = await withWorkspace(
    workspaceId,
    (tx) => tx<{ updatedAt: Date }[]>`
      update armada.credentials set secret = ${seal(secret)}, updated_at = now()
      where provider = 'cj' and label = '' and updated_at = ${from.version} and status <> 'disconnected'
      returning updated_at`,
  );
  if (updated[0]) return { ...from, secret, version: updated[0].updatedAt };
  return loadCredential(workspaceId);
}

async function saveCredential(workspaceId: string, secret: CjSecret, meta: CjMeta, status = "connected") {
  await withWorkspace(
    workspaceId,
    (tx) => tx`
      insert into armada.credentials (workspace_id, provider, label, secret, status, meta)
      values (${workspaceId}, 'cj', '', ${seal(secret)}, ${status}, ${tx.json(meta as never)})
      on conflict (workspace_id, provider, label) do update
        set secret = excluded.secret, status = excluded.status, meta = excluded.meta, updated_at = now()`,
  );
}

async function noteProblem(workspaceId: string, message: string, status: "connected" | "needs_attention") {
  await withWorkspace(
    workspaceId,
    (tx) => tx`
      update armada.credentials
      set status = ${status}, meta = meta || ${tx.json({ lastError: message, lastErrorAt: new Date().toISOString() } as never)}, updated_at = now()
      where provider = 'cj' and label = ''`,
  );
}

const expiresWithin = (iso: string | undefined, ms: number) => !iso || new Date(iso).getTime() - Date.now() < ms;

// CJ's documented default is one call a second. Calls are spaced a quarter more than that, because
// two calls reserved a slot apart can still reach CJ closer together (measured: 1072ms apart on a
// 1100ms spacing with two builds running at once).
const DEFAULT_GAP_MS = 1250;

/** CJ's paid tiers top out at 6 calls a second. */
const MAX_QPS = 6;

function laneInterval(meta: CjMeta): number {
  // An account's own setting can allow more calls a second, but only believe it within CJ's real
  // tiers: /setting/get has been seen to report 100, which would get every call refused.
  const qps = meta.qpsLimit;
  return qps && qps > 1 && qps <= MAX_QPS ? Math.ceil(1250 / qps) : DEFAULT_GAP_MS;
}

/** Calls CJ as this workspace's connected account. */
export async function cj<T>(
  workspaceId: string,
  method: "GET" | "POST",
  path: string,
  opts: {
    query?: Record<string, QueryValue>;
    body?: unknown;
    /**
     * False for calls that must never be sent twice (placing an order): a timeout is reported, not
     * retried, because the first request may have gone through.
     */
    retryTimeouts?: boolean;
  } = {},
): Promise<T> {
  const { retryTimeouts = true, ...request } = opts;
  let cred = await loadCredential(workspaceId);
  const gap = laneInterval(cred.meta);

  // Renewing the access token. Only a refused key marks the connection as needing attention; CJ
  // being busy or slow just fails this call.
  const renew = async () => {
    try {
      const fresh = await refreshTokens(workspaceId, gap, cred.secret);
      cred = await saveRenewed(workspaceId, cred, fresh);
    } catch (e) {
      if (e instanceof CjError && KEY_REFUSED.has(e.code)) {
        await noteProblem(workspaceId, "CJ stopped accepting the saved key. Connect CJ again with a fresh key.", "needs_attention");
      }
      throw e;
    }
  };
  // Renew a day early. If that early renewal fails (CJ busy or slow), the current token still works,
  // so carry on with it rather than failing the call.
  if (expiresWithin(cred.secret.accessTokenExpiry, 24 * 3600_000)) {
    try {
      await renew();
    } catch (e) {
      if (expiresWithin(cred.secret.accessTokenExpiry, 0) || isFatalCjError(e)) throw e;
    }
  }

  let renewed = false;
  for (let attempt = 0; attempt < 4; attempt++) {
    let env: Envelope<T>;
    try {
      env = await laned<T>(workspaceId, gap, method, path, { token: cred.secret.accessToken, ...request });
    } catch (e) {
      if (retryTimeouts && attempt < 3 && e instanceof Error && /timeout|abort|fetch failed/i.test(e.message)) {
        await sleep(1000 * (attempt + 1));
        continue;
      }
      throw e;
    }
    if (env.result || env.code === 200) return env.data;
    if (BUSY.has(env.code) && (retryTimeouts || env.code === 1600200)) {
      await sleep(1500 * (attempt + 1));
      continue;
    }
    if ((env.code === 1600001 || env.code === 1600030) && !renewed) {
      renewed = true;
      await renew();
      continue;
    }
    if (OUT_OF_POINTS.has(env.code)) {
      await noteProblem(workspaceId, "CJ's allowance for this account is used up for now. It refills through the day.", "connected");
    }
    throw new CjError(env.code, env.message, env.requestId);
  }
  throw new CjError(1600200, "CJ is busy right now. Try again in a minute.");
}

// ---------- connecting ----------

interface CjSettings {
  openId: string | number;
  openName?: string;
  openEmail?: string;
  setting?: { qpsLimit?: number };
  isSandbox?: boolean;
}

/** Checks a key with CJ, then stores it sealed. Throws CjError with CJ's own reason if it's refused. */
export async function connectCj(workspaceId: string, apiKey: string): Promise<CjMeta> {
  const secret = await exchangeKey(workspaceId, DEFAULT_GAP_MS, apiKey.trim());
  const env = await laned<CjSettings>(workspaceId, DEFAULT_GAP_MS, "GET", "/setting/get", { token: secret.accessToken });
  if (!env.result && env.code !== 200) throw new CjError(env.code, env.message, env.requestId);
  const meta: CjMeta = {
    account: env.data?.openName || String(env.data?.openId ?? ""),
    email: env.data?.openEmail,
    qpsLimit: env.data?.setting?.qpsLimit,
    isSandbox: Boolean(env.data?.isSandbox),
    connectedAt: new Date().toISOString(),
  };
  await saveCredential(workspaceId, secret, meta);
  return meta;
}

export async function disconnectCj(workspaceId: string): Promise<void> {
  await withWorkspace(workspaceId, (tx) => tx`delete from armada.credentials where provider = 'cj' and label = ''`);
}

export async function cjStatus(workspaceId: string): Promise<{ connected: boolean; status: string | null; meta: CjMeta }> {
  const rows = await withWorkspace(
    workspaceId,
    (tx) => tx<{ status: string; meta: CjMeta }[]>`select status, meta from armada.credentials where provider = 'cj' and label = ''`,
  );
  const r = rows[0];
  return { connected: Boolean(r && r.status !== "disconnected"), status: r?.status ?? null, meta: r?.meta ?? {} };
}

/**
 * True when every further call would be refused too (not connected, key refused, allowance used up),
 * so a loop over many products should stop instead of spending the speed lane on them.
 */
export function isFatalCjError(e: unknown): boolean {
  return e instanceof CjNotConnected || (e instanceof CjError && (KEY_REFUSED.has(e.code) || OUT_OF_POINTS.has(e.code)));
}

/** Plain words for a CJ refusal. */
export function describeCjError(e: unknown): string {
  if (e instanceof CjNotConnected) return "CJ isn't connected yet. Add your CJ key in Settings.";
  if (!(e instanceof CjError)) return "Couldn't reach CJ just now. Try again in a minute.";
  if ([1600001, 1600004, 1600005, 1600006, 1600008, 1601000].includes(e.code)) return "CJ didn't accept that key. Copy it again from CJ's API page and paste the whole thing.";
  if (OUT_OF_POINTS.has(e.code)) return "CJ's allowance for this account is used up for now. It refills through the day, so try again later.";
  if (e.code === 1603003) return "CJ already has this order, so it wasn't placed twice.";
  if (BUSY.has(e.code)) return "CJ is busy right now. Try again in a minute.";
  return `CJ said: ${e.message}`;
}
