import type { Fetch, PostOutcome, Sleep } from "./types";

// TikTok, for a shop's TikTok account. Every call Armada makes to TikTok for social accounts is in
// this file: Login Kit for web (the sign-in), access renewal, the profile, and photo posts through
// the Content Posting API.
//
// Photo carousels go to the person's TikTok inbox (post_mode MEDIA_UPLOAD) and they finish the post
// in TikTok with one tap. TikTok's rules for posting straight to a profile require the person to
// pick who can see each post, with no default, right before it goes out, and an app that hasn't
// passed TikTok's audit can only post privately; sending to the inbox keeps those choices in TikTok.
//
// Pure: callers pass fetch, the access and the app settings, so scripts/check-social-accounts.mjs
// can drive it offline.
//
// Checked against TikTok's docs on 2026-09-24:
//   login-kit-web (authorize address, callback), oauth-user-access-token-management (24-hour access,
//   365-day renewal, the renewal code may change), content-posting-api-reference-photo-post (up to 35
//   pictures, PULL_FROM_URL only, title 90, description 4000, video.upload for MEDIA_UPLOAD),
//   content-posting-api-media-transfer-guide (JPEG or WebP, 1080p at most, the address must be on a
//   verified domain or URL prefix and must not redirect), content-posting-api-reference-get-video-status.

const AUTHORIZE = "https://www.tiktok.com/v2/auth/authorize/";
const API = "https://open.tiktokapis.com/v2";

/** user.info.basic: name and picture. user.info.profile: the @username. video.upload: send posts to the inbox. */
export const TIKTOK_SCOPES = ["user.info.basic", "user.info.profile", "video.upload"];
export const TIKTOK_MAX_PHOTOS = 35;
export const TIKTOK_MAX_TITLE = 90;
export const TIKTOK_MAX_DESCRIPTION = 4000;

export class TikTokError extends Error {
  readonly code: string;
  readonly httpStatus?: number;
  constructor(message: string, code: string, httpStatus?: number) {
    super(message);
    this.name = "TikTokError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

/** The address of TikTok's own sign-in (and sign-up) page. */
export function tiktokLoginUrl(o: { clientKey: string; redirectUri: string; state: string; scopes?: string[] }): string {
  const u = new URL(AUTHORIZE);
  u.searchParams.set("client_key", o.clientKey);
  u.searchParams.set("scope", (o.scopes ?? TIKTOK_SCOPES).join(","));
  u.searchParams.set("response_type", "code");
  u.searchParams.set("redirect_uri", o.redirectUri);
  u.searchParams.set("state", o.state);
  return u.toString();
}

/** A public TikTok profile's address. */
export function tiktokProfileUrl(username: string): string {
  return `https://www.tiktok.com/@${encodeURIComponent(username)}`;
}

export interface TikTokAccess {
  accessToken: string;
  refreshToken: string;
  openId: string;
  scope: string;
  /** When the access stops working (24 hours after it's issued). */
  expiresAt: Date;
  /** When the renewal code stops working (365 days). */
  refreshExpiresAt: Date;
}

async function tokenCall(f: Fetch, form: Record<string, string>, now: number): Promise<TikTokAccess> {
  let res: Response;
  try {
    res = await f(`${API}/oauth/token/`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-cache" },
      body: new URLSearchParams(form),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    throw new TikTokError(`Couldn't reach TikTok (${(e as Error).message})`, "unreachable");
  }
  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    open_id?: string;
    scope?: string;
    expires_in?: number;
    refresh_expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || data.error || !data.access_token || !data.refresh_token) {
    throw new TikTokError(data.error_description || data.error || `TikTok answered ${res.status}`, data.error || "token_failed", res.status);
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    openId: data.open_id ?? "",
    scope: data.scope ?? "",
    expiresAt: new Date(now + (data.expires_in ?? 86_400) * 1000),
    refreshExpiresAt: new Date(now + (data.refresh_expires_in ?? 31_536_000) * 1000),
  };
}

/** Trades the one-time code from the callback for access and a renewal code. */
export function exchangeTikTokCode(f: Fetch, o: { clientKey: string; clientSecret: string; code: string; redirectUri: string; now?: number }): Promise<TikTokAccess> {
  return tokenCall(
    f,
    { client_key: o.clientKey, client_secret: o.clientSecret, code: o.code, grant_type: "authorization_code", redirect_uri: o.redirectUri },
    o.now ?? Date.now(),
  );
}

/** Renews the 24-hour access. TikTok may hand back a new renewal code; the caller must keep the one returned. */
export function refreshTikTokToken(f: Fetch, o: { clientKey: string; clientSecret: string; refreshToken: string; now?: number }): Promise<TikTokAccess> {
  return tokenCall(f, { client_key: o.clientKey, client_secret: o.clientSecret, grant_type: "refresh_token", refresh_token: o.refreshToken }, o.now ?? Date.now());
}

/** True when the access runs out within `marginMs` (five minutes by default), so it should be renewed first. */
export function needsRefresh(expiresAt: Date | string | null | undefined, now = Date.now(), marginMs = 5 * 60_000): boolean {
  if (!expiresAt) return true;
  return new Date(expiresAt).getTime() - now < marginMs;
}

async function api<T>(f: Fetch, method: "GET" | "POST", path: string, token: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await f(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json; charset=UTF-8" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    throw new TikTokError(`Couldn't reach TikTok (${(e as Error).message})`, "unreachable");
  }
  const data = (await res.json().catch(() => ({}))) as { data?: T; error?: { code?: string; message?: string } };
  const code = data.error?.code ?? (res.ok ? "ok" : `http_${res.status}`);
  if (code !== "ok") throw new TikTokError(data.error?.message || `TikTok answered ${res.status}`, code, res.status);
  return (data.data ?? {}) as T;
}

export interface TikTokProfile {
  openId: string;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
}

export async function tiktokUser(f: Fetch, token: string): Promise<TikTokProfile> {
  const d = await api<{ user?: { open_id?: string; display_name?: string; username?: string; avatar_url?: string } }>(
    f,
    "GET",
    "/user/info/?fields=open_id,display_name,username,avatar_url",
    token,
  );
  return { openId: d.user?.open_id ?? "", displayName: d.user?.display_name ?? "", username: d.user?.username || null, avatarUrl: d.user?.avatar_url ?? null };
}

/** Waits between status checks while TikTok downloads the pictures. */
const WAITS = [1500, 2500, 4000, 6000, 10_000];

/**
 * Sends a photo carousel to the person's TikTok inbox: TikTok downloads the pictures from Armada's
 * verified address, then notifies them in the app to finish the post.
 */
export async function publishTikTokPhotos(
  f: Fetch,
  a: { token: string; caption: string; photoUrls: string[] },
  o: { sleep: Sleep; maxWaitMs?: number },
): Promise<PostOutcome> {
  if (!a.photoUrls.length) return { ok: false, problem: "This post has no pictures." };
  if (a.photoUrls.length > TIKTOK_MAX_PHOTOS) return { ok: false, problem: `TikTok takes up to ${TIKTOK_MAX_PHOTOS} pictures in one post; this one has ${a.photoUrls.length}.` };
  const firstLine = a.caption.split(/\r?\n/).find((l) => l.trim()) ?? "";
  try {
    const init = await api<{ publish_id?: string }>(f, "POST", "/post/publish/content/init/", a.token, {
      post_info: { title: firstLine.slice(0, TIKTOK_MAX_TITLE), description: a.caption.slice(0, TIKTOK_MAX_DESCRIPTION) },
      source_info: { source: "PULL_FROM_URL", photo_cover_index: 0, photo_images: a.photoUrls },
      post_mode: "MEDIA_UPLOAD",
      media_type: "PHOTO",
    });
    const publishId = init.publish_id;
    if (!publishId) return { ok: false, problem: "TikTok didn't take the post. Try again in a minute." };

    let waited = 0;
    const max = o.maxWaitMs ?? 60_000;
    for (let i = 0; ; i++) {
      const s = await api<{ status?: string; fail_reason?: string }>(f, "POST", "/post/publish/status/fetch/", a.token, { publish_id: publishId });
      if (s.status === "SEND_TO_USER_INBOX" || s.status === "PUBLISH_COMPLETE") return { ok: true, externalId: publishId };
      if (s.status === "FAILED") return { ok: false, problem: failReason(s.fail_reason), reconnect: s.fail_reason === "auth_removed" };
      const wait = WAITS[Math.min(i, WAITS.length - 1)];
      // Still downloading after the wait: TikTok carries on by itself and notifies the person when it's ready.
      if (waited + wait > max) return { ok: true, externalId: publishId };
      await o.sleep(wait);
      waited += wait;
    }
  } catch (e) {
    return describeTikTokError(e);
  }
}

function failReason(r: string | undefined): string {
  switch (r) {
    case "photo_pull_failed":
    case "file_format_check_failed":
    case "picture_size_check_failed":
      return "TikTok couldn't use the pictures. They must be JPEG or WebP, at most 1080 pixels, at Armada's confirmed address.";
    case "auth_removed":
      return "The TikTok account removed Armada's access. Press Connect again to renew it.";
    case "spam_risk_too_many_posts":
    case "spam_risk_too_many_pending_share":
      return "TikTok is limiting how many posts this account can receive right now. Finish the ones in your TikTok inbox, then try again tomorrow.";
    case "spam_risk_user_banned_from_posting":
      return "TikTok has stopped this account from posting. Check the account in the TikTok app.";
    case "publish_cancelled":
      return "The post was cancelled in TikTok.";
    default:
      return "TikTok couldn't take the post. Try again in a few minutes.";
  }
}

/** A plain sentence for anything TikTok refused, and whether the account needs connecting again. */
export function describeTikTokError(e: unknown): PostOutcome {
  if (!(e instanceof TikTokError)) return { ok: false, problem: "TikTok didn't answer properly. Try again in a minute." };
  switch (e.code) {
    case "access_token_invalid":
    case "invalid_grant":
    case "scope_not_authorized":
    case "scope_permission_missed":
      return { ok: false, reconnect: true, problem: "TikTok stopped accepting Armada's access to this account. Press Connect again to renew it." };
    case "rate_limit_exceeded":
      return { ok: false, problem: "TikTok is limiting how often Armada can post right now. Try again in a minute." };
    case "url_ownership_unverified":
      return { ok: false, problem: "TikTok hasn't confirmed Armada's picture address yet. The Armada owner sets this up once." };
    case "spam_risk_too_many_pending_share":
    case "spam_risk_too_many_posts":
      return { ok: false, problem: "TikTok is limiting how many posts this account can receive right now. Finish the ones in your TikTok inbox, then try again tomorrow." };
    case "unreachable":
      return { ok: false, problem: "TikTok couldn't be reached. Try again in a minute." };
    default:
      return { ok: false, problem: `TikTok didn't accept it: ${e.message.replace(/\s+/g, " ").trim().slice(0, 160)}` };
  }
}
