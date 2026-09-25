import "server-only";
import type { AdPlatform } from "@/lib/ads/types";
import { PlatformProblem } from "@/lib/ads/types";

// TikTok ads: the same shape as Meta's, not built yet. Every method reports "Coming soon" and never
// calls TikTok. When it is built, campaigns, ad groups and ads are created switched off and only a
// person's "Switch on" changes that, like Meta's (see connectors/meta-ads).

const SOON = "TikTok ads are coming soon.";

export const tiktokAds: AdPlatform = {
  key: "tiktok",
  name: "TikTok",
  async cannotLaunch() {
    return SOON;
  },
  async createPaused() {
    return { ok: false, problem: SOON, external: {}, ads: [] };
  },
  async switchOn() {
    throw new PlatformProblem(SOON);
  },
  async pause() {
    throw new PlatformProblem(SOON);
  },
  async changeBudget() {
    throw new PlatformProblem(SOON);
  },
  async readResults() {
    return { rows: [], reachTotal: null };
  },
};
