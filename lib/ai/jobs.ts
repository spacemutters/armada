import "server-only";
import { asSystem, type Tx } from "@/lib/db";
import type { AiJob, AiJobInput } from "@/lib/types";
import { HELPER_ONLINE_SECONDS, JOB_MAX_ATTEMPTS, JOB_STALE_MINUTES, modelFor } from "./config";

export async function enqueueJob(
  tx: Tx,
  job: {
    workspaceId: string;
    kind: string;
    input: Omit<AiJobInput, "model"> & { model?: string };
    parent?: { type: string; id: string };
  },
): Promise<string> {
  const input: AiJobInput = { ...job.input, model: job.input.model ?? modelFor(job.kind) };
  const [row] = await tx<{ id: string }[]>`
    insert into armada.ai_jobs (workspace_id, kind, input, parent_type, parent_id)
    values (${job.workspaceId}, ${job.kind}, ${tx.json(input as never)}, ${job.parent?.type ?? null}, ${job.parent?.id ?? null})
    returning id`;
  return row.id;
}

/** Hands the oldest waiting job to a helper. Jobs stuck "running" too long are taken back. */
export async function claimJob(helperId: string): Promise<AiJob | null> {
  return asSystem(async (tx) => {
    const rows = await tx<AiJob[]>`
      update armada.ai_jobs set status = 'running', started_at = now(), attempts = attempts + 1, claimed_by = ${helperId}
      where id = (
        select id from armada.ai_jobs
        where status = 'queued'
           or (status = 'running' and started_at < now() - make_interval(mins => ${JOB_STALE_MINUTES}))
        order by created_at
        limit 1
        for update skip locked
      )
      returning *`;
    return rows[0] ?? null;
  });
}

export type JobHandler = (tx: Tx, job: AiJob) => Promise<void>;
const handlers = new Map<string, JobHandler>();

/** Registers what happens after a job of this kind finishes or finally fails. */
export function onJobFinished(kindPrefix: string, handler: JobHandler): void {
  handlers.set(kindPrefix, handler);
}

function handlerFor(kind: string): JobHandler | undefined {
  for (const [prefix, h] of handlers) if (kind === prefix || kind.startsWith(prefix + ".")) return h;
  return undefined;
}

/**
 * Records a helper's result. A failed job gets one more try before it is marked failed;
 * either way the job's owner (for example a shop being built) is told once it is final.
 */
export async function completeJob(
  helperId: string,
  jobId: string,
  result: { ok: true; output: unknown; usage?: unknown } | { ok: false; error: string; usage?: unknown },
): Promise<void> {
  await asSystem(async (tx) => {
    const [job] = await tx<AiJob[]>`select * from armada.ai_jobs where id = ${jobId} for update`;
    if (!job || job.status !== "running" || job.claimedBy !== helperId) return;

    let finished: AiJob;
    if (result.ok) {
      [finished] = await tx<AiJob[]>`
        update armada.ai_jobs
        set status = 'done', output = ${tx.json(result.output as never)}, usage = ${tx.json((result.usage ?? null) as never)},
            error = null, finished_at = now()
        where id = ${jobId} returning *`;
    } else if (job.attempts < JOB_MAX_ATTEMPTS) {
      await tx`update armada.ai_jobs set status = 'queued', error = ${result.error.slice(0, 2000)} where id = ${jobId}`;
      return;
    } else {
      [finished] = await tx<AiJob[]>`
        update armada.ai_jobs set status = 'failed', error = ${result.error.slice(0, 2000)}, finished_at = now()
        where id = ${jobId} returning *`;
    }

    const handler = handlerFor(finished.kind);
    if (handler) {
      // The follow-up step runs as the job's workspace only, not with system reach.
      await tx`select set_config('armada.workspace_id', ${finished.workspaceId}, true), set_config('armada.system', '', true)`;
      await handler(tx, finished);
    }
  });
}

export async function recordHeartbeat(helperId: string, info: Record<string, unknown>): Promise<void> {
  await asSystem(
    (tx) => tx`
      insert into armada.helpers (id, last_seen_at, info) values (${helperId}, now(), ${tx.json(info as never)})
      on conflict (id) do update set last_seen_at = now(), info = excluded.info`,
  );
}

export interface HelperStatus {
  online: boolean;
  lastSeenAt: Date | null;
  busy: boolean;
}

export async function helperStatus(): Promise<HelperStatus> {
  const rows = await asSystem(
    (tx) => tx<{ lastSeenAt: Date; info: { busy?: boolean } }[]>`
      select last_seen_at, info from armada.helpers order by last_seen_at desc limit 1`,
  );
  const h = rows[0];
  if (!h) return { online: false, lastSeenAt: null, busy: false };
  const online = Date.now() - new Date(h.lastSeenAt).getTime() < HELPER_ONLINE_SECONDS * 1000;
  return { online, lastSeenAt: h.lastSeenAt, busy: online && Boolean(h.info?.busy) };
}
