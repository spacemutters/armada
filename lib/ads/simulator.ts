// Practice delivery: made-up numbers for practice ads, so the whole ads flow can be tried before any
// ad account exists. Pure (no database, no server-only imports) so scripts/check-ads.mjs can test it.
//
// The model is deliberately simple and shown to people in plain words (PRACTICE_MODEL_LINES):
//   money spent → times shown (a fixed price per 1,000 views, wobbling day to day)
//   times shown → visits (a click rate, lower in the first two days while the platform learns,
//                 higher or lower per ad by a made-up "pull")
//   visits → adds to bag → sales (fixed rates), sales → money in (the shop's average price)
// The platform moves money towards the ads that pull best as days go by, as real ones do.
// Every row it makes is practice = true and every screen that shows it says so.

export const PRACTICE_MODEL = {
  /** Cost to show ads 1,000 times, in cents. */
  costPerThousandCents: 1200,
  /** Share of people shown an ad who tap through to the shop. */
  clickRate: 0.011,
  /** Share of visitors who add something to their bag. */
  addToBagRate: 0.07,
  /** Share of those who add something who then buy (about 2% of visitors). */
  buyOfAdders: 0.28,
  /** How many times each person sees the ads on the first and last day. */
  timesPerPerson: [1.15, 2.2] as const,
  /** The first days, the platform is still learning who to show the ads to. */
  learningDays: 2,
  learningFactor: 0.8,
  /** Day-to-day wobble, either way. */
  wobble: 0.2,
  /** Each ad's made-up pull on the click rate. */
  strength: [0.7, 1.3] as const,
  /** Share of a day's budget that actually gets spent. */
  pace: [0.9, 1.0] as const,
  /** Practice clock: one practice day passes every this many minutes while the ads are on. */
  minutesPerDay: 1,
} as const;

export const PRACTICE_LABEL = "Practice numbers: made-up shoppers from a simple model, not real results.";

/** The model, in words a shop owner reads on the results screen. */
export const PRACTICE_MODEL_LINES: string[] = [
  `Showing the ads 1,000 times costs about $${(PRACTICE_MODEL.costPerThousandCents / 100).toFixed(0)}, give or take ${Math.round(PRACTICE_MODEL.wobble * 100)}% from day to day.`,
  `About ${(PRACTICE_MODEL.clickRate * 100).toFixed(1)}% of people who see an ad visit the shop. Each ad gets its own made-up pull, so one can pull ahead.`,
  `For the first ${PRACTICE_MODEL.learningDays} days fewer people visit, while the platform learns who to show the ads to.`,
  `${Math.round(PRACTICE_MODEL.addToBagRate * 100)}% of visitors add something to their bag, and about ${Math.round(PRACTICE_MODEL.addToBagRate * PRACTICE_MODEL.buyOfAdders * 1000) / 10}% of visitors buy, at the shop's average price.`,
  "Day by day, more of the budget goes to the ads that pull best.",
  `One practice day passes every ${PRACTICE_MODEL.minutesPerDay === 1 ? "minute" : `${PRACTICE_MODEL.minutesPerDay} minutes`} while the ads are on, and spending never goes past the cap.`,
];

export interface PracticeAd {
  id: string;
  /** The ad's made-up pull, from practiceStrengths(). */
  strength: number;
}

export interface PracticeDayInput {
  /** Anything stable for the ad set (its id), so the same set always gets the same numbers. */
  seed: string;
  /** 1 for the first day the ads are on. */
  dayIndex: number;
  totalDays: number;
  dailyBudgetCents: number;
  capCents: number;
  spentSoFarCents: number;
  /** The shop's average product price, in cents. */
  avgOrderCents: number;
  ads: PracticeAd[];
}

export interface PracticeRow {
  variationId: string;
  practice: true;
  impressions: number;
  /** People who saw the ads for the first time that day, so days add up to people reached. */
  reach: number;
  clicks: number;
  addToCarts: number;
  purchases: number;
  spendCents: number;
  salesCents: number;
}

/** FNV-1a: a stable 32-bit number from any text. */
export function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32: a small, repeatable random number source. */
export function randomFrom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Each ad's made-up pull, between 0.7 and 1.3, the same every time for the same set. */
export function practiceStrengths(seed: string, count: number): number[] {
  const rnd = randomFrom(hashSeed(`${seed}:strength`));
  const [lo, hi] = PRACTICE_MODEL.strength;
  return Array.from({ length: count }, () => Math.round((lo + rnd() * (hi - lo)) * 100) / 100);
}

/** Rounds up or down at random in proportion, so small expected numbers still come out whole and fair. */
function roundFair(x: number, rnd: () => number): number {
  if (!(x > 0)) return 0;
  const f = Math.floor(x);
  return f + (rnd() < x - f ? 1 : 0);
}

const between = (rnd: () => number, lo: number, hi: number) => lo + rnd() * (hi - lo);

/** One practice day for every ad in the set. Spending never passes the cap. */
export function simulateDay(input: PracticeDayInput): PracticeRow[] {
  const m = PRACTICE_MODEL;
  const rnd = randomFrom(hashSeed(`${input.seed}:day:${input.dayIndex}`));
  const ads = input.ads.filter((a) => a.strength > 0);
  if (!ads.length) return [];
  const left = Math.max(0, input.capCents - input.spentSoFarCents);
  const daySpend = Math.min(left, Math.floor(input.dailyBudgetCents * between(rnd, m.pace[0], m.pace[1])));

  // More of the money goes to the stronger ads as the days go by.
  const lean = 1 + 0.5 * (input.dayIndex - 1);
  const weights = ads.map((a) => a.strength ** lean);
  const total = weights.reduce((s, w) => s + w, 0);
  const progress = input.totalDays > 1 ? Math.min(1, (input.dayIndex - 1) / (input.totalDays - 1)) : 0;
  const timesPerPerson = m.timesPerPerson[0] + (m.timesPerPerson[1] - m.timesPerPerson[0]) * progress;
  const learning = input.dayIndex <= m.learningDays ? m.learningFactor : 1;

  // Whole cents per ad; the cents lost to rounding go to the ad with the biggest share, so the day's
  // money is spent exactly and a set that reaches its cap lands on it (not a cent short).
  const shares = weights.map((w) => Math.floor((daySpend * w) / total));
  const top = weights.indexOf(Math.max(...weights));
  shares[top] += daySpend - shares.reduce((s, x) => s + x, 0);
  return ads.map((ad, i) => {
    const spendCents = shares[i];
    const cpm = m.costPerThousandCents * between(rnd, 1 - m.wobble, 1 + m.wobble);
    const impressions = roundFair((spendCents / cpm) * 1000, rnd);
    const reach = Math.min(impressions, roundFair(impressions / timesPerPerson, rnd));
    const clicks = Math.min(impressions, roundFair(impressions * m.clickRate * ad.strength * learning * between(rnd, 1 - m.wobble, 1 + m.wobble), rnd));
    const addToCarts = Math.min(clicks, roundFair(clicks * m.addToBagRate * between(rnd, 1 - m.wobble, 1 + m.wobble), rnd));
    const purchases = Math.min(addToCarts, roundFair(addToCarts * m.buyOfAdders * between(rnd, 1 - m.wobble, 1 + m.wobble), rnd));
    return {
      variationId: ad.id,
      practice: true as const,
      impressions,
      reach,
      clicks,
      addToCarts,
      purchases,
      spendCents,
      salesCents: purchases * Math.max(0, Math.round(input.avgOrderCents)),
    };
  });
}

/**
 * How many practice days should have happened by `now`: the days already run, plus one for every
 * minute (PRACTICE_MODEL.minutesPerDay) since the clock started, never more than the set's days.
 */
export function practiceDaysDue(clockStartedAt: Date | string | null, now: number, daysAtStart: number, totalDays: number): number {
  if (!clockStartedAt) return Math.min(daysAtStart, totalDays);
  const elapsed = Math.max(0, now - new Date(clockStartedAt).getTime());
  return Math.min(totalDays, daysAtStart + Math.floor(elapsed / (PRACTICE_MODEL.minutesPerDay * 60_000)));
}
