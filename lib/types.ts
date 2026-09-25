// Row shapes as the app sees them (the database client turns snake_case into camelCase).

export type Role = "owner" | "manager" | "assistant" | "viewer";

export interface Member {
  id: string;
  workspaceId: string;
  displayName: string;
  role: Role;
  sessionVersion: number;
}

export type Platform = "shopify" | "ebay" | "facebook";
export type StoreMode = "practice" | "live";
export type StoreStatus = "connected" | "disconnected" | "needs_attention" | "setting_up";

export interface Store {
  id: string;
  workspaceId: string;
  platform: Platform;
  mode: StoreMode;
  name: string;
  domain: string | null;
  currency: string;
  country: string;
  status: StoreStatus;
  groupId: string | null;
  sellerKey: string | null;
  /** An icon name from the shop builder's set; null shows as a plain square. */
  icon: string | null;
  health: Record<string, unknown>;
  meta: Record<string, unknown>;
  createdAt: Date;
}

export interface CatalogImage {
  url: string;
  alt?: string;
}

/** Practice items without a photo carry an illustration spec instead. */
export interface ItemArt {
  icon: string;
  tone: "accent" | "ink" | "muted";
}

export interface CatalogItem {
  id: string;
  workspaceId: string | null;
  source: "practice" | "cj" | "aliexpress";
  sourceId: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  images: CatalogImage[];
  costCents: number;
  shipCents: number;
  shipDaysMin: number | null;
  shipDaysMax: number | null;
  stock: number | null;
  rating: string | null;
  branded: boolean;
  retailSource: boolean;
  attributes: { art?: ItemArt; imagined?: boolean; [k: string]: unknown };
}

export interface Product {
  id: string;
  workspaceId: string;
  catalogItemId: string | null;
  title: string;
  description: string;
  bullets: string[];
  images: CatalogImage[];
  category: string;
  costCents: number;
  shipCents: number;
  seoTitle: string | null;
  seoDescription: string | null;
  score: number | null;
  scoreParts: ScoreParts | Record<string, never>;
  status: "active" | "paused" | "archived";
  createdAt: Date;
}

export interface ScorePart {
  value: number; // 0..1
  measured: boolean; // false = estimate or not checked yet
  note: string;
}

export interface ScoreParts {
  margin: ScorePart;
  demand: ScorePart;
  competition: ScorePart;
  shipping: ScorePart;
  reliability: ScorePart;
  penalty: { points: number; reasons: string[] };
  reasons: string[];
}

export type AiJobStatus = "queued" | "running" | "done" | "failed";

export interface AiJob {
  id: string;
  workspaceId: string;
  kind: string;
  status: AiJobStatus;
  input: AiJobInput;
  output: unknown;
  error: string | null;
  attempts: number;
  parentType: string | null;
  parentId: string | null;
  claimedBy: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}

/** Everything the helper needs to run one job. The helper itself knows nothing about shops. */
export interface AiJobInput {
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
  model: string;
  /** Which AI tool runs the job; set by enqueueJob from lib/ai/config.ts. Missing means claude. */
  engine?: "claude" | "codex";
  effort?: "low" | "medium" | "high";
  timeoutMs?: number;
}
