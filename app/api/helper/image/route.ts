import { z } from "zod";
import { helperIdFrom, isHelper } from "@/lib/ai/helper-auth";
import { isCreativeKind, receiveCreativePictures } from "@/lib/creative/pictures";
import { asSystem } from "@/lib/db";
import { receivePictures } from "@/lib/shops/images";
import "@/lib/ai/handlers";

// The AI helper hands back a finished picture here: the cut and compressed files plus the AI's answer
// (the prompt it used and alt text). The files are stored and the job is finished in one go. Brand
// pictures go to lib/shops/images.ts; pictures for ads and posts to lib/creative/pictures.ts.
// A failed image job is reported through /api/helper/complete like any other job.
export const maxDuration = 60;

const File = z.object({
  name: z.string().regex(/^[a-z][a-z0-9-]{0,19}$/),
  width: z.number().int().min(16).max(4000),
  height: z.number().int().min(16).max(4000),
  type: z.enum(["image/webp", "image/jpeg", "image/png"]),
  // base64 of at most 800 KB
  data: z.string().min(100).max(1_100_000),
});

const Body = z.object({
  helperId: z.string(),
  jobId: z.uuid(),
  output: z.object({ prompt: z.unknown().optional(), alt: z.unknown().optional(), source: z.unknown().optional() }).nullish(),
  usage: z.unknown().optional(),
  files: z.array(File).min(1).max(4),
});

export async function POST(request: Request) {
  if (!isHelper(request)) return new Response(null, { status: 401 });
  if (Number(request.headers.get("content-length") ?? 0) > 4_000_000) return new Response(null, { status: 413 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  const helperId = helperIdFrom(parsed.success ? parsed.data.helperId : null);
  if (!parsed.success || !helperId) return new Response(null, { status: 400 });

  const d = parsed.data;
  const [job] = await asSystem((tx) => tx<{ kind: string }[]>`select kind from armada.ai_jobs where id = ${d.jobId}`);
  if (!job) return new Response(null, { status: 409 });
  const receive = isCreativeKind(job.kind) ? receiveCreativePictures : receivePictures;
  const result = await receive(helperId, d.jobId, d.output ?? null, d.usage ?? null, d.files);
  if (result === "gone") return new Response(null, { status: 409 });
  if (result === "bad") return new Response(null, { status: 400 });
  return Response.json({ ok: true });
}
