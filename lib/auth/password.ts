// Passwords: hashing, checking, and refusing sign-in after too many wrong tries.
//
// This file has no "server-only" import and no "@/..." imports that run, so Node scripts
// (scripts/make-admin.mjs, scripts/check-password.mjs) can import it directly. Only server code
// imports it from the app.
import crypto from "node:crypto";
import type { Tx } from "@/lib/db";

// scrypt settings for new hashes. Each hash takes about 32 MB of memory and a fraction of a second,
// which is the point: guessing millions of passwords against a stolen hash is slow.
const N = 2 ** 15;
const R = 8;
const P = 1;
const SALT_BYTES = 16;
const KEY_BYTES = 64;

/** Longer input is refused outright, so nobody can make the server hash a megabyte. */
export const MAX_PASSWORD_LENGTH = 256;
/** The shortest password a member can choose in Settings. */
export const MIN_NEW_PASSWORD_LENGTH = 12;

/**
 * A hash of a random password nobody knows, made with the same settings as real hashes. When the
 * email is unknown (or has no password) the password is checked against this instead, so a wrong
 * email takes as long as a wrong password. It never signs anyone in: callers also require a real hash.
 */
export const DUMMY_HASH =
  "scrypt$32768$8$1$WCfLhuVA85RPCIgwDQ464Q==$I0x7mdBaKBwvbHjDYsnlxAqBR/DwRsmyxXXRBMjz60ZysAdXeFTlm/I5kDRF5tewQE8Diu5+Zowiz62jN9rG7Q==";

function scrypt(password: string, salt: Buffer, keylen: number, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(
      password.normalize("NFKC"),
      salt,
      keylen,
      // Node refuses anything over maxmem; scrypt needs 128 * N * r bytes plus a little.
      { N: n, r, p, maxmem: 2 * 128 * n * r + 128 * r * p },
      (err, key) => (err ? reject(err) : resolve(key)),
    );
  });
}

/** Hashes a password as "scrypt$N$r$p$salt$hash" (salt and hash in base64). */
export async function hashPassword(password: string): Promise<string> {
  if (typeof password !== "string" || password.length === 0) throw new Error("The password is empty.");
  if (password.length > MAX_PASSWORD_LENGTH) throw new Error(`The password is longer than ${MAX_PASSWORD_LENGTH} characters.`);
  const salt = crypto.randomBytes(SALT_BYTES);
  const key = await scrypt(password, salt, KEY_BYTES, N, R, P);
  return ["scrypt", N, R, P, salt.toString("base64"), key.toString("base64")].join("$");
}

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

function strictBase64(s: string): Buffer | null {
  if (!BASE64.test(s)) return null;
  const buf = Buffer.from(s, "base64");
  return buf.toString("base64") === s ? buf : null;
}

interface ParsedHash {
  n: number;
  r: number;
  p: number;
  salt: Buffer;
  key: Buffer;
}

/** Reads a stored hash, or null if it is malformed or asks for settings too costly to run. */
function parseHash(stored: string): ParsedHash | null {
  if (typeof stored !== "string") return null;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return null;
  if (![parts[1], parts[2], parts[3]].every((x) => /^[0-9]{1,7}$/.test(x))) return null;
  const [n, r, p] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  const powerOfTwo = n > 1 && (n & (n - 1)) === 0;
  if (!powerOfTwo || n < 2 ** 14 || n > 2 ** 17 || r < 1 || r > 16 || p < 1 || p > 4) return null;
  if (128 * n * r * p > 64 * 1024 * 1024) return null;
  const salt = strictBase64(parts[4]);
  const key = strictBase64(parts[5]);
  // The key must be full length: scrypt's shorter output is a prefix of its longer one, so a cut-down
  // hash would otherwise still match.
  if (!salt || !key || salt.length < SALT_BYTES || key.length !== KEY_BYTES) return null;
  return { n, r, p, salt, key };
}

/** True only when `password` matches `stored`. Never throws; a malformed hash is simply no match. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (typeof password !== "string" || password.length === 0 || password.length > MAX_PASSWORD_LENGTH) return false;
  const parsed = parseHash(stored);
  if (!parsed) return false;
  let key: Buffer;
  try {
    key = await scrypt(password, parsed.salt, parsed.key.length, parsed.n, parsed.r, parsed.p);
  } catch {
    return false;
  }
  return key.length === parsed.key.length && crypto.timingSafeEqual(key, parsed.key);
}

// ---------- email ----------

/** Emails are compared lower-cased with the spaces trimmed off. */
export function normalizeEmail(raw: string): string {
  return String(raw ?? "").trim().toLowerCase();
}

export function looksLikeEmail(email: string): boolean {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ---------- lockout ----------

export const LOCKOUT = {
  /** Wrong tries are counted over this many minutes. */
  windowMinutes: 15,
  /** After this many wrong tries for one email, the next is refused without checking the password. */
  maxFailsPerEmail: 5,
  /** After this many wrong tries from one internet address (any emails), the next is refused. */
  maxFailsPerIp: 20,
  /** Old tries are deleted after this many days. */
  keepDays: 7,
} as const;

export const LOCKED_MESSAGE = "Too many wrong tries. Wait 15 minutes and try again, or sign in with your passkey.";

export interface FailureCounts {
  email: number;
  ip: number;
}

/** Whether the next try must be refused, given the wrong tries in the last 15 minutes. */
export function isLockedOut(counts: FailureCounts): boolean {
  return counts.email >= LOCKOUT.maxFailsPerEmail || counts.ip >= LOCKOUT.maxFailsPerIp;
}

/**
 * Wrong tries in the window: for this email since its last successful sign-in, and from this
 * address across all emails. Must run in system mode. Counts any email typed, known or not, so
 * being locked out says nothing about whether an email has an account.
 */
export async function failureCounts(tx: Tx, email: string, ip: string): Promise<FailureCounts> {
  const [row] = await tx<{ email: number; ip: number }[]>`
    select
      (select count(*)::int from armada.login_attempts a
        where a.email = ${email} and a.outcome = 'wrong'
          and a.at > now() - make_interval(mins => ${LOCKOUT.windowMinutes})
          and a.at > coalesce((select max(b.at) from armada.login_attempts b where b.email = ${email} and b.outcome = 'ok'), '-infinity')
      ) as email,
      (select count(*)::int from armada.login_attempts a
        where a.ip = ${ip} and a.outcome = 'wrong'
          and a.at > now() - make_interval(mins => ${LOCKOUT.windowMinutes})
      ) as ip`;
  return { email: row.email, ip: row.ip };
}

export type Attempt = { locked: true } | { locked: false; id: string };

/**
 * Starts a sign-in try. Must run in system mode, in its own short transaction.
 *
 * If the email or address already has too many wrong tries, records a refused try and returns
 * locked. Otherwise records the try as wrong before the password is even checked, and the caller
 * marks it ok (markAttemptOk) only if the password matches. A try that crashes halfway therefore
 * still counts against the limit.
 */
export async function beginAttempt(tx: Tx, email: string, ip: string): Promise<Attempt> {
  // One try at a time per email and per address, so a burst of tries sent at once can't all slip
  // under the limit. Email lock first, then address, always in that order.
  await tx`select pg_advisory_xact_lock(hashtextextended(${"armada.login.email:" + email}, 0))`;
  await tx`select pg_advisory_xact_lock(hashtextextended(${"armada.login.ip:" + ip}, 0))`;
  const counts = await failureCounts(tx, email, ip);
  if (isLockedOut(counts)) {
    await tx`insert into armada.login_attempts (email, ip, outcome) values (${email}, ${ip}, 'locked')`;
    return { locked: true };
  }
  const [row] = await tx<{ id: string }[]>`
    insert into armada.login_attempts (email, ip, outcome) values (${email}, ${ip}, 'wrong') returning id`;
  await tx`delete from armada.login_attempts where at < now() - make_interval(days => ${LOCKOUT.keepDays})`;
  return { locked: false, id: String(row.id) };
}

/** Marks a try as a successful sign-in. Must run in system mode. */
export async function markAttemptOk(tx: Tx, attemptId: string): Promise<void> {
  await tx`update armada.login_attempts set outcome = 'ok' where id = ${attemptId}`;
}

/** The address a request came from, as the hosting platform reports it. */
export function clientIp(headers: Headers): string {
  const ip = headers.get("x-real-ip") ?? headers.get("x-forwarded-for")?.split(",")[0] ?? "";
  return ip.trim().slice(0, 64) || "unknown";
}
