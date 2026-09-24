import "server-only";
import {
  basicAuth,
  codeGrantBody,
  ebayHosts,
  readTokenResponse,
  refreshGrantBody,
  TOKEN_PATH,
  type EbayConfig,
  type EbayEnv,
  type EbayErrorItem,
  type EbayTokens,
} from "./core";

// The one door to eBay. Every request to eBay leaves through send(): a 20-second limit, no caching,
// and eBay's error list read back so callers can explain it (core.ts explainEbayProblem).

export class EbayError extends Error {
  status: number;
  errors: EbayErrorItem[];
  constructor(status: number, errors: EbayErrorItem[], message?: string) {
    super(message ?? errors.map((e) => e.longMessage || e.message).find(Boolean) ?? `eBay answered ${status}`);
    this.status = status;
    this.errors = errors;
  }
}

type Query = Record<string, string | number | undefined>;

async function send(url: string, init: { method: string; headers: Record<string, string>; body?: string }): Promise<{ status: number; json: unknown }> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000), cache: "no-store" });
  } catch {
    throw new EbayError(503, [], "eBay didn't answer in time.");
  }
  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  return { status: res.status, json };
}

function errorsOf(json: unknown): EbayErrorItem[] {
  const j = (json ?? {}) as { errors?: EbayErrorItem[]; error?: string; error_description?: string };
  if (Array.isArray(j.errors)) return j.errors;
  // The token service answers in the OAuth shape instead.
  if (typeof j.error === "string") return [{ message: j.error, longMessage: j.error_description }];
  return [];
}

/** A call to one of eBay's REST APIs with a seller's access. Returns the parsed answer (null for 204). */
export async function ebayRequest<T>(
  env: EbayEnv,
  accessToken: string,
  opts: { method?: "GET" | "POST" | "PUT" | "DELETE"; host?: "api" | "apiz"; path: string; query?: Query; body?: unknown; headers?: Record<string, string> },
): Promise<T | null> {
  const hosts = ebayHosts(env);
  const url = new URL((opts.host === "apiz" ? hosts.apiz : hosts.api) + opts.path);
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  const { status, json } = await send(url.toString(), {
    method: opts.method ?? "GET",
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/json",
      ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
      ...opts.headers,
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  if (status >= 200 && status < 300) return (json as T) ?? null;
  throw new EbayError(status, errorsOf(json));
}

/** Swaps the one-time code from eBay's sign-in page for the seller's access. */
export async function exchangeCode(cfg: EbayConfig, code: string): Promise<EbayTokens> {
  const { status, json } = await send(ebayHosts(cfg.env).api + TOKEN_PATH, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", authorization: basicAuth(cfg) },
    body: codeGrantBody(cfg, code),
  });
  if (status !== 200) throw new EbayError(status, errorsOf(json));
  return readTokenResponse(json, Date.now());
}

/** Renews a seller's two-hour access with the lasting one eBay gave at sign-in. */
export async function refreshAccess(cfg: EbayConfig, previous: EbayTokens): Promise<EbayTokens> {
  const { status, json } = await send(ebayHosts(cfg.env).api + TOKEN_PATH, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", authorization: basicAuth(cfg) },
    body: refreshGrantBody(previous.refreshToken),
  });
  if (status !== 200) throw new EbayError(status === 400 ? 401 : status, errorsOf(json));
  return readTokenResponse(json, Date.now(), previous);
}
