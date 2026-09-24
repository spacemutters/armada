import { z } from "zod";
import { completeJob } from "@/lib/ai/jobs";
import { helperIdFrom, isHelper } from "@/lib/ai/helper-auth";
import "@/lib/ai/handlers";

const Body = z.object({
  helperId: z.string(),
  jobId: z.uuid(),
  ok: z.boolean(),
  output: z.unknown().optional(),
  error: z.string().max(4000).optional(),
  usage: z.unknown().optional(),
});

export async function POST(request: Request) {
  if (!isHelper(request)) return new Response(null, { status: 401 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  const helperId = helperIdFrom(parsed.success ? parsed.data.helperId : null);
  if (!parsed.success || !helperId) return new Response(null, { status: 400 });

  const d = parsed.data;
  await completeJob(
    helperId,
    d.jobId,
    d.ok ? { ok: true, output: d.output, usage: d.usage } : { ok: false, error: d.error ?? "The AI helper reported an error.", usage: d.usage },
  );
  return Response.json({ ok: true });
}
