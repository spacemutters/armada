import { cookies, headers } from "next/headers";
import { recordVisit } from "@/lib/abtest/tests";
import { looksLikeAPerson, readVisitor, versionFor, VISITOR_COOKIE } from "@/lib/abtest/visitor";

// Storefront visits for headline tests. Only genuine visitor ids count, never the shop's own team,
// and the version is worked out here from the visitor id, never taken from the browser.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const slug = typeof body?.slug === "string" && /^[a-z0-9]{6,20}$/.test(body.slug) ? body.slug : null;
  const kind = body?.kind === "view" || body?.kind === "add" ? body.kind : null;
  if (!slug || !kind) return new Response(null, { status: 400 });

  const jar = await cookies();
  if (jar.has("armada_session")) return new Response(null, { status: 204 });
  if (!looksLikeAPerson((await headers()).get("user-agent"))) return new Response(null, { status: 204 });
  const visitor = await readVisitor(jar.get(VISITOR_COOKIE)?.value);
  if (!visitor) return new Response(null, { status: 204 });

  await recordVisit(slug, visitor, kind, (testId, split) => versionFor(visitor, testId, split));
  return new Response(null, { status: 204 });
}
