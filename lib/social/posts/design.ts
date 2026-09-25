import type { Palette } from "@/lib/color";
import type { Blueprint } from "@/lib/shops/types";

// How a slide is laid out, decided from what's on it. Pure, so the renderer, the review page and the
// checks agree. Everything is measured on the 1080 x 1350 portrait canvas platforms use for carousels.

export const SLIDE_W = 1080;
export const SLIDE_H = 1350;
/** Bump when the drawing changes, so every slide gets a fresh address and caches let go of the old look. */
export const DESIGN_REV = 4;

export interface SlideLook {
  brand: string;
  palette: Palette;
  fonts: { display: string; body: string };
}

/**
 * - cover: a slide over a full-bleed photo (a scene), words on a veil at the bottom: the first slide
 *   with a scene-like product photo, or any slide with a ChatGPT scene.
 * - still: the first slide with a product shot on a plain ground (a cut-out), words below it.
 * - object: a later slide with a product photo in a panel and the words under it.
 * - type: a later slide with words only, set large.
 * - statement / close: the first and last slide with words only, on the shop's accent colour.
 */
/** The shop's look for its slides, or null for a shop that hasn't been designed yet. */
export function lookFromBlueprint(bp: Blueprint): SlideLook | null {
  if (!bp.theme?.palette || !bp.theme.fonts) return null;
  return { brand: bp.brand?.name ?? "", palette: bp.theme.palette, fonts: bp.theme.fonts };
}

export type Layout = "cover" | "still" | "object" | "type" | "statement" | "close";

/** Photo "scene" fills its frame edge to edge; a "cutout" (a product on white) is placed on the shop's ground. */
export type PhotoKind = "scene" | "cutout";

export function layoutFor(n: number, total: number, photo: PhotoKind | null, fullBleed = false): Layout {
  if (photo && fullBleed) return "cover";
  if (n === 1) return photo === "scene" ? "cover" : photo === "cutout" ? "still" : "statement";
  if (photo) return "object";
  return n === total ? "close" : "type";
}

const SERIF = new Set(["Fraunces", "Instrument Serif", "DM Serif Display", "Cormorant Garamond", "Young Serif", "Bodoni Moda", "Newsreader", "Source Serif 4"]);
const SINGLE_WEIGHT = new Set(["Instrument Serif", "DM Serif Display", "Young Serif"]);

export const isSerif = (font: string) => SERIF.has(font);
/** The weight a display font is drawn in (the storefront's 500, or the only weight some fonts have). */
export const displayWeight = (font: string) => (SINGLE_WEIGHT.has(font) ? 400 : 500);

// Average letter width as a share of the font size, measured roughly per family. Only used to pick
// a size that fits; a font not listed gets a middle value.
const WIDTH_EM: Record<string, number> = {
  Fraunces: 0.5,
  "Instrument Serif": 0.42,
  "DM Serif Display": 0.5,
  "Cormorant Garamond": 0.43,
  "Young Serif": 0.53,
  "Bodoni Moda": 0.49,
  Newsreader: 0.46,
  "Space Grotesk": 0.54,
  Syne: 0.6,
  Archivo: 0.52,
  "Bricolage Grotesque": 0.5,
  Sora: 0.56,
  Unbounded: 0.66,
  "Familjen Grotesk": 0.5,
  Inter: 0.53,
  "DM Sans": 0.52,
  Manrope: 0.54,
  Figtree: 0.51,
  "Work Sans": 0.54,
  Karla: 0.5,
  "Public Sans": 0.53,
  "IBM Plex Sans": 0.52,
  "Source Serif 4": 0.5,
  "Libre Franklin": 0.54,
};

export function widthEm(font: string): number {
  return WIDTH_EM[font] ?? 0.52;
}

/** Lines `text` takes when wrapped greedily at about `perLine` characters. */
export function lineCount(text: string, perLine: number): number {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return 0;
  let lines = 1;
  let used = 0;
  for (const w of words) {
    const need = used ? used + 1 + w.length : w.length;
    if (need <= perLine || !used) used = need;
    else {
      lines++;
      used = w.length;
    }
  }
  return lines;
}

/** The largest size (a step of 4px) at which `text` fits `width` in `maxLines`, and the lines it takes. */
export function fitText(text: string, font: string, width: number, maxLines: number, max: number, min: number): { size: number; lines: number } {
  const em = widthEm(font);
  for (let size = max; size >= min; size -= 4) {
    const perLine = Math.max(4, Math.floor(width / (size * em)));
    const lines = lineCount(text, perLine);
    const longest = Math.max(...text.split(/\s+/).map((w) => w.length));
    if (lines <= maxLines && longest <= perLine) return { size, lines };
  }
  const perLine = Math.max(4, Math.floor(width / (min * em)));
  return { size: min, lines: lineCount(text, perLine) };
}

/** 32-bit FNV-1a as base 36: short, stable, and different when anything drawn changes. */
export function shortHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export interface SlideWords {
  n: number;
  headline: string;
  line: string;
  imageUrl: string | null;
  /** The ChatGPT picture the slide is drawn with (a scene or a practice item's picture), if any. */
  pictureId?: string | null;
}

/** Changes whenever anything on the drawn slide changes: words, photo or picture, place in the post, or the shop's look. */
export function slideVersion(s: SlideWords, total: number, look: SlideLook): string {
  const p = look.palette;
  return shortHash(
    [DESIGN_REV, s.n, total, s.headline, s.line, s.imageUrl ?? "", s.pictureId ?? "", look.brand, p.background, p.surface, p.ink, p.muted, p.accent, p.accentInk, look.fonts.display, look.fonts.body].join(""),
  );
}

/** A slide's image address. `base` is the public origin ("https://armada-pi.vercel.app"), or "" for a same-site link. */
export function slideUrl(base: string, postId: string, n: number, version: string): string {
  return `${base.replace(/\/+$/, "")}/api/social/slide/${postId}/${n}.jpg?v=${version}`;
}

/** The slide number in an address ("2" or "2.jpg"), or null. Slides are numbered 1 to 8. */
export function slideNumber(raw: string): number | null {
  const m = /^([1-8])(?:\.(?:jpe?g|png))?$/i.exec(raw);
  return m ? Number(m[1]) : null;
}

/** What a screen reader hears for a slide on the platform. */
export function slideAlt(headline: string, line: string, productTitle: string | null): string {
  const words = [headline, line].map((t) => t.trim().replace(/[.\s]+$/, "")).filter(Boolean).join(". ");
  return (productTitle ? `${words}. Photo: ${productTitle}.` : `${words}.`).slice(0, 400);
}
