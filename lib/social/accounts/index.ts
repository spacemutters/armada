import "server-only";
import { ComposioProblem, composioOn, postInstagramCarousel } from "@/connectors/composio/client";
import { refreshTikTokToken, needsRefresh, describeTikTokError } from "@/connectors/social-accounts/tiktok";
import { isViaService } from "@/connectors/pipedream/core";
import { relayFetch } from "@/connectors/pipedream/social";
import type { Fetch } from "@/connectors/social-accounts/types";
import { serviceOn } from "@/lib/connections/service";
import { appOrigin } from "@/lib/connections/types";
import { getShop } from "@/lib/shops/queries";
import { withWorkspace } from "@/lib/db";
import type { PublishCarousel, PublishResult, SocialAccount, SocialPlatform } from "@/lib/social/types";
import { metaReady, metaSettings, relaySecret, tiktokPicturesReady, tiktokReady, tiktokSettings } from "./config";
import { shopLink } from "./connect";
import { publishTo, type PublishTarget } from "./publish";
import { relayPath } from "./relay";
import {
  accountsForShop,
  loadAccountWithSecret,
  markNeedsAttention,
  noteProblem,
  recordPracticePost,
  saveRenewedSecret,
  type ComposioSecret,
  type MetaPageSecret,
  type TikTokSecret,
} from "./store";

// A shop's social accounts, for the posts Armada makes (the contract is lib/social/types.ts).
// Accounts own the access; posts ask for a publisher and never see it.

/** A shop's Instagram, Facebook Page and TikTok accounts, real and practice, in that order. */
export async function socialAccountsFor(workspaceId: string, shopId: string): Promise<SocialAccount[]> {
  const rows = await accountsForShop(workspaceId, shopId);
  return rows.map((r) => ({
    id: r.id,
    workspaceId: r.workspaceId,
    shopId: r.shopId,
    platform: r.platform,
    name: r.name,
    handle: r.handle,
    status: r.status,
    // All four take multi-picture posts: Instagram carousels, Facebook multi-photo posts, TikTok photo
    // posts, and Pinterest carousel pins (a single-picture pin on personal accounts).
    // TikTok can only download pictures once Armada's picture address is confirmed with TikTok.
    canPostCarousel: r.kind === "practice" || r.platform !== "tiktok" || tiktokPicturesReady(),
  }));
}

/**
 * What to tell the person after a post went out, when there's something they should do. TikTok
 * posts arrive in their TikTok inbox to finish with one tap (TikTok requires them to choose who
 * sees each post), so the posts screen should say so.
 */
export function afterPublishNote(platform: SocialPlatform, status: SocialAccount["status"]): string | null {
  if (status === "practice") return "This is a practice account, so the post stayed in Armada.";
  if (platform === "tiktok") return "It's in your TikTok inbox. Open TikTok and tap the notification to post it.";
  return null;
}

/** Slides may be given as addresses on Armada ("/api/…"); the platforms need the full public address. */
function absolute(url: string): string {
  try {
    return new URL(url, appOrigin() + "/").toString();
  } catch {
    return url;
  }
}

/** Renews a TikTok account's 24-hour access when it's about to run out, holding the row so two posts can't renew at once. */
async function freshTikTokAccess(workspaceId: string, accountId: string): Promise<{ accessToken: string } | { problem: string; reconnect: boolean }> {
  try {
    return await withWorkspace(workspaceId, async (tx) => {
      const acc = await loadAccountWithSecret<TikTokSecret>(tx, accountId, true);
      if (!acc?.secret) return { problem: "This TikTok account isn't fully connected. Connect it again.", reconnect: true };
      if (!needsRefresh(acc.tokenExpiresAt)) return { accessToken: acc.secret.accessToken };
      if (acc.refreshExpiresAt && new Date(acc.refreshExpiresAt).getTime() < Date.now()) {
        return { problem: "TikTok's permission for Armada ran out after a year. Press Connect again to renew it.", reconnect: true };
      }
      const renewed = await refreshTikTokToken(fetch, { ...tiktokSettings(), refreshToken: acc.secret.refreshToken });
      await saveRenewedSecret(tx, accountId, { accessToken: renewed.accessToken, refreshToken: renewed.refreshToken }, renewed.expiresAt, renewed.refreshExpiresAt);
      return { accessToken: renewed.accessToken };
    });
  } catch (e) {
    const d = describeTikTokError(e);
    return { problem: d.problem ?? "TikTok didn't renew Armada's access.", reconnect: Boolean(d.reconnect) };
  }
}

export const publishCarousel: PublishCarousel = async (workspaceId, accountId, post): Promise<PublishResult> => {
  const acc = await withWorkspace(workspaceId, (tx) => loadAccountWithSecret<MetaPageSecret & TikTokSecret & Partial<ComposioSecret>>(tx, accountId));
  if (!acc) return { ok: false, problem: "That social account isn't connected any more." };

  const slides = (post.slides ?? []).map((s) => ({ imageUrl: absolute(s.imageUrl), alt: s.alt ?? "" }));

  // Instagram connected through Composio: its approved app posts the carousel.
  if (acc.kind === "real" && acc.status === "connected" && acc.platform === "instagram" && acc.secret?.composio) {
    if (!composioOn()) return { ok: false, problem: "Instagram posting is switched off in Armada right now." };
    const relay = relaySecret();
    try {
      const id = await postInstagramCarousel(
        acc.secret.composio,
        acc.externalId ?? "",
        post.caption,
        slides.map((s) => (relay ? `${appOrigin()}${relayPath(relay, s.imageUrl)}` : s.imageUrl)),
      );
      return { ok: true, externalId: id };
    } catch (e) {
      const problem = e instanceof ComposioProblem ? `Instagram said: ${e.message}` : "Couldn't reach Instagram just now. Try again in a minute.";
      await noteProblem(workspaceId, accountId, problem);
      return { ok: false, problem };
    }
  }
  const target: PublishTarget = { platform: acc.platform, kind: acc.kind, status: acc.status, externalId: acc.externalId, access: acc.secret };
  let send: Fetch = fetch;

  if (acc.kind === "real" && acc.status === "connected") {
    if (acc.platform === "pinterest") {
      // Through the connection service: the relay adds the person's Pinterest access.
      if (!(await serviceOn())) return { ok: false, problem: "Pinterest posting is switched off in Armada right now." };
      const via: unknown = acc.secret;
      if (!isViaService(via)) return { ok: false, problem: "This Pinterest account isn't fully connected. Connect it again." };
      const shop = await getShop(workspaceId, acc.shopId);
      target.access = {
        boardId: acc.meta.boardId,
        business: acc.meta.business,
        link: shop ? await shopLink(workspaceId, shop) : null,
        shopName: shop?.blueprint.brand?.name || shop?.niche,
      };
      send = relayFetch(via);
    } else if (acc.platform === "tiktok") {
      if (!tiktokReady()) return { ok: false, problem: "TikTok posting is switched off in Armada right now." };
      if (!tiktokPicturesReady()) return { ok: false, problem: "TikTok can't download Armada's pictures until the Armada owner confirms Armada's picture address with TikTok." };
      const fresh = await freshTikTokAccess(workspaceId, accountId);
      if ("problem" in fresh) {
        if (fresh.reconnect) await markNeedsAttention(workspaceId, accountId, fresh.problem);
        return { ok: false, problem: fresh.problem };
      }
      target.access = { accessToken: fresh.accessToken };
    } else if (!metaReady() && !(acc.platform === "facebook" && acc.meta?.viaService)) {
      return { ok: false, problem: "Facebook and Instagram posting is switched off in Armada right now." };
    }
  }

  const secret = acc.kind === "real" ? relaySecret() : null;
  const outcome = await publishTo(target, { caption: post.caption, slides }, {
    fetch: send,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    appSecret: metaReady() ? metaSettings().appSecret : undefined,
    recordPractice: (p) => recordPracticePost(workspaceId, accountId, p),
    pictureUrl: (url) => (secret ? `${appOrigin()}${relayPath(secret, url)}` : url),
  });

  if (!outcome.ok && outcome.problem && acc.kind === "real") {
    if (outcome.reconnect) await markNeedsAttention(workspaceId, accountId, outcome.problem);
    else await noteProblem(workspaceId, accountId, outcome.problem);
  }
  return { ok: outcome.ok, externalId: outcome.externalId, url: outcome.url, problem: outcome.problem };
};
