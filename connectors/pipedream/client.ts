import "server-only";
import { open, seal } from "@/lib/crypto";
import { asSystem } from "@/lib/db";
import {
  checkPdSettings,
  PD_API,
  PD_APPS,
  readAccounts,
  relayHeaders,
  relayPath,
  type PdAccount,
  type PdEnvironment,
  type PdProvider,
  type PdSettings,
} from "./core";

// The one door to the connection service (Pipedream Connect). Its settings come from the admin's
// paste on the Admin page (sealed in armada.connection_service), or from PIPEDREAM_CLIENT_ID,
// PIPEDREAM_CLIENT_SECRET, PIPEDREAM_PROJECT_ID and PIPEDREAM_ENVIRONMENT. Every request has a
// deadline; the service's own access (an hour long) is kept in memory and renewed early.

export class PdProblem extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const apiBase = () => (process.env.PIPEDREAM_API_BASE || PD_API).replace(/\/$/, "");

function fromEnv(): PdSettings | null {
  const s = {
    clientId: process.env.PIPEDREAM_CLIENT_ID ?? "",
    clientSecret: process.env.PIPEDREAM_CLIENT_SECRET ?? "",
    projectId: process.env.PIPEDREAM_PROJECT_ID ?? "",
    environment: (process.env.PIPEDREAM_ENVIRONMENT as PdEnvironment) || "production",
  };
  return checkPdSettings(s) ? null : s;
}

interface Row {
  clientId: string;
  clientSecret: Buffer;
  projectId: string;
  environment: PdEnvironment;
  connectedAt: Date;
  lastError: string | null;
}

async function fromDb(): Promise<(PdSettings & { connectedAt: Date; lastError: string | null }) | null> {
  const rows = await asSystem(
    (tx) => tx<Row[]>`select client_id, client_secret, project_id, environment, connected_at, last_error from armada.connection_service`,
  );
  const r = rows[0];
  if (!r) return null;
  return { clientId: r.clientId, clientSecret: open<string>(r.clientSecret), projectId: r.projectId, environment: r.environment, connectedAt: r.connectedAt, lastError: r.lastError };
}

let cachedSettings: { at: number; value: PdSettings | null } | null = null;

/** The service's settings, or null when it isn't set up. Read at most every 30 seconds. */
export async function pdSettings(): Promise<PdSettings | null> {
  const env = fromEnv();
  if (env) return env;
  if (cachedSettings && Date.now() - cachedSettings.at < 30_000) return cachedSettings.value;
  const value = await fromDb().catch(() => null);
  cachedSettings = { at: Date.now(), value };
  return value;
}

/** What the Admin page shows: whether it's set up, where from, and never the secret. */
export async function pdStatus(): Promise<{ on: boolean; from: "settings" | "pasted" | null; projectId: string | null; environment: PdEnvironment | null; connectedAt: Date | null; lastError: string | null }> {
  const env = fromEnv();
  if (env) return { on: true, from: "settings", projectId: env.projectId, environment: env.environment, connectedAt: null, lastError: null };
  const db = await fromDb().catch(() => null);
  return db
    ? { on: true, from: "pasted", projectId: db.projectId, environment: db.environment, connectedAt: db.connectedAt, lastError: db.lastError }
    : { on: false, from: null, projectId: null, environment: null, connectedAt: null, lastError: null };
}

let cachedToken: { key: string; token: string; until: number } | null = null;

async function send(url: string, init: RequestInit): Promise<{ status: number; text: string; headers: Headers }> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(35_000), cache: "no-store" });
  } catch {
    throw new PdProblem(503, "Couldn't reach the connection service just now. Try again in a minute.");
  }
  return { status: res.status, text: await res.text(), headers: res.headers };
}

const parse = (text: string): unknown => {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
};

async function serviceToken(s: PdSettings): Promise<string> {
  const key = `${s.clientId}:${s.projectId}`;
  if (cachedToken && cachedToken.key === key && cachedToken.until > Date.now()) return cachedToken.token;
  const r = await send(`${apiBase()}/v1/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ grant_type: "client_credentials", client_id: s.clientId, client_secret: s.clientSecret }),
  });
  const body = parse(r.text) as { access_token?: string; expires_in?: number; error?: string; error_description?: string } | null;
  if (r.status < 200 || r.status > 299 || !body?.access_token) {
    // Pipedream's own reason (never the secret) goes in the message, so a refusal can be told apart
    // from a wrong paste; the server log keeps the status too.
    console.error("connection service token refused", r.status, body?.error ?? "", (body?.error_description ?? r.text.slice(0, 160)).replace(/\s+/g, " "));
    const why = body?.error === "invalid_client" ? "it doesn't know that Client ID and secret together" : body?.error ? `it said ${body.error}` : `it answered with status ${r.status}`;
    throw new PdProblem(
      r.status >= 200 && r.status <= 299 ? 502 : r.status,
      `Pipedream didn't accept these: ${why}. Copy the Client ID and Client secret again from Pipedream (Settings, then API) and paste them here.`,
    );
  }
  // Renewed five minutes early.
  cachedToken = { key, token: body.access_token, until: Date.now() + Math.max(60, (body.expires_in ?? 3600) - 300) * 1000 };
  return body.access_token;
}

async function call(s: PdSettings, method: string, path: string, body?: unknown): Promise<{ status: number; json: unknown }> {
  const token = await serviceToken(s);
  const r = await send(`${apiBase()}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "x-pd-environment": s.environment,
      accept: "application/json",
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (r.status === 401) cachedToken = null;
  return { status: r.status, json: parse(r.text) };
}

async function need(): Promise<PdSettings> {
  const s = await pdSettings();
  if (!s) throw new PdProblem(412, "One-click connections aren't switched on yet.");
  return s;
}

/**
 * The service's hosted page where a seller connects one platform, scoped to this workspace. It sends
 * them back to `back` with ?pd=done, or ?pd=failed when something went wrong on the way.
 */
export async function connectPage(externalUserId: string, provider: PdProvider, back: string): Promise<string> {
  return connectPageForApp(externalUserId, PD_APPS[provider], back);
}

/** The service's connect page for any of its apps, by the service's own name for it (for the admin's checks). */
export async function connectPageForApp(externalUserId: string, appSlug: string, back: string): Promise<string> {
  const s = await need();
  const sep = back.includes("?") ? "&" : "?";
  const r = await call(s, "POST", `/v1/connect/${encodeURIComponent(s.projectId)}/tokens`, {
    external_user_id: externalUserId,
    success_redirect_uri: `${back}${sep}pd=done`,
    error_redirect_uri: `${back}${sep}pd=failed`,
    expires_in: 3600,
  });
  const link = (r.json as { connect_link_url?: string } | null)?.connect_link_url;
  if (r.status !== 200 || !link) throw new PdProblem(r.status, "The connection service couldn't start connecting. Try again in a minute.");
  const u = new URL(link);
  u.searchParams.set("app", appSlug);
  return u.toString();
}

/** The service's apps matching a search, with what the admin needs to judge them (for the admin's checks). */
export async function searchServiceApps(q: string): Promise<unknown> {
  const s = await need();
  const r = await call(s, "GET", `/v1/apps?q=${encodeURIComponent(q)}&limit=20`);
  if (r.status !== 200) throw new PdProblem(r.status, `The connection service answered ${r.status}.`);
  return r.json;
}

/** Every account the admin's check connected, so they can be let go afterwards. */
export async function accountsOf(externalUserId: string): Promise<PdAccount[]> {
  const s = await need();
  const r = await call(s, "GET", `/v1/connect/${encodeURIComponent(s.projectId)}/users/${encodeURIComponent(externalUserId)}/accounts`);
  if (r.status === 404) return [];
  if (r.status !== 200) throw new PdProblem(r.status, "Couldn't read the connected accounts from the connection service.");
  return readAccounts(r.json);
}

/** The accounts a workspace has connected at the service for one platform. */
export async function serviceAccounts(externalUserId: string, provider: PdProvider): Promise<PdAccount[]> {
  const s = await need();
  const r = await call(
    s,
    "GET",
    `/v1/connect/${encodeURIComponent(s.projectId)}/users/${encodeURIComponent(externalUserId)}/accounts?app=${PD_APPS[provider]}`,
  );
  // A workspace that hasn't connected anything yet isn't a user at the service yet.
  if (r.status === 404) return [];
  if (r.status !== 200) throw new PdProblem(r.status, "Couldn't read the connected accounts from the connection service.");
  return readAccounts(r.json);
}

/** Lets go of an account at the service (the seller's access there is deleted). */
export async function forgetServiceAccount(accountId: string): Promise<boolean> {
  const s = await need();
  const r = await call(s, "DELETE", `/v1/connect/${encodeURIComponent(s.projectId)}/accounts/${encodeURIComponent(accountId)}`);
  return r.status === 204 || r.status === 200 || r.status === 404;
}

/**
 * One request to a platform, sent through the service's relay as this seller. The service adds the
 * seller's access; Armada never holds it. Answers with the platform's status and body.
 */
export async function relay(
  externalUserId: string,
  accountId: string,
  target: string,
  init: { method?: string; headers?: Record<string, string>; body?: string },
): Promise<{ status: number; text: string; headers: Headers }> {
  const s = await need();
  const token = await serviceToken(s);
  const r = await send(`${apiBase()}${relayPath(s.projectId, target, externalUserId, accountId)}`, {
    method: init.method ?? "GET",
    headers: {
      authorization: `Bearer ${token}`,
      "x-pd-environment": s.environment,
      ...relayHeaders(init.headers ?? {}),
      ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: init.body,
  });
  if (r.status === 401 && !r.text.includes("errors")) cachedToken = null;
  return r;
}

// ---------- the Admin page's paste ----------

/** Checks pasted settings against the service, then keeps them sealed. Returns a plain problem or null. */
export async function savePdSettings(input: PdSettings, memberId: string): Promise<string | null> {
  const problem = checkPdSettings(input);
  if (problem) return problem;
  const s: PdSettings = { clientId: input.clientId.trim(), clientSecret: input.clientSecret.trim(), projectId: input.projectId.trim(), environment: input.environment };
  cachedToken = null;
  try {
    await serviceToken(s);
    // The project's own details: a read that only works when the project belongs to this Client ID's
    // workspace. (Looking up a user who doesn't exist yet answers "not found" even for a right project.)
    const r = await call(s, "GET", `/v1/connect/${encodeURIComponent(s.projectId)}/projects/info`);
    if (r.status === 404 || r.status === 403) return "Pipedream doesn't have that Project ID in the same workspace as this Client ID. Copy the Project ID again from the project's Connect page.";
    if (r.status >= 400) return `Pipedream answered with status ${r.status}. Check the three values and try again.`;
  } catch (e) {
    return e instanceof PdProblem ? e.message : "Couldn't reach the connection service just now. Try again in a minute.";
  }
  await asSystem(
    (tx) => tx`
      insert into armada.connection_service (id, client_id, client_secret, project_id, environment, connected_by)
      values (true, ${s.clientId}, ${seal(s.clientSecret)}, ${s.projectId}, ${s.environment}, ${memberId})
      on conflict (id) do update set client_id = excluded.client_id, client_secret = excluded.client_secret, project_id = excluded.project_id,
        environment = excluded.environment, connected_by = excluded.connected_by, updated_at = now(), last_error = null, last_error_at = null`,
  );
  cachedSettings = null;
  return null;
}

export async function clearPdSettings(): Promise<void> {
  await asSystem((tx) => tx`delete from armada.connection_service`);
  cachedSettings = null;
  cachedToken = null;
}
