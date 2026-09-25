import "server-only";
import { relay } from "./client";
import type { PdProvider, ViaService } from "./core";

// Who an account is, asked of the platform through the connection service right after it's
// connected, so Connections can name it. Any failure just leaves the platform's plain name.

const parse = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

async function get(via: ViaService, url: string): Promise<unknown> {
  const r = await relay(via.externalUserId, via.accountId, url, { method: "GET", headers: { accept: "application/json" } });
  return r.status >= 200 && r.status < 300 ? parse(r.text) : null;
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 120) : null);

export async function accountName(provider: PdProvider, via: ViaService): Promise<string | null> {
  try {
    if (provider === "tiktok_ads") {
      const j = (await get(via, "https://business-api.tiktok.com/open_api/v1.3/user/info/")) as { data?: { display_name?: string; email?: string } } | null;
      return str(j?.data?.display_name) ?? str(j?.data?.email);
    }
    if (provider === "printful") {
      const j = (await get(via, "https://api.printful.com/stores")) as { result?: { name?: string }[] } | null;
      return str(j?.result?.map((s) => s.name).filter(Boolean).join(", "));
    }
    if (provider === "printify") {
      const j = (await get(via, "https://api.printify.com/v1/shops.json")) as { title?: string }[] | null;
      return Array.isArray(j) ? str(j.map((s) => s.title).filter(Boolean).join(", ")) : null;
    }
  } catch {
    // Naming it is a nicety; the connection stands without it.
  }
  return null;
}
