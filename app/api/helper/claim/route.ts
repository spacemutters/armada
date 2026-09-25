import { after } from "next/server";
import { claimJob, recordHeartbeat } from "@/lib/ai/jobs";
import { helperIdFrom, isHelper } from "@/lib/ai/helper-auth";
import { resumeLiveEbayChanges } from "@/lib/changes/engine";
import { advanceOpenLaunches } from "@/lib/launch/run";
import { resumeStalledCjBuilds } from "@/lib/shops/pipeline";
import { publishDuePosts } from "@/lib/social/posts/schedule";

export const maxDuration = 300;

// The helper polls every couple of seconds; stalled CJ builds and scheduled posts that are due are
// looked for at most once a minute, so a post goes out on time even when nobody has the page open.
let lastSweep = 0;

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
  if (Date.now() - lastSweep > 60_000) {
    lastSweep = Date.now();
    after(() => resumeStalledCjBuilds().catch((e) => console.error("stalled build sweep failed", e)));
    after(() => publishDuePosts().catch((e) => console.error("scheduled posts sweep failed", e)));
    // Launches nobody is watching carry on, and approved eBay listings that stopped part way finish.
    after(() => advanceOpenLaunches().catch((e) => console.error("launch sweep failed", e)));
    after(() => resumeLiveEbayChanges().catch((e) => console.error("eBay listing sweep failed", e)));
  }
  if (!job) return new Response(null, { status: 204 });
  return Response.json({ id: job.id, kind: job.kind, input: job.input });
}
