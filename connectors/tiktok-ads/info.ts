import type { ConnectorInfo } from "@/lib/connections/types";

// TikTok ads. The connection itself isn't built yet, so it stays "Coming soon" even once the settings
// exist; the steps below are what the platform admin needs ready for when it is.

const requiredEnv = ["TIKTOK_APP_ID", "TIKTOK_APP_SECRET"];

export const tiktokAdsInfo: ConnectorInfo & { available: () => boolean } = {
  provider: "tiktok_ads",
  name: "TikTok ads",
  kind: "ads",
  blurb: "Run full-screen ads between TikTok videos for your shops.",
  method: "redirect",
  requiredEnv,
  callbackPath: "/api/connect/tiktok_ads/callback",
  ownerSetup: "A TikTok for Business developer profile and an approved app (sign-up 2). Armada's side of the connection is still being built.",
  // Not built yet: stays off even when the settings are present.
  available: () => false,
};

export const tiktokAdsSetupSteps: string[] = [
  "Armada's side of the TikTok ads connection is still being built; nothing here switches it on yet.",
  "Register a TikTok for Business developer profile with a company email address and website.",
  "Create an app with the ad account management and campaign management permissions, and add this redirect address: https://armada-pi.vercel.app/api/connect/tiktok_ads/callback",
  "Wait for TikTok's app review (about three business days).",
  "Put TIKTOK_APP_ID and TIKTOK_APP_SECRET in Vercel's settings.",
];
