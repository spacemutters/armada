import { hasEnv, type ConnectorInfo } from "@/lib/connections/types";

// Placeholder written so the registry compiles; the connections work replaces it.
type WithAvailable = ConnectorInfo & { available: () => boolean };

const make = (info: ConnectorInfo): WithAvailable => ({ ...info, available: () => hasEnv(info.requiredEnv) });

export const adsInfos: WithAvailable[] = [
  make({
    provider: "meta_ads",
    name: "Meta ads",
    kind: "ads",
    blurb: "Run Facebook and Instagram ads for your shops.",
    method: "redirect",
    requiredEnv: ["META_APP_ID", "META_APP_SECRET", "META_ADS_APPROVED"],
    ownerSetup: "Business Verification and App Review for ads (sign-up 1).",
  }),
  make({
    provider: "google_ads",
    name: "Google ads",
    kind: "ads",
    blurb: "Run Google Shopping and search ads for your shops.",
    method: "redirect",
    requiredEnv: ["GOOGLE_ADS_CLIENT_ID", "GOOGLE_ADS_CLIENT_SECRET", "GOOGLE_ADS_DEVELOPER_TOKEN"],
    ownerSetup: "Brand verification in Google Cloud and an ads developer token (sign-up 3).",
  }),
  make({
    provider: "tiktok_ads",
    name: "TikTok ads",
    kind: "ads",
    blurb: "Run TikTok ads for your shops.",
    method: "redirect",
    requiredEnv: ["TIKTOK_APP_ID", "TIKTOK_APP_SECRET"],
    ownerSetup: "A TikTok developer profile and app (sign-up 2).",
  }),
];
