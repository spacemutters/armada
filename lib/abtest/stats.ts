// Reading a headline test's numbers. Pure functions, so the page and the checks share them.
//
// "Chance B is better" treats each version's add-to-bag rate as uncertain (a Beta distribution from
// its visitors and adds) and asks how likely B's true rate is above A's, computed exactly. (A normal
// approximation was off by up to 3 points when adds were few, enough to hold back a real winner.)

export interface Side {
  visitors: number;
  adds: number;
}

export interface Reading {
  a: Side & { rate: number };
  b: Side & { rate: number };
  /** 0..1: how likely B's real rate beats A's. */
  chanceB: number;
  /** B's rate relative to A's, e.g. 0.18 for 18% higher. Null until A has an add. */
  lift: number | null;
  /** Visitors each version needs to reliably spot a 20% difference at A's rate. */
  neededEach: number;
  /** 0..1 toward `neededEach` for the smaller side. */
  progress: number;
  verdict: "too_early" | "b_better" | "a_better" | "no_difference" | "keep_going";
  /** One plain sentence for the top of the results. */
  headline: string;
}

/** Below this many visitors on either side, nothing is said about a leader. */
export const MIN_VISITORS = 100;
/** How sure the test must be before it names a winner. */
export const SURE = 0.95;

// Standard normal cumulative distribution (Abramowitz-Stegun 7.1.26, error below 1.5e-7).
export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

// log of the gamma function for x >= 1 (Lanczos, g = 7).
const LANCZOS = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
function logGamma(x: number): number {
  x -= 1;
  let s = LANCZOS[0];
  for (let i = 1; i < 9; i++) s += LANCZOS[i] / (x + i);
  const t = x + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(s);
}
const logBeta = (a: number, b: number) => logGamma(a) + logGamma(b) - logGamma(a + b);

// Exact P(B's rate > A's rate) for Beta(1 + adds, 1 + misses) posteriors (closed form, one term per B add).
export function chanceBBetter(a: Side, b: Side): number {
  const aA = 1 + a.adds;
  const bA = 1 + Math.max(0, a.visitors - a.adds);
  const aB = 1 + b.adds;
  const bB = 1 + Math.max(0, b.visitors - b.adds);
  let total = 0;
  for (let i = 0; i < aB; i++) total += Math.exp(logBeta(aA + i, bA + bB) - Math.log(bB + i) - logBeta(1 + i, bB) - logBeta(aA, bA));
  return Math.min(1, Math.max(0, total));
}

/** Per-version sample size to detect a 20% relative change with 80% power at 5% significance. */
export function visitorsNeeded(baseRate: number): number {
  const p = Math.min(0.5, Math.max(0.005, baseRate));
  const p2 = 1.2 * p;
  return Math.ceil(((1.96 + 0.8416) ** 2 * (p * (1 - p) + p2 * (1 - p2))) / (p2 - p) ** 2 / 100) * 100;
}

const pct = (x: number) => `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`;

export function readTest(a: Side, b: Side): Reading {
  const rate = (s: Side) => (s.visitors ? s.adds / s.visitors : 0);
  const ra = rate(a);
  const rb = rate(b);
  const chanceB = chanceBBetter(a, b);
  // Until A has some adds, plan for a typical 3% store rate.
  const neededEach = visitorsNeeded(a.adds >= 5 ? ra : 0.03);
  const progress = Math.min(1, Math.min(a.visitors, b.visitors) / neededEach);
  const lift = ra > 0 ? rb / ra - 1 : null;

  let verdict: Reading["verdict"];
  let headline: string;
  if (Math.min(a.visitors, b.visitors) < MIN_VISITORS) {
    verdict = "too_early";
    const more = MIN_VISITORS - Math.min(a.visitors, b.visitors);
    headline = `Too early to tell. Each version needs at least ${MIN_VISITORS} visitors before the numbers mean anything, about ${more} more.`;
  } else if (chanceB >= SURE) {
    verdict = "b_better";
    headline = `The new version is winning: ${pct(rb)} of its visitors add something to their bag, against ${pct(ra)} for the original.`;
  } else if (chanceB <= 1 - SURE) {
    verdict = "a_better";
    headline = `The original is doing better: ${pct(ra)} of its visitors add something to their bag, against ${pct(rb)} for the new version.`;
  } else if (progress >= 1) {
    verdict = "no_difference";
    headline = "No real difference. Both versions do about as well, so keep whichever you prefer.";
  } else {
    verdict = "keep_going";
    headline = `No clear winner yet. ${rb >= ra ? "The new version" : "The original"} is slightly ahead, but it could still go either way.`;
  }
  return { a: { ...a, rate: ra }, b: { ...b, rate: rb }, chanceB, lift, neededEach, progress, verdict, headline };
}
