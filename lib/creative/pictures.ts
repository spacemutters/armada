import "server-only";
import { completeJob, enqueueJob, onJobFinished } from "@/lib/ai/jobs";
import { asSystem, type Tx } from "@/lib/db";
import type { ShopRow } from "@/lib/shops/types";
import { clip } from "@/lib/text";
import type { AiJob } from "@/lib/types";
import { mayPictureItem, OUTPUTS, PICTURE_JOB, pictureJobInput, type ItemSpec, type PictureJobImage, type PictureJobInput, type PictureVariant, type SceneSpec } from "./brief";

// ChatGPT pictures for ads and social posts: queueing, the helper handing them back, going live, and
// reading them. What each picture shows is decided by lib/ads/pictures.ts and lib/social/posts/pictures.ts;
// the rules for what ChatGPT may make are in ./brief.ts.
//
// How a picture is made (the same road as the shop's brand pictures, lib/shops/images.ts):
//   queueScene / queueItem   one job per picture (kind images.scene or images.item)
//   helper                   runs Codex with only the image tool on, cuts the picture to the sizes asked
//   /api/helper/image        receiveCreativePictures(): stores the cuts (not live yet), finishes the job
//   onJobFinished            makes the new cuts live and deletes the slot's older ones
//   /api/img/<id>            serves a cut, cached forever (a new picture always gets a new id)
//
// Pictures are made once: a slot that has one, or is being made, or couldn't be made, is left alone
// until a person presses "Make again". Jobs for an ad or post that's taken out are called off before
// the helper starts them, so nobody's ChatGPT plan pays for pictures nobody will see.

export type Owner = { type: "ad"; id: string } | { type: "post"; id: string };

/** The jobs' parent: the ad (ad_variations), the post (social_posts), or, for item pictures, the shop. */
export const PICTURE_PARENT = { ad: "ad_picture", post: "post_picture", item: "item_picture" } as const;

/** Written on a picture job that was called off because nothing needs it any more. It never counts as a failure. */
export const NOT_NEEDED = "Not needed any more.";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The key a slot is known by on the screens: "ad:<id>:<slot>", "post:<id>:<slot>" or "item:<productId>". */
export const pictureKey = {
  ad: (id: string, slot: string) => `ad:${id}:${slot}`,
  post: (id: string, slot: string) => `post:${id}:${slot}`,
  item: (productId: string) => `item:${productId}`,
};

// ---------- queueing ----------

async function pending(tx: Tx, parentType: string, parentId: string, slot: string, productId: string | null): Promise<boolean> {
  const [row] = await tx<{ n: number }[]>`
    select count(*)::int as n from armada.ai_jobs
    where parent_type = ${parentType} and parent_id = ${parentId} and status in ('queued', 'running')
      and input -> 'image' ->> 'slot' = ${slot}
      ${productId ? tx`and input -> 'image' ->> 'productId' = ${productId}` : tx``}`;
  return (row?.n ?? 0) > 0;
}

/** Queues one scene for an ad's or post's slot. False when one is already being made for it. */
export async function queueScene(tx: Tx, shop: ShopRow, owner: Owner, slot: string, spec: SceneSpec): Promise<boolean> {
  const parentType = PICTURE_PARENT[owner.type];
  if (await pending(tx, parentType, owner.id, slot, null)) return false;
  await enqueueJob(tx, {
    workspaceId: shop.workspaceId,
    kind: PICTURE_JOB.scene,
    input: pictureJobInput(shop, spec, { slot, shopId: shop.id }),
    parent: { type: parentType, id: owner.id },
  });
  return true;
}

/**
 * Queues a practice item's picture, once per shop and item. Refused (false) for anything but a
 * practice shop's imagined item: a real product is only ever shown by its real photo.
 */
export async function queueItem(tx: Tx, shop: ShopRow, productId: string, spec: Omit<ItemSpec, "kind">, opts: { again?: boolean } = {}): Promise<boolean> {
  if (!UUID.test(productId) || !mayPictureItem(shop, productId)) return false;
  if (await pending(tx, PICTURE_PARENT.item, shop.id, "item", productId)) return false;
  if (!opts.again) {
    const [live] = await tx<{ n: number }[]>`
      select count(*)::int as n from armada.creative_pictures where shop_id = ${shop.id} and product_id = ${productId} and kind = 'item' and live`;
    if (live?.n) return false;
  }
  await enqueueJob(tx, {
    workspaceId: shop.workspaceId,
    kind: PICTURE_JOB.item,
    input: pictureJobInput(shop, { kind: "item", ...spec }, { slot: "item", shopId: shop.id, productId }),
    parent: { type: PICTURE_PARENT.item, id: shop.id },
  });
  return true;
}

/**
 * Calls off an ad's or post's pictures that haven't started (all of them, or only these slots). A
 * picture already being made finishes and is kept, in case the ad is put back.
 */
export async function callOff(tx: Tx, owner: Owner, slots?: string[]): Promise<void> {
  if (slots && !slots.length) return;
  await tx`
    update armada.ai_jobs set status = 'failed', error = ${NOT_NEEDED}, finished_at = now()
    where parent_type = ${PICTURE_PARENT[owner.type]} and parent_id = ${owner.id} and status = 'queued'
      ${slots ? tx`and input -> 'image' ->> 'slot' in ${tx(slots)}` : tx``}`;
}

/** Deletes an ad's or post's pictures (all, or only these slots), after calling off any not started. */
export async function dropPictures(tx: Tx, owner: Owner, slots?: string[]): Promise<void> {
  if (slots && !slots.length) return;
  await callOff(tx, owner, slots);
  const col = owner.type === "ad" ? "ad_variation_id" : "post_id";
  await tx`delete from armada.creative_pictures where ${tx(col)} = ${owner.id} ${slots ? tx`and slot in ${tx(slots)}` : tx``}`;
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

/** True for the job kinds this module makes. /api/helper/image sends those here. */
export function isCreativeKind(kind: string): boolean {
  return kind === PICTURE_JOB.scene || kind === PICTURE_JOB.item;
}

/**
 * Stores the cuts of a finished picture job (not live yet), then finishes the job, which makes them
 * live. Only the helper holding the job may hand it back, only once, and only with the sizes asked
 * for. If the ad or post is gone by now, the job is finished and nothing is stored.
 */
export async function receiveCreativePictures(
  helperId: string,
  jobId: string,
  answer: { prompt?: unknown; alt?: unknown; source?: unknown } | null,
  usage: unknown,
  files: IncomingFile[],
): Promise<"ok" | "gone" | "bad"> {
  const stored = await asSystem(async (tx) => {
    const [job] = await tx<AiJob[]>`select * from armada.ai_jobs where id = ${jobId} for update`;
    if (!job || job.status !== "running" || job.claimedBy !== helperId) return "gone" as const;
    const spec = (job.input as PictureJobInput).image as PictureJobImage | undefined;
    if (!isCreativeKind(job.kind) || !spec || !OUTPUTS[spec.kind] || !job.parentId) return "bad" as const;
    const expected = spec.kind === "item" ? PICTURE_PARENT.item : null;
    if (expected ? job.parentType !== expected : job.parentType !== PICTURE_PARENT.ad && job.parentType !== PICTURE_PARENT.post) return "bad" as const;

    // Whose picture it is, if they're still there.
    let owner: { shopId: string; ad: string | null; post: string | null; product: string | null } | null = null;
    if (job.parentType === PICTURE_PARENT.ad) {
      const [r] = await tx<{ shopId: string }[]>`
        select s.shop_id from armada.ad_variations v join armada.ad_sets s on s.id = v.ad_set_id where v.id = ${job.parentId}`;
      if (r) owner = { shopId: r.shopId, ad: job.parentId, post: null, product: null };
    } else if (job.parentType === PICTURE_PARENT.post) {
      const [r] = await tx<{ shopId: string }[]>`select shop_id from armada.social_posts where id = ${job.parentId}`;
      if (r) owner = { shopId: r.shopId, ad: null, post: job.parentId, product: null };
    } else {
      const [shop] = await tx<ShopRow[]>`select * from armada.shops where id = ${job.parentId}`;
      if (shop && spec.productId && mayPictureItem(shop, spec.productId)) owner = { shopId: shop.id, ad: null, post: null, product: spec.productId };
    }
    if (!owner) return "orphan" as const;

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
      rows.push({ variant: out.name, mime: f.type, bytes, width, height });
    }
    for (const r of rows) {
      await tx`
        insert into armada.creative_pictures
          (workspace_id, shop_id, ad_variation_id, post_id, product_id, slot, kind, variant, job_id, prompt, alt, mime, bytes, width, height)
        values (${job.workspaceId}, ${owner.shopId}, ${owner.ad}, ${owner.post}, ${owner.product}, ${spec.kind === "item" ? "item" : spec.slot},
                ${spec.kind}, ${r.variant}, ${job.id}, ${prompt}, ${alt}, ${r.mime}, ${r.bytes}, ${r.width}, ${r.height})`;
    }
    return "ok" as const;
  });
  if (stored === "gone" || stored === "bad") return stored;
  await completeJob(helperId, jobId, {
    ok: true,
    output: {
      prompt: typeof answer?.prompt === "string" ? answer.prompt.slice(0, 4000) : "",
      alt: typeof answer?.alt === "string" ? answer.alt : "",
      source: answer?.source ?? null,
      ...(stored === "orphan" ? { note: "The ad or post was gone, so the picture wasn't kept." } : {}),
    },
    usage,
  });
  return "ok";
}

async function finished(tx: Tx, job: AiJob) {
  const spec = (job.input as PictureJobInput).image as PictureJobImage | undefined;
  if (!spec || !job.parentId) return;
  if (job.status !== "done") {
    // It failed for good: the slot keeps the picture it had.
    await tx`delete from armada.creative_pictures where job_id = ${job.id} and not live`;
    return;
  }
  const fresh = await tx<{ id: string; shopId: string }[]>`select id, shop_id from armada.creative_pictures where job_id = ${job.id}`;
  if (!fresh.length) return;
  if (job.parentType === PICTURE_PARENT.ad) {
    await tx`delete from armada.creative_pictures where ad_variation_id = ${job.parentId} and slot = ${spec.slot} and job_id is distinct from ${job.id}`;
  } else if (job.parentType === PICTURE_PARENT.post) {
    await tx`delete from armada.creative_pictures where post_id = ${job.parentId} and slot = ${spec.slot} and job_id is distinct from ${job.id}`;
  } else if (spec.productId) {
    await tx`
      delete from armada.creative_pictures
      where shop_id = ${job.parentId} and product_id = ${spec.productId} and kind = 'item' and job_id is distinct from ${job.id}`;
  }
  await tx`update armada.creative_pictures set live = true where job_id = ${job.id}`;
  // Leftovers from runs that never finished.
  await tx`delete from armada.creative_pictures where shop_id = ${fresh[0].shopId} and not live and created_at < now() - interval '1 hour'`;
}

onJobFinished(PICTURE_JOB.scene, finished);
onJobFinished(PICTURE_JOB.item, finished);

// ---------- reading ----------

export interface Cut {
  id: string;
  width: number;
  height: number;
}

/** One slot's pictures and where making them stands. */
export interface SlotState {
  cuts: Partial<Record<PictureVariant, Cut>>;
  alt: string;
  /** A picture is being made (a first one, or a new one to replace the one shown). */
  making: boolean;
  /** The last try couldn't make it (it keeps the picture it had, if any). */
  failed: boolean;
  /** Anything was ever asked for this slot, apart from jobs called off. */
  tried: boolean;
  /** The last try failed only because the AI couldn't be reached (ChatGPT down), long enough ago to ask again. */
  retry: boolean;
}

/** Failures that aren't the picture's fault: ChatGPT (or the helper's path to it) wasn't answering. */
export const AI_DOWN = /isn't signed in|isn't answering|took too long to answer|Couldn't start the ChatGPT tool/i;
/** How long after such a failure a picture is asked for again, so an outage isn't hammered. */
export const RETRY_AFTER_MS = 15 * 60_000;

/**
 * Whether a slot should be asked for (again): nothing was ever asked, or the last try failed only
 * because the AI was down a while ago. Slots with a picture, or being made, are left alone.
 */
export const needsAsking = (s: SlotState | undefined): boolean =>
  !s || (!s.making && !Object.keys(s.cuts).length && (!s.tried || s.retry));

export type PictureIndex = Map<string, SlotState>;

const blank = (): SlotState => ({ cuts: {}, alt: "", making: false, failed: false, tried: false, retry: false });

/** Everything known about the pictures of these ads, posts and practice items (one shop). */
export async function pictureIndex(tx: Tx, q: { shopId: string; adIds?: string[]; postIds?: string[]; itemIds?: string[] }): Promise<PictureIndex> {
  const adIds = (q.adIds ?? []).filter((x) => UUID.test(x));
  const postIds = (q.postIds ?? []).filter((x) => UUID.test(x));
  const itemIds = (q.itemIds ?? []).filter((x) => UUID.test(x));
  const index: PictureIndex = new Map();
  if (!adIds.length && !postIds.length && !itemIds.length) return index;
  const none = "00000000-0000-0000-0000-000000000000";
  const rows = await tx<{ id: string; adVariationId: string | null; postId: string | null; productId: string | null; slot: string; variant: PictureVariant; alt: string; width: number; height: number }[]>`
    select id, ad_variation_id, post_id, product_id, slot, variant, alt, width, height from armada.creative_pictures
    where live and (
      ad_variation_id in ${tx(adIds.length ? adIds : [none])}
      or post_id in ${tx(postIds.length ? postIds : [none])}
      or (kind = 'item' and shop_id = ${q.shopId} and product_id in ${tx(itemIds.length ? itemIds : [none])})
    )
    order by created_at desc`;
  const keyOf = (r: { adVariationId: string | null; postId: string | null; productId: string | null; slot: string }) =>
    r.adVariationId ? pictureKey.ad(r.adVariationId, r.slot) : r.postId ? pictureKey.post(r.postId, r.slot) : pictureKey.item(r.productId as string);
  for (const r of rows) {
    const k = keyOf(r);
    const s = index.get(k) ?? blank();
    if (!s.cuts[r.variant]) s.cuts[r.variant] = { id: r.id, width: r.width, height: r.height };
    s.alt ||= r.alt;
    index.set(k, s);
  }

  const jobs = await tx<{ parentType: string; parentId: string; slot: string | null; productId: string | null; status: string; error: string | null; finishedAt: Date | null }[]>`
    select parent_type, parent_id, input -> 'image' ->> 'slot' as slot, input -> 'image' ->> 'productId' as product_id, status, error, finished_at
    from armada.ai_jobs
    where (parent_type = ${PICTURE_PARENT.ad} and parent_id in ${tx(adIds.length ? adIds : [none])})
       or (parent_type = ${PICTURE_PARENT.post} and parent_id in ${tx(postIds.length ? postIds : [none])})
       or (parent_type = ${PICTURE_PARENT.item} and parent_id = ${itemIds.length ? q.shopId : none})
    order by created_at desc`;
  const seen = new Set<string>();
  for (const j of jobs) {
    if (!j.slot) continue;
    const k =
      j.parentType === PICTURE_PARENT.ad ? pictureKey.ad(j.parentId, j.slot) : j.parentType === PICTURE_PARENT.post ? pictureKey.post(j.parentId, j.slot) : j.productId ? pictureKey.item(j.productId) : null;
    if (!k || (j.parentType === PICTURE_PARENT.item && !itemIds.includes(j.productId ?? ""))) continue;
    const called = j.status === "failed" && j.error === NOT_NEEDED;
    const s = index.get(k) ?? blank();
    if (!called) s.tried = true;
    if (!seen.has(k)) {
      // The newest job decides what's happening now.
      seen.add(k);
      s.making = j.status === "queued" || j.status === "running";
      s.failed = j.status === "failed" && !called;
      s.retry = s.failed && AI_DOWN.test(j.error ?? "") && (!j.finishedAt || Date.now() - new Date(j.finishedAt).getTime() >= RETRY_AFTER_MS);
    }
    index.set(k, s);
  }
  return index;
}

/** One picture cut's bytes, for /api/img/<id> and the ad pictures. Live pictures only. */
export async function creativeFile(id: string): Promise<{ mime: string; bytes: Buffer } | null> {
  if (!UUID.test(id)) return null;
  const rows = await asSystem((tx) => tx<{ mime: string; bytes: Buffer }[]>`select mime, bytes from armada.creative_pictures where id = ${id} and live`);
  return rows[0] ?? null;
}
