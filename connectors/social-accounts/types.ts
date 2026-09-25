// Shapes shared by the social-account connectors (Meta for Facebook Pages and Instagram, TikTok).
// Type-only, so the connectors stay free of runtime imports and the offline check can load them
// straight from source.

/** The fetch the connectors use. Real code passes globalThis.fetch; the offline check passes a fake. */
export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** Waiting between status checks. Real code waits; the offline check records the waits and returns at once. */
export type Sleep = (ms: number) => Promise<void>;

export interface SlideIn {
  imageUrl: string;
  alt: string;
}

/** What a publish came to. Mirrors lib/social/types PublishResult, plus whether the account must be connected again. */
export interface PostOutcome {
  ok: boolean;
  externalId?: string;
  url?: string;
  problem?: string;
  /** True when the platform stopped accepting Armada's access, so the account needs connecting again. */
  reconnect?: boolean;
}
