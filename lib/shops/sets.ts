// Sets and "goes well with" pairs for a shop, the pure rules (no server imports, so the bag in the
// browser and the tests use the same code).
//
// Honest by construction, because the words shoppers see are all true:
// - A set's price is the shop's own prices for its items added up, less SET_DISCOUNT, rounded down.
//   "Together $X, $Y separately" is always the real sum; there is no invented "was" price.
// - Pairs say why the two go together, in the AI's words, from the products' own facts. They're
//   never called "frequently bought together" or "popular": the shop has no data that says so.
// - The AI only picks from the shop's products by their handles; anything else is dropped.

/** How much less a set costs than its items bought one by one. */
export const SET_DISCOUNT = 0.1;
export const MAX_SETS = 3;
export const MAX_PAIRS_PER_PRODUCT = 2;

export interface ShopSet {
  handle: string;
  title: string;
  why: string;
  productHandles: string[];
  /** What the set costs. */
  priceCents: number;
  /** What its items cost bought separately, at the shop's own prices. */
  separateCents: number;
}

/** Each product's handle → up to two others that go with it, and why. */
export type Pairings = Record<string, { handle: string; why: string }[]>;

const clean = (s: unknown, max: number) =>
  String(s ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "set";

/**
 * A set's price: the real sum less the discount, rounded down the way the shop prices (to the dollar
 * less a cent, or to a round $5 for a premium brand). Always below the sum.
 */
export function setPrice(separateCents: number, round: "cents" | "whole" = "cents"): number {
  const target = Math.floor(separateCents * (1 - SET_DISCOUNT));
  const rounded = round === "whole" ? Math.floor(target / 500) * 500 : Math.floor((target + 1) / 100) * 100 - 1;
  return Math.max(1, Math.min(rounded > 0 ? rounded : target, separateCents - 1));
}

/**
 * Reads the AI's sets and pairs against the shop's real products: unknown handles, repeats,
 * one-product sets and a product paired with itself are dropped; prices come from the rules.
 */
export function readSetsAndPairings(
  raw: { sets?: unknown; pairings?: unknown },
  products: { handle: string; priceCents: number }[],
  round: "cents" | "whole" = "cents",
): { sets: ShopSet[]; pairings: Pairings } {
  const price = new Map(products.map((p) => [p.handle, p.priceCents]));
  const sets: ShopSet[] = [];
  const seenSets = new Set<string>();
  const handles = new Set<string>();
  for (const s of Array.isArray(raw.sets) ? raw.sets : []) {
    const o = (s ?? {}) as { title?: unknown; why?: unknown; products?: unknown };
    const members = [...new Set((Array.isArray(o.products) ? o.products : []).map((h) => String(h)).filter((h) => price.has(h)))].slice(0, 3);
    const title = clean(o.title, 48);
    if (members.length < 2 || !title) continue;
    const key = [...members].sort().join("|");
    if (seenSets.has(key)) continue;
    seenSets.add(key);
    const separateCents = members.reduce((n, h) => n + (price.get(h) ?? 0), 0);
    let handle = slug(title);
    for (let i = 2; handles.has(handle); i++) handle = `${slug(title)}-${i}`;
    handles.add(handle);
    sets.push({ handle, title, why: clean(o.why, 160), productHandles: members, priceCents: setPrice(separateCents, round), separateCents });
    if (sets.length >= MAX_SETS) break;
  }

  const pairings: Pairings = {};
  for (const p of Array.isArray(raw.pairings) ? raw.pairings : []) {
    const o = (p ?? {}) as { product?: unknown; with?: unknown; why?: unknown };
    const a = String(o.product ?? "");
    const b = String(o.with ?? "");
    const why = clean(o.why, 120);
    if (!price.has(a) || !price.has(b) || a === b || !why) continue;
    const list = (pairings[a] ??= []);
    if (list.length >= MAX_PAIRS_PER_PRODUCT || list.some((x) => x.handle === b)) continue;
    list.push({ handle: b, why });
  }
  return { sets, pairings };
}

/**
 * What the bag saves on complete sets: each set counts as many times as all its items are in the
 * bag, and an item counts toward one set at a time (the biggest savings first).
 */
export function bagSetSavings(lines: { handle: string; qty: number }[], sets: ShopSet[]): { handle: string; title: string; times: number; savingCents: number }[] {
  const left = new Map(lines.map((l) => [l.handle, Math.max(0, Math.floor(l.qty))]));
  const out: { handle: string; title: string; times: number; savingCents: number }[] = [];
  for (const s of [...sets].sort((x, y) => y.separateCents - y.priceCents - (x.separateCents - x.priceCents))) {
    const times = Math.min(...s.productHandles.map((h) => left.get(h) ?? 0));
    if (!Number.isFinite(times) || times <= 0) continue;
    for (const h of s.productHandles) left.set(h, (left.get(h) ?? 0) - times);
    out.push({ handle: s.handle, title: s.title, times, savingCents: (s.separateCents - s.priceCents) * times });
  }
  return out;
}
