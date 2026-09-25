import { createElement as h, type ReactElement } from "react";
import type { Palette } from "@/lib/color";
import type { Fetch } from "@/connectors/social-accounts/types";
import { MONOGRAM_ICONS } from "./monogram-icons";

// The profile kit's pictures, drawn from the brand: the profile picture (the brand's icon in its
// palette, 1080 x 1080) and the Facebook cover (1640 x 924, which shows whole on phones and as its
// middle band on computers, so everything sits in that band). Plain element trees for next/og's
// ImageResponse, written without JSX so the offline check can draw them too.

export const AVATAR = { width: 1080, height: 1080 };
export const COVER = { width: 1640, height: 924 };

export interface ArtBrand {
  name: string;
  tagline: string;
  palette: Palette;
  displayFont: string;
  bodyFont: string;
  icon: string;
}

function icon(name: string, size: number, color: string, weight: number): ReactElement {
  const nodes = MONOGRAM_ICONS[name] ?? MONOGRAM_ICONS["shopping-bag"];
  return h(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: color,
      strokeWidth: weight,
      strokeLinecap: "round",
      strokeLinejoin: "round",
    },
    ...nodes.map(([tag, attrs], i) => h(tag, { key: i, ...attrs })),
  );
}

/** The profile picture: the brand's icon, thin-lined, on its accent colour. Platforms crop it to a circle, so it stays well inside one. */
export function avatarArt(b: ArtBrand): ReactElement {
  const { accent, accentInk } = b.palette;
  return h(
    "div",
    {
      style: {
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        background: accent,
      },
    },
    // A hairline ring just inside the circular crop, so the picture reads as finished at any size.
    h("div", {
      style: {
        position: "absolute",
        left: 90,
        top: 90,
        width: 900,
        height: 900,
        borderRadius: 450,
        border: `3px solid ${accentInk}`,
        opacity: 0.22,
      },
    }),
    icon(b.icon, 470, accentInk, 1.35),
  );
}

/** The Facebook cover: the brand mark, name and tagline, centred in the band every screen shows. */
export function coverArt(b: ArtBrand, fonts: { display: boolean; body: boolean }): ReactElement {
  const p = b.palette;
  const nameSize = b.name.length > 22 ? 84 : b.name.length > 14 ? 104 : 124;
  return h(
    "div",
    {
      style: {
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: p.background,
        padding: "0 160px",
      },
    },
    h(
      "div",
      {
        style: {
          width: 116,
          height: 116,
          borderRadius: 30,
          background: p.accent,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 40,
        },
      },
      icon(b.icon, 62, p.accentInk, 1.6),
    ),
    h(
      "div",
      {
        style: {
          fontFamily: fonts.display ? "Display" : undefined,
          fontSize: nameSize,
          lineHeight: 1.05,
          letterSpacing: "-0.01em",
          color: p.ink,
          textAlign: "center",
          maxWidth: 1200,
        },
      },
      b.name,
    ),
    b.tagline
      ? h(
          "div",
          {
            style: {
              fontFamily: fonts.body ? "Body" : undefined,
              fontSize: 40,
              lineHeight: 1.3,
              color: p.muted,
              textAlign: "center",
              marginTop: 26,
              maxWidth: 1100,
            },
          },
          b.tagline,
        )
      : null,
  );
}

// These ship in one weight only; asking Google Fonts for others fails the request (as lib/shops/style.ts notes).
const SINGLE_WEIGHT = new Set(["Instrument Serif", "DM Serif Display", "Young Serif"]);

/**
 * One font from Google Fonts as TrueType, cut down to the letters in `text` so it stays small.
 * Google serves TrueType when the request doesn't look like a modern browser, which is what the
 * image renderer needs (it can't read WOFF2). Null if it can't be had; the picture then uses the
 * renderer's own font.
 */
export async function loadGoogleFont(f: Fetch, family: string, weight: number, text: string): Promise<ArrayBuffer | null> {
  const w = SINGLE_WEIGHT.has(family) ? 400 : weight;
  const css = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}:wght@${w}&text=${encodeURIComponent(text)}`;
  try {
    const sheet = await (await f(css, { signal: AbortSignal.timeout(8000) })).text();
    const src = sheet.match(/src:\s*url\(([^)]+)\)\s*format\('(opentype|truetype)'\)/);
    if (!src) return null;
    const res = await f(src[1], { signal: AbortSignal.timeout(8000) });
    return res.ok ? await res.arrayBuffer() : null;
  } catch {
    return null;
  }
}
