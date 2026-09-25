import "server-only";
import { GRAPH_VERSION, type MetaPage } from "@/connectors/social-accounts/meta";
import { relay } from "./client";
import type { ViaService } from "./core";

// Facebook Pages connected through the connection service (its own approved Meta app, which may
// post to Pages but not publish to Instagram). The person's Pages are read through the service's
// relay; each Page's own access comes back with it, as Meta's answer always includes it, and that is
// what posts to the Page afterwards.

const FIELDS = "id,name,username,link,access_token,tasks,instagram_business_account{id,username,name}";

interface RawPage {
  id: string;
  name?: string;
  username?: string;
  link?: string;
  access_token?: string;
  tasks?: string[];
  instagram_business_account?: { id: string; username?: string; name?: string };
}

export async function pagesViaService(via: ViaService): Promise<MetaPage[]> {
  const out: MetaPage[] = [];
  let url: string | null = `https://graph.facebook.com/${GRAPH_VERSION}/me/accounts?fields=${encodeURIComponent(FIELDS)}&limit=100`;
  for (let i = 0; i < 5 && url; i++) {
    const r = await relay(via.externalUserId, via.accountId, url, { method: "GET", headers: { accept: "application/json" } });
    let body: { data?: RawPage[]; paging?: { next?: string }; error?: { message?: string } } | null = null;
    try {
      body = JSON.parse(r.text);
    } catch {
      body = null;
    }
    if (r.status < 200 || r.status > 299 || !body) throw new Error(body?.error?.message || `Facebook answered ${r.status}`);
    for (const p of body.data ?? []) {
      if (!p.access_token) continue;
      out.push({
        id: p.id,
        name: p.name ?? "",
        username: p.username ?? null,
        link: p.link ?? null,
        accessToken: p.access_token,
        tasks: p.tasks ?? [],
        instagram: p.instagram_business_account
          ? { id: p.instagram_business_account.id, username: p.instagram_business_account.username ?? null, name: p.instagram_business_account.name ?? null }
          : null,
      });
    }
    url = body.paging?.next && body.paging.next.startsWith("https://graph.facebook.com/") ? body.paging.next : null;
  }
  return out;
}
