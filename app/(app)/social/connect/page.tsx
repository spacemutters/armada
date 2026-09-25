import { applyKit, makePracticeAccount, pickPage, removeSocialAccount, skipPageChoice } from "./actions";
import { composioOn } from "@/connectors/composio/client";
import { serviceOn } from "@/lib/connections/service";
import { isPlatformAdmin } from "@/app/(app)/admin/access";
import { ShopChooser, type ShopChoice } from "@/components/social-connect/shop-list";
import { SocialConnectView, type Note, type OwnerInfo } from "@/components/social-connect/view";
import { META_PERMISSIONS } from "@/connectors/social-accounts/meta";
import { TIKTOK_SCOPES } from "@/connectors/social-accounts/tiktok";
import { requireSession } from "@/lib/auth/session";
import { hasEnv } from "@/lib/connections/types";
import { canConnect, kitFor } from "@/lib/social/accounts/connect";
import {
  callbackUrl,
  kitImageUrl,
  META_ENV,
  metaReady,
  readNote,
  TIKTOK_ENV,
  TIKTOK_VERIFY_ENV,
  tiktokPicturePrefix,
  tiktokPicturesReady,
  tiktokReady,
} from "@/lib/social/accounts/config";
import { accountCountsByShop, accountsForShop, pendingPageChoices, practicePostsFor } from "@/lib/social/accounts/store";
import { getShop, listShops } from "@/lib/shops/queries";
import type { ShopRow } from "@/lib/shops/types";

export const metadata = { title: "Social media" };

const SHORT: Record<string, string> = { instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok", pinterest: "Pinterest" };

/** A shop can have social media once it's built: it has its brand and look, and its link works. */
const READY = new Set(["ready", "publishing", "published"]);
const socialReady = (s: ShopRow) => READY.has(s.status) && Boolean(s.blueprint.brand && s.blueprint.theme);

/** What the short result codes on the address (from the connect flows and actions) say. */
function message(sp: Record<string, string | undefined>): Note | null {
  const who = SHORT[sp.p ?? ""] ?? "The platform";
  if (sp.done === "instagram") return { tone: "ok", text: "Instagram is connected. Posts Armada makes for this shop can go straight to it." };
  if (sp.done === "facebook") return { tone: "ok", text: "Your Facebook Page is connected, and Armada filled in what the Page was missing from the kit." };
  if (sp.done === "tiktok") return { tone: "ok", text: "TikTok is connected. Posts arrive in your TikTok inbox, ready to post with one tap." };
  if (sp.done === "pinterest") return { tone: "ok", text: "Pinterest is connected. Posts go to the shop's board." };
  if (sp.practice) return { tone: "ok", text: `A practice ${SHORT[sp.practice] ?? ""} account is ready. Posts to it stay in Armada.` };
  if (sp.removed) return { tone: "ok", text: sp.kind === "practice" ? "The practice account is removed." : `${SHORT[sp.removed] ?? "The account"} is disconnected from this shop.` };
  if (sp.kit === "applied") return { tone: "ok", text: "The Page now has the kit's description, website, profile picture and cover." };
  if (sp.kit === "partial") return { tone: "problem", text: "Facebook took part of the kit. The Facebook card shows what it refused." };
  switch (sp.problem) {
    case "cancelled":
    case "denied":
      return { tone: "problem", text: `${who}'s window closed before it finished, so nothing changed. Press the button again when you're ready.` };
    case "nopage":
      return { tone: "problem", text: "Facebook didn't share a Page with Armada. In Facebook's window, choose the shop's Page (or make one first), then press the button again." };
    case "notlinked":
      return {
        tone: "problem",
        text: "None of the Pages you shared has an Instagram professional account linked. In Instagram, open your profile, tap Edit profile, then Page, and choose the Page. Then press the button again.",
      };
    case "expired":
      return { tone: "problem", text: "That sign-in took too long or was already used. Press the button again." };
    case "browser":
      return { tone: "problem", text: "Nothing was connected: finish in the browser where you're signed in to Armada, as the person who pressed the button. Press it again there." };
    case "off":
      return { tone: "problem", text: "That platform isn't switched on in Armada yet. A practice account works meanwhile." };
    case "role":
      return { tone: "problem", text: "Only the owner or a manager can connect or disconnect accounts." };
    case "shop":
      return { tone: "problem", text: "That shop wasn't found. Pick it again below." };
    case "building":
      return { tone: "problem", text: "That shop is still being built. Its social media can be set up as soon as it's ready." };
    case "notconnected":
      return { tone: "problem", text: "Connect the Page first." };
    case "failed":
    case "unreachable":
      return { tone: "problem", text: `${who} didn't finish connecting. Try again in a minute.` };
    case "platform":
      // Only words Armada wrote (signed) are shown; anything else in the address is ignored.
      return { tone: "problem", text: readNote(sp.why, sp.ws) ?? `${who} didn't finish connecting. Try again in a minute.` };
  }
  return null;
}

function ownerInfo(): OwnerInfo {
  const settings = (names: string[]) => names.map((name) => ({ name, set: hasEnv([name]) }));
  return {
    meta: { settings: settings(META_ENV), callbacks: [callbackUrl("facebook_page"), callbackUrl("instagram")], permissions: META_PERMISSIONS },
    tiktok: { settings: settings([...TIKTOK_ENV, ...TIKTOK_VERIFY_ENV]), callback: callbackUrl("tiktok"), prefix: tiktokPicturePrefix(), scopes: TIKTOK_SCOPES },
    open: !metaReady() || !tiktokPicturesReady(),
  };
}

function countsLine(c: { connected: number; attention: number; practice: number } | undefined): string | null {
  if (!c) return null;
  const parts = [c.connected ? `${c.connected} connected` : "", c.attention ? `${c.attention} need${c.attention === 1 ? "s" : ""} you` : "", c.practice ? `${c.practice} practice` : ""].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function SocialConnectPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await requireSession();
  const raw = await searchParams;
  const sp = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])) as Record<string, string | undefined>;
  const found = sp.shop ? await getShop(session.workspaceId, sp.shop) : null;
  const shop = found && socialReady(found) ? found : null;
  const note = found && !shop ? message({ problem: "building" }) : message(sp);

  if (!shop) {
    const [all, counts] = await Promise.all([listShops(session.workspaceId), accountCountsByShop(session.workspaceId)]);
    const ready = all.filter(socialReady);
    const choices: ShopChoice[] = ready.map((s) => ({
      id: s.id,
      name: s.blueprint.brand!.name || s.niche,
      tagline: s.blueprint.brand!.tagline,
      avatarUrl: kitImageUrl(s.slug, "avatar"),
      summary: countsLine(counts[s.id]),
    }));
    const building = all.filter((s) => !socialReady(s) && (s.status === "draft" || s.status === "building")).length;
    return <ShopChooser shops={choices} note={note} building={building} />;
  }

  const [rows, choice, admin, { kit, link }] = await Promise.all([
    accountsForShop(session.workspaceId, shop.id),
    pendingPageChoices(session.workspaceId, shop.id),
    isPlatformAdmin(session.memberId),
    kitFor(session.workspaceId, shop),
  ]);
  const service = await serviceOn();
  const practice = await practicePostsFor(
    session.workspaceId,
    rows.filter((r) => r.kind === "practice").map((r) => r.id),
  );

  return (
    <SocialConnectView
      shopId={shop.id}
      brandName={shop.blueprint.brand?.name || shop.niche}
      link={link}
      avatarUrl={kitImageUrl(shop.slug, "avatar")}
      coverUrl={kitImageUrl(shop.slug, "cover")}
      kit={kit}
      note={note}
      choice={choice}
      rows={rows}
      practice={practice}
      ready={{ instagram: metaReady() || composioOn(), facebook: metaReady() || service, tiktok: tiktokReady(), pinterest: service }}
      canConnect={canConnect(session)}
      canPractice={session.role !== "viewer"}
      practiceShop={shop.brief?.source === "practice"}
      isAdmin={admin}
      highlight={sp.done ?? sp.practice ?? sp.p}
      actions={{ makePractice: makePracticeAccount, remove: removeSocialAccount, pick: pickPage, skip: skipPageChoice, applyKit }}
      owner={admin ? ownerInfo() : null}
    />
  );
}
