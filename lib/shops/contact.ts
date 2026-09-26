import "server-only";
import { asSystem } from "@/lib/db";
import { supportEmail } from "./storefront";
import type { ShopRow } from "./types";

// The email shoppers write to. Practice shops show a reserved .example address, so nothing sent
// there reaches anyone. Real shops show the workspace's shop contact email (Settings), or the
// owner's sign-in email until one is set; a real shop with neither can't take payments.

export const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/;

/** The workspace's shop contact email, and whether it was set on purpose (not the owner's sign-in email). */
export async function workspaceContactEmail(workspaceId: string): Promise<{ email: string | null; set: boolean }> {
  const [row] = await asSystem(
    (tx) => tx<{ supportEmail: string | null; ownerEmail: string | null }[]>`
      select w.support_email,
             (select m.email from armada.members m where m.workspace_id = w.id and m.role = 'owner' and m.email is not null
              order by m.created_at limit 1) as owner_email
      from armada.workspaces w where w.id = ${workspaceId}`,
  );
  if (row?.supportEmail) return { email: row.supportEmail, set: true };
  return { email: row?.ownerEmail ?? null, set: false };
}

/** What a shop's pages show shoppers, and whether it's a real inbox. */
export async function shopContactEmail(shop: ShopRow): Promise<{ email: string; real: boolean }> {
  if (shop.brief?.source === "practice") return { email: supportEmail(shop.blueprint), real: false };
  const c = await workspaceContactEmail(shop.workspaceId);
  return c.email ? { email: c.email, real: true } : { email: supportEmail(shop.blueprint), real: false };
}
