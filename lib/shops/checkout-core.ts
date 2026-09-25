import { bagSetSavings, type ShopSet } from "./sets";

// The pure half of checkout on Armada's own storefronts: what a bag costs and what was sold, worked
// out on the server from the shop's own prices (the shopper's browser only says which items and how
// many). No imports beyond the set rules, so scripts/check-checkout.mjs loads it straight from Node.

/** Where the shop ships (the supplier ships to these; prices are in US dollars). */
export const CHECKOUT_COUNTRIES = ["US", "CA", "GB", "AU", "NZ", "IE"] as const;
export const MAX_QTY = 20;
/** Stripe metadata holds one sold product per key, and allows 50 keys (a few are Armada's own). */
export const MAX_SOLD = 40;

export interface CheckoutItem {
  handle: string;
  productId: string;
  title: string;
  priceCents: number;
  image: string | null;
  /** A sample made up for a practice shop: never sold. */
  imagined: boolean;
}

/** One line on Stripe's checkout page. */
export interface PayLine {
  name: string;
  unitCents: number;
  qty: number;
  image: string | null;
}

/** One product sold, at what it effectively cost the shopper (a set's price shared over its items). */
export interface SoldLine {
  productId: string;
  title: string;
  qty: number;
  unitCents: number;
}

export type CheckoutPlan = { ok: true; pay: PayLine[]; sold: SoldLine[]; totalCents: number } | { ok: false; problem: string };

/** The bag as the browser sent it, cleaned: known items only, whole quantities from 1 to 20, one line per item. */
export function cleanBag(raw: unknown, known: Set<string>): { handle: string; qty: number }[] {
  const lines = Array.isArray(raw) ? raw.slice(0, 100) : [];
  const qty = new Map<string, number>();
  for (const l of lines) {
    const handle = typeof l?.handle === "string" ? l.handle : "";
    const n = Math.floor(Number(l?.qty));
    if (!known.has(handle) || !Number.isFinite(n) || n < 1) continue;
    qty.set(handle, Math.min(MAX_QTY, (qty.get(handle) ?? 0) + n));
  }
  return [...qty].map(([handle, n]) => ({ handle, qty: n }));
}

/**
 * What the bag costs: complete sets at the set's price (as the bag shows them), everything else at
 * the shop's price. Refuses a bag with a practice sample in it.
 */
export function planCheckout(rawBag: unknown, items: CheckoutItem[], sets: ShopSet[]): CheckoutPlan {
  const byHandle = new Map(items.map((i) => [i.handle, i]));
  const bag = cleanBag(rawBag, new Set(byHandle.keys()));
  if (!bag.length) return { ok: false, problem: "Your bag is empty." };
  if (bag.some((l) => byHandle.get(l.handle)!.imagined)) return { ok: false, problem: "These are sample items, so they can't be bought." };

  const left = new Map(bag.map((l) => [l.handle, l.qty]));
  const pay: PayLine[] = [];
  const sold = new Map<string, { title: string; qty: number; cents: number }>();
  const sell = (item: CheckoutItem, qty: number, cents: number) => {
    const s = sold.get(item.productId) ?? { title: item.title, qty: 0, cents: 0 };
    s.qty += qty;
    s.cents += cents;
    sold.set(item.productId, s);
  };

  // The same sets, in the same order, as the bag's own savings line.
  for (const saving of bagSetSavings(bag, sets)) {
    const set = sets.find((s) => s.handle === saving.handle);
    if (!set) continue;
    const members = set.productHandles.map((h) => byHandle.get(h)!).filter(Boolean);
    const separate = members.reduce((n, m) => n + m.priceCents, 0);
    pay.push({ name: `${set.title} set`, unitCents: set.priceCents, qty: saving.times, image: members[0]?.image ?? null });
    // The set's price shared over its items in proportion to their own prices, the last taking the rounding.
    let shared = 0;
    members.forEach((m, i) => {
      const part = i === members.length - 1 ? set.priceCents - shared : Math.round((set.priceCents * m.priceCents) / Math.max(1, separate));
      shared += part;
      sell(m, saving.times, part * saving.times);
      left.set(m.handle, (left.get(m.handle) ?? 0) - saving.times);
    });
  }
  for (const [handle, qty] of left) {
    if (qty <= 0) continue;
    const item = byHandle.get(handle)!;
    pay.push({ name: item.title, unitCents: item.priceCents, qty, image: item.image });
    sell(item, qty, item.priceCents * qty);
  }

  if (sold.size > MAX_SOLD) return { ok: false, problem: `A bag can hold up to ${MAX_SOLD} different items.` };
  if (pay.some((p) => !Number.isInteger(p.unitCents) || p.unitCents < 50)) return { ok: false, problem: "One of these items has no price yet." };
  return {
    ok: true,
    pay,
    sold: [...sold].map(([productId, s]) => ({ productId, title: s.title, qty: s.qty, unitCents: Math.round(s.cents / s.qty) })),
    totalCents: pay.reduce((n, p) => n + p.unitCents * p.qty, 0),
  };
}

/** What was sold, as Stripe metadata: one key per product, "productId|qty|unitCents". */
export function soldMetadata(sold: SoldLine[]): Record<string, string> {
  return Object.fromEntries(sold.slice(0, MAX_SOLD).map((s, i) => [`l${i}`, `${s.productId}|${s.qty}|${s.unitCents}`]));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reads soldMetadata back. Anything malformed is skipped. */
export function readSoldMetadata(meta: Record<string, unknown> | null | undefined): { productId: string; qty: number; unitCents: number }[] {
  const out: { productId: string; qty: number; unitCents: number }[] = [];
  for (let i = 0; i < MAX_SOLD; i++) {
    const v = meta?.[`l${i}`];
    if (typeof v !== "string") continue;
    const [productId, qty, cents] = v.split("|");
    const q = Number(qty);
    const c = Number(cents);
    if (UUID.test(productId ?? "") && Number.isInteger(q) && q > 0 && q <= MAX_QTY * 10 && Number.isInteger(c) && c >= 0) out.push({ productId, qty: q, unitCents: c });
  }
  return out;
}
