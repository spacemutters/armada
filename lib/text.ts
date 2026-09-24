export function slugify(s: string, max = 60): string {
  return (
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, max)
      .replace(/-+$/g, "") || "item"
  );
}

/** A slug not yet in `used`; adds it to `used`. */
export function uniqueHandle(base: string, used: Set<string>): string {
  const root = slugify(base);
  let handle = root;
  for (let i = 2; used.has(handle); i++) handle = `${root}-${i}`;
  used.add(handle);
  return handle;
}

export function randomSlug(length = 10): string {
  const alphabet = "abcdefghijkmnopqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max + 1);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : t.slice(0, max)).replace(/[\s,;:.-]+$/, "");
}

export function timeAgo(date: Date | string | null | undefined, now = Date.now()): string {
  if (!date) return "never";
  const s = Math.max(0, Math.round((now - new Date(date).getTime()) / 1000));
  if (s < 10) return "just now";
  if (s < 60) return `${s} seconds ago`;
  const m = Math.round(s / 60);
  if (m < 60) return m === 1 ? "a minute ago" : `${m} minutes ago`;
  const h = Math.round(m / 60);
  if (h < 24) return h === 1 ? "an hour ago" : `${h} hours ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}
