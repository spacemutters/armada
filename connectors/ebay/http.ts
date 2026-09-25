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
// and eBay's error list read back so callers can explain it (core.ts explainEbayProblem). A seller
// connected through the connection service is reached through its relay instead (ebayRequestVia),
// which adds their access; the answer is read the same way.

import { relay } from "@/connectors/pipedream/client";
import type { ViaService } from "@/connectors/pipedream/core";

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

/** The same call as ebayRequest, for a seller connected through the connection service (eBay's live site). */
export async function ebayRequestVia<T>(
  via: ViaService,
  opts: { method?: "GET" | "POST" | "PUT" | "DELETE"; host?: "api" | "apiz"; path: string; query?: Query; body?: unknown; headers?: Record<string, string> },
): Promise<T | null> {
  const hosts = ebayHosts("production");
  const url = new URL((opts.host === "apiz" ? hosts.apiz : hosts.api) + opts.path);
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  let r: Awaited<ReturnType<typeof relay>>;
  try {
    r = await relay(via.externalUserId, via.accountId, url.toString(), {
      method: opts.method ?? "GET",
      headers: { accept: "application/json", ...opts.headers },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch {
    throw new EbayError(503, [], "eBay didn't answer in time.");
  }
  let json: unknown = null;
  if (r.text) {
    try {
      json = JSON.parse(r.text);
    } catch {
      json = null;
    }
  }
  if (r.status >= 200 && r.status < 300) return (json as T) ?? null;
  throw new EbayError(r.status, errorsOf(json));
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
