"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { appOrigin } from "@/lib/connections/types";
import { signedNote } from "@/lib/social/accounts/config";
import { socialAccountsFor } from "@/lib/social/accounts";
import {
  cancelRun,
  PostProblem,
  remakeSlidePicture,
  removePost,
  saveCaption,
  saveSlides,
  scheduleAllSuggested,
  schedulePost,
  startRewrite,
  startWeek,
  unschedulePost,
  uuid,
  type SlideEdit,
} from "@/lib/social/posts/queries";
import { publishPostNow } from "@/lib/social/posts/schedule";
import { shopAccounts } from "@/lib/social/posts/targets";
import { MAX_SLIDES } from "@/lib/social/posts/schema";
import type { SocialAccount } from "@/lib/social/types";

// Everything the posts screen can change. Viewers can look but not change; every action checks the
// ids it's given and works inside the signed-in workspace only.

const page = (shopId: string, extra = "") => `/social?shop=${shopId}${extra}`;
// Problems travel as signed notes, so the page only ever shows words Armada wrote.
const problem = (shopId: string, message: string, postId?: string) =>
  page(shopId, `&${new URLSearchParams(signedNote(message))}${postId ? `&for=${postId}#post-${postId}` : ""}`);

/** Back to the posts page with its data read fresh (a redirect to the same page alone keeps the old data). */
function go(url: string): never {
  revalidatePath("/social");
  redirect(url);
}

async function editor() {
  const session = await requireSession();
  if (session.role === "viewer") redirect("/");
  return session;
}

async function chosenAccounts(workspaceId: string, shopId: string, formData: FormData): Promise<string[]> {
  const wanted = new Set(formData.getAll("account").map(String));
  const { eligible } = await shopAccounts(workspaceId, shopId);
  return eligible.filter((a) => wanted.has(a.id)).map((a) => a.id);
}

export async function makeWeekAction(shopId: string) {
  const session = await editor();
  if (!uuid(shopId)) redirect("/social");
  try {
    const accounts = await socialAccountsFor(session.workspaceId, shopId).catch(() => [] as SocialAccount[]);
    await startWeek(session.workspaceId, shopId, session.memberId, accounts.map((a) => a.platform));
  } catch (e) {
    if (e instanceof PostProblem) go(problem(shopId, e.message));
    throw e;
  }
  go(page(shopId, "#writing"));
}

export async function cancelRunAction(shopId: string, runId: string) {
  const session = await editor();
  if (uuid(runId)) await cancelRun(session.workspaceId, runId);
  go(page(shopId));
}

export async function rewriteAction(shopId: string, postId: string) {
  const session = await editor();
  if (!uuid(postId)) go(page(shopId));
  try {
    const accounts = await socialAccountsFor(session.workspaceId, shopId).catch(() => [] as SocialAccount[]);
    await startRewrite(session.workspaceId, postId, session.memberId, accounts.map((a) => a.platform));
  } catch (e) {
    if (e instanceof PostProblem) go(problem(shopId, e.message, postId));
    throw e;
  }
  go(page(shopId, `#post-${postId}`));
}

export async function captionAction(shopId: string, postId: string, formData: FormData) {
  const session = await editor();
  if (!uuid(postId)) go(page(shopId));
  await saveCaption(session.workspaceId, postId, String(formData.get("caption") ?? ""), String(formData.get("hashtags") ?? ""));
  go(page(shopId, `&saved=${postId}#post-${postId}`));
}

export async function slidesAction(shopId: string, postId: string, formData: FormData) {
  const session = await editor();
  if (!uuid(postId)) go(page(shopId));
  const edits: SlideEdit[] = [];
  for (let n = 1; n <= MAX_SLIDES; n++) {
    if (!formData.has(`headline-${n}`)) continue;
    edits.push({
      n,
      headline: String(formData.get(`headline-${n}`) ?? ""),
      line: String(formData.get(`line-${n}`) ?? ""),
      photo: String(formData.get(`photo-${n}`) ?? "keep"),
    });
  }
  try {
    await saveSlides(session.workspaceId, postId, edits);
  } catch (e) {
    if (e instanceof PostProblem) go(problem(shopId, e.message, postId));
    throw e;
  }
  go(page(shopId, `&saved=${postId}#post-${postId}`));
}

/** "Make again" on one slide's picture made with AI. */
export async function remakeSlidePictureAction(shopId: string, postId: string, n: number) {
  const session = await editor();
  if (!uuid(postId) || !Number.isInteger(n) || n < 1 || n > MAX_SLIDES) go(page(shopId));
  try {
    await remakeSlidePicture(session.workspaceId, postId, n);
  } catch (e) {
    if (e instanceof PostProblem) go(problem(shopId, e.message, postId));
    throw e;
  }
  go(page(shopId, `#post-${postId}`));
}

export async function removeAction(shopId: string, postId: string) {
  const session = await editor();
  if (uuid(postId)) await removePost(session.workspaceId, postId);
  go(page(shopId));
}

export async function scheduleAction(shopId: string, postId: string, formData: FormData) {
  const session = await editor();
  if (!uuid(postId)) go(page(shopId));
  const at = new Date(String(formData.get("at") ?? ""));
  if (Number.isNaN(at.getTime())) go(problem(shopId, "Pick a day and time for this post.", postId));
  if (at.getTime() < Date.now() + 60_000) go(problem(shopId, "That time has already passed. Pick a later one, or use Post now.", postId));
  if (at.getTime() > Date.now() + 120 * 86_400_000) go(problem(shopId, "Posts can be scheduled up to four months ahead.", postId));
  const accounts = await chosenAccounts(session.workspaceId, shopId, formData);
  if (!accounts.length) go(problem(shopId, "Choose at least one account for this post.", postId));
  const ok = await schedulePost(session.workspaceId, shopId, postId, at, accounts, appOrigin());
  if (!ok) go(problem(shopId, "This post can't be scheduled right now.", postId));
  go(page(shopId, `#post-${postId}`));
}

export async function postNowAction(shopId: string, postId: string, formData: FormData) {
  const session = await editor();
  if (!uuid(postId)) go(page(shopId));
  const accounts = await chosenAccounts(session.workspaceId, shopId, formData);
  if (!accounts.length) go(problem(shopId, "Choose at least one account for this post.", postId));
  const ok = await schedulePost(session.workspaceId, shopId, postId, new Date(), accounts, appOrigin());
  if (!ok) go(problem(shopId, "This post can't be sent right now.", postId));
  // Sent after this answer, so the page can show it on its way; the once-a-minute sweep picks it up if this is cut off.
  const workspaceId = session.workspaceId;
  after(() => publishPostNow(workspaceId, postId).catch((e) => console.error("post now failed", postId, e)));
  go(page(shopId, `#post-${postId}`));
}

export async function unscheduleAction(shopId: string, postId: string) {
  const session = await editor();
  if (uuid(postId)) await unschedulePost(session.workspaceId, postId);
  go(page(shopId, `#post-${postId}`));
}

/** Queues every draft at its suggested time, to every account that can take it. */
export async function scheduleAllAction(shopId: string) {
  const session = await editor();
  if (!uuid(shopId)) redirect("/social");
  const accounts = (await shopAccounts(session.workspaceId, shopId)).eligible.map((a) => a.id);
  if (!accounts.length) go(problem(shopId, "This shop has no accounts that can take posts yet."));
  const { scheduled, past } = await scheduleAllSuggested(session.workspaceId, shopId, accounts, appOrigin());
  go(page(shopId, `${past ? `&scheduled=${scheduled}&past=${past}` : ""}#queue`));
}
