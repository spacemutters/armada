import "server-only";
import type { AdPlatform } from "@/lib/ads/types";
import { PlatformProblem } from "@/lib/ads/types";

// Google ads: the same shape as Meta's, not built yet. Every method reports "Coming soon" and never
// calls Google. When it is built, campaigns are created with Google's paused status and only a
// person's "Switch on" changes that, like Meta's (see connectors/meta-ads).

const SOON = "Google ads are coming soon.";

export const googleAds: AdPlatform = {
  key: "google",
  name: "Google",
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
