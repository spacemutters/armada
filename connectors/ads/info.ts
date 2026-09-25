import type { ConnectorInfo, Provider } from "@/lib/connections/types";
import { googleAdsInfo, googleAdsSetupSteps } from "@/connectors/google-ads/info";
import { metaAdsInfo, metaAdsSetupSteps } from "@/connectors/meta-ads/info";
import { tiktokAdsInfo, tiktokAdsSetupSteps } from "@/connectors/tiktok-ads/info";

// Ad accounts. Each needs Armada's own app on the ad platform (Davis's sign-ups) and a connection flow
// in Armada. Meta's flow is built (app/api/connect/meta_ads), so it switches on as soon as its settings
// exist. Google's and TikTok's flows aren't built yet, so they stay "coming soon" (available() is
// false) even with settings; their connectors report "Coming soon" with the same shape as Meta's.

type WithAvailable = ConnectorInfo & { available: () => boolean };

export const adsInfos: WithAvailable[] = [metaAdsInfo, googleAdsInfo, tiktokAdsInfo];

/** What a platform admin does, step by step, to switch each ad platform on. */
export const adsSetupSteps: Partial<Record<Provider, string[]>> = {
  meta_ads: metaAdsSetupSteps,
  google_ads: googleAdsSetupSteps,
  tiktok_ads: tiktokAdsSetupSteps,
};

/** The server settings a platform still needs (names only, never values). */
export function missingSettings(info: ConnectorInfo): string[] {
  return info.requiredEnv.filter((n) => !process.env[n]);
}
