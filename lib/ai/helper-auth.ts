import "server-only";
import crypto from "node:crypto";

/** True when the request carries the helper's shared token. Constant-time comparison. */
export function isHelper(request: Request): boolean {
  const expected = process.env.HELPER_TOKEN;
  if (!expected || expected.length < 32) return false;
  const header = request.headers.get("authorization") ?? "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function helperIdFrom(value: unknown): string | null {
  return typeof value === "string" && /^[a-zA-Z0-9._-]{3,80}$/.test(value) ? value : null;
}
