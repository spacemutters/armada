"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { withWorkspace } from "@/lib/db";
import { startShopBuild } from "@/lib/shops/pipeline";
import type { ShopBrief } from "@/lib/shops/types";

// Distinct directions for shops built in one batch, so ten shops from one idea don't come out as
// ten versions of the same brand.
const ANGLES = [
  "quiet and minimal",
  "bright and playful",
  "rugged and outdoorsy",
  "calm and natural",
  "bold and graphic",
  "warm and classic",
  "precise and technical",
  "soft and gentle",
  "urban and modern",
  "cheerful and good value",
];

const Form = z.object({
  niche: z.string().trim().min(3, "Say what the shop should sell.").max(200),
  audience: z.string().trim().max(200).default(""),
  country: z.string().trim().min(2).max(40).default("United States"),
  priceFeel: z.enum(["budget", "mid", "premium"]).default("mid"),
  productCount: z.coerce.number().int().min(4).max(24).default(12),
  look: z.string().trim().max(160).default(""),
  count: z.coerce.number().int().min(1).max(10).default(1),
});

export async function createShops(formData: FormData) {
  const session = await requireSession();
  const parsed = Form.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`/builder/new?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Check the form.")}`);
  const f = parsed.data;

  const ids = await withWorkspace(session.workspaceId, async (tx) => {
    const made: string[] = [];
    for (let i = 0; i < f.count; i++) {
      const look = f.count > 1 ? [f.look, ANGLES[i % ANGLES.length]].filter(Boolean).join("; ") : f.look;
      const brief: ShopBrief = {
        niche: f.niche,
        audience: f.audience,
        country: f.country,
        priceFeel: f.priceFeel,
        productCount: f.productCount,
        look,
        source: "practice",
      };
      const { id } = await startShopBuild(tx, session.workspaceId, brief);
      made.push(id);
    }
    await tx`
      insert into armada.audit_log (workspace_id, member_id, action, detail)
      values (${session.workspaceId}, ${session.memberId}, 'shops.build_started', ${tx.json({ niche: f.niche, count: f.count })})`;
    return made;
  });

  redirect(ids.length === 1 ? `/builder/${ids[0]}` : "/builder");
}
