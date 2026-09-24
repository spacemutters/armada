import "server-only";
import { withWorkspace } from "@/lib/db";

// Speed lanes. Each outside account (a CJ account now, each Shopify store later) has a lane; every
// call first reserves the next free time slot with one atomic update, then waits for it. Because
// the reservation is a single row update, any number of servers calling at once still queue up
// in order and never exceed the account's limit.

export async function reserveSlot(workspaceId: string, lane: string, intervalMs: number): Promise<number> {
  const [row] = await withWorkspace(
    workspaceId,
    (tx) => tx<{ waitMs: number }[]>`
      insert into armada.provider_lanes (workspace_id, lane, next_at)
      values (${workspaceId}, ${lane}, now() + make_interval(secs => ${intervalMs / 1000}))
      on conflict (workspace_id, lane) do update
        set next_at = greatest(armada.provider_lanes.next_at, now()) + make_interval(secs => ${intervalMs / 1000})
      returning greatest(0, extract(epoch from (next_at - now())) * 1000 - ${intervalMs})::int as wait_ms`,
  );
  return row.waitMs;
}

/** Waits for this lane's next slot. Returns how long it waited, in milliseconds. */
export async function waitForSlot(workspaceId: string, lane: string, intervalMs: number): Promise<number> {
  const wait = await reserveSlot(workspaceId, lane, intervalMs);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  return wait;
}
