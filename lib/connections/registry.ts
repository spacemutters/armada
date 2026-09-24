import "server-only";
import { adsInfos } from "@/connectors/ads/info";
import { cjInfo } from "@/connectors/cj/info";
import { ebayInfo } from "@/connectors/ebay/info";
import { facebookInfo } from "@/connectors/meta/info";
import { shopifyInfo } from "@/connectors/shopify/info";
import type { ConnectorInfo, Provider } from "./types";

// Every connection Armada offers, in the order people see them.
export type Connector = ConnectorInfo & { available: () => boolean };

export const CONNECTORS: Connector[] = [shopifyInfo, ebayInfo, facebookInfo, cjInfo, ...adsInfos];

export function connector(provider: Provider): Connector | undefined {
  return CONNECTORS.find((c) => c.provider === provider);
}

/** The store platforms that can open a brand-new store in one press. */
export const STORE_OPENERS = CONNECTORS.filter((c) => c.kind === "store" && c.canOpenNew);
