import { ImageResponse } from "next/og";
import type { Blueprint } from "@/lib/shops/types";
import { AVATAR, COVER, avatarArt, coverArt, loadGoogleFont, type ArtBrand } from "./kit-art";

// Draws a shop's profile picture or cover as a PNG. Used by app/api/social-kit (the public
// addresses Meta, TikTok and the download buttons use) and by the design harness in .shots/social.

/** The brand as the pictures need it, or null when the shop isn't built far enough to have one. */
export function artBrand(bp: Blueprint, niche: string): ArtBrand | null {
  if (!bp.brand || !bp.theme) return null;
  return {
    name: bp.brand.name || niche,
    tagline: bp.brand.tagline ?? "",
    palette: bp.theme.palette,
    displayFont: bp.theme.fonts.display,
    bodyFont: bp.theme.fonts.body,
    icon: bp.brand.monogramIcon,
  };
}

export async function kitImage(brand: ArtBrand, kind: "avatar" | "cover", headers: Record<string, string> = {}): Promise<Response> {
  if (kind === "avatar") return new ImageResponse(avatarArt(brand), { ...AVATAR, headers });
  const [display, body] = await Promise.all([
    loadGoogleFont(fetch, brand.displayFont, 600, brand.name),
    brand.tagline ? loadGoogleFont(fetch, brand.bodyFont, 400, brand.tagline) : Promise.resolve(null),
  ]);
  const fonts: { name: string; data: ArrayBuffer; weight: 400 | 600; style: "normal" }[] = [];
  if (display) fonts.push({ name: "Display", data: display, weight: 600, style: "normal" });
  if (body) fonts.push({ name: "Body", data: body, weight: 400, style: "normal" });
  return new ImageResponse(coverArt(brand, { display: Boolean(display), body: Boolean(body) }), { ...COVER, fonts, headers });
}
