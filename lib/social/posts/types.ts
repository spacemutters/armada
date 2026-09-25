import type { SocialPlatform } from "@/lib/social/types";

// Row shapes for carousel posts, as the app sees them (the database client turns snake_case into camelCase).

export type PostStatus = "draft" | "scheduled" | "posting" | "posted" | "failed";

export interface AccountResult {
  ok: boolean;
  platform: SocialPlatform;
  name: string;
  handle: string | null;
  practice: boolean;
  externalId?: string;
  url?: string;
  problem?: string;
  at: string;
}

export interface SocialPostRow {
  id: string;
  workspaceId: string;
  shopId: string;
  runId: string | null;
  status: PostStatus;
  angle: string;
  caption: string;
  hashtags: string[];
  suggestedAt: Date | null;
  scheduledAt: Date | null;
  accountIds: string[];
  results: Record<string, AccountResult>;
  problem: string | null;
  slideBase: string | null;
  edited: boolean;
  rewriting: boolean;
  postingStartedAt: Date | null;
  postedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SocialSlideRow {
  postId: string;
  workspaceId: string;
  n: number;
  headline: string;
  line: string;
  productId: string | null;
  imageUrl: string | null;
  /** A ChatGPT picture on the slide: a scene (described in `scene`), or the practice item `productId`. */
  picture: "scene" | "item" | null;
  scene: string;
  alt: string;
  updatedAt: Date;
}

/** A slide with its ChatGPT picture, if it has one: the cut it's drawn with and where making it stands. */
export interface SlideWithPicture extends SocialSlideRow {
  pictureId: string | null;
  pictureState: "ready" | "making" | "failed" | "waiting" | null;
}

export interface SocialRunRow {
  id: string;
  workspaceId: string;
  shopId: string;
  kind: "week" | "rewrite" | "product";
  postId: string | null;
  /** The product a "product" run (Make an ad with AI) is about. */
  productId: string | null;
  status: "writing" | "done" | "failed" | "cancelled";
  /** The photos the AI was offered, by short name. url is null for a practice item's picture (item: true). */
  refs: Record<string, { productId: string; url: string | null; title: string; item?: boolean }>;
  count: number;
  error: string | null;
  createdBy: string | null;
  createdAt: Date;
  finishedAt: Date | null;
}

export interface PostWithSlides extends SocialPostRow {
  slides: SlideWithPicture[];
}
