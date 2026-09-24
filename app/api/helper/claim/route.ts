import { claimJob, recordHeartbeat } from "@/lib/ai/jobs";
import { helperIdFrom, isHelper } from "@/lib/ai/helper-auth";

export async function POST(request: Request) {
  if (!isHelper(request)) return new Response(null, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const helperId = helperIdFrom(body?.helperId);
  if (!helperId) return new Response(null, { status: 400 });

  const job = await claimJob(helperId);
  await recordHeartbeat(helperId, {
    busy: Boolean(job) || Number(body?.running) > 0,
    version: typeof body?.version === "string" ? body.version : null,
    running: (Number(body?.running) || 0) + (job ? 1 : 0),
  });
  if (!job) return new Response(null, { status: 204 });
  return Response.json({ id: job.id, kind: job.kind, input: job.input });
}
