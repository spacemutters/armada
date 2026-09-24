import { recordHeartbeat } from "@/lib/ai/jobs";
import { helperIdFrom, isHelper } from "@/lib/ai/helper-auth";

export async function POST(request: Request) {
  if (!isHelper(request)) return new Response(null, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const helperId = helperIdFrom(body?.helperId);
  if (!helperId) return new Response(null, { status: 400 });
  await recordHeartbeat(helperId, {
    busy: Boolean(body?.busy),
    version: typeof body?.version === "string" ? body.version : null,
    running: typeof body?.running === "number" ? body.running : 0,
  });
  return Response.json({ ok: true });
}
