// The contract between a shop's social accounts (lib/social/accounts, connect flows) and the posts
// Armada makes for them (lib/social/posts, carousel posts). Accounts own the tokens; posts ask for a
// publisher and never see a token.

export type SocialPlatform = "instagram" | "facebook" | "tiktok" | "pinterest";

export interface SocialAccount {
  id: string;
  workspaceId: string;
  /** The shop this account posts for. */
  shopId: string;
  platform: SocialPlatform;
  /** The page or profile name as people see it. */
  name: string;
  handle: string | null;
  /** "connected", "needs_attention" (the platform stopped accepting it), or "practice" (a simulated account). */
  status: "connected" | "needs_attention" | "practice";
  /** Whether the platform lets Armada publish a multi-image (carousel) post to it. */
  canPostCarousel: boolean;
}

/** One slide of a carousel: an image Armada renders, plus its alt text. */
export interface Slide {
  imageUrl: string;
  alt: string;
}

export interface PublishResult {
  ok: boolean;
  /** The platform's id for the post, and a link to it when there is one. */
  externalId?: string;
  url?: string;
  /** A plain sentence when it didn't go out. */
  problem?: string;
}

/**
 * Implemented by lib/social/accounts: publishes a carousel to one connected account. Practice
 * accounts "publish" instantly without leaving Armada.
 */
export type PublishCarousel = (workspaceId: string, accountId: string, post: { caption: string; slides: Slide[] }) => Promise<PublishResult>;
