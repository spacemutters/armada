import "server-only";
import { cache } from "react";
import { slugify } from "@/lib/text";
import { getShopForStorefront, type ShopProduct } from "./queries";
import type { Blueprint, ShopRow } from "./types";

export const loadStorefront = cache(getShopForStorefront);

const SERIF_DISPLAY = new Set(["Fraunces", "Instrument Serif", "DM Serif Display", "Cormorant Garamond", "Young Serif", "Bodoni Moda", "Newsreader"]);

/** The shop's palette, fonts and its one radius, as CSS variables for the storefront. */
export function storefrontVars(bp: Blueprint): React.CSSProperties {
  const p = bp.theme!.palette;
  const f = bp.theme!.fonts;
  const serif = SERIF_DISPLAY.has(f.display);
  return {
    "--s-bg": p.background,
    "--s-surface": p.surface,
    "--s-ink": p.ink,
    "--s-muted": p.muted,
    "--s-accent": p.accent,
    "--s-accent-ink": p.accentInk,
    "--s-display": `'${f.display}', ${serif ? "Georgia, serif" : "ui-sans-serif, system-ui, sans-serif"}`,
    "--s-body": `'${f.body}', ui-sans-serif, system-ui, sans-serif`,
    // One radius for everything: near-square for editorial serif brands, softer for modern ones.
    "--s-radius": serif ? "2px" : "10px",
  } as React.CSSProperties;
}

/** A practice shop's support address uses the reserved .example domain, so it can't be mistaken for a real inbox. */
export function supportEmail(bp: Blueprint): string {
  return `hello@${slugify(bp.brand?.name ?? "shop", 30)}.example`;
}

export interface StoreItem {
  handle: string;
  priceCents: number;
  collection: string;
  imagined: boolean;
  product: ShopProduct;
}

export function storeItems(shop: ShopRow, products: ShopProduct[]): StoreItem[] {
  const byId = new Map(products.map((p) => [p.id, p]));
  return (shop.blueprint.products ?? [])
    .map((ref) => {
      const product = byId.get(ref.productId);
      return product ? { handle: ref.handle, priceCents: ref.priceCents, collection: ref.collection, imagined: ref.imagined, product } : null;
    })
    .filter((x): x is StoreItem => x !== null);
}

export function shopBase(slug: string): string {
  return `/s/${slug}`;
}
