// How well a supplier's result matches what was searched for. CJ's own search is loose: "ceramic pour
// over coffee dripper" also brings back children's gloves ("gants pour enfant") and a coat ("over
// knee"). Results are kept when they name the thing searched for (a search's last word, like
// "dripper", "napkins" or "organizer"), best first; when too few do, those sharing at least half the
// words; and a search never comes back empty because of this.
// No imports, so scripts/check-relevance.mjs loads it straight from Node.

const STOP = new Set([
  "a", "an", "and", "the", "for", "with", "of", "to", "in", "on", "by", "set", "pcs", "piece", "pieces", "new", "hot", "sale",
  "best", "quality", "high", "style", "fashion", "women", "men", "kids", "diy", "home", "use", "product", "products",
  // Short everyday words that match almost anything (and French "pour"/"avec" on cross-border listings).
  "over", "under", "all", "pour", "avec", "mini", "small", "large", "big", "cute", "cool", "creative",
]);

/** A word's plain form: lower case, and a simple plural taken off ("lamps" → "lamp", "boxes" → "box"). */
function stem(word: string): string {
  const w = word.toLowerCase();
  if (w.length > 4 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && /(ches|shes|xes|sses)$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

export function searchWords(text: string): string[] {
  return [...new Set((text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length >= 3 && !STOP.has(w)).map(stem))];
}

const has = (words: Set<string>, w: string) => words.has(w) || [...words].some((h) => h.length >= 4 && w.length >= 4 && (h.startsWith(w) || w.startsWith(h)));

/** Share of the search's words found in the title (0 to 1). */
export function matchShare(query: string, title: string): number {
  const want = searchWords(query);
  if (!want.length) return 1;
  const words = new Set(searchWords(title));
  return want.filter((w) => has(words, w)).length / want.length;
}

const plain = (s: string) => searchWords(s).join(" ");

/**
 * The results worth showing for a search, best first: those naming the thing searched for (the
 * search's last word); with fewer than `min` of those, those sharing at least half the words; then
 * any that share a word; then everything. Titles with the search's words side by side come first.
 */
export function rankByQuery<T>(query: string, items: T[], titleOf: (t: T) => string, min = 3): T[] {
  const want = searchWords(query);
  if (!want.length) return items;
  const head = want[want.length - 1];
  const phrase = plain(query);
  const scored = items.map((item, i) => {
    const title = titleOf(item);
    const words = new Set(searchWords(title));
    return { item, i, share: matchShare(query, title), named: has(words, head), together: want.length > 1 && plain(title).includes(phrase) };
  });
  const enough = Math.min(min, items.length);
  let pool = scored.filter((s) => s.named);
  if (pool.length < enough) pool = scored.filter((s) => s.share >= 0.5 - 1e-9);
  if (pool.length < enough) pool = scored.filter((s) => s.share > 0);
  if (pool.length < enough) pool = scored;
  // Words side by side first, then the most words, then the supplier's own order.
  return pool.sort((a, b) => Number(b.together) - Number(a.together) || b.share - a.share || a.i - b.i).map((s) => s.item);
}
