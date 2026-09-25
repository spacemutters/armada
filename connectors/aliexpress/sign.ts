import { createHmac } from "node:crypto";

// AliExpress Open Platform request signing (pure, so tests can load it without the server).
// Every call carries app_key, timestamp (ms), sign_method=sha256 and a sign: HMAC-SHA256 with the
// app secret over the parameters sorted by name, each as name+value, as upper-case hex. System calls
// (paths like /auth/token/create, sent to /rest) put that path in front of the string; business
// calls (method names like aliexpress.ds.product.get, sent to /sync) carry the method as a parameter.
// Matches AliExpress's own documentation and the open-source SDKs that are confirmed live.

export const GATEWAY = "https://api-sg.aliexpress.com";

export type Params = Record<string, string | number | boolean | null | undefined>;

export function signString(params: Params, apiPath?: string): string {
  const body = Object.entries(params)
    .filter(([, v]) => v !== null && v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}${String(v)}`)
    .join("");
  return (apiPath ?? "") + body;
}

export function sign(secret: string, params: Params, apiPath?: string): string {
  return createHmac("sha256", secret).update(signString(params, apiPath), "utf8").digest("hex").toUpperCase();
}

/** The full request address for a call: /rest/<path> for system calls, /sync for business calls. */
export function requestUrl(appKey: string, secret: string, method: string, params: Params, now = Date.now()): string {
  const isSystem = method.startsWith("/");
  const all: Params = {
    ...params,
    app_key: appKey,
    timestamp: now,
    sign_method: "sha256",
    ...(isSystem ? {} : { method, simplify: true }),
  };
  const signature = sign(secret, all, isSystem ? method : undefined);
  const query = Object.entries({ ...all, sign: signature })
    .filter(([, v]) => v !== null && v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
  return `${GATEWAY}${isSystem ? `/rest${method}` : "/sync"}?${query}`;
}

/**
 * AliExpress wraps answers differently per call (confirmed live): some come as
 * {"<method>_response": {...}}, some with a further "resp_result"; success is signalled by "code"
 * ("00"), "rsp_code" ("200") or "resp_code" (200). Returns the inner payload, or throws its message.
 */
export function unwrap(envelope: unknown): Record<string, unknown> {
  let e = envelope as Record<string, unknown>;
  if (!e || typeof e !== "object") throw new AliexpressError("empty", "AliExpress sent back nothing Armada could read.");
  if ("error_response" in e) {
    const er = e.error_response as { code?: string; msg?: string; sub_msg?: string };
    throw new AliexpressError(String(er?.code ?? "error"), er?.sub_msg || er?.msg || "AliExpress refused the request.");
  }
  if (e && typeof e === "object") {
    // The wrapper can sit beside a request_id, so look for it by name rather than by being alone.
    const wrapped = Object.entries(e).find(([k, v]) => k.endsWith("_response") && v && typeof v === "object");
    if (wrapped) e = wrapped[1] as Record<string, unknown>;
  }
  if (e && typeof e.resp_result === "object" && e.resp_result) e = e.resp_result as Record<string, unknown>;
  for (const [codeField, msgField] of [
    ["code", "msg"],
    ["rsp_code", "rsp_msg"],
    ["resp_code", "resp_msg"],
  ] as const) {
    if (!(codeField in e)) continue;
    const code = String(e[codeField] ?? "").trim();
    const ok = codeField === "code" ? code === "" || /^0+$/.test(code) : ["200", "0", "00"].includes(code);
    if (!ok) throw new AliexpressError(code, String(e[msgField] ?? e.sub_msg ?? "AliExpress refused the request."));
  }
  return e;
}

export class AliexpressError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/** A list AliExpress may send bare or wrapped in a single-key object ({ product: [...] }). */
export function listOf<T = Record<string, unknown>>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === "object") {
    const inner = Object.values(value as Record<string, unknown>).find(Array.isArray);
    if (inner) return inner as T[];
  }
  return [];
}

/** "12.34" or 12.34 → 1234 cents; ranges and junk → the highest number, or null. */
export function cents(value: unknown): number | null {
  const nums = String(value ?? "")
    .split(/[-~]/)
    .map((s) => Number.parseFloat(s.replace(/[^0-9.]/g, "")))
    .filter((n) => Number.isFinite(n));
  return nums.length ? Math.round(Math.max(...nums) * 100) : null;
}
