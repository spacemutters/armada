"use client";

// The practice storefront's bag lives in this browser only. Every read and write is guarded,
// because storage can be missing or blocked (private windows, strict settings).

export interface BagLine {
  handle: string;
  title: string;
  priceCents: number;
  image: string | null;
  icon: string | null;
  qty: number;
}

const key = (slug: string) => `armada-bag:${slug}`;
const EVENT = "armada-bag-change";

export function readBag(slug: string): BagLine[] {
  try {
    const raw = window.localStorage.getItem(key(slug));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeBag(slug: string, lines: BagLine[]): void {
  try {
    window.localStorage.setItem(key(slug), JSON.stringify(lines));
  } catch {
    // Storage unavailable: the bag just won't persist across pages.
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: slug }));
}

export function addToBag(slug: string, line: Omit<BagLine, "qty">, qty = 1): void {
  const lines = readBag(slug);
  const existing = lines.find((l) => l.handle === line.handle);
  if (existing) existing.qty = Math.min(20, existing.qty + qty);
  else lines.push({ ...line, qty });
  writeBag(slug, lines);
}

export function onBagChange(fn: () => void): () => void {
  window.addEventListener(EVENT, fn);
  window.addEventListener("storage", fn);
  return () => {
    window.removeEventListener(EVENT, fn);
    window.removeEventListener("storage", fn);
  };
}
