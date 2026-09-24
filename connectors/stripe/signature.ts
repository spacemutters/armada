import { createHmac, timingSafeEqual } from "node:crypto";

// Checks that a notification really came from Stripe, the manual way Stripe documents
// (https://docs.stripe.com/webhooks#verify-manually):
// - The Stripe-Signature header holds "t=<unix seconds>" and one or more "v1=<hex>" (more than one
//   while a signing secret is being rolled). Every other scheme (v0 is a fake one Stripe adds to
//   test events) is ignored, so nobody can downgrade the check.
// - The expected signature is HMAC-SHA256, keyed with the endpoint's signing secret (the whole
//   "whsec_..." text), over `${t}.${rawBody}`, as lowercase hex.
// - Signatures are compared in constant time, and the timestamp must be within the tolerance
//   (5 minutes, Stripe's own default) so an old notification can't be replayed.
//
// Pure apart from node:crypto, so the offline check can load it.

export const SIGNATURE_TOLERANCE_SECONDS = 300;

export interface ParsedSignatureHeader {
  timestamp: number | null;
  signatures: string[];
}

export function parseSignatureHeader(header: string | null | undefined): ParsedSignatureHeader {
  const out: ParsedSignatureHeader = { timestamp: null, signatures: [] };
  if (!header) return out;
  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq < 1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "t") {
      if (/^\d{1,12}$/.test(value)) out.timestamp = Number(value);
    } else if (key === "v1") {
      if (/^[0-9a-fA-F]{64}$/.test(value)) out.signatures.push(value.toLowerCase());
    }
  }
  return out;
}

/** The v1 signature Stripe would send for this payload at this time. */
export function computeSignature(secret: string, timestamp: number, payload: string | Uint8Array): string {
  const mac = createHmac("sha256", secret);
  mac.update(`${timestamp}.`, "utf8");
  if (typeof payload === "string") mac.update(payload, "utf8");
  else mac.update(payload);
  return mac.digest("hex");
}

/** A header as Stripe sends it, for tests. */
export function signatureHeader(secret: string, timestamp: number, payload: string | Uint8Array): string {
  return `t=${timestamp},v1=${computeSignature(secret, timestamp, payload)}`;
}

export type SignatureCheck =
  | { ok: true; timestamp: number }
  | { ok: false; reason: "no_secret" | "no_header" | "no_timestamp" | "no_signature" | "mismatch" | "outside_tolerance" };

/**
 * Verifies a notification. `payload` must be the raw body exactly as received (the bytes, or the text
 * decoded from them), never JSON that was parsed and re-encoded.
 */
export function verifySignature(
  payload: string | Uint8Array,
  header: string | null | undefined,
  secret: string,
  opts: { toleranceSeconds?: number; now?: number } = {},
): SignatureCheck {
  const tolerance = opts.toleranceSeconds ?? SIGNATURE_TOLERANCE_SECONDS;
  // A tolerance of 0 would switch the replay check off, which Stripe warns against.
  if (!(tolerance > 0)) throw new Error("The signature tolerance must be above zero");
  if (!secret) return { ok: false, reason: "no_secret" };
  if (!header) return { ok: false, reason: "no_header" };
  const parsed = parseSignatureHeader(header);
  if (parsed.timestamp === null) return { ok: false, reason: "no_timestamp" };
  if (!parsed.signatures.length) return { ok: false, reason: "no_signature" };

  const expected = Buffer.from(computeSignature(secret, parsed.timestamp, payload), "hex");
  let matched = false;
  for (const sig of parsed.signatures) {
    const got = Buffer.from(sig, "hex");
    // Every candidate is compared, in constant time, even after a match.
    if (got.length === expected.length && timingSafeEqual(got, expected)) matched = true;
  }
  if (!matched) return { ok: false, reason: "mismatch" };

  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - parsed.timestamp) > tolerance) return { ok: false, reason: "outside_tolerance" };
  return { ok: true, timestamp: parsed.timestamp };
}
