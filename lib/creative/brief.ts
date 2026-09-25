import { PICTURE_CRAFT, withCraft } from "@/lib/shops/craft";
import { PRICE_WORDS, productKinds } from "@/lib/shops/images";
import type { ShopRow } from "@/lib/shops/types";
import { clip } from "@/lib/text";
import type { AiJobInput } from "@/lib/types";

// What the image maker is told for one picture in an ad or a social post. No database here, so the
// offline check (scripts/check-creative-pictures.mjs) can build every brief.
//
// Two kinds of picture, and nothing else:
//   scene  the shop's world: a place, light, materials, the moment of use. NEVER a product the shop
//          sells: the product in an ad or post is always its real photo, placed by Armada.
//   item   a practice item (an imagined product in a practice shop, with only an illustration). Made
//          once per shop and item and used wherever that item appears, like a product photo. Only
//          practice shops get these, and practice ads never run (lib/creative/pictures.ts refuses
//          anything else, and so does the database).
//
// Usage: every picture is one run of ChatGPT's image maker on the owner's plan, so each brief is a
// few short lines (the shop's plan, the one thing this picture shows, its shape) and the craft block
// is shared (PICTURE_CRAFT in lib/shops/craft.ts).

export type PictureKind = "scene" | "item";
/** What a scene is for: a carousel card, the setting behind a single-photo ad's product, or a post's slide. */
export type SceneRole = "card" | "backdrop" | "slide";
export type PictureVariant = "square" | "portrait" | "story";

/** Job kinds. Both start with "images.", so lib/ai/config.ts sends them to the ChatGPT tool. */
export const PICTURE_JOB = { scene: "images.scene", item: "images.item" } as const;

/** The most words a scene description (written by the ad or post writer) may have in a brief. */
export const SCENE_WORDS_MAX = 30;

interface Output {
  name: PictureVariant;
  width: number;
  height: number;
  format: "webp" | "jpeg";
  maxBytes: number;
}

/**
 * The cuts each picture becomes. A scene is asked for tall (2:3) and cut three ways: square for
 * carousel cards, 4:5 for the feed and post slides, 9:16 for full-screen cards. An item is square.
 */
export const OUTPUTS: Record<PictureKind, Output[]> = {
  scene: [
    { name: "square", width: 1080, height: 1080, format: "webp", maxBytes: 220_000 },
    { name: "portrait", width: 1080, height: 1350, format: "webp", maxBytes: 240_000 },
    { name: "story", width: 1080, height: 1920, format: "webp", maxBytes: 260_000 },
  ],
  item: [{ name: "square", width: 1200, height: 1200, format: "webp", maxBytes: 240_000 }],
};

export interface SceneSpec {
  kind: "scene";
  role: SceneRole;
  /** What the picture shows, as the ad or post writer described it. */
  scene: string;
  /** Where it's used, for the brief: 'a carousel ad card headed "Slow mornings"'. */
  context: string;
}

export interface ItemSpec {
  kind: "item";
  title: string;
  facts: string[];
}

export type PictureSpec = SceneSpec | ItemSpec;

/** What the helper carries with an image job. It reads only `outputs`; the rest is for Armada. */
export interface PictureJobImage {
  kind: PictureKind;
  role: SceneRole | "item";
  /** "main", "card:<key>", "slide:<n>" or "item". */
  slot: string;
  shopId: string;
  /** The practice item shown (item pictures only). */
  productId: string | null;
  outputs: Output[];
}

export type PictureJobInput = Omit<AiJobInput, "model"> & { model?: string; image: PictureJobImage };

const SYSTEM = `You are the art director inside Armada, a tool that runs online shops. You make one picture for a shop's ad or social post with the image generation tool.

1. Write the image prompt from the brief, following the picture craft below.
2. Call the image generation tool exactly once, with that prompt.
3. Then answer: "prompt" is the exact prompt you gave the tool, and "alt" is one plain sentence of at most 20 words saying what the picture shows, for people who can't see it.
Answer only with JSON that matches the schema you are given.`;

const ANSWER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["prompt", "alt"],
  properties: { prompt: { type: "string" }, alt: { type: "string" } },
} as const;

type BriefShop = Pick<ShopRow, "niche" | "brief" | "blueprint">;

function words(s: string, max: number): string {
  const w = s.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  return w.length <= max ? w.join(" ") : `${w.slice(0, max).join(" ")}`;
}

/** The shop's plan in a few lines: the same for every picture of the shop, so a set looks like one shoot. */
function shopLines(shop: BriefShop): string[] {
  const bp = shop.blueprint;
  const p = bp.theme?.palette;
  return [
    `Shop: ${bp.brand?.name ?? "the shop"}. ${bp.brand?.tagline ?? ""}`.trim(),
    `What it sells: ${shop.niche}`,
    bp.brand?.audience ? `Who it's for: ${bp.brand.audience}` : "",
    shop.brief?.look ? `Look the owner asked for: ${shop.brief.look}` : "",
    shop.brief?.priceFeel ? `Price level: ${PRICE_WORDS[shop.brief.priceFeel]}` : "",
    p ? `Brand palette: background ${p.background}, surface ${p.surface}, ink ${p.ink}, muted ${p.muted}, accent ${p.accent}` : "",
  ].filter(Boolean);
}

/** The brief for one picture. Scenes list the shop's product kinds as things that must not appear. */
export function pictureBrief(shop: BriefShop, spec: PictureSpec): string {
  const lines = shopLines(shop);
  if (spec.kind === "item") {
    const p = shop.blueprint.theme?.palette;
    const facts = spec.facts.map((f) => clip(f, 90)).filter(Boolean).slice(0, 4).join("; ");
    return `${lines.join("\n")}

This picture is the practice item exception: an imagined product in a practice shop, which is never sold and whose ads never run. Show exactly this practice item and nothing else: "${clip(spec.title, 90)}"${facts ? ` (${facts})` : ""}.
A studio photograph: the whole item, centred, filling about two thirds of the frame, on a seamless backdrop in ${p?.surface ?? "a soft warm white"}, soft daylight from one side, a gentle shadow under it. No brand names, logos, labels or text on the item. Square 1:1.`;
  }
  const scene = words(spec.scene, SCENE_WORDS_MAX) || "a calm corner of the place these products are used, in soft morning light";
  const kinds = productKinds(shop.blueprint);
  const role =
    spec.role === "backdrop"
      ? "Keep the middle of the frame plain and uncluttered (a surface, a wall, soft shadows): Armada sets the product's real photo there on a panel."
      : "One clear subject; nothing that could be taken for something the shop sells.";
  return `${lines.join("\n")}
Product kinds this shop sells. None of these, and nothing that looks like one, may appear: ${kinds.join(", ") || shop.niche}.

This picture: ${scene}. It is ${spec.context}.
${role}
Tall 2:3 portrait.`;
}

/** One picture's job input. The model comes from lib/ai/config.ts, like every other job. */
export function pictureJobInput(shop: BriefShop, spec: PictureSpec, where: { slot: string; shopId: string; productId?: string | null }): PictureJobInput {
  return {
    system: withCraft(SYSTEM, ["picture"]),
    prompt: pictureBrief(shop, spec),
    schema: ANSWER_SCHEMA as never,
    effort: "low",
    timeoutMs: 300_000,
    image: {
      kind: spec.kind,
      role: spec.kind === "item" ? "item" : spec.role,
      slot: where.slot,
      shopId: where.shopId,
      productId: spec.kind === "item" ? (where.productId ?? null) : null,
      outputs: OUTPUTS[spec.kind].map((o) => ({ ...o })),
    },
  };
}

/**
 * The one honesty test for an item picture: only a practice shop, and only an item the shop marks as
 * imagined. Everything that queues an item picture goes through this (and the database checks it too).
 */
export function mayPictureItem(shop: Pick<ShopRow, "brief" | "blueprint">, productId: string): boolean {
  if (shop.brief?.source !== "practice") return false;
  return Boolean(shop.blueprint.products?.some((p) => p.productId === productId && p.imagined === true));
}
