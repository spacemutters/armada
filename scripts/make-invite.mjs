// Prints a one-time setup link. With no workspace it makes a first-owner link that creates a new
// fleet; the person who opens it makes a passkey and becomes the owner. With --admin, the person
// instead picks their own email and password on the page and becomes the platform admin.
// usage: node --env-file=.env.local scripts/make-invite.mjs https://armada.example [hours] [--admin]
import crypto from "node:crypto";
import postgres from "postgres";

const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const admin = process.argv.includes("--admin");
const base = (positional[0] || "http://localhost:3000").replace(/\/$/, "");
const hours = Number(positional[1] || 72);
const { SUPABASE_CA } = await import("../lib/db/supabase-ca.ts");
const url = process.env.DATABASE_URL;
const sql = postgres(url, {
  prepare: false,
  max: 1,
  host: process.env.DATABASE_HOSTADDR || undefined,
  ssl: { ca: SUPABASE_CA, servername: new URL(url).hostname, rejectUnauthorized: true },
});

const token = crypto.randomBytes(32).toString("base64url");
const hash = crypto.createHash("sha256").update(token).digest("hex");
try {
  await sql.begin(async (tx) => {
    await tx`select set_config('armada.system', 'on', true)`;
    await tx`insert into armada.invites (workspace_id, member_id, role, admin, token_hash, expires_at)
             values (null, null, 'owner', ${admin}, ${hash}, now() + make_interval(hours => ${hours}))`;
  });
  console.log(`${base}/setup/${token}`);
} finally {
  await sql.end();
}
