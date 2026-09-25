import { createHmac } from "node:crypto";
import type { Fetch, PostOutcome, Sleep, SlideIn } from "./types";

// Meta, for a shop's Facebook Page and the Instagram professional account linked to it. Every call
// Armada makes to Meta for social accounts is in this file.
//
// Sign-in is Facebook Login for Business: one Meta sign-in covers the Page and its Instagram
// account, and Page access made from a long-lived user access has no set end date. Instagram calls
// go to graph.facebook.com with the Page's access (the "Instagram API with Facebook Login" setup).
//
// Pure: no database and no settings read from the environment. Callers pass fetch, the access and
// the app settings, so scripts/check-social-accounts.mjs can drive every call against a fake.
//
// Checked against Meta's docs on 2026-09-24, and again on 2026-09-25:
//   Graph API v26.0 is current (changelog: released 2026-07-29); dialog and token exchange: facebook-login/guides/advanced/manual-flow
//   long-lived access: facebook-login/guides/access-tokens/get-long-lived
//   Instagram publishing: instagram-platform/content-publishing (JPEG only, carousels up to 10,
//     100 posts per 24 hours, status_code once a minute for up to five minutes; with Facebook Login it
//     needs instagram_basic, instagram_content_publish and pages_read_engagement, plus ads_management
//     and ads_read when the person's Page role comes through a business portfolio)
//   ig-user/media: alt_text on a single picture or a carousel picture, up to 1000 characters;
//     pictures 320 to 1440 wide, 4:5 to 1.91:1, 8 MB at most
//   Page fields: graph-api/reference/page ("about" is 100 characters; "cover" takes a photo id)
//   Page picture: graph-api/reference/page/picture (create only, `picture` = the picture's address)
//   Instagram profile (bio, picture): ig-user reference says updating is not supported.

export const GRAPH_VERSION = "v26.0";
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;
const DIALOG = `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`;

/** What Armada's Facebook Login for Business setup must ask for, and why (shown to the platform admin). */
export const META_PERMISSIONS: { name: string; why: string }[] = [
  { name: "pages_show_list", why: "see the Pages the person chose" },
  { name: "pages_read_engagement", why: "read the Page's details and set its profile picture" },
  { name: "pages_manage_metadata", why: "write the Page's description and website" },
  { name: "pages_manage_posts", why: "publish picture posts to the Page" },
  { name: "business_management", why: "Pages owned by a business portfolio, and the cover photo" },
  { name: "instagram_basic", why: "find the Instagram account linked to the Page" },
  { name: "instagram_content_publish", why: "publish carousels to Instagram" },
];

/** Instagram's own limits (content-publishing and ig-user/media docs). */
export const INSTAGRAM_MAX_SLIDES = 10;
export const INSTAGRAM_MAX_CAPTION = 2200;
/** alt_text on a single picture or a carousel picture (ig-user/media reference). */
export const INSTAGRAM_MAX_ALT = 1000;

/** Cuts text to at most `max` UTF-16 units without splitting an emoji in half. */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
}

export interface MetaCtx {
  fetch: Fetch;
  /** Adds appsecret_proof to every call made with an access, so a leaked access alone is useless. */
  appSecret?: string;
}

export class MetaError extends Error {
  readonly code?: number;
  readonly subcode?: number;
  readonly httpStatus?: number;
  readonly userMessage?: string;
  /** Set for Armada's own stops while waiting on Instagram, which have no Meta error code. */
  readonly reason?: "not_ready" | "prep_failed" | "expired";
  constructor(message: string, code?: number, subcode?: number, httpStatus?: number, userMessage?: string, reason?: MetaError["reason"]) {
    super(message);
    this.name = "MetaError";
    this.code = code;
    this.subcode = subcode;
    this.httpStatus = httpStatus;
    this.userMessage = userMessage;
    this.reason = reason;
  }
}

/** The address of Meta's own sign-in window. `configId` is the Facebook Login for Business setup, which replaces a list of permissions. */
export function metaLoginUrl(o: { appId: string; configId: string; redirectUri: string; state: string }): string {
  const u = new URL(DIALOG);
  u.searchParams.set("client_id", o.appId);
  u.searchParams.set("redirect_uri", o.redirectUri);
  u.searchParams.set("state", o.state);
  u.searchParams.set("config_id", o.configId);
  u.searchParams.set("response_type", "code");
  return u.toString();
}

type Params = Record<string, string | undefined>;

async function graph<T>(ctx: MetaCtx, method: "GET" | "POST", path: string, params: Params, token?: string): Promise<T> {
  const url = new URL(GRAPH + path);
  const all: Params = { ...params };
  if (token) {
    all.access_token = token;
    if (ctx.appSecret) all.appsecret_proof = createHmac("sha256", ctx.appSecret).update(token).digest("hex");
  }
  let init: RequestInit = { method, headers: { Accept: "application/json" } };
  if (method === "GET") {
    for (const [k, v] of Object.entries(all)) if (v !== undefined) url.searchParams.set(k, v);
  } else {
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(all)) if (v !== undefined) body.set(k, v);
    init = { method, body, headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" } };
  }
  let res: Response;
  try {
    res = await ctx.fetch(url.toString(), { ...init, signal: AbortSignal.timeout(30_000) });
  } catch (e) {
    throw new MetaError(`Couldn't reach Facebook (${(e as Error).message})`);
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // Meta always answers JSON; anything else is an outage page.
  }
  const err = (data as { error?: { message?: string; code?: number; error_subcode?: number; error_user_msg?: string } } | null)?.error;
  if (!res.ok || err) {
    throw new MetaError(err?.message ?? `Facebook answered ${res.status}`, err?.code, err?.error_subcode, res.status, err?.error_user_msg);
  }
  return data as T;
}

/** Facebook's own page for making a new Page (for people who don't have one yet). */
export const META_CREATE_PAGE_URL = "https://www.facebook.com/pages/create";

/** A public Instagram profile's address. */
export function instagramProfileUrl(username: string): string {
  return `https://www.instagram.com/${encodeURIComponent(username)}/`;
}

// ---------- sign-in ----------

export interface MetaAccess {
  accessToken: string;
  /** Seconds until it stops working, when Meta says. */
  expiresIn?: number;
}

/** Trades the one-time code from the callback for a short-lived user access. */
export async function exchangeMetaCode(ctx: MetaCtx, o: { appId: string; appSecret: string; redirectUri: string; code: string }): Promise<MetaAccess> {
  const r = await graph<{ access_token: string; expires_in?: number }>({ fetch: ctx.fetch }, "GET", "/oauth/access_token", {
    client_id: o.appId,
    redirect_uri: o.redirectUri,
    client_secret: o.appSecret,
    code: o.code,
  });
  return { accessToken: r.access_token, expiresIn: r.expires_in };
}

/** Trades a short-lived user access for one that lasts about 60 days. Page access made from it has no set end. */
export async function longLivedMetaToken(ctx: MetaCtx, o: { appId: string; appSecret: string; token: string }): Promise<MetaAccess> {
  const r = await graph<{ access_token: string; expires_in?: number }>({ fetch: ctx.fetch }, "GET", "/oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: o.appId,
    client_secret: o.appSecret,
    fb_exchange_token: o.token,
  });
  return { accessToken: r.access_token, expiresIn: r.expires_in };
}

// ---------- Pages ----------

export interface MetaPage {
  id: string;
  name: string;
  username: string | null;
  link: string | null;
  /** The Page's own access (no set end date when made from a long-lived user access). */
  accessToken: string;
  /** What the person may do on the Page: CREATE_CONTENT, MANAGE, MODERATE… */
  tasks: string[];
  instagram: { id: string; username: string | null; name: string | null } | null;
}

interface RawPage {
  id: string;
  name?: string;
  username?: string;
  link?: string;
  access_token?: string;
  tasks?: string[];
  instagram_business_account?: { id: string; username?: string; name?: string };
}

const PAGE_FIELDS = "id,name,username,link,access_token,tasks,instagram_business_account{id,username,name}";

/** The Pages the person shared with Armada in Meta's window, each with its linked Instagram account if there is one. */
export async function listPages(ctx: MetaCtx, userToken: string): Promise<MetaPage[]> {
  const out: MetaPage[] = [];
  let after: string | undefined;
  for (let i = 0; i < 5; i++) {
    const r = await graph<{ data: RawPage[]; paging?: { cursors?: { after?: string }; next?: string } }>(
      ctx,
      "GET",
      "/me/accounts",
      { fields: PAGE_FIELDS, limit: "100", after },
      userToken,
    );
    for (const p of r.data ?? []) {
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
    after = r.paging?.next ? r.paging.cursors?.after : undefined;
    if (!after) break;
  }
  return out;
}

/** The Instagram account linked to a Page right now (someone may have linked it since connecting). */
export async function linkedInstagram(ctx: MetaCtx, pageId: string, pageToken: string): Promise<MetaPage["instagram"]> {
  const r = await graph<{ instagram_business_account?: { id: string; username?: string; name?: string } }>(
    ctx,
    "GET",
    `/${pageId}`,
    { fields: "instagram_business_account{id,username,name}" },
    pageToken,
  );
  const ig = r.instagram_business_account;
  return ig ? { id: ig.id, username: ig.username ?? null, name: ig.name ?? null } : null;
}

export interface PageSetup {
  about: string;
  website: string;
  pictureUrl: string;
  coverUrl: string;
  /** Replace what the Page already has. Off, Armada only fills what's empty. */
  overwrite: boolean;
}

export type SetupPart = "about" | "website" | "picture" | "cover";
export interface PageSetupResult {
  /** Parts Armada wrote. */
  done: SetupPart[];
  /** Parts the Page already had, left as they were. */
  kept: SetupPart[];
  /** Parts Meta refused, with a plain reason. */
  failed: { part: SetupPart; problem: string }[];
}

/**
 * Fills in the Page from the shop's profile kit: description (Meta's "about", 100 characters),
 * website, profile picture and cover photo. Each part is tried on its own, so one refusal doesn't
 * stop the rest.
 */
export async function setupPage(ctx: MetaCtx, pageId: string, pageToken: string, s: PageSetup): Promise<PageSetupResult> {
  const result: PageSetupResult = { done: [], kept: [], failed: [] };
  let current: { about?: string; website?: string; cover?: { id?: string }; picture?: { data?: { is_silhouette?: boolean } } } = {};
  try {
    current = await graph(ctx, "GET", `/${pageId}`, { fields: "about,website,cover,picture{is_silhouette}" }, pageToken);
  } catch {
    // Can't read it: treat everything as empty only when told to overwrite; otherwise leave it all alone.
    if (!s.overwrite) {
      result.kept.push("about", "website", "picture", "cover");
      return result;
    }
  }

  const fields: Params = {};
  const wantAbout = s.overwrite || !current.about?.trim();
  const wantWebsite = s.overwrite || !current.website?.trim();
  if (wantAbout) fields.about = clip(s.about, 100);
  else result.kept.push("about");
  if (wantWebsite) fields.website = s.website;
  else result.kept.push("website");
  if (wantAbout || wantWebsite) {
    try {
      await graph(ctx, "POST", `/${pageId}`, fields, pageToken);
      if (wantAbout) result.done.push("about");
      if (wantWebsite) result.done.push("website");
    } catch (e) {
      const problem = describeMetaError(e).problem!;
      if (wantAbout) result.failed.push({ part: "about", problem });
      if (wantWebsite) result.failed.push({ part: "website", problem });
    }
  }

  const pictureIsDefault = current.picture?.data?.is_silhouette !== false;
  if (s.overwrite || pictureIsDefault) {
    try {
      await graph(ctx, "POST", `/${pageId}/picture`, { picture: s.pictureUrl }, pageToken);
      result.done.push("picture");
    } catch (e) {
      result.failed.push({ part: "picture", problem: describeMetaError(e).problem! });
    }
  } else result.kept.push("picture");

  if (s.overwrite || !current.cover?.id) {
    try {
      const photo = await graph<{ id: string }>(ctx, "POST", `/${pageId}/photos`, { url: s.coverUrl, published: "false" }, pageToken);
      await graph(ctx, "POST", `/${pageId}`, { cover: photo.id }, pageToken);
      result.done.push("cover");
    } catch (e) {
      result.failed.push({ part: "cover", problem: describeMetaError(e).problem! });
    }
  } else result.kept.push("cover");

  return result;
}

// ---------- publishing ----------

export interface PublishOpts {
  sleep: Sleep;
  /** How long to wait for Instagram to finish preparing the pictures, in total. */
  maxWaitMs?: number;
}

/** Waits between status checks: quick at first (pictures are usually ready in seconds), then once every 15 s. */
const WAITS = [1000, 2000, 3000, 5000, 10_000, 15_000];

async function waitUntilReady(ctx: MetaCtx, containerId: string, token: string, o: PublishOpts): Promise<void> {
  let waited = 0;
  const max = o.maxWaitMs ?? 120_000;
  for (let i = 0; ; i++) {
    const r = await graph<{ status_code?: string; status?: string }>(ctx, "GET", `/${containerId}`, { fields: "status_code,status" }, token);
    if (r.status_code === "FINISHED" || r.status_code === "PUBLISHED") return;
    if (r.status_code === "ERROR") throw new MetaError(r.status || "container error", undefined, undefined, 200, undefined, "prep_failed");
    if (r.status_code === "EXPIRED") throw new MetaError("container expired", undefined, undefined, 200, undefined, "expired");
    const wait = WAITS[Math.min(i, WAITS.length - 1)];
    if (waited + wait > max) throw new MetaError("still preparing", undefined, undefined, 200, undefined, "not_ready");
    await o.sleep(wait);
    waited += wait;
  }
}

/**
 * Publishes a carousel to an Instagram professional account: one item container per picture
 * (is_carousel_item), then the carousel container (media_type CAROUSEL, children), waiting on each
 * container's status_code, then media_publish. One picture is posted as a single-image post.
 */
export async function publishInstagramCarousel(
  ctx: MetaCtx,
  a: { igId: string; token: string; caption: string; slides: SlideIn[] },
  o: PublishOpts,
): Promise<PostOutcome> {
  const { igId, token, slides } = a;
  if (!slides.length) return { ok: false, problem: "This post has no pictures." };
  if (slides.length > INSTAGRAM_MAX_SLIDES) return { ok: false, problem: `Instagram takes up to ${INSTAGRAM_MAX_SLIDES} pictures in one post; this one has ${slides.length}.` };
  const caption = clip(a.caption, INSTAGRAM_MAX_CAPTION);
  const alt = (s: SlideIn) => clip(s.alt ?? "", INSTAGRAM_MAX_ALT) || undefined;
  try {
    // Apps may publish 100 posts per account per 24 hours. Asking first gives a plain answer instead of a refusal halfway.
    try {
      const limit = await graph<{ data?: { quota_usage?: number; config?: { quota_total?: number } }[] }>(
        ctx,
        "GET",
        `/${igId}/content_publishing_limit`,
        { fields: "quota_usage,config" },
        token,
      );
      const row = limit.data?.[0];
      if (row?.config?.quota_total && (row.quota_usage ?? 0) >= row.config.quota_total) {
        return { ok: false, problem: `Instagram allows ${row.config.quota_total} posts a day from apps, and this account has used them. It can post again tomorrow.` };
      }
    } catch (e) {
      if (e instanceof MetaError && isAccessError(e)) throw e;
      // Otherwise the limit check is only a courtesy; carry on.
    }

    let containerId: string;
    if (slides.length === 1) {
      const c = await graph<{ id: string }>(ctx, "POST", `/${igId}/media`, { image_url: slides[0].imageUrl, alt_text: alt(slides[0]), caption }, token);
      containerId = c.id;
    } else {
      const children: string[] = [];
      for (const s of slides) {
        const c = await graph<{ id: string }>(ctx, "POST", `/${igId}/media`, { image_url: s.imageUrl, is_carousel_item: "true", alt_text: alt(s) }, token);
        children.push(c.id);
      }
      for (const id of children) await waitUntilReady(ctx, id, token, o);
      const carousel = await graph<{ id: string }>(ctx, "POST", `/${igId}/media`, { media_type: "CAROUSEL", children: children.join(","), caption }, token);
      containerId = carousel.id;
    }
    await waitUntilReady(ctx, containerId, token, o);
    const published = await graph<{ id: string }>(ctx, "POST", `/${igId}/media_publish`, { creation_id: containerId }, token);
    let url: string | undefined;
    try {
      url = (await graph<{ permalink?: string }>(ctx, "GET", `/${published.id}`, { fields: "permalink" }, token)).permalink;
    } catch {
      // The post is out; the link is a nicety.
    }
    return { ok: true, externalId: published.id, url };
  } catch (e) {
    return describeMetaError(e, "instagram");
  }
}

/** Publishes a multi-picture post to a Facebook Page: each picture uploaded unpublished, then one post that attaches them all. */
export async function publishPagePhotos(ctx: MetaCtx, a: { pageId: string; token: string; caption: string; slides: SlideIn[] }): Promise<PostOutcome> {
  const { pageId, token, slides } = a;
  if (!slides.length) return { ok: false, problem: "This post has no pictures." };
  try {
    const ids: string[] = [];
    for (const s of slides) {
      const p = await graph<{ id: string }>(ctx, "POST", `/${pageId}/photos`, { url: s.imageUrl, published: "false", alt_text_custom: s.alt || undefined }, token);
      ids.push(p.id);
    }
    const params: Params = { message: a.caption };
    ids.forEach((id, i) => (params[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id })));
    const post = await graph<{ id: string }>(ctx, "POST", `/${pageId}/feed`, params, token);
    let url: string | undefined = `https://www.facebook.com/${post.id}`;
    try {
      url = (await graph<{ permalink_url?: string }>(ctx, "GET", `/${post.id}`, { fields: "permalink_url" }, token)).permalink_url ?? url;
    } catch {
      // Keep the constructed link.
    }
    return { ok: true, externalId: post.id, url };
  } catch (e) {
    return describeMetaError(e, "facebook");
  }
}

// ---------- plain words for Meta's refusals ----------

function isAccessError(e: MetaError): boolean {
  // 190: the access expired or was removed. 102: session problem. 10 and 200-299: a permission is missing.
  return e.code === 190 || e.code === 102 || e.code === 10 || (e.code !== undefined && e.code >= 200 && e.code < 300);
}

/** A plain sentence for anything Meta refused, and whether the account needs connecting again. */
export function describeMetaError(e: unknown, platform: "instagram" | "facebook" = "facebook"): PostOutcome {
  const name = platform === "instagram" ? "Instagram" : "Facebook";
  if (!(e instanceof MetaError)) return { ok: false, problem: `${name} didn't answer properly. Try again in a minute.` };
  if (e.reason === "not_ready") return { ok: false, problem: "Instagram is still preparing the pictures. Try publishing again in a few minutes." };
  if (e.reason === "expired") return { ok: false, problem: "Instagram's prepared post expired before it went out. Publish it again." };
  if (e.reason === "prep_failed") {
    return { ok: false, problem: "Instagram couldn't use one of the pictures. They must be JPEG files, 320 to 1440 pixels wide, between 4:5 (tall) and 1.91:1 (wide)." };
  }
  if (e.code === 190 || e.code === 102) {
    return { ok: false, reconnect: true, problem: `${name} stopped accepting Armada's access to this account. Press Connect again to renew it.` };
  }
  if (e.code === 10 || (e.code !== undefined && e.code >= 200 && e.code < 300)) {
    return { ok: false, reconnect: true, problem: `${name} didn't give Armada permission for this. Connect again and allow everything Armada asks for.` };
  }
  if (e.code === 4 || e.code === 17 || e.code === 32 || e.code === 613 || e.code === 80001 || e.code === 9 || e.subcode === 2207042) {
    return { ok: false, problem: `${name} is limiting how often Armada can post for this account. Try again in an hour.` };
  }
  if (e.subcode === 2207052 || e.subcode === 2207026 || /download|fetch|image_url|media url/i.test(e.message)) {
    return { ok: false, problem: `${name} couldn't download the pictures. ${platform === "instagram" ? "They must be JPEG files at a public address." : "They must be at a public address."}` };
  }
  if (e.subcode === 2207009 || /aspect ratio/i.test(e.message)) {
    return { ok: false, problem: "Instagram only takes pictures between 4:5 (tall) and 1.91:1 (wide)." };
  }
  if (e.httpStatus === undefined) return { ok: false, problem: `${name} couldn't be reached. Try again in a minute.` };
  const said = (e.userMessage || e.message || "").replace(/\s+/g, " ").trim().slice(0, 160);
  return { ok: false, problem: `${name} didn't accept it${said ? `: ${said}` : "."}` };
}
