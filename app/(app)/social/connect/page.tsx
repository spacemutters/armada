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
  if (sp.done === "facebook") return { tone: "ok", text: "Facebook Page connected and filled in." };
  if (sp.done && SHORT[sp.done]) return { tone: "ok", text: `${SHORT[sp.done]} connected.` };
  if (sp.practice) return { tone: "ok", text: "Practice account ready." };
  if (sp.removed) return { tone: "ok", text: sp.kind === "practice" ? "Practice account removed." : `${SHORT[sp.removed] ?? "Account"} disconnected.` };
  if (sp.kit === "applied") return { tone: "ok", text: "The Page has the kit now." };
  if (sp.kit === "partial") return { tone: "problem", text: "Facebook took part of the kit. The Facebook card shows what it refused." };
  switch (sp.problem) {
    case "cancelled":
    case "denied":
      return { tone: "problem", text: "Nothing changed. Press the button again when you're ready." };
    case "nopage":
      return { tone: "problem", text: "Facebook didn't share a Page. Choose the shop's Page in Facebook's window, then try again." };
    case "notlinked":
      return {
        tone: "problem",
        text: "No shared Page has an Instagram linked. In Instagram, tap Edit profile, then Page, choose it, and try again.",
      };
    case "expired":
      return { tone: "problem", text: "That took too long. Press the button again." };
    case "browser":
      return { tone: "problem", text: "Finish in the browser where you're signed in to Armada." };
    case "off":
      return { tone: "problem", text: "Not switched on yet. A practice account works meanwhile." };
    case "role":
      return { tone: "problem", text: "Only the owner or a manager can do that." };
    case "shop":
      return { tone: "problem", text: "Shop not found. Pick it again." };
    case "building":
      return { tone: "problem", text: "That shop is still being built." };
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
    // Closed until opened: the page's own presses come first.
    open: false,
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
