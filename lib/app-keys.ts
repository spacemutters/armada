import "server-only";
import { open, seal } from "@/lib/crypto";
import { asSystem } from "@/lib/db";

// Armada's own app keys on each platform, pasted by the platform admin on Connections (sealed in
// armada.app_keys) instead of set in Vercel. They're loaded into the server's settings when it starts
// (instrumentation.ts) and every minute after, so every connector reads them exactly as it reads a
// Vercel setting. A setting made in Vercel always wins over a pasted one.

/** The settings that may be pasted, and which of them are secrets (shown as set, never shown back). */
export const APP_KEYS: Record<string, { secret: boolean }> = {
  SHOPIFY_CLIENT_ID: { secret: false },
  SHOPIFY_CLIENT_SECRET: { secret: true },
  EBAY_CLIENT_ID: { secret: false },
  EBAY_CLIENT_SECRET: { secret: true },
  EBAY_RUNAME: { secret: false },
  META_APP_ID: { secret: false },
  META_APP_SECRET: { secret: true },
  META_SOCIAL_CONFIG_ID: { secret: false },
  META_SHOPS_APPROVED: { secret: false },
  META_ADS_APPROVED: { secret: false },
  TIKTOK_CLIENT_KEY: { secret: false },
  TIKTOK_CLIENT_SECRET: { secret: true },
  TIKTOK_APP_ID: { secret: false },
  TIKTOK_APP_SECRET: { secret: true },
  GOOGLE_ADS_CLIENT_ID: { secret: false },
  GOOGLE_ADS_CLIENT_SECRET: { secret: true },
  GOOGLE_ADS_DEVELOPER_TOKEN: { secret: true },
  ALIEXPRESS_APP_KEY: { secret: false },
  ALIEXPRESS_APP_SECRET: { secret: true },
  // The connection service with an approved Instagram app.
  COMPOSIO_API_KEY: { secret: true },
};

export const isAppKey = (name: string) => Object.hasOwn(APP_KEYS, name);

// Kept on the process, not the module: the start-up hook and the pages can load this file as separate
// copies, and they must agree which settings came from Vercel (taken before any paste is loaded).
const state = ((globalThis as { __armadaAppKeys?: { pasted: Set<string>; fromVercel: Set<string>; loadedAt: number } }).__armadaAppKeys ??= {
  /** Names this server took from the pasted keys (so a removed paste can be taken back out). */
  pasted: new Set<string>(),
  /** Names Vercel set before any paste was loaded: those always win. */
  fromVercel: new Set(Object.keys(APP_KEYS).filter((n) => Boolean(process.env[n]))),
  loadedAt: 0,
});
const { pasted, fromVercel } = state;

/** Brings the pasted keys into this server's settings. Cheap to call; reads at most every 30 seconds unless forced. */
export async function loadAppKeys(force = false): Promise<void> {
  if (!force && Date.now() - state.loadedAt < 30_000) return;
  state.loadedAt = Date.now();
  const rows = await asSystem((tx) => tx<{ name: string; value: Buffer }[]>`select name, value from armada.app_keys`);
  const seen = new Set<string>();
  for (const r of rows) {
    if (!isAppKey(r.name) || fromVercel.has(r.name)) continue;
    try {
      process.env[r.name] = open<string>(r.value);
      pasted.add(r.name);
      seen.add(r.name);
    } catch {
      // Sealed with an older key: treated as not pasted.
    }
  }
  for (const name of [...pasted]) {
    if (!seen.has(name)) {
      delete process.env[name];
      pasted.delete(name);
    }
  }
}

/** Where each of these settings comes from right now: Vercel, a paste, or nowhere. */
export function appKeySource(name: string): "vercel" | "pasted" | null {
  if (fromVercel.has(name)) return "vercel";
  if (pasted.has(name) && process.env[name]) return "pasted";
  return process.env[name] ? "vercel" : null;
}

/** Saves pasted keys (sealed) and loads them at once. Blank values are left as they were. */
export async function saveAppKeys(values: Record<string, string>, memberId: string): Promise<string[]> {
  const saved: string[] = [];
  await asSystem(async (tx) => {
    for (const [name, raw] of Object.entries(values)) {
      if (!isAppKey(name) || fromVercel.has(name)) continue;
      const value = raw.trim();
      if (!value) continue;
      await tx`
        insert into armada.app_keys (name, value, updated_by) values (${name}, ${seal(value)}, ${memberId})
        on conflict (name) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`;
      saved.push(name);
    }
  });
  await loadAppKeys(true);
  return saved;
}

export async function removeAppKeys(names: string[]): Promise<void> {
  const allowed = names.filter(isAppKey);
  if (!allowed.length) return;
  await asSystem((tx) => tx`delete from armada.app_keys where name in ${tx(allowed)}`);
  await loadAppKeys(true);
}
