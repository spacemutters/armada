// Creates or updates Armada's platform admin: a member who can sign in with email and password and
// open /admin. Everything comes from the environment, so no email or password is ever written into a file.
//
//   ADMIN_EMAIL           required
//   ADMIN_PASSWORD        required (not checked for strength here; change it later in Settings > Password)
//   ADMIN_NAME            optional, default "Davis"   (only used when creating)
//   ADMIN_WORKSPACE_NAME  optional, default "Armada"  (only used when creating)
//
// If a member already has that email, their password is replaced and they become an admin.
// Otherwise a new fleet is made with that member as its owner, the same way a first-owner setup link does.
//
// PowerShell:
//   $env:ADMIN_EMAIL='you@example.com'; $env:ADMIN_PASSWORD='your password'; node --env-file=.env.local scripts/make-admin.mjs
//
// Prints only "admin ready: <email>, workspace <name>". Never prints the password or its hash.
import postgres from "postgres";

function fail(message) {
  console.error(message);
  process.exit(1);
}

const { hashPassword, looksLikeEmail, normalizeEmail, MAX_PASSWORD_LENGTH } = await import("../lib/auth/password.ts");
const { SUPABASE_CA } = await import("../lib/db/supabase-ca.ts");

const email = normalizeEmail(process.env.ADMIN_EMAIL ?? "");
const password = process.env.ADMIN_PASSWORD ?? "";
const name = (process.env.ADMIN_NAME ?? "").trim().slice(0, 60) || "Davis";
const workspaceName = (process.env.ADMIN_WORKSPACE_NAME ?? "").trim().slice(0, 60) || "Armada";

if (!looksLikeEmail(email)) fail("Set ADMIN_EMAIL to the admin's email address.");
if (!password) fail("Set ADMIN_PASSWORD to the admin's password.");
if (password.length > MAX_PASSWORD_LENGTH) fail(`ADMIN_PASSWORD is longer than ${MAX_PASSWORD_LENGTH} characters.`);
const url = process.env.DATABASE_URL;
if (!url) fail("DATABASE_URL is not set. Run it as: node --env-file=.env.local scripts/make-admin.mjs");

const hash = await hashPassword(password);

const sql = postgres(url, {
  prepare: false,
  max: 1,
  host: process.env.DATABASE_HOSTADDR || undefined,
  ssl: { ca: SUPABASE_CA, servername: new URL(url).hostname, rejectUnauthorized: true },
});

try {
  const workspace = await sql.begin(async (tx) => {
    await tx`select set_config('armada.system', 'on', true)`;
    const [existing] = await tx`
      select m.id, m.workspace_id, w.name as workspace_name
      from armada.members m join armada.workspaces w on w.id = m.workspace_id
      where m.email = ${email}
      for update of m`;
    if (existing) {
      await tx`
        update armada.members set password_hash = ${hash}, password_changed_at = now(), is_admin = true
        where id = ${existing.id}`;
      await tx`
        insert into armada.audit_log (workspace_id, member_id, action, detail)
        values (${existing.workspace_id}, ${existing.id}, 'admin.updated', ${tx.json({ by: "make-admin" })})`;
      return existing.workspace_name;
    }
    const [ws] = await tx`insert into armada.workspaces (name) values (${workspaceName}) returning id, name`;
    const [member] = await tx`
      insert into armada.members (workspace_id, display_name, role, email, password_hash, password_changed_at, is_admin)
      values (${ws.id}, ${name}, 'owner', ${email}, ${hash}, now(), true)
      returning id`;
    await tx`
      insert into armada.audit_log (workspace_id, member_id, action, detail)
      values (${ws.id}, ${member.id}, 'admin.created', ${tx.json({ by: "make-admin" })})`;
    return ws.name;
  });
  console.log(`admin ready: ${email}, workspace ${workspace}`);
} catch (e) {
  // Only the message: a database error's other fields can quote the row, hash included.
  console.error(`couldn't make the admin: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
