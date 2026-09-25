import "server-only";
import { cache } from "react";
import { completeJob, enqueueJob, onJobFinished } from "@/lib/ai/jobs";
import { asSystem, withWorkspace, type Tx } from "@/lib/db";
import { clip } from "@/lib/text";
import type { AiJob, AiJobInput } from "@/lib/types";
import { IMAGE_CRAFT, withCraft } from "./craft";
import type { Blueprint, ShopRow } from "./types";

// Brand images for AI-built shops, made with ChatGPT's image maker on the owner's PC.
//
// THE HONESTY RULE: these pictures are for mood only (the home page hero, collection covers, a
// lifestyle band and the link preview). They show the shop's world: a place, light, materials, the
// moment of use. They never show, or stand in for, a product the shop sells, because shoppers must
// receive what the product photos show. Product photos stay the supplier's real photos. The rule is
// in IMAGE_CRAFT (what the AI is told), in every brief below (the shop's product kinds are listed as
// things that must not appear), and in how the storefront uses them (never on a product card or page).
//
// How a picture is made:
//   startShopImages / redoShopImage  queue one job per slot (kind images.hero, images.lifestyle, images.collection)
//   helper (helper/engines.mjs)      runs Codex with only the image tool on, cuts the picture to the sizes below
//   /api/helper/image                receivePictures(): stores the files (not live yet) and finishes the job
//   onJobFinished("images")          makes the new files live and deletes the slot's older ones
//   /api/img/<id>                    serves a file, cached forever (a new picture always gets a new id)

/** What a new shop gets. Change the numbers here: each picture is one image-maker run on the owner's ChatGPT plan. */
export const IMAGE_SET = { hero: true, lifestyle: false, collections: 3 } as const;

/** The jobs' parent: the shop they make pictures for. */
const PARENT = "shop_images";

export type ImageSlotKind = "hero" | "lifestyle" | "collection";
type Output = { name: string; width: number; height: number; format: "webp" | "jpeg"; maxBytes: number };

/**
 * The sizes each slot's one picture is cut into, and the row each size becomes. The hero is asked
 * for wide (3:2) and cut to 16:9 for large screens, 4:5 for phones and 1200x630 for link previews.
 */
const OUTPUTS: Record<ImageSlotKind, (Output & { kind: ImageRow["kind"]; variant: ImageRow["variant"] })[]> = {
  hero: [
    { name: "wide", width: 1600, height: 900, format: "webp", maxBytes: 200_000, kind: "hero", variant: "wide" },
    { name: "tall", width: 1080, height: 1350, format: "webp", maxBytes: 180_000, kind: "hero", variant: "tall" },
    { name: "og", width: 1200, height: 630, format: "jpeg", maxBytes: 150_000, kind: "og", variant: "main" },
  ],
  lifestyle: [
    { name: "wide", width: 1600, height: 900, format: "webp", maxBytes: 200_000, kind: "lifestyle", variant: "wide" },
    { name: "tall", width: 1080, height: 1350, format: "webp", maxBytes: 180_000, kind: "lifestyle", variant: "tall" },
  ],
  collection: [{ name: "main", width: 1200, height: 1200, format: "webp", maxBytes: 200_000, kind: "collection", variant: "main" }],
};

export interface ImageRow {
  id: string;
  shopId: string;
  kind: "hero" | "lifestyle" | "collection" | "og";
  variant: "main" | "wide" | "tall";
  collectionHandle: string | null;
  alt: string;
  width: number;
  height: number;
  createdAt: Date;
}

interface ImageJobSpec {
  slot: string;
  kind: ImageSlotKind;
  collection: string | null;
  outputs: Output[];
}
type ImageJobInput = Omit<AiJobInput, "model"> & { model?: string; image: ImageJobSpec };

/** A slot is one picture's place in the shop: "hero", "lifestyle" or "collection:<handle>". */
export interface Slot {
  key: string;
  kind: ImageSlotKind;
  collection?: NonNullable<Blueprint["collections"]>[number];
}

const slotKey = (kind: ImageSlotKind, handle?: string | null) => (kind === "collection" ? `collection:${handle}` : kind);

export function imageUrl(id: string): string {
  return `/api/img/${id}`;
}

// ---------- what the AI is told ----------

const IMAGE_SYSTEM = `You are the art director inside Armada, a tool that builds online shops. You make one brand image for a shop's website with the image generation tool.

1. Write the image prompt from the brief, following the image craft below.
2. Call the image generation tool exactly once, with that prompt.
3. Then answer: "prompt" is the exact prompt you gave the tool, and "alt" is one plain sentence of at most 20 words saying what the picture shows, for people who can't see it.
Answer only with JSON that matches the schema you are given.`;

const ANSWER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["prompt", "alt"],
  properties: { prompt: { type: "string" }, alt: { type: "string" } },
} as const;

export const PRICE_WORDS = {
  budget: "everyday prices",
  mid: "considered, mid-range prices",
  premium: "premium prices",
  luxury: "a premium brand: quiet, spacious, expensive-looking, never flashy",
} as const;

/** The product kinds a shop sells, from its plan. The brief lists them as things that must not appear. */
export function productKinds(bp: Blueprint): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of [...(bp.searchTerms ?? []), ...(bp.collections ?? []).flatMap((c) => c.keywords)]) {
    const t = clip(k, 40).toLowerCase();
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out.slice(0, 24);
}

/** The brief for one picture, built from the shop's plan. The AI turns it into the image prompt. */
export function imageBrief(shop: Pick<ShopRow, "niche" | "brief" | "blueprint">, slot: Slot): string {
  const bp = shop.blueprint;
  const p = bp.theme?.palette;
  const covers = (bp.collections ?? []).slice(0, IMAGE_SET.collections).map((c) => c.title);
  const about = [
    `Shop: ${bp.brand?.name ?? "the shop"}. ${bp.brand?.tagline ?? ""}`.trim(),
    `What it sells: ${shop.niche}`,
    bp.brand?.audience ? `Who it's for: ${bp.brand.audience}` : "",
    bp.brand?.voice ? `How it talks: ${bp.brand.voice}` : "",
    shop.brief?.look ? `Look the owner asked for: ${shop.brief.look}` : "",
    shop.brief?.priceFeel ? `Price level: ${PRICE_WORDS[shop.brief.priceFeel]}` : "",
    p ? `Brand palette: background ${p.background}, surface ${p.surface}, ink ${p.ink}, muted ${p.muted}, accent ${p.accent}` : "",
    `Product kinds this shop sells. None of these, and nothing that looks like one, may appear: ${productKinds(bp).join(", ") || shop.niche}.`,
    `The set: a home page hero${covers.length ? ` and covers for ${covers.map((t) => `"${t}"`).join(", ")}` : ""}. They must look like one shoot.`,
  ].filter(Boolean);
  let thisImage: string;
  if (slot.kind === "hero") {
    thisImage = `This image: the home page hero, beside and behind the headline "${bp.hero?.headline ?? ""}" (${bp.hero?.subhead ?? ""}). Wide 3:2 landscape. The left 40% calm and plain, because the headline sits over it; one clear subject just right of center, so a tall 4:5 crop keeps it.`;
  } else if (slot.kind === "lifestyle") {
    thisImage = `This image: a wide band between the product sections showing the everyday moment this range is for, after the products have done their job, with none of them in view. Wide 3:2 landscape, the subject near the middle so a tall 4:5 crop keeps it.`;
  } else {
    const c = slot.collection!;
    thisImage = `This image: the cover for the collection "${c.title}" (${c.description}). Square 1:1. One still life or setting that says what this collection is for without showing any of its products, simple enough to read at 300 pixels.`;
  }
  return `${about.join("\n")}\n\n${thisImage}`;
}

/** One picture's job input. Exported for scripts/check-shop-images.mjs. */
export function imageJobInput(shop: Pick<ShopRow, "niche" | "brief" | "blueprint">, slot: Slot): ImageJobInput {
  return {
    system: withCraft(IMAGE_SYSTEM, ["image"]),
    prompt: imageBrief(shop, slot),
    schema: ANSWER_SCHEMA as never,
    // No model here: enqueueJob takes it from lib/ai/config.ts, like every other job.
    effort: "low",
    timeoutMs: 300_000,
    image: {
      slot: slot.key,
      kind: slot.kind,
      collection: slot.collection?.handle ?? null,
      outputs: OUTPUTS[slot.kind].map(({ name, width, height, format, maxBytes }) => ({ name, width, height, format, maxBytes })),
    },
  };
}

// ---------- queueing ----------

/** The slots a shop gets: the hero, the lifestyle band if switched on, and the first collections' covers. */
function plannedSlots(bp: Blueprint): Slot[] {
  const slots: Slot[] = [];
  if (IMAGE_SET.hero) slots.push({ key: "hero", kind: "hero" });
  if (IMAGE_SET.lifestyle) slots.push({ key: "lifestyle", kind: "lifestyle" });
  const cols = bp.collections ?? [];
  const withProducts = cols.filter((c) => c.productIds?.length);
  for (const c of (withProducts.length ? withProducts : cols).slice(0, IMAGE_SET.collections)) {
    slots.push({ key: slotKey("collection", c.handle), kind: "collection", collection: c });
  }
  return slots;
}

async function pendingSlots(tx: Tx, shopId: string): Promise<Set<string>> {
  const rows = await tx<{ slot: string | null }[]>`
    select input -> 'image' ->> 'slot' as slot from armada.ai_jobs
    where parent_type = ${PARENT} and parent_id = ${shopId} and status in ('queued', 'running')`;
  return new Set(rows.map((r) => r.slot).filter((s): s is string => Boolean(s)));
}

async function liveSlots(tx: Tx, shopId: string): Promise<Set<string>> {
  const rows = await tx<{ kind: ImageRow["kind"]; collectionHandle: string | null }[]>`
    select distinct kind, collection_handle from armada.shop_images where shop_id = ${shopId} and live`;
  return new Set(rows.filter((r) => r.kind !== "og").map((r) => slotKey(r.kind as ImageSlotKind, r.collectionHandle)));
}

async function enqueueSlot(tx: Tx, shop: ShopRow, slot: Slot): Promise<void> {
  await enqueueJob(tx, { workspaceId: shop.workspaceId, kind: `images.${slot.kind}`, input: imageJobInput(shop, slot), parent: { type: PARENT, id: shop.id } });
}

/**
 * Queues the pictures a shop is missing: by default one hero and up to three collection covers
 * (IMAGE_SET). A slot that already has a picture, or is being made, is left alone. Call it once the
 * shop's plan is final (brand, palette and collections). Returns how many were queued.
 */
export async function startShopImages(tx: Tx, shop: ShopRow): Promise<number> {
  const bp = shop.blueprint;
  if (!bp.brand || !bp.theme) return 0;
  const [pending, live] = await Promise.all([pendingSlots(tx, shop.id), liveSlots(tx, shop.id)]);
  let queued = 0;
  for (const slot of plannedSlots(bp)) {
    if (pending.has(slot.key) || live.has(slot.key)) continue;
    await enqueueSlot(tx, shop, slot);
    queued++;
  }
  return queued;
}

/** "Make images" for a shop: queues whatever it's missing. False if the shop isn't there or has no plan yet. */
export async function makeShopImages(workspaceId: string, shopId: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(shopId)) return false;
  return withWorkspace(workspaceId, async (tx) => {
    const [shop] = await tx<ShopRow[]>`select * from armada.shops where id = ${shopId}`;
    if (!shop) return false;
    return (await startShopImages(tx, shop)) > 0 || (await pendingSlots(tx, shop.id)).size > 0;
  });
}

/**
 * "Make again" for one picture: queues a new one for the same slot, from the shop's current plan.
 * The old one stays on the shop until the new one is ready. False if it's already being made again.
 */
export async function redoShopImage(workspaceId: string, imageId: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(imageId)) return false;
  return withWorkspace(workspaceId, async (tx) => {
    const [img] = await tx<{ shopId: string; kind: ImageRow["kind"]; collectionHandle: string | null }[]>`
      select shop_id, kind, collection_handle from armada.shop_images where id = ${imageId} and live`;
    if (!img) return false;
    const [shop] = await tx<ShopRow[]>`select * from armada.shops where id = ${img.shopId}`;
    if (!shop?.blueprint.brand) return false;
    const kind: ImageSlotKind = img.kind === "og" ? "hero" : img.kind;
    const collection = kind === "collection" ? shop.blueprint.collections?.find((c) => c.handle === img.collectionHandle) : undefined;
    if (kind === "collection" && !collection) return false;
    const slot: Slot = { key: slotKey(kind, collection?.handle), kind, collection };
    if ((await pendingSlots(tx, shop.id)).has(slot.key)) return false;
    await enqueueSlot(tx, shop, slot);
    return true;
  });
}

// ---------- the helper hands a picture back ----------

export interface IncomingFile {
  name: string;
  width: number;
  height: number;
  type: string;
  data: string;
}

const MAGIC: Record<string, (b: Buffer) => boolean> = {
  "image/webp": (b) => b.length > 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP",
  "image/jpeg": (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/png": (b) => b.length > 8 && b.readUInt32BE(0) === 0x89504e47,
};

/**
 * Stores the files of a finished image job (not live yet), then finishes the job, which makes them
 * live (the handler below). Only the helper that holds the job may hand it back, only once, and only
 * with the sizes the job asked for.
 */
export async function receivePictures(
  helperId: string,
  jobId: string,
  answer: { prompt?: unknown; alt?: unknown; source?: unknown } | null,
  usage: unknown,
  files: IncomingFile[],
): Promise<"ok" | "gone" | "bad"> {
  const stored = await asSystem(async (tx) => {
    const [job] = await tx<AiJob[]>`select * from armada.ai_jobs where id = ${jobId} for update`;
    if (!job || job.status !== "running" || job.claimedBy !== helperId) return "gone" as const;
    const spec = (job.input as ImageJobInput).image;
    if (!job.kind.startsWith("images.") || job.parentType !== PARENT || !job.parentId || !spec || !OUTPUTS[spec.kind]) return "bad" as const;

    const prompt = typeof answer?.prompt === "string" ? answer.prompt.slice(0, 4000) : "";
    const alt = typeof answer?.alt === "string" ? clip(answer.alt, 200) : "";
    const rows = [];
    for (const out of OUTPUTS[spec.kind]) {
      const f = files.find((x) => x?.name === out.name);
      if (!f || typeof f.data !== "string" || !MAGIC[f.type]) return "bad" as const;
      const bytes = Buffer.from(f.data, "base64");
      if (bytes.length < 100 || bytes.length > 800_000 || !MAGIC[f.type](bytes)) return "bad" as const;
      const width = Math.round(Number(f.width));
      const height = Math.round(Number(f.height));
      if (!(width >= 16 && width <= out.width && height >= 16 && height <= out.height)) return "bad" as const;
      rows.push({ out, mime: f.type, bytes, width, height });
    }
    for (const r of rows) {
      await tx`
        insert into armada.shop_images
          (workspace_id, shop_id, job_id, kind, variant, collection_handle, prompt, alt, mime, bytes, width, height)
        values (${job.workspaceId}, ${job.parentId}, ${job.id}, ${r.out.kind}, ${r.out.variant},
                ${r.out.kind === "collection" ? spec.collection : null}, ${prompt}, ${alt}, ${r.mime}, ${r.bytes}, ${r.width}, ${r.height})`;
    }
    return "ok" as const;
  });
  if (stored !== "ok") return stored;
  await completeJob(helperId, jobId, {
    ok: true,
    output: { prompt: typeof answer?.prompt === "string" ? answer.prompt.slice(0, 4000) : "", alt: typeof answer?.alt === "string" ? answer.alt : "", source: answer?.source ?? null },
    usage,
  });
  return "ok";
}

onJobFinished("images", async (tx: Tx, job: AiJob) => {
  if (job.parentType !== PARENT || !job.parentId) return;
  const spec = (job.input as ImageJobInput).image;
  if (!spec) return;
  if (job.status !== "done") {
    // It failed for good: the slot keeps the picture it had.
    await tx`delete from armada.shop_images where job_id = ${job.id} and not live`;
    return;
  }
  const fresh = await tx<{ id: string }[]>`select id from armada.shop_images where job_id = ${job.id}`;
  if (!fresh.length) return;
  if (spec.kind === "hero") {
    await tx`delete from armada.shop_images where shop_id = ${job.parentId} and kind in ('hero', 'og') and job_id is distinct from ${job.id}`;
  } else if (spec.kind === "lifestyle") {
    await tx`delete from armada.shop_images where shop_id = ${job.parentId} and kind = 'lifestyle' and job_id is distinct from ${job.id}`;
  } else {
    await tx`
      delete from armada.shop_images
      where shop_id = ${job.parentId} and kind = 'collection' and collection_handle = ${spec.collection} and job_id is distinct from ${job.id}`;
  }
  await tx`update armada.shop_images set live = true where job_id = ${job.id}`;
  // Leftovers from runs that never finished.
  await tx`delete from armada.shop_images where shop_id = ${job.parentId} and not live and created_at < now() - interval '1 hour'`;
});

// ---------- reading ----------

export interface ShopImageSet {
  hero: { wide: ImageRow | null; tall: ImageRow | null };
  lifestyle: { wide: ImageRow | null; tall: ImageRow | null };
  og: ImageRow | null;
  collections: Record<string, ImageRow>;
}

function toSet(rows: ImageRow[]): ShopImageSet {
  const pick = (kind: ImageRow["kind"], variant: ImageRow["variant"]) => rows.find((r) => r.kind === kind && r.variant === variant) ?? null;
  const collections: Record<string, ImageRow> = {};
  for (const r of rows) if (r.kind === "collection" && r.collectionHandle) collections[r.collectionHandle] = r;
  return {
    hero: { wide: pick("hero", "wide"), tall: pick("hero", "tall") },
    lifestyle: { wide: pick("lifestyle", "wide"), tall: pick("lifestyle", "tall") },
    og: pick("og", "main"),
    collections,
  };
}

/** A shop's live pictures, for its public storefront. Once per request. */
export const storefrontImages = cache(async (shopId: string): Promise<ShopImageSet> => {
  const rows = await asSystem(
    (tx) => tx<ImageRow[]>`
      select id, shop_id, kind, variant, collection_handle, alt, width, height, created_at
      from armada.shop_images where shop_id = ${shopId} and live order by created_at desc`,
  );
  return toSet(rows);
});

/** One picture's bytes, for /api/img/<id>. Live pictures only. */
export async function imageFile(id: string): Promise<{ mime: string; bytes: Buffer } | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  const rows = await asSystem((tx) => tx<{ mime: string; bytes: Buffer }[]>`select mime, bytes from armada.shop_images where id = ${id} and live`);
  return rows[0] ?? null;
}

export interface ShopImagesView {
  shopId: string;
  hasPlan: boolean;
  /** One card per slot: what the shop has, what's being made, and what couldn't be made last time. */
  slots: { key: string; kind: ImageSlotKind; label: string; image: ImageRow | null; making: boolean; failed: boolean }[];
}

/** Everything the "Brand images" section needs for one shop. */
export async function shopImagesView(workspaceId: string, shopId: string): Promise<ShopImagesView | null> {
  if (!/^[0-9a-f-]{36}$/i.test(shopId)) return null;
  return withWorkspace(workspaceId, async (tx) => {
    const [shop] = await tx<ShopRow[]>`select * from armada.shops where id = ${shopId}`;
    if (!shop) return null;
    const rows = await tx<ImageRow[]>`
      select id, shop_id, kind, variant, collection_handle, alt, width, height, created_at
      from armada.shop_images where shop_id = ${shopId} and live order by created_at desc`;
    const set = toSet(rows);
    const pending = await pendingSlots(tx, shopId);
    // The latest finished job per slot; a failure newer than the slot's picture is shown as such.
    const last = await tx<{ slot: string; status: string; finishedAt: Date }[]>`
      select distinct on (input -> 'image' ->> 'slot') input -> 'image' ->> 'slot' as slot, status, finished_at
      from armada.ai_jobs
      where parent_type = ${PARENT} and parent_id = ${shopId} and status in ('done', 'failed')
      order by input -> 'image' ->> 'slot', finished_at desc`;
    const failedSlots = new Set(last.filter((l) => l.status === "failed").map((l) => l.slot));

    const keys = new Map<string, Slot>();
    for (const s of plannedSlots(shop.blueprint)) keys.set(s.key, s);
    if (set.lifestyle.wide) keys.set("lifestyle", { key: "lifestyle", kind: "lifestyle" });
    for (const handle of Object.keys(set.collections)) {
      const c = shop.blueprint.collections?.find((x) => x.handle === handle);
      if (c) keys.set(slotKey("collection", handle), { key: slotKey("collection", handle), kind: "collection", collection: c });
    }
    const slots = [...keys.values()].map((s) => {
      const image = s.kind === "hero" ? set.hero.wide : s.kind === "lifestyle" ? set.lifestyle.wide : (set.collections[s.collection!.handle] ?? null);
      return {
        key: s.key,
        kind: s.kind,
        label: s.kind === "hero" ? "Home page" : s.kind === "lifestyle" ? "Everyday moment" : s.collection!.title,
        image,
        making: pending.has(s.key),
        failed: failedSlots.has(s.key) && !pending.has(s.key),
      };
    });
    return { shopId, hasPlan: Boolean(shop.blueprint.brand && shop.blueprint.theme), slots };
  });
}

/** The IMAGE_CRAFT text, re-exported for checks that confirm every brief carries the rule. */
export { IMAGE_CRAFT };
