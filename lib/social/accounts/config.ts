import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { appOrigin, hasEnv } from "@/lib/connections/types";
import type { SocialPlatform } from "@/lib/social/types";

// Which social platforms are switched on, and the addresses the platform admin registers with Meta
// and TikTok. A platform is switched on when all of its server settings are present; until then
// people see it as coming soon (and can still use a practice account and the profile kit).

/** Meta's app (Facebook Pages and Instagram): the app id and secret, and the Facebook Login for Business setup id. */
export const META_ENV = ["META_APP_ID", "META_APP_SECRET", "META_SOCIAL_CONFIG_ID"];
/** TikTok's app with Login Kit and the Content Posting API. */
export const TIKTOK_ENV = ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"];
/** The file TikTok asks for to prove Armada owns the picture address (its name, and the text inside). */
export const TIKTOK_VERIFY_ENV = ["TIKTOK_VERIFY_FILE", "TIKTOK_VERIFY_TEXT"];

export function metaReady(): boolean {
  return hasEnv(META_ENV);
}
export function tiktokReady(): boolean {
  return hasEnv(TIKTOK_ENV);
}
/** TikTok only downloads pictures from an address Armada has proven it owns. */
export function tiktokPicturesReady(): boolean {
  return tiktokReady() && hasEnv(TIKTOK_VERIFY_ENV);
}
export function platformReady(p: SocialPlatform): boolean {
  return p === "tiktok" ? tiktokReady() : metaReady();
}

export function metaSettings() {
  return { appId: process.env.META_APP_ID!, appSecret: process.env.META_APP_SECRET!, configId: process.env.META_SOCIAL_CONFIG_ID! };
}
export function tiktokSettings() {
  return { clientKey: process.env.TIKTOK_CLIENT_KEY!, clientSecret: process.env.TIKTOK_CLIENT_SECRET! };
}

export type ConnectRoute = "facebook_page" | "instagram" | "tiktok";
export const ROUTE_FOR: Record<SocialPlatform, ConnectRoute> = { facebook: "facebook_page", instagram: "instagram", tiktok: "tiktok" };

export function callbackUrl(route: ConnectRoute): string {
  return `${appOrigin()}/api/connect/${route}/callback`;
}

/** Where Meta, TikTok and people download a shop's kit pictures (public: the shop's link is unguessable, like its preview). */
export function kitImageUrl(slug: string, kind: "avatar" | "cover"): string {
  return `${appOrigin()}/api/social-kit/${slug}/${kind}.png`;
}

/** The address prefix TikTok must confirm Armada owns, so it will download pictures from it. */
export function tiktokPicturePrefix(): string {
  return `${appOrigin()}/api/social-kit/`;
}

/** The key that signs relayed picture addresses, derived from the encryption key so there's no extra setting. */
export function relaySecret(): Buffer {
  const k = process.env.ENCRYPTION_KEY;
  if (!k) throw new Error("ENCRYPTION_KEY is not set");
  return createHmac("sha256", k).update("armada social picture relay").digest();
}

/**
 * A platform's refusal travels back to the page in the address (?why=…), so it's signed: the page
 * shows only words Armada wrote, never text someone put in a link.
 */
function noteKey(): Buffer {
  const k = process.env.ENCRYPTION_KEY;
  if (!k) throw new Error("ENCRYPTION_KEY is not set");
  return createHmac("sha256", k).update("armada social page note").digest();
}
const noteSig = (text: string) => createHmac("sha256", noteKey()).update(text).digest("base64url").slice(0, 22);

/** Address parameters that carry a sentence to the social page: ?why=<text>&ws=<signature>. */
export function signedNote(text: string): Record<string, string> {
  const t = text.trim().slice(0, 300);
  return t ? { why: t, ws: noteSig(t) } : {};
}

/** The sentence from ?why= when its signature matches, otherwise null. */
export function readNote(why: string | undefined, sig: string | undefined): string | null {
  if (!why || !sig || why.length > 300) return null;
  const want = Buffer.from(noteSig(why));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got) ? why : null;
}

/** The one-time state's platform label in armada.oauth_states (free text there). */
export const STATE_PROVIDER: Record<ConnectRoute, string> = {
  facebook_page: "social_facebook_page",
  instagram: "social_instagram",
  tiktok: "social_tiktok",
};
