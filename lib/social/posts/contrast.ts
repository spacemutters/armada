import { contrast, ensureContrast, luminance, mix, type Palette } from "@/lib/color";

// Text on slides must read at 4.5:1 or better, including words set over a product photo. Over a
// photo nothing is known about the pixels behind a letter, so the check assumes the worst: the
// scrim (a veil of one colour at some opacity) is tested over pure black and pure white. Blending is
// linear in each channel and luminance rises with each channel, so every photo pixel lands between
// those two results; if the text passes against both ends, it passes against any photo.

export const TEXT_MIN = 4.5;

/** What a veil of `scrim` at `alpha` (0..1) looks like over `under`. */
export function over(scrim: string, alpha: number, under: string): string {
  return mix(under, scrim, alpha);
}

/** The lowest contrast `text` can have over any photo under a `scrim` veil at `alpha`. */
export function worstContrastOverPhoto(text: string, scrim: string, alpha: number): number {
  const dark = over(scrim, alpha, "#000000");
  const light = over(scrim, alpha, "#ffffff");
  const lt = luminance(text);
  const [lo, hi] = [luminance(dark), luminance(light)].sort((a, b) => a - b);
  // Text whose own brightness falls inside the veil's range can meet a pixel of its own colour.
  if (lt >= lo && lt <= hi) return 1;
  return Math.min(contrast(text, dark), contrast(text, light));
}

/** The least veil opacity (to 0.01) that keeps `text` at `min` over any photo, or null if none can. */
export function scrimAlpha(text: string, scrim: string, min = TEXT_MIN): number | null {
  for (let i = 0; i <= 100; i++) {
    const a = i / 100;
    if (worstContrastOverPhoto(text, scrim, a) >= min) return a;
  }
  return null;
}

export interface OverPhotoColors {
  /** The veil colour and its opacity. */
  scrim: string;
  alpha: number;
  /** Headline and body words. */
  text: string;
  /** Quieter words (the brand name, the page count), still at 4.5:1 over any photo. */
  soft: string;
  /** The measured worst case for each, for the checks. */
  worstText: number;
  worstSoft: number;
}

/**
 * Colours for words over a photo, from the shop's palette: the darker of ink and background becomes
 * the veil, the lighter one the words. The veil is the least that passes plus a small margin, so the
 * photo still shows through above the words.
 */
export function overPhotoColors(p: Palette, margin = 0.04): OverPhotoColors {
  const [scrim, text0] = luminance(p.ink) < luminance(p.background) ? [p.ink, p.background] : [p.background, p.ink];
  // A palette whose ink and background are too close can't carry words over a photo; fall back to
  // near-black under near-white.
  const usable = contrast(text0, scrim) >= TEXT_MIN + 1;
  const veil = usable ? scrim : mix("#0b0b0b", p.accent, 0.08);
  const text = usable ? text0 : mix("#fbfbf9", p.accent, 0.03);
  const least = scrimAlpha(text, veil) ?? 1;
  const alpha = Math.min(0.95, Math.round((least + margin) * 100) / 100);
  let soft = mix(text, veil, 0.22);
  if (worstContrastOverPhoto(soft, veil, alpha) < TEXT_MIN) soft = text;
  return {
    scrim: veil,
    alpha,
    text,
    soft,
    worstText: worstContrastOverPhoto(text, veil, alpha),
    worstSoft: worstContrastOverPhoto(soft, veil, alpha),
  };
}

export interface SolidColors {
  ground: string;
  /** Headlines and body words. */
  text: string;
  /** Quieter words. */
  soft: string;
}

/**
 * `fg`, moved toward black or white until it reaches `min` on `bg`. lib/color's ensureContrast picks
 * the direction from the ground's brightness alone, which on a mid grey can head for white and never
 * get there; this tries the other direction too, and falls back to whichever extreme reads best.
 */
export function readableOn(fg: string, bg: string, min = TEXT_MIN): string {
  const first = ensureContrast(fg, bg, min);
  if (contrast(first, bg) >= min) return first;
  for (const target of ["#000000", "#ffffff"]) {
    for (let t = 0.05; t <= 1.0001; t += 0.05) {
      const c = mix(fg, target, t);
      if (contrast(c, bg) >= min) return c;
    }
  }
  return contrast("#000000", bg) >= contrast("#ffffff", bg) ? "#000000" : "#ffffff";
}

/** Words on a solid ground, each pushed until it reaches 4.5:1 on that ground. */
export function solidColors(ground: string, text: string, soft: string): SolidColors {
  return { ground, text: readableOn(text, ground), soft: readableOn(soft, ground) };
}

/**
 * Every colour pairing a slide uses, from the shop's palette:
 * - page: words on the shop's background (later slides with a photo panel, or words only),
 * - loud: words on the shop's accent (the words-only first and last slides),
 * - overPhoto: words on a veil over a full-bleed photo (a first slide with a scene photo).
 */
export function slideColors(p: Palette): { page: SolidColors; loud: SolidColors; overPhoto: OverPhotoColors } {
  return {
    page: solidColors(p.background, p.ink, p.muted),
    loud: solidColors(p.accent, p.accentInk, mix(p.accentInk, p.accent, 0.22)),
    overPhoto: overPhotoColors(p),
  };
}

/** A colour as rgba() with an opacity, for gradients. */
export function rgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
