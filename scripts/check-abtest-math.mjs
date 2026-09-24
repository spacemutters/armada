// Checks the headline-test math against independent answers: known normal values, a Monte Carlo
// simulation of the Beta posteriors, the textbook sample-size formula, the verdicts, the visitor
// split, and the signed visitor ids. Prints one PASS/FAIL line per check and exits 1 on any FAIL.
//
//   node scripts/check-abtest-math.mjs
//
// It needs nothing but the two .ts files next door, so preflight's --selftest can run it in a
// scratch copy that has no node_modules.

let failures = 0;
function report(ok, label, detail) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? ` (${detail})` : ""}`);
}

let stats, visitor;
try {
  stats = await import("../lib/abtest/stats.ts");
  visitor = await import("../lib/abtest/visitor.ts");
} catch (e) {
  console.log(`FAIL couldn't load the headline-test code: ${e.message}`);
  process.exit(1);
}
const { normalCdf, chanceBBetter, visitorsNeeded, readTest, MIN_VISITORS, SURE } = stats;
const { newVisitor, readVisitor, versionFor } = visitor;

// ---------- seeded randomness, so the check gives the same answer every run ----------
function sfc32(a, b, c, d) {
  return () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}
const rand = sfc32(0x9e3779b9, 0x243f6a88, 0xb7e15162, 0x2545f491);
for (let i = 0; i < 20; i++) rand();
const uniform = () => (Math.floor(rand() * 4294967296) + 0.5) / 4294967296; // never 0 or 1

let spare = null;
function normal() {
  if (spare !== null) {
    const z = spare;
    spare = null;
    return z;
  }
  const r = Math.sqrt(-2 * Math.log(uniform()));
  const th = 2 * Math.PI * uniform();
  spare = r * Math.sin(th);
  return r * Math.cos(th);
}

// Marsaglia-Tsang gamma sampler (shape >= 1; boosted for shape < 1).
function gamma(shape) {
  if (shape < 1) return gamma(shape + 1) * Math.pow(uniform(), 1 / shape);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x, v;
    do {
      x = normal();
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = uniform();
    if (u < 1 - 0.0331 * x ** 4) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}
function betaSample(a, b) {
  const x = gamma(a);
  return x / (x + gamma(b));
}
// Same posterior as stats.ts: a flat prior, so Beta(1 + adds, 1 + visitors - adds).
function monteCarloChanceB(A, B, draws) {
  let wins = 0;
  for (let i = 0; i < draws; i++) {
    const pa = betaSample(1 + A.adds, 1 + A.visitors - A.adds);
    const pb = betaSample(1 + B.adds, 1 + B.visitors - B.adds);
    if (pb > pa) wins++;
  }
  return wins / draws;
}

const f4 = (x) => x.toFixed(4);
const side = (s) => `${s.adds}/${s.visitors}`;

// ---------- a) normalCdf against known values ----------
for (const [z, want] of [
  [0, 0.5],
  [1.96, 0.9750021048517795],
  [-1.645, 0.04998490553912138],
  [1.2815515655446004, 0.9],
  [-3, 0.0013498980316301],
]) {
  const got = normalCdf(z);
  report(Math.abs(got - want) <= 1e-4, `normalCdf(${z}) is ${f4(want)}`, `got ${f4(got)}`);
}

// ---------- b) chanceBBetter against a Monte Carlo simulation ----------
const DRAWS = 200_000;
const cases = [
  [{ visitors: 60, adds: 2 }, { visitors: 60, adds: 5 }],
  [{ visitors: 5000, adds: 150 }, { visitors: 5000, adds: 190 }],
  [{ visitors: 200, adds: 6 }, { visitors: 200, adds: 6 }],
  [{ visitors: 150, adds: 10 }, { visitors: 120, adds: 3 }],
  [{ visitors: 1000, adds: 30 }, { visitors: 1000, adds: 36 }],
  [{ visitors: 100, adds: 0 }, { visitors: 100, adds: 2 }],
  [{ visitors: 2000, adds: 60 }, { visitors: 2500, adds: 60 }],
];
for (const [A, B] of cases) {
  const got = chanceBBetter(A, B);
  const sim = monteCarloChanceB(A, B, DRAWS);
  report(Math.abs(got - sim) <= 0.02, `chanceBBetter ${side(A)} vs ${side(B)} matches simulation`, `formula ${f4(got)}, simulation ${f4(sim)}, off by ${f4(Math.abs(got - sim))}`);
}
{
  const [A, B] = cases[0];
  const sum = chanceBBetter(A, B) + chanceBBetter(B, A);
  report(Math.abs(sum - 1) <= 1e-9, "chanceBBetter is symmetric (B over A plus A over B is 1)", `sum ${sum}`);
}

// ---------- c) visitorsNeeded against the textbook two-proportion formula ----------
{
  const p1 = 0.03;
  const p2 = p1 * 1.2; // a 20% relative lift
  const zAlpha = 1.959963984540054; // 5% two-sided
  const zBeta = 0.8416212335729143; // 80% power
  const pBar = (p1 + p2) / 2;
  const textbook = (zAlpha * Math.sqrt(2 * pBar * (1 - pBar)) + zBeta * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2))) ** 2 / (p2 - p1) ** 2;
  const got = visitorsNeeded(p1);
  const off = Math.abs(got - textbook) / textbook;
  report(off <= 0.05, "visitorsNeeded(0.03) is within 5% of the textbook sample size", `got ${got}, textbook ${Math.round(textbook)}, off by ${(off * 100).toFixed(1)}%`);
}

// ---------- d) readTest verdicts ----------
report(MIN_VISITORS === 100, "a test needs 100 visitors a side before it names a leader", `MIN_VISITORS is ${MIN_VISITORS}`);
report(SURE === 0.95, "a winner is named only at 95% sure", `SURE is ${SURE}`);
for (const [label, A, B, want] of [
  ["99 visitors on one side is too early", { visitors: 99, adds: 1 }, { visitors: 5000, adds: 400 }, "too_early"],
  ["a big gap on 50 visitors a side is still too early", { visitors: 50, adds: 1 }, { visitors: 50, adds: 12 }, "too_early"],
  ["a clearly better B wins", { visitors: 20000, adds: 600 }, { visitors: 20000, adds: 800 }, "b_better"],
  ["a clearly better A wins", { visitors: 20000, adds: 800 }, { visitors: 20000, adds: 600 }, "a_better"],
  ["a small unclear gap keeps going", { visitors: 1000, adds: 30 }, { visitors: 1000, adds: 33 }, "keep_going"],
  ["a small gap after enough visitors is no difference", { visitors: 20000, adds: 600 }, { visitors: 20000, adds: 605 }, "no_difference"],
]) {
  const r = readTest(A, B);
  report(r.verdict === want, `readTest: ${label}`, `${side(A)} vs ${side(B)} gave ${r.verdict}, chance B ${f4(r.chanceB)}`);
}

// ---------- e) versionFor splits visitors fairly and consistently ----------
{
  const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const ids = Array.from({ length: 20_000 }, () => b64url(Uint8Array.from({ length: 16 }, () => Math.floor(rand() * 256))));
  const testId = "3f2b8c1e-7d4a-4e9b-a1c2-5d6e7f809a1b";
  for (const split of [50, 20]) {
    const first = ids.map((id) => versionFor(id, testId, split));
    const share = first.filter((v) => v === "b").length / ids.length;
    report(Math.abs(share - split / 100) <= 0.015, `versionFor sends ${split}% of visitors to B`, `got ${(share * 100).toFixed(2)}%`);
    const again = ids.map((id) => versionFor(id, testId, split));
    const changed = again.filter((v, i) => v !== first[i]).length;
    report(changed === 0, `versionFor gives the same visitor the same version every time (split ${split})`, `${changed} of ${ids.length} changed`);
  }
  const none = ids.filter((id) => versionFor(id, testId, 0) === "b").length;
  const all = ids.filter((id) => versionFor(id, testId, 100) === "b").length;
  report(none === 0 && all === ids.length, "versionFor at 0% shows nobody B and at 100% shows everybody B", `${none} at 0%, ${all} at 100%`);
}

// ---------- f) signed visitor ids ----------
{
  process.env.SESSION_SECRET = "check-abtest-math-secret-not-real-0123456789";
  const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const swap = (ch) => ALPHABET[(ALPHABET.indexOf(ch) + 1) % ALPHABET.length];
  try {
    const cookie = await newVisitor();
    const [id, sig] = cookie.split(".");
    report((await readVisitor(cookie)) === id, "a new visitor cookie reads back as the same visitor", cookie);
    const other = await newVisitor();
    report(other !== cookie, "two new visitors get different ids");

    let accepted = [];
    for (let i = 0; i < id.length; i++) {
      const bad = `${id.slice(0, i)}${swap(id[i])}${id.slice(i + 1)}.${sig}`;
      if ((await readVisitor(bad)) !== null) accepted.push(`id char ${i}`);
    }
    for (let i = 0; i < sig.length; i++) {
      const bad = `${id}.${sig.slice(0, i)}${swap(sig[i])}${sig.slice(i + 1)}`;
      if ((await readVisitor(bad)) !== null) accepted.push(`signature char ${i}`);
    }
    const shown = accepted.slice(0, 3).join(", ") + (accepted.length > 3 ? ` and ${accepted.length - 3} more` : "");
    report(accepted.length === 0, "changing any one character of the id or signature is refused", accepted.length ? `accepted ${shown}` : `${id.length + sig.length} tampered cookies all refused`);

    // A signature made with some other secret must not pass.
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("visitor:some-other-secret"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(id))).slice(0, 16);
    const forged = `${id}.${btoa(String.fromCharCode(...mac)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
    report((await readVisitor(forged)) === null, "a cookie signed with a different secret is refused");

    const junk = [undefined, null, "", id, `${id}.`, `.${sig}`, `${other.split(".")[0]}.${sig}`, "not-a-cookie"];
    const let_in = [];
    for (const j of junk) if ((await readVisitor(j)) !== null) let_in.push(JSON.stringify(j));
    report(let_in.length === 0, "empty, unsigned or mismatched cookies are refused", let_in.length ? `accepted: ${let_in.join(", ")}` : "");
  } catch (e) {
    report(false, "signed visitor ids work", e.message);
  }
}

console.log(failures ? `\n${failures} math check(s) failed` : "\nall math checks pass");
process.exit(failures ? 1 : 0);
