import { after } from "next/server";
import { z } from "zod";
import { completeJob } from "@/lib/ai/jobs";
import { helperIdFrom, isHelper } from "@/lib/ai/helper-auth";
import "@/lib/ai/handlers";

// Follow-up work (such as checking supplier shipping for a new shop) runs after the answer is sent.
export const maxDuration = 300;

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
  const deferred = await completeJob(
    helperId,
    d.jobId,
    d.ok ? { ok: true, output: d.output, usage: d.usage } : { ok: false, error: d.error ?? "The AI helper reported an error.", usage: d.usage },
  );
  if (deferred.length) {
    after(async () => {
      for (const work of deferred) {
        try {
          await work();
        } catch (e) {
          console.error("follow-up work failed", e);
        }
      }
    });
  }
  return Response.json({ ok: true });
}
