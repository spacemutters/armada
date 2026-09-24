import { endSession } from "@/lib/auth/session";

export async function POST() {
  await endSession();
  return Response.json({ ok: true });
}
