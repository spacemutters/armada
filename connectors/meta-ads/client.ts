import "server-only";
import { createHmac } from "node:crypto";
import { PlatformProblem } from "@/lib/ads/types";
import { META_STATUS_PAUSED } from "./payloads";

// Every request Armada makes to Meta's ads system goes through call() in this file.
// Version: v26.0 is Meta's current version (released 2026-07-29, checked 2026-09-24 on
// developers.facebook.com). META_GRAPH_VERSION in the server settings overrides it when Meta moves on.

export const META_VERSION = process.env.META_GRAPH_VERSION || "v26.0";
const GRAPH = "https://graph.facebook.com";
const TIMEOUT_MS = 25_000;

interface MetaErrorBody {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  error_user_title?: string;
  error_user_msg?: string;
}

/** Meta's own error, turned into a sentence a shop owner can act on. */
export class MetaProblem extends PlatformProblem {
  constructor(
    message: string,
    readonly code?: number,
    readonly subcode?: number,
    readonly signedOut = false,
  ) {
    super(message);
  }
}

function plainProblem(e: MetaErrorBody | undefined, status: number): MetaProblem {
  const code = e?.code;
  if (code === 190) return new MetaProblem("Meta signed Armada out of this ad account. Connect it again on the Ads page.", code, e?.error_subcode, true);
  if (code === 10 || code === 200 || code === 294 || (code && code >= 200 && code < 300))
    return new MetaProblem("Meta hasn't given Armada permission to do this on your ad account yet.", code, e?.error_subcode);
  if (code === 4 || code === 17 || code === 32 || code === 613 || code === 80004) return new MetaProblem("Meta is busy right now. Try again in a minute.", code, e?.error_subcode);
  if (code === 1 || code === 2 || status >= 500) return new MetaProblem("Meta had a problem on its side. Try again in a minute.", code, e?.error_subcode);
  const said = (e?.error_user_msg || e?.message || "").trim();
  return new MetaProblem(said ? `Meta said: ${said.slice(0, 300)}` : `Meta refused the request (${status}).`, code, e?.error_subcode);
}

/** Proves the request comes from Armada's app, so a leaked sign-in alone can't be replayed elsewhere. */
function appSecretProof(token: string): string | undefined {
  const secret = process.env.META_APP_SECRET;
  return secret ? createHmac("sha256", secret).update(token).digest("hex") : undefined;
}

function encode(params: Record<string, unknown>): URLSearchParams {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    out.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
  }
  return out;
}

async function call<T>(method: "GET" | "POST", path: string, token: string | null, params: Record<string, unknown> = {}): Promise<T> {
  const url = new URL(`${GRAPH}/${META_VERSION}${path}`);
  const all = { ...params, ...(token ? { access_token: token, appsecret_proof: appSecretProof(token) } : {}) };
  let res: Response;
  try {
    if (method === "GET") {
      url.search = encode(all).toString();
      res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
    } else {
      res = await fetch(url, {
        method: "POST",
        body: encode(all),
        headers: { "content-type": "application/x-www-form-urlencoded" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
    }
  } catch {
    throw new MetaProblem("Couldn't reach Meta. Check the connection and try again.");
  }
  const body = (await res.json().catch(() => null)) as (T & { error?: MetaErrorBody }) | null;
  if (!res.ok || !body || body.error) throw plainProblem(body?.error, res.status);
  return body;
}

// ---------- signing in ----------

export function loginDialogUrl(params: { appId: string; redirectUri: string; state: string; scopes: string[] }): string {
  const u = new URL(`https://www.facebook.com/${META_VERSION}/dialog/oauth`);
  u.searchParams.set("client_id", params.appId);
  u.searchParams.set("redirect_uri", params.redirectUri);
  u.searchParams.set("state", params.state);
  u.searchParams.set("scope", params.scopes.join(","));
  u.searchParams.set("response_type", "code");
  return u.toString();
}

export async function exchangeCode(code: string, redirectUri: string): Promise<{ token: string; expiresIn: number | null }> {
  const r = await call<{ access_token: string; expires_in?: number }>("GET", "/oauth/access_token", null, {
    client_id: process.env.META_APP_ID,
    client_secret: process.env.META_APP_SECRET,
    redirect_uri: redirectUri,
    code,
  });
  return { token: r.access_token, expiresIn: r.expires_in ?? null };
}

/** Swaps a short sign-in (about an hour) for a long one (about 60 days). */
export async function extendToken(token: string): Promise<{ token: string; expiresIn: number | null }> {
  const r = await call<{ access_token: string; expires_in?: number }>("GET", "/oauth/access_token", null, {
    grant_type: "fb_exchange_token",
    client_id: process.env.META_APP_ID,
    client_secret: process.env.META_APP_SECRET,
    fb_exchange_token: token,
  });
  return { token: r.access_token, expiresIn: r.expires_in ?? null };
}

export interface MetaAdAccount {
  id: string;
  name: string;
  currency: string;
  /** Meta's account_status 1 means it can run ads. */
  active: boolean;
}

export interface MetaPage {
  id: string;
  name: string;
  instagramUserId: string | null;
}

export async function whoAmI(token: string): Promise<{ id: string; name: string }> {
  return call<{ id: string; name: string }>("GET", "/me", token, { fields: "id,name" });
}

export async function listAdAccounts(token: string): Promise<MetaAdAccount[]> {
  const r = await call<{ data: { id: string; name: string; currency: string; account_status: number }[] }>("GET", "/me/adaccounts", token, {
    fields: "id,name,currency,account_status",
    limit: 50,
  });
  return r.data.map((a) => ({ id: a.id, name: a.name, currency: a.currency, active: a.account_status === 1 }));
}

export async function listPages(token: string): Promise<MetaPage[]> {
  const r = await call<{ data: { id: string; name: string; instagram_business_account?: { id: string } }[] }>("GET", "/me/accounts", token, {
    fields: "id,name,instagram_business_account",
    limit: 50,
  });
  return r.data.map((p) => ({ id: p.id, name: p.name, instagramUserId: p.instagram_business_account?.id ?? null }));
}

// ---------- making ads (everything created switched off) ----------

/** Creates one thing under an ad account (campaigns, adsets, adcreatives, ads) and returns its id. */
export async function create(token: string, accountId: string, edge: "campaigns" | "adsets" | "adcreatives" | "ads", payload: Record<string, unknown>): Promise<string> {
  if (edge !== "adcreatives" && payload.status !== META_STATUS_PAUSED) {
    // The rule, enforced at the last step as well as in the payload builders: nothing is created switched on.
    throw new MetaProblem("Armada only ever creates ads switched off.");
  }
  const r = await call<{ id: string }>("POST", `/${accountId}/${edge}`, token, payload);
  return r.id;
}

/** Uploads a product photo to the ad account and returns Meta's hash for it. */
export async function uploadImage(token: string, accountId: string, imageUrl: string): Promise<string> {
  let bytes: Buffer;
  try {
    const res = await fetch(imageUrl, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !type.startsWith("image/")) throw new Error("not an image");
    bytes = Buffer.from(await res.arrayBuffer());
  } catch {
    throw new MetaProblem("Couldn't download one of the product photos to send to Meta.");
  }
  if (bytes.length > 8 * 1024 * 1024) throw new MetaProblem("One of the product photos is larger than Meta accepts (8 MB).");
  const r = await call<{ images: Record<string, { hash: string }> }>("POST", `/${accountId}/adimages`, token, { bytes: bytes.toString("base64") });
  const first = Object.values(r.images ?? {})[0];
  if (!first?.hash) throw new MetaProblem("Meta didn't accept one of the product photos.");
  return first.hash;
}

/** Meta's own interest for each plain word ("home cooking"), best match only; words with no match are skipped. */
export async function findInterests(token: string, words: string[]): Promise<{ id: string; name: string }[]> {
  const out: { id: string; name: string }[] = [];
  for (const q of words.slice(0, 6)) {
    try {
      const r = await call<{ data: { id: string; name: string }[] }>("GET", "/search", token, { type: "adinterest", q, limit: 1 });
      if (r.data[0] && !out.some((x) => x.id === r.data[0].id)) out.push({ id: r.data[0].id, name: r.data[0].name });
    } catch {
      // An interest that can't be found just isn't used; the ads still reach the countries and ages.
    }
  }
  return out;
}

// ---------- switching on and off ----------

/** Meta's word for delivering. Used only by switchOn below, which only a person's press reaches. */
const SWITCHED_ON = "ACTIVE";

/**
 * Switches ads on: sets the ad set's hard spending cap and end date, then switches on the ads, the ad
 * set and the campaign (in that order, so nothing half-on can deliver). If any step fails, everything
 * is paused again before the problem is reported.
 */
export async function switchOn(
  token: string,
  ids: { campaignId: string; adSetId: string; adIds: string[] },
  budget: { lifetimeBudgetMinor: number; endTime: Date },
): Promise<void> {
  try {
    await call("POST", `/${ids.adSetId}`, token, { lifetime_budget: budget.lifetimeBudgetMinor, end_time: budget.endTime.toISOString(), start_time: new Date().toISOString() });
    for (const adId of ids.adIds) await call("POST", `/${adId}`, token, { status: SWITCHED_ON });
    await call("POST", `/${ids.adSetId}`, token, { status: SWITCHED_ON });
    await call("POST", `/${ids.campaignId}`, token, { status: SWITCHED_ON });
  } catch (e) {
    await pause(token, ids.campaignId).catch(() => undefined);
    throw e;
  }
}

/** Pausing the campaign stops every ad under it at once. */
export async function pause(token: string, campaignId: string): Promise<void> {
  await call("POST", `/${campaignId}`, token, { status: META_STATUS_PAUSED });
}

export async function updateAdSet(token: string, adSetId: string, payload: Record<string, unknown>): Promise<void> {
  if ("status" in payload) throw new MetaProblem("Budget changes never switch ads on or off.");
  await call("POST", `/${adSetId}`, token, payload);
}

// ---------- results ----------

export interface MetaInsightRow {
  ad_id: string;
  date_start: string;
  impressions?: string;
  reach?: string;
  inline_link_clicks?: string;
  spend?: string;
  actions?: { action_type: string; value: string }[];
  action_values?: { action_type: string; value: string }[];
}

const ADD_TO_CART = ["add_to_cart", "omni_add_to_cart", "offsite_conversion.fb_pixel_add_to_cart"];
const PURCHASE = ["purchase", "omni_purchase", "offsite_conversion.fb_pixel_purchase"];

/** The same event is reported under several names; take the largest rather than adding them up. */
export function actionCount(list: { action_type: string; value: string }[] | undefined, names: string[]): number {
  return Math.max(0, ...(list ?? []).filter((a) => names.includes(a.action_type)).map((a) => Number(a.value) || 0));
}

export async function readInsights(token: string, campaignId: string, since: Date): Promise<{ daily: MetaInsightRow[]; reachTotal: number | null }> {
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const range = { since: day(since), until: day(new Date()) };
  const fields = "ad_id,impressions,reach,inline_link_clicks,spend,actions,action_values";
  const daily: MetaInsightRow[] = [];
  let after: string | undefined;
  for (let page = 0; page < 10; page++) {
    const r = await call<{ data: MetaInsightRow[]; paging?: { cursors?: { after?: string }; next?: string } }>("GET", `/${campaignId}/insights`, token, {
      level: "ad",
      time_increment: 1,
      time_range: range,
      fields,
      limit: 200,
      after,
    });
    daily.push(...r.data);
    after = r.paging?.next ? r.paging.cursors?.after : undefined;
    if (!after) break;
  }
  // People reached can't be added up day by day (the same person shows up on several days), so it is asked for once.
  const total = await call<{ data: { reach?: string }[] }>("GET", `/${campaignId}/insights`, token, { time_range: range, fields: "reach" });
  const reachTotal = total.data[0]?.reach != null ? Number(total.data[0].reach) : null;
  return { daily, reachTotal };
}

export { ADD_TO_CART, PURCHASE };
