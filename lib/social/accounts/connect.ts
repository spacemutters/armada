import "server-only";
import {
  describeMetaError,
  exchangeMetaCode,
  instagramProfileUrl,
  linkedInstagram,
  listPages,
  longLivedMetaToken,
  metaLoginUrl,
  setupPage,
  type MetaPage,
} from "@/connectors/social-accounts/meta";
import { describeTikTokError, exchangeTikTokCode, tiktokLoginUrl, tiktokProfileUrl, tiktokUser, TIKTOK_SCOPES } from "@/connectors/social-accounts/tiktok";
import type { Session } from "@/lib/auth/session";
import { ComposioProblem, composioOn, instagramLink, instagramUser, waitUntilActive } from "@/connectors/composio/client";
import { pagesViaService, relayFetch } from "@/connectors/pipedream/social";
import { boardForShop, describePinterestError, pinterestMe } from "@/connectors/social-accounts/pinterest";
import { stateHash } from "@/lib/connections/state";
import type { ViaService } from "@/connectors/pipedream/core";
import { serviceOn, startViaService } from "@/lib/connections/service";
import { consumeState, createState } from "@/lib/connections/state";
import { appOrigin, type Provider } from "@/lib/connections/types";
import { withWorkspace } from "@/lib/db";
import { getShop } from "@/lib/shops/queries";
import type { ShopRow } from "@/lib/shops/types";
import { buildKit, kitBrand, type ProfileKit } from "./kit";
import {
  callbackUrl,
  kitImageUrl,
  metaReady,
  metaSettings,
  signedNote,
  STATE_PROVIDER,
  tiktokReady,
  tiktokSettings,
  type ConnectRoute,
} from "./config";
import {
  loadAccountWithSecret,
  savePageChoices,
  saveRealAccount,
  takePageChoices,
  updateMeta,
  type MetaPageSecret,
} from "./store";

// The one-press connect flows. Each press sends the person to the platform's own sign-in (which is
// also where they can make an account), and when they come back Armada does everything the
// platform allows: saves the connection, finds the Instagram account linked to the Page, and fills
// in the Page's description, website, profile picture and cover from the shop's profile kit.

const provider = (route: ConnectRoute) => STATE_PROVIDER[route] as string as Provider;

/** Back to the social page for a shop, with a short result code the page turns into words. */
export function backTo(shopId: string | null, params: Record<string, string> = {}): string {
  const q = new URLSearchParams(shopId ? { shop: shopId, ...params } : params);
  return `/social/connect?${q.toString()}`;
}

export function canConnect(session: Session): boolean {
  return session.role === "owner" || session.role === "manager";
}

/** Where the shop's profiles link to: its live store when it has one, otherwise its preview. */
export async function shopLink(workspaceId: string, shop: ShopRow): Promise<string> {
  if (shop.storeId) {
    const [store] = await withWorkspace(
      workspaceId,
      (tx) => tx<{ mode: string; domain: string | null }[]>`select mode, domain from armada.stores where id = ${shop.storeId}`,
    );
    if (store?.mode === "live" && store.domain) return `https://${store.domain.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
  }
  return `${appOrigin()}/s/${shop.slug}`;
}

export async function kitFor(workspaceId: string, shop: ShopRow): Promise<{ kit: ProfileKit; link: string }> {
  const link = await shopLink(workspaceId, shop);
  return { kit: buildKit(kitBrand(shop.blueprint, shop.niche), link), link };
}

// ---------- Meta (Facebook Page and Instagram) ----------

type ChoiceSecret = { userToken: string; pages: { id: string; name: string; username: string | null; link: string | null; token: string; instagram: MetaPage["instagram"] }[] };

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Saves the shop's Facebook Page (and the Instagram account linked to it), then fills the Page in from
 * the kit. A Page connected through the connection service has no user access of Armada's (userToken
 * ""): that app may post to the Page but not publish to Instagram or change the Page's details, so
 * those two steps are skipped for it.
 */
async function connectPage(session: { workspaceId: string; memberId: string | null }, shop: ShopRow, page: ChoiceSecret["pages"][number], userToken: string): Promise<void> {
  const ownApp = Boolean(userToken);
  const ws = session.workspaceId;
  const fbId = await withWorkspace(ws, async (tx) => {
    const id = await saveRealAccount(tx, ws, {
      shopId: shop.id,
      platform: "facebook",
      name: page.name,
      handle: page.username,
      externalId: page.id,
      secret: { pageToken: page.token, userToken },
      meta: { pageId: page.id, pageName: page.name, link: page.link, instagramLinked: Boolean(page.instagram), ...(ownApp ? {} : { viaService: true }) },
      memberId: session.memberId,
    });
    if (page.instagram && ownApp) {
      await saveRealAccount(tx, ws, {
        shopId: shop.id,
        platform: "instagram",
        name: page.instagram.name || page.instagram.username || page.name,
        handle: page.instagram.username,
        externalId: page.instagram.id,
        secret: { pageToken: page.token },
        meta: { pageId: page.id, pageName: page.name, link: page.instagram.username ? instagramProfileUrl(page.instagram.username) : null },
        memberId: session.memberId,
      });
    }
    return id;
  });
  if (ownApp) await fillPage(ws, shop, fbId, page.id, page.token, false);
}

/** Fills the Page's description, website, picture and cover from the kit. Only what's empty, unless `overwrite`. */
async function fillPage(workspaceId: string, shop: ShopRow, accountId: string, pageId: string, pageToken: string, overwrite: boolean) {
  const { kit } = await kitFor(workspaceId, shop);
  const result = await setupPage({ fetch, appSecret: metaSettings().appSecret }, pageId, pageToken, {
    about: kit.facebook.about,
    website: kit.facebook.website,
    pictureUrl: kitImageUrl(shop.slug, "avatar"),
    coverUrl: kitImageUrl(shop.slug, "cover"),
    overwrite,
  });
  await withWorkspace(workspaceId, (tx) => updateMeta(tx, accountId, { kit: { ...result, at: new Date().toISOString() } }));
  return result;
}

/**
 * The address the Facebook or Instagram press sends the person to. For Instagram, when the shop's
 * Page is already connected, Armada first looks for a newly linked Instagram account with the
 * access it already has, so no sign-in is needed.
 */
export async function metaStart(session: Session, route: "facebook_page" | "instagram", shopId: string): Promise<string> {
  const shop = await getShop(session.workspaceId, shopId);
  if (!shop) return backTo(null, { problem: "shop" });
  if (!canConnect(session)) return backTo(shop.id, { problem: "role" });
  if (!metaReady()) {
    // No Meta app of Armada's own: Instagram connects through Composio's approved app.
    if (route === "instagram" && composioOn()) return composioInstagramStart(session, shop);
    // A Page connects through the connection service's approved app.
    if (route === "facebook_page" && (await serviceOn())) {
      return startViaService({ workspaceId: session.workspaceId, memberId: session.memberId, provider: "facebook_page", purpose: "connect", returnTo: backTo(shop.id), detail: { shopId: shop.id } });
    }
    return backTo(shop.id, { problem: "off" });
  }

  if (route === "instagram") {
    const found = await instagramFromConnectedPage(session, shop);
    if (found) return backTo(shop.id, { done: "instagram" });
  }
  const state = await createState(session.workspaceId, session.memberId, provider(route), "connect", { returnTo: backTo(shop.id), shopId: shop.id });
  const s = metaSettings();
  return metaLoginUrl({ appId: s.appId, configId: s.configId, redirectUri: callbackUrl(route), state });
}

async function instagramFromConnectedPage(session: Session, shop: ShopRow): Promise<boolean> {
  const ws = session.workspaceId;
  const fb = await withWorkspace(ws, async (tx) => {
    const [row] = await tx<{ id: string }[]>`
      select id from armada.social_accounts where shop_id = ${shop.id} and platform = 'facebook' and kind = 'real' and status = 'connected'`;
    return row ? loadAccountWithSecret<MetaPageSecret>(tx, row.id) : null;
  });
  if (!fb?.secret?.pageToken || !fb.externalId) return false;
  try {
    const ig = await linkedInstagram({ fetch, appSecret: metaSettings().appSecret }, fb.externalId, fb.secret.pageToken);
    await withWorkspace(ws, async (tx) => {
      await updateMeta(tx, fb.id, { instagramLinked: Boolean(ig) });
      if (ig) {
        await saveRealAccount(tx, ws, {
          shopId: shop.id,
          platform: "instagram",
          name: ig.name || ig.username || fb.name,
          handle: ig.username,
          externalId: ig.id,
          secret: { pageToken: fb.secret!.pageToken },
          meta: { pageId: fb.externalId!, pageName: fb.name, link: ig.username ? instagramProfileUrl(ig.username) : null },
          memberId: session.memberId,
        });
      }
    });
    return Boolean(ig);
  } catch {
    return false;
  }
}

/** Who is signed in to Armada in the browser the platform sent back (null: nobody). */
export type ReturningPerson = { memberId: string; workspaceId: string } | null;

/**
 * The platform sends the person back with the one-time state, and the browser it lands in must be
 * signed in as the person who pressed the button. Otherwise someone could start a connection in
 * their own team and get another person to approve it, joining that person's Page or account to
 * the wrong team (the same rule as Shopify's callback).
 */
function samePerson(state: { memberId: string | null; workspaceId: string }, person: ReturningPerson): boolean {
  return Boolean(person && state.memberId && person.memberId === state.memberId && person.workspaceId === state.workspaceId);
}

/** Handles Meta sending the person back. Returns where to send them next. */
export async function metaFinish(route: "facebook_page" | "instagram", url: URL, person: ReturningPerson): Promise<string> {
  const state = await consumeState(url.searchParams.get("state"), provider(route));
  if (!state) return backTo(null, { problem: "expired" });
  if (!samePerson(state, person)) return backTo(null, { problem: "browser" });
  const shopId = String(state.detail.shopId ?? "");
  const wanted = route === "instagram" ? "instagram" : "facebook";
  if (url.searchParams.get("error") || !url.searchParams.get("code")) return backTo(shopId, { problem: "cancelled", p: wanted });
  const shop = await getShop(state.workspaceId, shopId);
  if (!shop || !metaReady()) return backTo(shopId || null, { problem: shop ? "off" : "shop" });

  const s = metaSettings();
  const ctx = { fetch, appSecret: s.appSecret };
  try {
    const short = await exchangeMetaCode(ctx, { appId: s.appId, appSecret: s.appSecret, redirectUri: callbackUrl(route), code: url.searchParams.get("code")! });
    const long = await longLivedMetaToken(ctx, { appId: s.appId, appSecret: s.appSecret, token: short.accessToken });
    const pages = (await listPages(ctx, long.accessToken)).filter((p) => !p.tasks.length || p.tasks.includes("CREATE_CONTENT") || p.tasks.includes("MANAGE"));
    const candidates = wanted === "instagram" ? pages.filter((p) => p.instagram) : pages;
    if (!candidates.length) return backTo(shop.id, { problem: wanted === "instagram" && pages.length ? "notlinked" : "nopage", p: wanted });

    const brand = norm(shop.blueprint.brand?.name);
    const named = candidates.filter((p) => brand && (norm(p.name) === brand || norm(p.instagram?.username) === brand));
    const pick = candidates.length === 1 ? candidates[0] : named.length === 1 ? named[0] : null;
    const asChoice = (p: MetaPage) => ({ id: p.id, name: p.name, username: p.username, link: p.link, token: p.accessToken, instagram: p.instagram });
    if (pick) {
      await connectPage({ workspaceId: state.workspaceId, memberId: state.memberId }, shop, asChoice(pick), long.accessToken);
      return backTo(shop.id, { done: wanted });
    }
    await savePageChoices(state.workspaceId, {
      shopId: shop.id,
      memberId: state.memberId,
      wanted,
      secret: { userToken: long.accessToken, pages: candidates.map(asChoice) } satisfies ChoiceSecret,
      choices: candidates.map((p) => ({ id: p.id, name: p.name, instagram: p.instagram?.username ?? null })),
    });
    return backTo(shop.id, { choose: wanted });
  } catch (e) {
    return backTo(shop.id, { problem: "platform", p: wanted, ...signedNote(describeMetaError(e, wanted).problem ?? "") });
  }
}

// ---------- Instagram through Composio ----------

/** Composio's own sign-in for Instagram (its approved app), then back to Armada. */
async function composioInstagramStart(session: Session, shop: ShopRow): Promise<string> {
  const userId = `armada-${session.workspaceId}`;
  try {
    // The state is made first so its one-time token can ride on the return address.
    const pending = await createState(session.workspaceId, session.memberId, "social_instagram_composio" as Provider, "connect", { returnTo: backTo(shop.id), shopId: shop.id });
    const link = await instagramLink(userId, `${appOrigin()}/api/connect/composio/instagram?state=${encodeURIComponent(pending)}`);
    await withWorkspace(
      session.workspaceId,
      (tx) => tx`update armada.oauth_states set detail = detail || ${tx.json({ connectedAccountId: link.connectedAccountId, userId } as never)} where state_hash = ${stateHash(pending)}`,
    );
    return link.redirectUrl;
  } catch (e) {
    return backTo(shop.id, { problem: "platform", p: "instagram", ...signedNote(e instanceof ComposioProblem ? e.message : "Couldn't reach Composio just now. Try again in a minute.") });
  }
}

/** Composio sends the person back once Instagram approved. Returns where to send them next. */
export async function composioInstagramFinish(url: URL, person: ReturningPerson): Promise<string> {
  const state = await consumeState(url.searchParams.get("state"), "social_instagram_composio" as Provider);
  if (!state) return backTo(null, { problem: "expired" });
  if (!samePerson(state, person)) return backTo(null, { problem: "browser" });
  const shopId = String(state.detail.shopId ?? "");
  const connectedAccountId = String(state.detail.connectedAccountId ?? "");
  const userId = String(state.detail.userId ?? "");
  const shop = await getShop(state.workspaceId, shopId);
  if (!shop) return backTo(null, { problem: "shop" });
  if (!connectedAccountId || !userId) return backTo(shop.id, { problem: "cancelled", p: "instagram" });
  try {
    if (!(await waitUntilActive(connectedAccountId))) return backTo(shop.id, { problem: "cancelled", p: "instagram" });
    const me = await instagramUser(connectedAccountId, userId);
    await withWorkspace(state.workspaceId, (tx) =>
      saveRealAccount(tx, state.workspaceId, {
        shopId: shop.id,
        platform: "instagram",
        name: me.name || me.username || "Instagram account",
        handle: me.username,
        externalId: me.id,
        secret: { composio: { connectedAccountId, userId } },
        meta: { link: me.username ? instagramProfileUrl(me.username) : null, viaComposio: true },
        memberId: state.memberId,
      }),
    );
    return backTo(shop.id, { done: "instagram" });
  } catch (e) {
    return backTo(shop.id, { problem: "platform", p: "instagram", ...signedNote(e instanceof ComposioProblem ? e.message : "Instagram didn't finish connecting. Try again in a minute.") });
  }
}

/** Finishes a Facebook Page connected through the connection service. Returns where to send the person next. */
export async function metaFinishViaService(state: { workspaceId: string; memberId: string | null; shopId: string }, via: ViaService): Promise<string> {
  const shop = await getShop(state.workspaceId, state.shopId);
  if (!shop) return backTo(null, { problem: "shop" });
  try {
    const pages = (await pagesViaService(via)).filter((p) => !p.tasks.length || p.tasks.includes("CREATE_CONTENT") || p.tasks.includes("MANAGE"));
    if (!pages.length) return backTo(shop.id, { problem: "nopage", p: "facebook" });
    const brand = norm(shop.blueprint.brand?.name);
    const named = pages.filter((p) => brand && norm(p.name) === brand);
    const pick = pages.length === 1 ? pages[0] : named.length === 1 ? named[0] : null;
    const asChoice = (p: MetaPage) => ({ id: p.id, name: p.name, username: p.username, link: p.link, token: p.accessToken, instagram: p.instagram });
    if (pick) {
      await connectPage({ workspaceId: state.workspaceId, memberId: state.memberId }, shop, asChoice(pick), "");
      return backTo(shop.id, { done: "facebook" });
    }
    await savePageChoices(state.workspaceId, {
      shopId: shop.id,
      memberId: state.memberId,
      wanted: "facebook",
      secret: { userToken: "", pages: pages.map(asChoice) } satisfies ChoiceSecret,
      choices: pages.map((p) => ({ id: p.id, name: p.name, instagram: null })),
    });
    return backTo(shop.id, { choose: "facebook" });
  } catch (e) {
    return backTo(shop.id, { problem: "platform", p: "facebook", ...signedNote(describeMetaError(e, "facebook").problem ?? "") });
  }
}

// ---------- Pinterest (through the connection service) ----------

/** One press: the service's page, then Pinterest's own Authorize page, then back to Armada. */
export async function pinterestStart(session: Session, shopId: string): Promise<string> {
  const shop = await getShop(session.workspaceId, shopId);
  if (!shop) return backTo(null, { problem: "shop" });
  if (!canConnect(session)) return backTo(shop.id, { problem: "role" });
  if (!(await serviceOn())) return backTo(shop.id, { problem: "off" });
  try {
    return await startViaService({ workspaceId: session.workspaceId, memberId: session.memberId, provider: "pinterest", purpose: "connect", returnTo: backTo(shop.id), detail: { shopId: shop.id } });
  } catch {
    return backTo(shop.id, { problem: "platform", p: "pinterest", ...signedNote("Couldn't reach Pinterest just now. Try again in a minute.") });
  }
}

/**
 * Finishes a Pinterest connected through the service: who the account is, and the board the shop's
 * pins go to (one named for the shop, or one Armada makes). Returns where to send the person next.
 */
export async function pinterestFinishViaService(state: { workspaceId: string; memberId: string | null; shopId: string }, via: ViaService): Promise<string> {
  const shop = await getShop(state.workspaceId, state.shopId);
  if (!shop) return backTo(null, { problem: "shop" });
  const pin = relayFetch(via);
  const brand = shop.blueprint.brand?.name || shop.niche;
  try {
    const me = await pinterestMe(pin);
    const { board } = await boardForShop(pin, brand, shop.blueprint.brand?.tagline ?? "");
    const needBoard = `Make a board called ${brand} on Pinterest, then press Connect again.`;
    await withWorkspace(state.workspaceId, (tx) =>
      saveRealAccount(tx, state.workspaceId, {
        shopId: shop.id,
        platform: "pinterest",
        name: me.name,
        handle: me.username,
        externalId: me.id,
        secret: via,
        status: board ? "connected" : "needs_attention",
        meta: {
          link: me.link,
          business: me.business,
          ...(board ? { boardId: board.id, boardName: board.name } : { lastProblem: needBoard, lastProblemAt: new Date().toISOString() }),
        },
        memberId: state.memberId,
      }),
    );
    return board ? backTo(shop.id, { done: "pinterest" }) : backTo(shop.id, { problem: "platform", p: "pinterest", ...signedNote(needBoard) });
  } catch (e) {
    return backTo(shop.id, { problem: "platform", p: "pinterest", ...signedNote(describePinterestError(e).problem) });
  }
}

/** The person picked the shop's Page from the ones they shared with Armada. */
export async function choosePage(session: Session, shopId: string, choiceId: string, pageId: string): Promise<string> {
  const shop = await getShop(session.workspaceId, shopId);
  if (!shop) return backTo(null, { problem: "shop" });
  if (!canConnect(session)) return backTo(shop.id, { problem: "role" });
  const taken = await withWorkspace(session.workspaceId, (tx) => takePageChoices<ChoiceSecret>(tx, choiceId, shop.id));
  if (!taken) return backTo(shop.id, { problem: "expired" });
  const page = taken.secret.pages.find((p) => p.id === pageId);
  if (!page) return backTo(shop.id, { problem: "expired" });
  try {
    await connectPage(session, shop, page, taken.secret.userToken);
  } catch (e) {
    return backTo(shop.id, { problem: "platform", p: taken.wanted, ...signedNote(describeMetaError(e, taken.wanted).problem ?? "") });
  }
  return backTo(shop.id, { done: taken.wanted });
}

/** Puts the whole profile kit on the connected Page, replacing what's there. */
export async function applyKitToPage(session: Session, shopId: string): Promise<string> {
  const shop = await getShop(session.workspaceId, shopId);
  if (!shop) return backTo(null, { problem: "shop" });
  if (!canConnect(session)) return backTo(shop.id, { problem: "role" });
  if (!metaReady()) return backTo(shop.id, { problem: "off" });
  const fb = await withWorkspace(session.workspaceId, async (tx) => {
    const [row] = await tx<{ id: string }[]>`
      select id from armada.social_accounts where shop_id = ${shop.id} and platform = 'facebook' and kind = 'real' and status = 'connected'`;
    return row ? loadAccountWithSecret<MetaPageSecret>(tx, row.id) : null;
  });
  if (!fb?.secret?.pageToken || !fb.externalId) return backTo(shop.id, { problem: "notconnected", p: "facebook" });
  const result = await fillPage(session.workspaceId, shop, fb.id, fb.externalId, fb.secret.pageToken, true);
  return backTo(shop.id, { kit: result.failed.length ? "partial" : "applied" });
}

// ---------- TikTok ----------

export async function tiktokStart(session: Session, shopId: string): Promise<string> {
  const shop = await getShop(session.workspaceId, shopId);
  if (!shop) return backTo(null, { problem: "shop" });
  if (!canConnect(session)) return backTo(shop.id, { problem: "role" });
  if (!tiktokReady()) return backTo(shop.id, { problem: "off" });
  const state = await createState(session.workspaceId, session.memberId, provider("tiktok"), "connect", { returnTo: backTo(shop.id), shopId: shop.id });
  return tiktokLoginUrl({ clientKey: tiktokSettings().clientKey, redirectUri: callbackUrl("tiktok"), state });
}

export async function tiktokFinish(url: URL, person: ReturningPerson): Promise<string> {
  const state = await consumeState(url.searchParams.get("state"), provider("tiktok"));
  if (!state) return backTo(null, { problem: "expired" });
  if (!samePerson(state, person)) return backTo(null, { problem: "browser" });
  const shopId = String(state.detail.shopId ?? "");
  if (url.searchParams.get("error") || !url.searchParams.get("code")) return backTo(shopId, { problem: "cancelled", p: "tiktok" });
  const shop = await getShop(state.workspaceId, shopId);
  if (!shop || !tiktokReady()) return backTo(shopId || null, { problem: shop ? "off" : "shop" });
  try {
    const access = await exchangeTikTokCode(fetch, { ...tiktokSettings(), code: url.searchParams.get("code")!, redirectUri: callbackUrl("tiktok") });
    const me = await tiktokUser(fetch, access.accessToken);
    const granted = access.scope.split(",").map((x) => x.trim());
    const missing = TIKTOK_SCOPES.filter((sc) => sc !== "user.info.profile" && !granted.includes(sc));
    const refused = "TikTok didn't let Armada send posts to this account. Press Connect again and leave every box ticked on TikTok's page.";
    await withWorkspace(state.workspaceId, (tx) =>
      saveRealAccount(tx, state.workspaceId, {
        shopId: shop.id,
        platform: "tiktok",
        name: me.displayName || me.username || "TikTok account",
        handle: me.username,
        externalId: access.openId || me.openId,
        secret: { accessToken: access.accessToken, refreshToken: access.refreshToken },
        tokenExpiresAt: access.expiresAt,
        refreshExpiresAt: access.refreshExpiresAt,
        // Connected, but without permission to send posts: saved so the card can say exactly that.
        status: missing.length ? "needs_attention" : "connected",
        meta: {
          link: me.username ? tiktokProfileUrl(me.username) : null,
          ...(missing.length ? { lastProblem: refused, lastProblemAt: new Date().toISOString() } : {}),
        },
        memberId: state.memberId,
      }),
    );
    return missing.length ? backTo(shop.id, { problem: "platform", p: "tiktok", ...signedNote(refused) }) : backTo(shop.id, { done: "tiktok" });
  } catch (e) {
    return backTo(shop.id, { problem: "platform", p: "tiktok", ...signedNote(describeTikTokError(e).problem ?? "") });
  }
}
