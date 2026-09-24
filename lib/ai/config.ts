// Which model each AI job uses. Change routing here, never in calling code.
// Values are the Claude command-line tool's model aliases.
export const AI_MODELS = {
  "shop.concept": "sonnet",
  "shop.products": "sonnet",
  "shop.pages": "sonnet",
  default: "sonnet",
} as const;

export function modelFor(kind: string): string {
  return (AI_MODELS as Record<string, string>)[kind] ?? AI_MODELS.default;
}

/** A helper counts as on if it checked in within this many seconds. */
export const HELPER_ONLINE_SECONDS = 45;

/** A job running longer than this is assumed lost and goes back in the queue. */
export const JOB_STALE_MINUTES = 12;

/** Attempts before a job is marked failed. */
export const JOB_MAX_ATTEMPTS = 2;
