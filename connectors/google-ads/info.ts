import type { ConnectorInfo } from "@/lib/connections/types";

// Google ads. The connection itself isn't built yet, so it stays "Coming soon" even once the settings
// exist; the steps below are what the platform admin needs ready for when it is.

const requiredEnv = ["GOOGLE_ADS_CLIENT_ID", "GOOGLE_ADS_CLIENT_SECRET", "GOOGLE_ADS_DEVELOPER_TOKEN"];

export const googleAdsInfo: ConnectorInfo & { available: () => boolean } = {
  provider: "google_ads",
  name: "Google ads",
  kind: "ads",
  blurb: "Run Google Shopping and search ads for your shops.",
  method: "redirect",
  requiredEnv,
  callbackPath: "/api/connect/google_ads/callback",
  ownerSetup: "Brand verification in Google Cloud and a Google Ads developer token (sign-up 3). Armada's side of the connection is still being built.",
  // Not built yet: stays off even when the settings are present.
  available: () => false,
};

export const googleAdsSetupSteps: string[] = [
  "Armada's side of the Google ads connection is still being built; nothing here switches it on yet.",
  "In Google Cloud, create a project, set up the sign-in consent screen and pass brand verification.",
  "Add this as an authorized redirect address: https://armada-pi.vercel.app/api/connect/google_ads/callback",
  "In a Google Ads manager account, apply for a developer token (basic access is usually approved within a few days).",
  "Put GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET and GOOGLE_ADS_DEVELOPER_TOKEN in Vercel's settings.",
];
