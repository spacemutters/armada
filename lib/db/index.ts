import "server-only";
import postgres from "postgres";
import { SUPABASE_CA } from "./supabase-ca";

// One pooled client per server instance. The app logs in as `armada_app`, which is not the
// table owner, so row-level security decides what every query can see.
let client: postgres.Sql | undefined;

function sql(): postgres.Sql {
  if (client) return client;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const { hostname } = new URL(url);
  client = postgres(url, {
    prepare: false, // the transaction pooler can't keep prepared statements
    max: 5,
    idle_timeout: 20,
    max_lifetime: 5 * 60, // recycle connections so a dead one never lingers
    connect_timeout: 15,
    keep_alive: 30,
    // Queries that hang are cancelled after 25 seconds by a role setting on armada_app
    // (statement_timeout), which works through the pooler where startup settings don't.
    // Local only: this PC's resolver stalls on the pooler name, so dev can dial its address directly.
    host: process.env.DATABASE_HOSTADDR || undefined,
    ssl: { ca: SUPABASE_CA, servername: hostname, rejectUnauthorized: true },
    transform: postgres.camel,
  });
  return client;
}

export type Tx = postgres.TransactionSql;

/** Runs `fn` in a transaction that can only see and write one workspace's rows. */
export async function withWorkspace<T>(workspaceId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return (await sql().begin(async (tx) => {
    await tx`select set_config('armada.workspace_id', ${workspaceId}, true)`;
    return fn(tx);
  })) as T;
}

/** Runs `fn` with access across workspaces. Only for sign-in, the AI helper and background sweeps. */
export async function asSystem<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return (await sql().begin(async (tx) => {
    await tx`select set_config('armada.system', 'on', true)`;
    return fn(tx);
  })) as T;
}

/** A plain query with no workspace set. Row-level security makes it see nothing, by design. */
export function unscoped(): postgres.Sql {
  return sql();
}
