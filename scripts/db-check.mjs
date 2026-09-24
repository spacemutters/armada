// Confirms the app's database login works through the pooler and that the wall between
// workspaces holds: with no workspace set, the app login must see zero rows.
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1, connect_timeout: 15 });
try {
  const [who] = await sql`select current_user as user, current_setting('search_path') as path`;
  console.log("connected as", who.user, "search_path", who.path);

  const [blind] = await sql`select count(*)::int as n from armada.workspaces`;
  console.log("rows visible with no workspace set:", blind.n);

  const [sys] = await sql.begin(async (tx) => {
    await tx`select set_config('armada.system', 'on', true)`;
    return tx`select count(*)::int as n from armada.workspaces`;
  });
  console.log("rows visible in system mode:", sys.n);

  const hostTables = await sql`select count(*)::int as n from information_schema.tables where table_schema = 'public'`;
  console.log("host project tables readable by the app login:", hostTables[0].n);
} catch (e) {
  console.error("FAILED:", e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
