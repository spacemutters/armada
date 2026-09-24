import "server-only";
import crypto from "node:crypto";

// Sealing for connection keys and tokens: AES-256-GCM, with the key held in Vercel's settings
// (ENCRYPTION_KEY, 32 random bytes as base64). Sealed layout: version(1) | iv(12) | tag(16) | data.

const VERSION = 1;

function key(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) throw new Error("ENCRYPTION_KEY is not set");
  const k = Buffer.from(raw, "base64");
  if (k.length !== 32) throw new Error("ENCRYPTION_KEY must be 32 bytes");
  return k;
}

export function seal(value: unknown): Buffer {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), data]);
}

export function open<T>(sealed: Buffer | Uint8Array): T {
  const buf = Buffer.from(sealed);
  if (buf[0] !== VERSION) throw new Error("Unknown sealed format");
  const iv = buf.subarray(1, 13);
  const tag = buf.subarray(13, 29);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  const text = Buffer.concat([decipher.update(buf.subarray(29)), decipher.final()]).toString("utf8");
  return JSON.parse(text) as T;
}
