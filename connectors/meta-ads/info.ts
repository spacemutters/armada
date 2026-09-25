import { hasEnv, type ConnectorInfo } from "@/lib/connections/types";

// Facebook and Instagram ads. Switches on by itself once Armada's Meta app is approved for ads and
// its three server settings exist (META_ADS_APPROVED is set by hand after App Review passes).

const requiredEnv = ["META_APP_ID", "META_APP_SECRET", "META_ADS_APPROVED"];

export const metaAdsInfo: ConnectorInfo & { available: () => boolean } = {
  provider: "meta_ads",
  name: "Facebook and Instagram ads",
  kind: "ads",
  blurb: "Run your shops' ads in Facebook and Instagram feeds. Every ad is made switched off until you switch it on.",
  method: "redirect",
  requiredEnv,
  callbackPath: "/api/connect/meta_ads/callback",
  ownerSetup: "Armada's Meta app needs Business Verification and App Review for ads (sign-up 1), then its settings in Vercel.",
  available: () => hasEnv(requiredEnv),
};

/** Exactly what the platform admin does to switch this on, in order. */
export const metaAdsSetupSteps: string[] = [
  "In Meta for Developers, create an app of the Business type, and add the Marketing API and Facebook Login for Business to it.",
  "Under Facebook Login for Business, add this as a valid redirect address: https://armada-pi.vercel.app/api/connect/meta_ads/callback",
  "Complete Business Verification for the business that owns the app (Meta asks for company documents; it usually takes a few days).",
  "In App Review, ask for Advanced Access to ads_management, ads_read, business_management, pages_show_list, pages_read_engagement, pages_manage_ads and instagram_basic. Meta wants a screen recording: record this Ads page making practice ads, creating them paused and switching them on.",
  "Put the app's ID and secret in Vercel's settings as META_APP_ID and META_APP_SECRET (the shop connection uses the same two).",
  "Once App Review passes, add META_ADS_APPROVED = 1 in Vercel's settings and deploy. Connecting an ad account then appears on this page for everyone.",
];
