// The pure half of Launch: its steps, their states, and what the whole launch is waiting for.
// No imports, so scripts/check-launch.mjs loads it straight from Node.
//
// Launch is one press on a finished shop. Armada then does everything a program is allowed to do
// for that shop (list its products on the connected eBay account, prepare its Facebook Page and
// Instagram, write and schedule the first week of posts, prepare its ads switched off) and turns
// the one thing it isn't allowed to do (making an account on Facebook, Instagram or eBay) into one
// press with everything filled in and ready to copy.

export type LaunchStepKey = "store" | "checkout" | "ebay" | "facebook" | "instagram" | "pinterest" | "posts" | "ads";

/**
 * - working: Armada (or the AI helper) is doing it now
 * - needs-you: one press from the person, the only thing in the way
 * - waiting: waiting for something else (another step, a connection that isn't switched on yet)
 * - done, skipped (not for this shop), failed (stopped; pressing Launch again tries it again)
 */
export type LaunchStepState = "working" | "needs-you" | "waiting" | "done" | "skipped" | "failed";

export interface LaunchAction {
  label: string;
  href: string;
  /** Opens in a new tab (the platform's own page, or a connect flow that ends elsewhere). */
  external?: boolean;
  primary?: boolean;
}

export interface LaunchStep {
  key: LaunchStepKey;
  label: string;
  state: LaunchStepState;
  /** One or two plain sentences: what happened, or what's needed. */
  note?: string;
  actions?: LaunchAction[];
  /** For a step that needs a person: the short title Home's "Needs you" list shows. */
  ask?: string;
  /** Products done out of the total, for a step that works through a list. */
  progress?: { done: number; total: number };
  finishedAt?: string;
}

export type LaunchStatus = "working" | "needs_you" | "waiting" | "done";

/** The profile kit shown beside the Facebook and Instagram sign-up presses. */
export interface LaunchKit {
  name: string;
  pageAbout: string;
  website: string;
  instagramBio: string;
  username: string | null;
  link: string;
  avatarUrl: string;
  coverUrl: string;
}

/** What the progress view shows (the launch route answers with this). */
export interface LaunchView {
  shopId: string;
  status: LaunchStatus;
  steps: LaunchStep[];
  startedAt: string;
  finishedAt: string | null;
  helperOnline: boolean;
  /** The profile kit, when making the Facebook Page or Instagram is the person's step. */
  kit: LaunchKit | null;
}

export const LAUNCH_STEPS: { key: LaunchStepKey; label: string }[] = [
  { key: "store", label: "The shop's own store" },
  { key: "checkout", label: "Checkout" },
  { key: "ebay", label: "eBay listings" },
  { key: "facebook", label: "Facebook Page" },
  { key: "instagram", label: "Instagram" },
  { key: "pinterest", label: "Pinterest" },
  { key: "posts", label: "The first week of posts" },
  { key: "ads", label: "Ads, ready and switched off" },
];

export function freshLaunchSteps(): LaunchStep[] {
  return LAUNCH_STEPS.map((s) => ({ ...s, state: "waiting" as const }));
}

/** Steps as saved, brought up to the current list (a step added later appears as waiting). */
export function normalizeSteps(saved: LaunchStep[] | null | undefined): LaunchStep[] {
  const byKey = new Map((saved ?? []).map((s) => [s.key, s]));
  return LAUNCH_STEPS.map((s) => ({ ...s, state: "waiting" as LaunchStepState, ...byKey.get(s.key), label: s.label }));
}

/** Pressing Launch again: stopped steps get another go; everything else carries on where it was. */
export function retrySteps(steps: LaunchStep[]): LaunchStep[] {
  return steps.map((s) => (s.state === "failed" ? { key: s.key, label: s.label, state: "waiting" as const } : s));
}

/** Checkout waits on payments, which the launch can't switch on; it never holds the rest up. */
const counts = (s: LaunchStep) => s.key !== "checkout";

/** What the whole launch is doing: working beats needing a person, which beats waiting. */
export function launchStatus(steps: LaunchStep[]): LaunchStatus {
  const relevant = steps.filter(counts);
  if (relevant.some((s) => s.state === "working")) return "working";
  if (relevant.some((s) => s.state === "needs-you" || s.state === "failed")) return "needs_you";
  if (relevant.some((s) => s.state === "waiting")) return "waiting";
  return "done";
}

/** The steps waiting on a press from the person (a stopped step's press is Try again). */
export function stepsNeedingYou(steps: LaunchStep[]): LaunchStep[] {
  return steps.filter((s) => counts(s) && (s.state === "needs-you" || s.state === "failed"));
}

/** Home's "Needs you" line for a launch: the first thing only the person can do. */
export function launchNeed(brand: string, steps: LaunchStep[]): { title: string; body: string } | null {
  const first = stepsNeedingYou(steps)[0];
  if (!first) return null;
  if (first.state === "failed") return { title: `${brand}: ${first.label.toLowerCase()} stopped`, body: first.note ?? "Press Try again on the shop's page." };
  return { title: `${brand}: ${first.ask ?? first.label}`, body: first.note ?? "One press from you and the launch carries on." };
}

/** "3 of 10 listed" style progress words. */
export function progressWords(done: number, total: number, verb: string): string {
  return total ? `${done} of ${total} ${verb}` : `Nothing to ${verb.replace(/ed$/, "")}`;
}

/** The status words beside each step, for eyes and screen readers alike. */
export const STATE_WORDS: Record<LaunchStepState, string> = {
  working: "working",
  "needs-you": "your turn",
  waiting: "waiting",
  done: "done",
  skipped: "not for this shop",
  failed: "stopped",
};

/** Where each platform lets a person make the account no program may make. */
export const SIGN_UP_PAGES = {
  facebook: "https://www.facebook.com/pages/creation/",
  instagram: "https://www.instagram.com/accounts/emailsignup/",
} as const;
