import type { AiJobInput } from "@/lib/types";

// Which AI engine and model each job uses. Change routing here, never in calling code.
//
// An engine is where a job runs. Today both are command-line tools on the owner's PC, run by the
// helper (helper/armada-helper.mjs, helper/engines.mjs): "claude" is the Claude tool on his Claude
// login and "codex" is OpenAI's Codex tool on his ChatGPT login. enqueueJob stamps the engine and
// model on every job, so moving a kind to another engine (or, later, to a paid API) is an edit to
// these tables and nothing else.
export type AiEngine = NonNullable<AiJobInput["engine"]>;

/**
 * Engine per job kind. A key ending in "." covers every kind that starts with it ("ads." covers
 * "ads.copy"). An exact kind beats a prefix and a longer prefix beats a shorter one.
 */
export const AI_ENGINES: Record<string, AiEngine> = {
  "ads.": "codex", // ad writing
  "social.": "codex", // social carousel posts
  default: "claude", // shop building, headline tests and everything else
};

/** Model per job kind. A kind not listed here gets its engine's default model below. */
export const AI_MODELS: Record<string, string> = {
  "shop.concept": "sonnet",
  "shop.products": "sonnet",
  "shop.pages": "sonnet",
  "ab.variants": "sonnet",
};

/**
 * Each engine's model when the kind isn't listed in AI_MODELS. claude takes the Claude tool's
 * aliases; codex takes OpenAI model names (`codex debug models` lists them; gpt-6-sol is the
 * everyday workhorse, gpt-6-luna the faster, cheaper one).
 */
export const AI_DEFAULT_MODELS: Record<AiEngine, string> = {
  claude: "sonnet",
  codex: "gpt-6-sol",
};

export function engineFor(kind: string): AiEngine {
  if (Object.hasOwn(AI_ENGINES, kind) && !kind.endsWith(".") && kind !== "default") return AI_ENGINES[kind];
  let best: string | null = null;
  for (const key of Object.keys(AI_ENGINES)) {
    if (key.endsWith(".") && kind.startsWith(key) && (best == null || key.length > best.length)) best = key;
  }
  return best ? AI_ENGINES[best] : AI_ENGINES.default;
}

export function modelFor(kind: string): string {
  return (Object.hasOwn(AI_MODELS, kind) ? AI_MODELS[kind] : null) ?? AI_DEFAULT_MODELS[engineFor(kind)];
}

/** A helper counts as on if it checked in within this many seconds. */
export const HELPER_ONLINE_SECONDS = 45;

/** A job running longer than this is assumed lost and goes back in the queue. */
export const JOB_STALE_MINUTES = 12;

/** Attempts before a job is marked failed. */
export const JOB_MAX_ATTEMPTS = 2;
