// Contrast math for AI-picked palettes. Numbers decide, not taste: every text color is pushed
// until it meets its floor against what it sits on.

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: [number, number, number]): string {
  return "#" + [r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("");
}

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** Moves `fg` toward black or white (whichever gains contrast) until it reaches `min` against `bg`. */
export function ensureContrast(fg: string, bg: string, min: number): string {
  if (contrast(fg, bg) >= min) return fg;
  const target: [number, number, number] = luminance(bg) > 0.4 ? [0, 0, 0] : [255, 255, 255];
  const start = hexToRgb(fg);
  for (let t = 0.05; t <= 1.0001; t += 0.05) {
    const mixed = rgbToHex([0, 1, 2].map((i) => start[i] + (target[i] - start[i]) * t) as [number, number, number]);
    if (contrast(mixed, bg) >= min) return mixed;
  }
  return rgbToHex(target);
}

export function isHex(v: unknown): v is string {
  return typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v.trim());
}

export interface Palette {
  background: string;
  surface: string;
  ink: string;
  muted: string;
  accent: string;
  accentInk: string;
}

/** Mixes `a` toward `b` by `t` (0..1). */
export function mix(a: string, b: string, t: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return rgbToHex([0, 1, 2].map((i) => x[i] + (y[i] - x[i]) * t) as [number, number, number]);
}

/** Pure white and pure black read as defaults; tint them slightly toward the accent instead. */
function untint(hex: string, accent: string): string {
  if (hex === "#ffffff") return mix("#ffffff", accent, 0.025);
  if (hex === "#000000") return mix("#0b0b0b", accent, 0.08);
  return hex;
}

/** Makes an AI-picked palette meet the contrast floors: 7:1 body text, 4.5:1 muted text, links and buttons. */
export function fixPalette(p: Partial<Palette>): { palette: Palette; changed: string[] } {
  const changed: string[] = [];
  const rawAccent = isHex(p.accent) ? p.accent.toLowerCase() : "#1d4ed8";
  const pick = (k: keyof Palette, fallback: string) => untint(isHex(p[k]) ? (p[k] as string).toLowerCase() : fallback, rawAccent);
  const background = pick("background", "#fafaf9");
  const surface = pick("surface", "#fdfdfc");
  const base = { background, surface };

  const ink = ensureContrast(pick("ink", "#1c1917"), background, 7);
  if (ink !== pick("ink", "")) changed.push("ink");
  const muted = ensureContrast(pick("muted", "#57534e"), background, 4.5);
  if (muted !== pick("muted", "")) changed.push("muted");
  // The accent colors links on the page and fills buttons, so it needs 4.5:1 against the background.
  const accent = ensureContrast(pick("accent", "#1d4ed8"), background, 4.5);
  if (accent !== pick("accent", "")) changed.push("accent");
  let accentInk = pick("accentInk", background);
  if (contrast(accentInk, accent) < 4.5) {
    const light = mix("#fbfbf9", accent, 0.03);
    const dark = mix("#121212", accent, 0.08);
    accentInk = contrast(light, accent) >= contrast(dark, accent) ? light : dark;
    changed.push("accentInk");
  }
  return { palette: { ...base, ink, muted, accent, accentInk }, changed };
}
