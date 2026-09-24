// The shared shape of every connection Armada offers: stores (Shopify, eBay, Facebook shops),
// the supplier (CJ) and ad accounts. Each connector describes itself with a ConnectorInfo in
// connectors/<name>/info.ts; lib/connections/registry.ts collects them for the Connections page and
// the "Open a new store" page.
//
// A connector only works once Armada's own app on that platform exists (Davis's developer
// accounts). Until its settings are present, `available()` is false: people see it as coming
// soon, and the platform admin sees what's missing.

export type Provider = "shopify" | "ebay" | "facebook" | "cj" | "meta_ads" | "google_ads" | "tiktok_ads";

export interface ConnectorInfo {
  provider: Provider;
  /** The platform's name as people know it, e.g. "Shopify". */
  name: string;
  kind: "store" | "supplier" | "ads";
  /** One plain sentence about what connecting does for them. */
  blurb: string;
  /**
   * How connecting works for the person:
   * - "redirect": one press sends them to the platform's own sign-in and approval, then back.
   * - "popup": the platform's own setup window (Meta's), then back.
   * - "key": paste a key from the platform's site (CJ has no sign-in approval for apps).
   */
  method: "redirect" | "popup" | "key";
  /** Server settings (environment variable names) Armada needs for this connector to work at all. */
  requiredEnv: string[];
  /** Where the platform sends people back to, for registering in the platform's developer console. */
  callbackPath?: string;
  /** True when this connector can open a brand-new store in one press (after the platform's own sign-up). */
  canOpenNew?: boolean;
  /** What only the Armada owner can do to switch this connector on, in plain words (shown to admins). */
  ownerSetup: string;
}

/** True when every server setting the connector needs is present. */
export function hasEnv(names: string[]): boolean {
  return names.every((n) => Boolean(process.env[n]));
}

/** The public origin used in callback addresses. */
export function appOrigin(): string {
  return (process.env.APP_ORIGIN || "https://armada-pi.vercel.app").replace(/\/$/, "");
}
