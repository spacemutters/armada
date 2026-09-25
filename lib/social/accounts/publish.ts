import { publishInstagramCarousel, publishPagePhotos } from "@/connectors/social-accounts/meta";
import { publishTikTokPhotos } from "@/connectors/social-accounts/tiktok";
import type { Fetch, PostOutcome, Sleep, SlideIn } from "@/connectors/social-accounts/types";
import type { SocialPlatform } from "@/lib/social/types";

// Sends one carousel to one account: the platform's own sequence for real accounts, a record in
// Armada for practice ones. No database and no settings here: publishCarousel in ./index.ts loads
// the account, renews access, and passes everything in, so the offline check can drive this with a
// fake fetch and see the exact sequence of calls.

export interface PublishTarget {
  platform: SocialPlatform;
  kind: "real" | "practice";
  status: "connected" | "needs_attention" | "practice";
  /** Instagram account id, Facebook Page id, or TikTok open_id. */
  externalId: string | null;
  /** Opened access: the Page's for Instagram and Facebook, the 24-hour access for TikTok. */
  access: { pageToken?: string; accessToken?: string } | null;
}

export interface PublishDeps {
  fetch: Fetch;
  sleep: Sleep;
  /** Meta's app secret, for appsecret_proof. */
  appSecret?: string;
  /** Keeps a practice post in Armada and returns its id. */
  recordPractice: (post: { caption: string; slides: SlideIn[] }) => Promise<string>;
  /** Turns a slide's address into one Instagram and TikTok can download (a JPEG at Armada's confirmed address). */
  pictureUrl: (imageUrl: string) => string;
  maxWaitMs?: number;
}

const NAME: Record<SocialPlatform, string> = { instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok" };

export async function publishTo(t: PublishTarget, post: { caption: string; slides: SlideIn[] }, deps: PublishDeps): Promise<PostOutcome> {
  const slides = (post.slides ?? []).filter((s) => s && typeof s.imageUrl === "string" && /^https?:\/\//.test(s.imageUrl));
  if (!slides.length) return { ok: false, problem: "This post has no pictures Armada can send." };
  const caption = String(post.caption ?? "");

  if (t.kind === "practice") {
    const id = await deps.recordPractice({ caption, slides });
    return { ok: true, externalId: `practice:${id}` };
  }
  if (t.status === "needs_attention") {
    return { ok: false, problem: `${NAME[t.platform]} stopped accepting Armada's access to this account. Connect it again on the social media page.` };
  }
  if (!t.externalId || !t.access) return { ok: false, problem: `This ${NAME[t.platform]} account isn't fully connected. Connect it again.` };

  const ctx = { fetch: deps.fetch, appSecret: deps.appSecret };
  const wait = { sleep: deps.sleep, maxWaitMs: deps.maxWaitMs };
  switch (t.platform) {
    case "instagram":
      if (!t.access.pageToken) return { ok: false, reconnect: true, problem: "This Instagram account isn't fully connected. Connect it again." };
      return publishInstagramCarousel(
        ctx,
        { igId: t.externalId, token: t.access.pageToken, caption, slides: slides.map((s) => ({ imageUrl: deps.pictureUrl(s.imageUrl), alt: s.alt })) },
        wait,
      );
    case "facebook":
      if (!t.access.pageToken) return { ok: false, reconnect: true, problem: "This Facebook Page isn't fully connected. Connect it again." };
      return publishPagePhotos(ctx, { pageId: t.externalId, token: t.access.pageToken, caption, slides });
    case "tiktok":
      if (!t.access.accessToken) return { ok: false, reconnect: true, problem: "This TikTok account isn't fully connected. Connect it again." };
      return publishTikTokPhotos(deps.fetch, { token: t.access.accessToken, caption, photoUrls: slides.map((s) => deps.pictureUrl(s.imageUrl)) }, wait);
  }
}
