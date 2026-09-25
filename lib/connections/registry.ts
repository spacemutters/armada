import "server-only";
import { adsInfos } from "@/connectors/ads/info";
import { aliexpressInfo } from "@/connectors/aliexpress/info";
import { cjInfo } from "@/connectors/cj/info";
import { ebayInfo } from "@/connectors/ebay/info";
import { facebookInfo } from "@/connectors/meta/info";
import { shopifyInfo } from "@/connectors/shopify/info";
import type { ConnectorInfo, Provider } from "./types";

// Every connection Armada offers, in the order people see them.
export type Connector = ConnectorInfo & { available: () => boolean };

export const CONNECTORS: Connector[] = [shopifyInfo, ebayInfo, facebookInfo, cjInfo, aliexpressInfo, ...adsInfos];

export function connector(provider: Provider): Connector | undefined {
  return CONNECTORS.find((c) => c.provider === provider);
}

/** The store platforms that can open a brand-new store in one press. */
export const STORE_OPENERS = CONNECTORS.filter((c) => c.kind === "store" && c.canOpenNew);

/** The groups on the Connections page, in order. */
export const CONNECTOR_GROUPS: { kind: Connector["kind"]; title: string; about: string }[] = [
  { kind: "store", title: "Stores", about: "Where you sell. Each store you connect appears in Stores, ready to list products." },
  { kind: "supplier", title: "Supplier", about: "Where your products come from: real costs, photos and shipping times." },
  { kind: "ads", title: "Ads", about: "Where you find buyers." },
];

/**
 * Where "Connect" goes for a platform with its own sign-in: its start route, which sends the person
 * to the platform's approval page and back. Shopify also takes the store's address.
 */
export function connectHref(provider: Provider, opts: { shop?: string; returnTo?: string } = {}): string {
  const q = new URLSearchParams({ purpose: "connect" });
  if (opts.shop) q.set("shop", opts.shop);
  if (opts.returnTo) q.set("returnTo", opts.returnTo);
  return `/api/connect/${provider}/start?${q}`;
}

/** Where "Open a new store" goes for a platform that can open one. */
export function openNewHref(provider: Provider): string {
  return `/stores/new?platform=${provider}`;
}

/** Only paths on Armada's own pages are allowed as a place to come back to. */
export function safeReturnTo(value: string | null | undefined): string {
  return value === "/stores/new" || value === "/stores" || value === "/connections" ? value : "/connections";
}
