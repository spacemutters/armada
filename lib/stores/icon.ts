import "server-only";
import { enqueueJob, onJobFinished } from "@/lib/ai/jobs";
import { withWorkspace, type Tx } from "@/lib/db";
import { ART_ICONS } from "@/lib/shops/style";
import type { AiJob } from "@/lib/types";

// A store's icon: one name from the shop builder's icon set, shown on the fleet map and the store's
// page. Set by hand, or made by the AI from the store's name and what it sells.

export function isStoreIcon(value: unknown): value is (typeof ART_ICONS)[number] {
  return typeof value === "string" && (ART_ICONS as readonly string[]).includes(value);
}

export async function setStoreIcon(workspaceId: string, storeId: string, icon: string | null): Promise<void> {
  if (icon !== null && !isStoreIcon(icon)) return;
  await withWorkspace(workspaceId, (tx) => tx`update armada.stores set icon = ${icon} where id = ${storeId}`);
}

const SYSTEM = `You pick one icon for an online store from a fixed list. Choose the icon a shopper would most quickly connect with what the store sells. Answer only with JSON that matches the schema.`;

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["icon", "why"],
  properties: {
    icon: { type: "string", enum: [...ART_ICONS] },
    why: { type: "string" },
  },
} as const;

/** Asks the AI helper for an icon. Returns false if one is already being made for this store. */
export async function makeStoreIcon(workspaceId: string, storeId: string): Promise<boolean> {
  return withWorkspace(workspaceId, async (tx) => {
    const [pending] = await tx<{ id: string }[]>`
      select id from armada.ai_jobs where parent_type = 'store' and parent_id = ${storeId} and status in ('queued', 'running')`;
    if (pending) return false;
    const [store] = await tx<{ name: string; platform: string }[]>`select name, platform from armada.stores where id = ${storeId}`;
    if (!store) return false;
    const products = await tx<{ title: string; category: string }[]>`
      select p.title, p.category from armada.listings l join armada.products p on p.id = l.product_id
      where l.store_id = ${storeId} order by l.created_at limit 15`;
    const prompt = [
      `Store name: ${store.name}`,
      `Sells on: ${store.platform}`,
      products.length ? `Some of its products:\n${products.map((p) => `- ${p.title}${p.category ? ` (${p.category})` : ""}`).join("\n")}` : "It has no products yet; go by the name.",
      `Pick the one icon from the list that fits best, and say why in one short sentence.`,
    ].join("\n\n");
    await enqueueJob(tx, {
      workspaceId,
      kind: "store.icon",
      input: { system: SYSTEM, prompt, schema: schema as never, timeoutMs: 90_000 },
      parent: { type: "store", id: storeId },
    });
    return true;
  });
}

/** Whether the AI is making an icon for this store right now. */
export async function iconInProgress(workspaceId: string, storeId: string): Promise<boolean> {
  const rows = await withWorkspace(
    workspaceId,
    (tx) => tx<{ id: string }[]>`
      select id from armada.ai_jobs where parent_type = 'store' and parent_id = ${storeId} and status in ('queued', 'running') limit 1`,
  );
  return rows.length > 0;
}

onJobFinished("store", async (tx: Tx, job: AiJob) => {
  if (job.kind !== "store.icon" || job.parentType !== "store" || !job.parentId || job.status !== "done") return;
  const icon = (job.output as { icon?: unknown } | null)?.icon;
  if (!isStoreIcon(icon)) return;
  await tx`update armada.stores set icon = ${icon} where id = ${job.parentId}`;
});
