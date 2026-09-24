"use server";

import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import {
  addPracticeVisitors,
  cancelTest,
  clearPracticeVisitors,
  finishTest,
  runTest,
  startHeadlineTest,
  TestProblem,
  undoWinner,
  writeMoreVersions,
} from "@/lib/abtest/tests";
import { clip } from "@/lib/text";

const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);
const page = (shopId: string, extra = "") => `/builder/${shopId}/test${extra}`;

/** Viewers can look at a test but not change it. */
async function editor() {
  const session = await requireSession();
  if (session.role === "viewer") redirect("/");
  return session;
}

export async function startTestAction(shopId: string) {
  const session = await editor();
  if (!uuid(shopId)) redirect("/builder");
  try {
    await startHeadlineTest(session.workspaceId, shopId, session.memberId);
  } catch (e) {
    if (e instanceof TestProblem) redirect(page(shopId, `?problem=${encodeURIComponent(e.message)}`));
    throw e;
  }
  redirect(page(shopId));
}

export async function writeMoreAction(shopId: string, testId: string) {
  const session = await editor();
  if (uuid(testId)) await writeMoreVersions(session.workspaceId, testId);
  redirect(page(shopId));
}

export async function runTestAction(shopId: string, testId: string, formData: FormData) {
  const session = await editor();
  const headline = clip(String(formData.get("headline") ?? ""), 70);
  const subhead = clip(String(formData.get("subhead") ?? ""), 170);
  const cta = clip(String(formData.get("cta") ?? ""), 28);
  const idea = clip(String(formData.get("idea") ?? ""), 110);
  if (!uuid(testId) || !headline) redirect(page(shopId, "?problem=" + encodeURIComponent("The new version needs a headline.")));
  await runTest(session.workspaceId, testId, { headline, subhead, cta: cta || "Shop the range", idea });
  redirect(page(shopId));
}

export async function practiceAction(shopId: string, testId: string) {
  const session = await editor();
  if (uuid(testId)) await addPracticeVisitors(session.workspaceId, testId, 1000);
  redirect(page(shopId, "#results"));
}

export async function clearPracticeAction(shopId: string, testId: string) {
  const session = await editor();
  if (uuid(testId)) await clearPracticeVisitors(session.workspaceId, testId);
  redirect(page(shopId, "#results"));
}

export async function winnerAction(shopId: string, testId: string, winner: "a" | "b" | "none") {
  const session = await editor();
  if (uuid(testId) && ["a", "b", "none"].includes(winner)) await finishTest(session.workspaceId, session.memberId, testId, winner);
  redirect(page(shopId));
}

export async function undoAction(shopId: string, testId: string) {
  const session = await editor();
  if (uuid(testId)) await undoWinner(session.workspaceId, session.memberId, testId);
  redirect(page(shopId));
}

export async function cancelAction(shopId: string, testId: string) {
  const session = await editor();
  if (uuid(testId)) await cancelTest(session.workspaceId, testId);
  redirect(page(shopId));
}
