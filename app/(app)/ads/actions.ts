"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { chooseMetaAccount, disconnectMeta } from "@/connectors/meta-ads/connection";
import {
  AdsProblem,
  discardSet,
  endSet,
  launchPaused,
  pauseSet,
  removeAd,
  restoreAd,
  retryWriting,
  rewriteAd,
  saveBudget,
  startAds,
  stopEverything,
  switchOn,
  updateAd,
} from "@/lib/ads/sets";
import { requireSession } from "@/lib/auth/session";

// Every press on the Ads screens. Viewers can look but not change anything. Spending money (switching
// on, changing the budget of ads that exist, connecting an ad account) is for owners and managers.

const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);
const shopPage = (shopId: string, extra = "") => `/ads/${shopId}${extra}`;
const withProblem = (path: string, message: string) => `${path}${path.includes("?") ? "&" : "?"}problem=${encodeURIComponent(message)}`;

async function editor() {
  const session = await requireSession();
  if (session.role === "viewer") redirect("/ads");
  return session;
}

async function spender() {
  const session = await requireSession();
  if (session.role !== "owner" && session.role !== "manager") redirect(withProblem("/ads", "Only the owner or a manager can switch ads on or change what they spend."));
  return session;
}

/** Runs a change and turns a plain-words problem into a message on the page; anything else is a real error. */
async function attempt(path: string, work: () => Promise<unknown>): Promise<void> {
  try {
    await work();
  } catch (e) {
    if (e instanceof AdsProblem) redirect(withProblem(path, e.message));
    throw e;
  }
}

async function inPlace(shopId: string, work: () => Promise<unknown>): Promise<{ problem?: string }> {
  try {
    await work();
    revalidatePath(shopPage(shopId));
    return {};
  } catch (e) {
    if (e instanceof AdsProblem) return { problem: e.message };
    throw e;
  }
}

// ---------- writing ----------

export async function makeAdsAction(shopId: string) {
  const session = await editor();
  if (!uuid(shopId)) redirect("/ads");
  await attempt("/ads", () => startAds(session.workspaceId, session.memberId, shopId));
  redirect(shopPage(shopId));
}

export async function retryAction(shopId: string, setId: string) {
  const session = await editor();
  if (uuid(setId)) await attempt(shopPage(shopId), () => retryWriting(session.workspaceId, setId));
  redirect(shopPage(shopId));
}

export async function discardAction(shopId: string, setId: string) {
  const session = await editor();
  if (uuid(setId)) await discardSet(session.workspaceId, session.memberId, setId);
  redirect(shopPage(shopId));
}

export async function saveAdAction(shopId: string, variationId: string, form: FormData) {
  const session = await editor();
  if (!uuid(variationId)) return { problem: "That ad wasn't found." };
  const cards: { headline: string; description: string; remove: boolean }[] = [];
  for (let i = 0; i < 10; i++) {
    if (!form.has(`card_${i}_remove`)) break;
    cards.push({
      headline: String(form.get(`card_${i}_headline`) ?? ""),
      description: String(form.get(`card_${i}_description`) ?? ""),
      remove: form.get(`card_${i}_remove`) === "1",
    });
  }
  return inPlace(shopId, () =>
    updateAd(session.workspaceId, variationId, {
      primaryText: String(form.get("primaryText") ?? ""),
      headline: String(form.get("headline") ?? ""),
      description: String(form.get("description") ?? ""),
      callToAction: String(form.get("callToAction") ?? ""),
      cards,
    }),
  );
}

export async function rewriteAdAction(shopId: string, variationId: string) {
  const session = await editor();
  if (!uuid(variationId)) return { problem: "That ad wasn't found." };
  return inPlace(shopId, () => rewriteAd(session.workspaceId, variationId));
}

export async function removeAdAction(shopId: string, variationId: string) {
  const session = await editor();
  if (!uuid(variationId)) return { problem: "That ad wasn't found." };
  return inPlace(shopId, () => removeAd(session.workspaceId, variationId));
}

export async function restoreAdAction(shopId: string, variationId: string) {
  const session = await editor();
  if (uuid(variationId)) await restoreAd(session.workspaceId, variationId);
  redirect(shopPage(shopId));
}

// ---------- budget ----------

export async function saveBudgetAction(shopId: string, setId: string, launched: boolean, form: FormData) {
  const session = launched ? await spender() : await editor();
  if (!uuid(setId)) return { problem: "Those ads weren't found." };
  const num = (k: string) => (form.has(k) ? Number(form.get(k)) : undefined);
  return inPlace(shopId, () =>
    saveBudget(session.workspaceId, session.memberId, setId, {
      dailyDollars: Number(form.get("daily")),
      days: Number(form.get("days")),
      ageMin: num("ageMin"),
      ageMax: num("ageMax"),
      audienceDescription: form.has("audience") ? String(form.get("audience")) : undefined,
    }),
  );
}

// ---------- creating, switching on and off ----------

export async function launchAction(shopId: string, setId: string) {
  const session = await editor();
  if (uuid(setId)) await attempt(shopPage(shopId), () => launchPaused(session.workspaceId, session.memberId, setId));
  redirect(shopPage(shopId));
}

export async function switchOnAction(shopId: string, setId: string) {
  const session = await spender();
  if (uuid(setId)) await attempt(shopPage(shopId), () => switchOn(session.workspaceId, session.memberId, setId));
  redirect(shopPage(shopId));
}

export async function pauseAction(shopId: string, setId: string) {
  const session = await editor();
  if (uuid(setId)) await attempt(shopPage(shopId), () => pauseSet(session.workspaceId, session.memberId, session.name, setId));
  redirect(shopPage(shopId));
}

export async function endAction(shopId: string, setId: string) {
  const session = await editor();
  if (uuid(setId)) await attempt(shopPage(shopId), () => endSet(session.workspaceId, session.memberId, session.name, setId));
  redirect(shopPage(shopId));
}

/** The one stop button: pauses every ad that is on, everywhere. */
export async function stopEverythingAction(returnTo: string) {
  const session = await editor();
  const back = returnTo.startsWith("/ads") ? returnTo.split("?")[0] : "/ads";
  const { paused, failed } = await stopEverything(session.workspaceId, session.memberId, session.name);
  const q = new URLSearchParams({ stopped: String(paused) });
  if (failed.length) q.set("problem", `Couldn't reach the ad platform for ${failed.join(", ")}. Those ads may still be on; pause them in the platform's own screens.`);
  redirect(`${back}?${q}`);
}

// ---------- the Meta ad account ----------

export async function chooseMetaAction(form: FormData) {
  const session = await spender();
  await chooseMetaAccount(session.workspaceId, String(form.get("adAccountId") ?? ""), String(form.get("pageId") ?? ""));
  redirect("/ads#platforms");
}

export async function disconnectMetaAction() {
  const session = await spender();
  await disconnectMeta(session.workspaceId);
  redirect("/ads#platforms");
}
