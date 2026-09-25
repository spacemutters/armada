import { ImageResponse } from "next/og";
import { luminance, mix } from "@/lib/color";
import { rgba, slideColors } from "./contrast";
import { displayWeight, fitText, isSerif, layoutFor, SLIDE_H, SLIDE_W, type Layout, type SlideLook } from "./design";
import { loadPhoto, photoFromBytes, type LoadedPhoto } from "./photo";

// Reading photos lives in ./photo.ts (no JSX, so offline checks and the ad pictures use it too).
export { loadPhoto, photoFromBytes, type LoadedPhoto };

// Draws one carousel slide as a 1080 x 1350 image, in the shop's own palette and fonts, with the
// product photo and the slide's words. No database here: the slide route loads the post and hands
// over plain values, so the offline check can draw a slide too.
//
// Photos go through sharp (installed with Next.js for its image optimizer): it turns WebP into JPEG
// (the image drawer reads only PNG and JPEG), trims and places cut-out product shots, and turns the
// finished slide into a JPEG, the one format every platform takes. Without sharp a slide is still
// drawn: PNG/JPEG photos as they are, other photos left off, and the slide served as PNG.

export interface RenderInput {
  look: SlideLook;
  n: number;
  total: number;
  headline: string;
  line: string;
  imageUrl: string | null;
  /**
   * A ChatGPT picture from the database, used instead of imageUrl: a scene (drawn full-bleed on any
   * slide) or a practice item's picture (placed like a product photo).
   */
  picture?: { bytes: Buffer; kind: "scene" | "item" } | null;
}

type SharpFn = typeof import("sharp").default;
let sharpPromise: Promise<SharpFn | null> | null = null;
function getSharp(): Promise<SharpFn | null> {
  sharpPromise ??= import("sharp").then((m) => m.default).catch(() => null);
  return sharpPromise;
}

// ---------- fonts ----------

const fontCache = new Map<string, Promise<ArrayBuffer | null>>();

/** A Google font as TTF (the drawer can't read WOFF2). Asked for without a browser's name, Google serves TTF. */
function googleFont(family: string, weight: number): Promise<ArrayBuffer | null> {
  const key = `${family}:${weight}`;
  let p = fontCache.get(key);
  if (!p) {
    p = (async () => {
      const css = await fetch(`https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}:wght@${weight}`, {
        signal: AbortSignal.timeout(8000),
      }).then((r) => (r.ok ? r.text() : ""));
      const url = /src:\s*url\((https:[^)]+)\)\s*format\(['"](?:truetype|opentype)['"]\)/.exec(css)?.[1];
      if (!url) return null;
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      return res.ok ? await res.arrayBuffer() : null;
    })().catch(() => null);
    fontCache.set(key, p);
    // A failed download is forgotten, so the next slide tries again.
    p.then((v) => {
      if (!v) fontCache.delete(key);
    });
  }
  return p;
}

type FontSpec = { name: string; data: ArrayBuffer; weight: 400 | 500; style: "normal" };

export async function loadFonts(look: SlideLook): Promise<FontSpec[]> {
  const want: [string, 400 | 500][] = [
    [look.fonts.display, displayWeight(look.fonts.display) as 400 | 500],
    [look.fonts.body, 400],
    [look.fonts.body, 500],
  ];
  const unique = want.filter(([f, w], i) => want.findIndex(([g, v]) => g === f && v === w) === i);
  const loaded = await Promise.all(unique.map(async ([name, weight]) => ({ name, weight, data: await googleFont(name, weight) })));
  return loaded.filter((f): f is { name: string; weight: 400 | 500; data: ArrayBuffer } => f.data !== null).map((f) => ({ ...f, style: "normal" as const }));
}

// ---------- photos ----------

/** Channel values from LIFT_FROM up are stretched so that LIFT_TO and above become pure white. */
const LIFT_FROM = 226;
const LIFT_TO = 246;

/**
 * The photo sized for its box, as a data address the drawer reads.
 * - "fill": crops to fill the box, keeping the most interesting part.
 * - "place": a cut-out product, trimmed, fitted inside the box with room around it, and multiplied
 *   onto `ground` so its white background becomes the slide's own colour.
 */
async function fitPhoto(photo: LoadedPhoto, w: number, h: number, mode: "fill" | "place", ground: string): Promise<string | null> {
  const sharp = await getSharp();
  if (!sharp) return photo.mime ? `data:${photo.mime};base64,${photo.bytes.toString("base64")}` : null;
  try {
    if (mode === "fill") {
      const out = await sharp(photo.bytes).flatten({ background: ground }).resize(w, h, { fit: "cover", position: "attention" }).jpeg({ quality: 90 }).toBuffer();
      return `data:image/jpeg;base64,${out.toString("base64")}`;
    }
    const pad = Math.round(Math.min(w, h) * 0.08);
    let trimmed = await sharp(photo.bytes).flatten({ background: "#ffffff" }).toBuffer();
    trimmed = await sharp(trimmed)
      .trim({ background: "#ffffff", threshold: 12 })
      .toBuffer()
      .catch(() => trimmed);
    const { data, info } = await sharp(trimmed)
      .resize(w - 2 * pad, h - 2 * pad, { fit: "contain", background: "#ffffff" })
      .extend({ top: pad, bottom: pad, left: pad, right: pad, background: "#ffffff" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    // Supplier "white" is often a little grey. Lift only the near-whites to pure white, so the edge of
    // the original photo doesn't show as a faint box once it's multiplied onto the ground.
    for (let i = 0; i < data.length; i++) {
      const v = data[i];
      if (v >= LIFT_FROM) data[i] = Math.min(255, Math.round(LIFT_FROM + ((v - LIFT_FROM) * (255 - LIFT_FROM)) / (LIFT_TO - LIFT_FROM)));
    }
    const out = await sharp({ create: { width: w, height: h, channels: 3, background: ground } })
      .composite([{ input: data, raw: { width: info.width, height: info.height, channels: info.channels }, blend: "multiply" }])
      .jpeg({ quality: 90 })
      .toBuffer();
    return `data:image/jpeg;base64,${out.toString("base64")}`;
  } catch {
    return photo.mime ? `data:${photo.mime};base64,${photo.bytes.toString("base64")}` : null;
  }
}

// ---------- drawing ----------

const M = 96; // the page margin
const META = 26; // brand name and page count
const META_H = 36;

interface Type {
  display: string;
  body: string;
  weight: number;
  serif: boolean;
}

function headlineStyle(t: Type, size: number, color: string): React.CSSProperties {
  return {
    display: "flex",
    fontFamily: t.display,
    fontWeight: t.weight,
    fontSize: size,
    lineHeight: t.serif ? 1.04 : 1.0,
    letterSpacing: Math.round(-size * (t.serif ? 0.018 : 0.032) * 10) / 10,
    color,
    textWrap: "balance",
  } as React.CSSProperties;
}

function bodyStyle(t: Type, size: number, color: string): React.CSSProperties {
  return { display: "flex", fontFamily: t.body, fontWeight: 400, fontSize: size, lineHeight: 1.36, color, textWrap: "pretty" } as React.CSSProperties;
}

function Meta({ t, brand, n, total, color, showCount = true }: { t: Type; brand: string; n: number; total: number; color: string; showCount?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", height: META_H, fontFamily: t.body, fontWeight: 500, fontSize: META, color, letterSpacing: 0.2 }}>
      <span>{brand}</span>
      {showCount ? <span>{`${n} / ${total}`}</span> : <span />}
    </div>
  );
}

const lineH = (t: Type, size: number, lines: number, serif: boolean) => Math.ceil(lines * size * (serif ? 1.04 : 1.0));
const bodyH = (size: number, lines: number) => Math.ceil(lines * size * 1.36);

/** The drawing for one slide, and the layout it used. Exported for the checks. */
export async function slideElement(input: RenderInput, photo: LoadedPhoto | null): Promise<{ element: React.ReactElement; layout: Layout }> {
  const { look, n, total } = input;
  const p = look.palette;
  const t: Type = { display: look.fonts.display, body: look.fonts.body, weight: displayWeight(look.fonts.display), serif: isSerif(look.fonts.display) };
  const radius = t.serif ? 4 : 28;
  const inner = SLIDE_W - 2 * M;

  // Cut-outs are multiplied onto a light ground; on a dark palette they sit on a light panel instead.
  const lightBackground = luminance(p.background) >= 0.45;
  const panel = luminance(p.surface) >= 0.45 ? p.surface : mix("#f3f3f0", p.accent, 0.04);
  let layout = layoutFor(n, total, photo?.kind ?? null, input.picture?.kind === "scene");
  if (layout === "still" && !lightBackground) layout = "object";

  const { page, loud, overPhoto } = slideColors(p);
  const headline = input.headline;
  const line = input.line;

  if (layout === "cover" && photo) {
    const c = overPhoto;
    const h = fitText(headline, t.display, inner, 4, 124, 72);
    const src = await fitPhoto(photo, SLIDE_W, SLIDE_H, "fill", p.surface);
    return {
      layout,
      element: (
        <div style={{ width: SLIDE_W, height: SLIDE_H, display: "flex", position: "relative", backgroundColor: c.scrim }}>
          {src ? (
            // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
            <img src={src} width={SLIDE_W} height={SLIDE_H} style={{ position: "absolute", top: 0, left: 0, width: SLIDE_W, height: SLIDE_H, objectFit: "cover" }} />
          ) : null}
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", height: 360, backgroundImage: `linear-gradient(to bottom, ${rgba(c.scrim, 0)}, ${rgba(c.scrim, c.alpha)})` }} />
            <div style={{ display: "flex", flexDirection: "column", backgroundColor: rgba(c.scrim, c.alpha), padding: `0 ${M}px ${M}px` }}>
              <Meta t={t} brand={look.brand} n={n} total={total} color={c.soft} />
              <div style={{ ...headlineStyle(t, h.size, c.text), marginTop: 40 }}>{headline}</div>
              {line ? <div style={{ ...bodyStyle(t, 36, c.text), marginTop: 30, maxWidth: 860 }}>{line}</div> : null}
            </div>
          </div>
        </div>
      ),
    };
  }

  if ((layout === "still" || layout === "object") && photo) {
    const still = layout === "still";
    const h = fitText(headline, t.display, inner, 3, still ? 96 : 76, still ? 60 : 52);
    const bodySize = still ? 34 : 32;
    const b = line ? fitText(line, t.body, inner, 4, bodySize, bodySize) : { size: bodySize, lines: 0 };
    const textH = lineH(t, h.size, h.lines, t.serif) + (line ? 26 + bodyH(bodySize, b.lines) : 0);
    const top = M * 0.75 + META_H + (still ? 24 : 48);
    const boxH = Math.max(420, SLIDE_H - top - textH - 64 - M);
    const boxW = still ? SLIDE_W : inner;
    const scene = photo.kind === "scene";
    const src = await fitPhoto(photo, boxW, boxH, scene ? "fill" : "place", still ? p.background : panel);
    return {
      layout,
      element: (
        <div style={{ width: SLIDE_W, height: SLIDE_H, display: "flex", flexDirection: "column", backgroundColor: page.ground }}>
          <div style={{ display: "flex", flexDirection: "column", padding: `${M * 0.75}px ${M}px 0` }}>
            <Meta t={t} brand={look.brand} n={n} total={total} color={page.soft} />
          </div>
          <div style={{ display: "flex", marginTop: still ? 24 : 48, marginLeft: still ? 0 : M, width: boxW, height: boxH, borderRadius: still ? 0 : radius, overflow: "hidden", backgroundColor: still ? page.ground : panel }}>
            {src ? (
              // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
              <img src={src} width={boxW} height={boxH} style={{ width: boxW, height: boxH, objectFit: "cover" }} />
            ) : null}
          </div>
          <div style={{ display: "flex", flexDirection: "column", padding: `64px ${M}px 0` }}>
            <div style={headlineStyle(t, h.size, page.text)}>{headline}</div>
            {line ? <div style={{ ...bodyStyle(t, bodySize, page.soft), marginTop: 26 }}>{line}</div> : null}
          </div>
        </div>
      ),
    };
  }

  if (layout === "statement" || layout === "close") {
    const close = layout === "close";
    const h = fitText(headline, t.display, inner, 5, close ? 112 : 136, close ? 64 : 76);
    return {
      layout,
      element: (
        <div style={{ width: SLIDE_W, height: SLIDE_H, display: "flex", flexDirection: "column", justifyContent: "space-between", backgroundColor: loud.ground, padding: `${M * 0.75}px ${M}px ${M}px` }}>
          <Meta t={t} brand={close ? "" : look.brand} n={n} total={total} color={loud.soft} />
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={headlineStyle(t, h.size, loud.text)}>{headline}</div>
            {line ? <div style={{ ...bodyStyle(t, 38, loud.soft), marginTop: 36, maxWidth: 860 }}>{line}</div> : null}
          </div>
          {close ? (
            <div style={{ display: "flex", borderTop: `2px solid ${loud.soft}`, paddingTop: 36, ...headlineStyle(t, 64, loud.text) }}>{look.brand}</div>
          ) : (
            <div style={{ display: "flex", height: 2 }} />
          )}
        </div>
      ),
    };
  }

  // "type": words only, set large, anchored low with open space above.
  const h = fitText(headline, t.display, inner, 5, 128, 68);
  return {
    layout: "type",
    element: (
      <div style={{ width: SLIDE_W, height: SLIDE_H, display: "flex", flexDirection: "column", justifyContent: "space-between", backgroundColor: page.ground, padding: `${M * 0.75}px ${M}px ${M}px` }}>
        <Meta t={t} brand={look.brand} n={n} total={total} color={page.soft} />
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", width: 72, height: 4, backgroundColor: p.accent, marginBottom: 56 }} />
          <div style={headlineStyle(t, h.size, page.text)}>{headline}</div>
          {line ? <div style={{ ...bodyStyle(t, 38, page.soft), marginTop: 36, maxWidth: 860 }}>{line}</div> : null}
        </div>
      </div>
    ),
  };
}

/** Draws the slide. JPEG when sharp is there (every platform takes it), PNG otherwise. */
export async function renderSlide(input: RenderInput): Promise<{ body: Uint8Array; type: "image/jpeg" | "image/png"; layout: Layout }> {
  const [fonts, photo] = await Promise.all([loadFonts(input.look), input.picture ? photoFromBytes(input.picture.bytes) : loadPhoto(input.imageUrl)]);
  const { element, layout } = await slideElement(input, photo);
  const image = new ImageResponse(element, { width: SLIDE_W, height: SLIDE_H, fonts: fonts.length ? fonts : undefined });
  const png = Buffer.from(await image.arrayBuffer());
  const sharp = await getSharp();
  if (!sharp) return { body: new Uint8Array(png), type: "image/png", layout };
  const jpeg = await sharp(png).jpeg({ quality: 90, chromaSubsampling: "4:4:4" }).toBuffer();
  return { body: new Uint8Array(jpeg), type: "image/jpeg", layout };
}
