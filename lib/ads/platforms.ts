import "server-only";
import { googleAds } from "@/connectors/google-ads";
import { metaAds } from "@/connectors/meta-ads";
import { tiktokAds } from "@/connectors/tiktok-ads";
import type { AdPlatform, AdPlatformKey } from "./types";

// The real ad platforms, by key. Practice ads never leave Armada, so "practice" has no connector.

const PLATFORMS: Record<Exclude<AdPlatformKey, "practice">, AdPlatform> = { meta: metaAds, google: googleAds, tiktok: tiktokAds };

export function platformFor(key: AdPlatformKey): AdPlatform | null {
  return key === "practice" ? null : PLATFORMS[key];
}

/** Where the words "Facebook and Instagram" or "Practice" come from on screen. */
export function platformLabel(key: AdPlatformKey): string {
  return key === "practice" ? "Practice" : PLATFORMS[key].name;
}
