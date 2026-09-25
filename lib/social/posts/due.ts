// Which posts are due to go out. The sweep in ./schedule.ts claims them in SQL (so two servers can
// never take the same post); these are the same rules as plain functions, for the page ("Sending")
// and for the offline check, which also reads schedule.ts to confirm its SQL says the same thing.
// No project imports, so the check can load this file directly.

/** Posts sent per sweep; the rest wait for the next minute. */
export const PER_SWEEP = 10;
/** A post still "posting" after this long lost its server partway; it's marked as not sent. */
export const LOST_AFTER_MINUTES = 15;

export interface DueCandidate {
  id: string;
  status: string;
  scheduledAt: Date | string | null;
  rewriting: boolean;
  postingStartedAt?: Date | string | null;
}

const ms = (d: Date | string | null | undefined) => (d == null ? NaN : new Date(d).getTime());

/** Scheduled, its time has come, and no new version is being written. */
export function isDue(p: DueCandidate, now: number): boolean {
  return p.status === "scheduled" && !p.rewriting && ms(p.scheduledAt) <= now;
}

/** What one sweep claims: due posts, oldest time first, at most `limit`. */
export function pickDue(posts: DueCandidate[], now: number, limit = PER_SWEEP): string[] {
  return posts
    .filter((p) => isDue(p, now))
    .sort((a, b) => ms(a.scheduledAt) - ms(b.scheduledAt))
    .slice(0, limit)
    .map((p) => p.id);
}

/** Stuck mid-send for longer than LOST_AFTER_MINUTES. */
export function isLost(p: DueCandidate, now: number): boolean {
  return p.status === "posting" && ms(p.postingStartedAt) < now - LOST_AFTER_MINUTES * 60_000;
}
