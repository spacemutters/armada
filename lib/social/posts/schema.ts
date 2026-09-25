import { z } from "zod";

// The shape of the AI's answer for a "social.carousel" job, and a lenient reader for it. The reader
// trims and caps lengths, drops what it can't trust (a photo name it wasn't offered, a hashtag that
// promises a sale) and keeps the rest, so one sloppy field never throws away a whole week.
// No project imports: the offline check (scripts/check-social-posts.mjs) loads this file directly.

/** Posts in "a week of posts". */
export const POSTS_PER_WEEK = 5;
/** "Make an ad with AI" on a product: this many carousel ads about that one product. */
export const POSTS_PER_PRODUCT = 3;
/** A carousel has at least four slides (what people expect of an Instagram carousel) and at most eight. */
export const MIN_SLIDES = 4;
export const MAX_SLIDES = 8;
/** Slides whose picture ChatGPT makes (a scene, never a product). Each is one picture on the owner's plan. */
export const MAX_SCENES_PER_POST = 2;
/** The longest scene description kept. */
export const SCENE_MAX = 200;
export const MIN_HASHTAGS = 3;
export const MAX_HASHTAGS = 8;
/** Photos offered per product; suppliers' later photos are mostly size charts and banners. */
export const PHOTOS_PER_PRODUCT = 3;

export const HEADLINE_MAX = 64;
export const LINE_MAX = 150;
export const CAPTION_MAX = 1500;
export const ANGLE_MAX = 110;

const str = { type: "string" } as const;

/** The JSON schema the AI answers in. `photoKeys` are the only photo names it may use, plus "scene" and "none". */
export function carouselSchema(photoKeys: string[], count: number) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["posts"],
    properties: {
      posts: {
        type: "array",
        minItems: count,
        maxItems: count,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["angle", "slides", "caption", "hashtags", "day", "time"],
          properties: {
            angle: str,
            slides: {
              type: "array",
              minItems: MIN_SLIDES,
              maxItems: MAX_SLIDES,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["headline", "line", "photo", "scene"],
                properties: {
                  headline: str,
                  line: str,
                  photo: { type: "string", enum: ["none", "scene", ...photoKeys] },
                  scene: str,
                },
              },
            },
            caption: str,
            hashtags: { type: "array", minItems: MIN_HASHTAGS, maxItems: MAX_HASHTAGS, items: str },
            day: { type: "integer", minimum: 1, maximum: 7 },
            time: str,
          },
        },
      },
    },
  } as const;
}

// ---------- tidying the AI's words ----------

const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}\u{20E3}]/gu;

/** One line of slide text: no emoji, no exclamation marks, single spaces, capped at a word boundary. */
export function tidyLine(s: string, max: number): string {
  const t = s
    .replace(EMOJI, "")
    .replace(/!+/g, ".")
    .replace(/\.{2,}/g, ".")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;:])/g, "$1")
    .trim();
  return clipWords(t, max);
}

/** A caption: the same rules, but paragraphs are kept (at most one blank line between them). */
export function tidyCaption(s: string, max = CAPTION_MAX): string {
  const paras = s
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((p) =>
      p
        .split("\n")
        .map((l) => tidyLine(l, max))
        .filter(Boolean)
        .join("\n"),
    )
    .filter(Boolean);
  // Hashtags belong in their own list; drop any the AI also put at the end of the caption.
  const body = paras.join("\n\n").replace(/(?:\s*#[\p{L}\p{N}_]+)+\s*$/u, "").trim();
  return body.length <= max ? body : clipWords(body, max);
}

export function clipWords(t: string, max: number): string {
  if (t.length <= max) return t;
  const cut = t.slice(0, max + 1);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : t.slice(0, max)).replace(/[\s,;:.-]+$/, "");
}

// Hashtags that promise a sale, a freebie or urgency are dropped: the shop can't stand behind them.
const PROMISE_TAGS =
  /^(sale|sales|onsale|discount\w*|deal|deals|dealoftheday|giveaway\w*|free\w*|promo\w*|coupon\w*|limited\w*|lastchance|bestseller\w*|musthave\w*|clearance|blackfriday|cybermonday|flashsale|shopnow|buynow|ad|ads|sponsored)$/i;

/** Hashtags without their # sign: letters, digits and underscores only, no repeats, no sales talk. */
export function normalizeHashtags(input: string[] | string, max = MAX_HASHTAGS): string[] {
  const raw = Array.isArray(input) ? input : input.split(/[\s,]+/);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    const t = String(r).normalize("NFKC").replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, "");
    if (!t || t.length > 40 || /^\d+$/.test(t) || PROMISE_TAGS.test(t)) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

/** "18:30", "6:30 pm", "6pm" → [18, 30]. Anything unreadable → the evening default. */
export function readClock(s: string, fallback: [number, number] = [18, 0]): [number, number] {
  const m = /^\s*(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)?\s*$/i.exec(s ?? "");
  if (!m) return fallback;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const ap = m[3]?.toLowerCase().replace(/\./g, "");
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  if (h > 23 || min > 59) return fallback;
  return [h, min];
}

// ---------- reading the answer ----------

export interface ReadSlide {
  headline: string;
  line: string;
  /** A photo name from the offered list, or null. */
  photo: string | null;
  /** What a scene slide's ChatGPT picture shows (never a product), or null. */
  scene: string | null;
}

export interface ReadPost {
  angle: string;
  slides: ReadSlide[];
  caption: string;
  hashtags: string[];
  /** 1 = tomorrow ... 7 = a week from today, in the shoppers' time. */
  day: number;
  hour: number;
  minute: number;
}

const Slide = z.object({
  headline: z.string().catch(""),
  line: z.string().catch(""),
  photo: z.string().catch("none"),
  scene: z.string().catch(""),
});

const Post = z.object({
  angle: z.string().catch(""),
  slides: z.array(z.unknown()).catch([]),
  caption: z.string().catch(""),
  hashtags: z.array(z.unknown()).catch([]),
  day: z.coerce.number().catch(1),
  time: z.string().catch("18:00"),
});

const Answer = z.object({ posts: z.array(z.unknown()) });

/**
 * Reads the AI's answer. Returns the posts it can use (never more than `count`) and plain notes on
 * what it had to leave out. A post with fewer than three usable slides is left out entirely.
 */
export function readCarouselAnswer(output: unknown, photoKeys: Iterable<string>, count: number): { posts: ReadPost[]; notes: string[] } {
  const keys = new Set(photoKeys);
  const notes: string[] = [];
  const parsed = Answer.safeParse(output);
  if (!parsed.success) return { posts: [], notes: ["The answer had no list of posts."] };
  const posts: ReadPost[] = [];
  for (const [i, rawPost] of parsed.data.posts.entries()) {
    if (posts.length >= count) break;
    const p = Post.safeParse(rawPost);
    if (!p.success) {
      notes.push(`Post ${i + 1} wasn't readable.`);
      continue;
    }
    const slides: ReadSlide[] = [];
    let unknownPhotos = 0;
    let scenes = 0;
    let extraScenes = 0;
    for (const rawSlide of p.data.slides.slice(0, MAX_SLIDES)) {
      const s = Slide.safeParse(rawSlide);
      if (!s.success) continue;
      const headline = tidyLine(s.data.headline, HEADLINE_MAX);
      if (!headline) continue;
      const wanted = s.data.photo.trim();
      const photo = keys.has(wanted) ? wanted : null;
      let scene: string | null = null;
      if (!photo && wanted.toLowerCase() === "scene") {
        // At most MAX_SCENES_PER_POST pictures made per post; any more stay words only.
        const text = clipWords(tidyLine(s.data.scene, SCENE_MAX * 2), SCENE_MAX);
        if (text && scenes < MAX_SCENES_PER_POST) {
          scene = text;
          scenes++;
        } else if (text) extraScenes++;
      } else if (!photo && wanted && wanted.toLowerCase() !== "none") unknownPhotos++;
      slides.push({ headline, line: tidyLine(s.data.line, LINE_MAX), photo, scene });
    }
    if (unknownPhotos) notes.push(`Post ${i + 1} named ${unknownPhotos === 1 ? "a photo" : `${unknownPhotos} photos`} it wasn't offered; ${unknownPhotos === 1 ? "that slide is" : "those slides are"} text only.`);
    if (extraScenes) notes.push(`Post ${i + 1} asked for more than ${MAX_SCENES_PER_POST} scenes; the extra ${extraScenes === 1 ? "slide is" : "slides are"} words only.`);
    if (slides.length < MIN_SLIDES) {
      notes.push(`Post ${i + 1} had fewer than ${MIN_SLIDES} usable slides, so it was left out.`);
      continue;
    }
    const [hour, minute] = readClock(p.data.time);
    const day = Number.isFinite(p.data.day) ? Math.min(7, Math.max(1, Math.round(p.data.day))) : 1;
    posts.push({
      angle: tidyLine(p.data.angle, ANGLE_MAX) || slides[0].headline,
      slides,
      caption: tidyCaption(p.data.caption),
      hashtags: normalizeHashtags(p.data.hashtags.map((h) => String(h))),
      day,
      hour,
      minute,
    });
  }
  return { posts, notes };
}

/** The caption as it goes out: the words, a blank line, then the hashtags. */
export function fullCaption(caption: string, hashtags: string[]): string {
  const tags = hashtags.map((h) => `#${h}`).join(" ");
  return [caption.trim(), tags].filter(Boolean).join("\n\n");
}
