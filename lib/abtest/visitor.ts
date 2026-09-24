// Storefront visitors, for headline tests. Each browser gets a random id signed with the server's
// secret, so the version a visitor sees stays the same across visits and a forged id is ignored.
// Uses Web Crypto so the proxy and the server can both run it.

export const VISITOR_COOKIE = "armada_v";
export const VISITOR_MAX_AGE = 180 * 24 * 3600;

// Crawlers and link previews aren't shoppers; they get no id and are never counted.
const NOT_A_PERSON = /bot|crawl|spider|slurp|facebookexternalhit|embedly|preview|lighthouse|pingdom|monitor|curl|wget|python-requests/i;

export function looksLikeAPerson(userAgent: string | null): boolean {
  return Boolean(userAgent) && !NOT_A_PERSON.test(userAgent!);
}

const b64url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

let keyPromise: Promise<CryptoKey> | null = null;
function key(): Promise<CryptoKey> {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set");
  keyPromise ??= crypto.subtle.importKey("raw", new TextEncoder().encode(`visitor:${secret}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return keyPromise;
}

async function signature(id: string): Promise<string> {
  const mac = await crypto.subtle.sign("HMAC", await key(), new TextEncoder().encode(id));
  return b64url(new Uint8Array(mac).slice(0, 16));
}

export async function newVisitor(): Promise<string> {
  const id = b64url(crypto.getRandomValues(new Uint8Array(16)));
  return `${id}.${await signature(id)}`;
}

/** The visitor id if the cookie is genuine, otherwise null. */
export async function readVisitor(cookie: string | undefined | null): Promise<string | null> {
  if (!cookie) return null;
  const [id, sig] = cookie.split(".");
  if (!id || !sig || id.length > 40) return null;
  return (await signature(id)) === sig ? id : null;
}

/**
 * Which version a visitor sees. The same visitor and test always give the same answer, and
 * `splitB` percent of visitors see B.
 */
export function versionFor(visitorId: string, testId: string, splitB: number): "a" | "b" {
  // FNV-1a over the pair, spread to 0..99.
  let h = 0x811c9dc5;
  for (const ch of `${testId}:${visitorId}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % 100 < splitB ? "b" : "a";
}
