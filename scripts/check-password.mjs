// Checks lib/auth/password.ts: hashing, checking, tampering, and the wrong-tries lockout.
//
//   node scripts/check-password.mjs                          hashing and lockout rules only
//   node --env-file=.env.local scripts/check-password.mjs    also the lockout counting in the database,
//                                                            inside a transaction that always rolls back
//
// Uses only made-up emails and random passwords. Prints "ok" or "FAIL" per check; exits 1 on any FAIL.
import crypto from "node:crypto";

const pw = await import("../lib/auth/password.ts");

let failed = 0;
function check(name, ok, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && detail ? `: ${detail}` : ""}`);
}
async function throws(fn) {
  try {
    await fn();
    return false;
  } catch {
    return true;
  }
}
const random = (n = 20) => crypto.randomBytes(n).toString("base64url").slice(0, n);
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

// ---------- hashing ----------
const secret = random(20);
const hash = await pw.hashPassword(secret);
const parts = hash.split("$");
check(
  "hash format is scrypt$32768$8$1$salt$hash with a 16-byte salt and 64-byte hash",
  parts.length === 6 &&
    parts[0] === "scrypt" &&
    parts[1] === "32768" &&
    parts[2] === "8" &&
    parts[3] === "1" &&
    Buffer.from(parts[4], "base64").length === 16 &&
    Buffer.from(parts[5], "base64").length === 64,
  hash.replace(/\$[^$]+\$[^$]+$/, "$…"),
);
check("hash does not contain the password", !hash.includes(secret));
check("right password matches", await pw.verifyPassword(secret, hash));
check("wrong password does not match", !(await pw.verifyPassword(secret + "x", hash)));
check("password differing only in case does not match", !(await pw.verifyPassword(secret.toUpperCase() === secret ? secret.toLowerCase() : secret.toUpperCase(), hash)));
check("empty password does not match", !(await pw.verifyPassword("", hash)));
const again = await pw.hashPassword(secret);
check("same password hashed twice gives different hashes (fresh salt)", again !== hash && (await pw.verifyPassword(secret, again)));

// ---------- tampering ----------
function flipByte(b64, index) {
  const buf = Buffer.from(b64, "base64");
  buf[index] ^= 0x01;
  return buf.toString("base64");
}
const tamperedKey = [...parts.slice(0, 5), flipByte(parts[5], 10)].join("$");
check("hash with one flipped bit does not match", !(await pw.verifyPassword(secret, tamperedKey)));
const tamperedSalt = [...parts.slice(0, 4), flipByte(parts[4], 3), parts[5]].join("$");
check("hash with a changed salt does not match", !(await pw.verifyPassword(secret, tamperedSalt)));
const weakerN = ["scrypt", "16384", ...parts.slice(2)].join("$");
check("hash with its cost setting lowered does not match", !(await pw.verifyPassword(secret, weakerN)));
const t0 = Date.now();
const hugeN = ["scrypt", String(2 ** 22), ...parts.slice(2)].join("$");
check("hash asking for a huge cost is refused at once, not run", !(await pw.verifyPassword(secret, hugeN)) && Date.now() - t0 < 200);
const truncated = hash.slice(0, -8);
check("truncated hash does not match", !(await pw.verifyPassword(secret, truncated)));
let malformedOk = true;
for (const bad of ["", "scrypt", "scrypt$", "bcrypt$32768$8$1$AAAA$BBBB", "scrypt$32768$8$1$!!!!$????", "scrypt$abc$8$1$" + parts[4] + "$" + parts[5], "scrypt$32768$8$1$" + parts[4] + "$" + parts[5] + "$extra", null, undefined, 42]) {
  try {
    if (await pw.verifyPassword(secret, bad)) malformedOk = false;
  } catch {
    malformedOk = false;
  }
}
check("malformed hashes never match and never throw", malformedOk);

// ---------- input edges ----------
check("hashing an empty password is refused", await throws(() => pw.hashPassword("")));
check(`hashing a password over ${pw.MAX_PASSWORD_LENGTH} characters is refused`, await throws(() => pw.hashPassword("a".repeat(pw.MAX_PASSWORD_LENGTH + 1))));
const accented = await pw.hashPassword("café au lait, s'il vous plaît");
check("the same accented letters typed two ways still match", await pw.verifyPassword("café au lait, s'il vous plaît", accented));

// ---------- the stand-in hash for unknown emails ----------
check("the stand-in hash has the same settings as real hashes", pw.DUMMY_HASH.split("$").slice(0, 4).join("$") === parts.slice(0, 4).join("$"));
check("a random guess does not match the stand-in hash", !(await pw.verifyPassword(random(20), pw.DUMMY_HASH)));
const real = [];
const dummy = [];
for (let i = 0; i < 5; i++) {
  let s = performance.now();
  await pw.verifyPassword("wrong guess " + i, hash);
  real.push(performance.now() - s);
  s = performance.now();
  await pw.verifyPassword("wrong guess " + i, pw.DUMMY_HASH);
  dummy.push(performance.now() - s);
}
const ratio = median(dummy) / median(real);
check(
  `unknown email takes about as long as a wrong password (${median(real).toFixed(0)} ms vs ${median(dummy).toFixed(0)} ms)`,
  ratio > 0.6 && ratio < 1.6,
  `ratio ${ratio.toFixed(2)}`,
);

// ---------- email ----------
check("emails are trimmed and lower-cased", pw.normalizeEmail("  Someone@Example.COM ") === "someone@example.com");
check("an email needs an @ and a dot", pw.looksLikeEmail("a@b.co") && !pw.looksLikeEmail("a@b") && !pw.looksLikeEmail("ab.co") && !pw.looksLikeEmail("a b@c.co"));

// ---------- lockout rule ----------
check("4 wrong tries for an email: next try allowed", !pw.isLockedOut({ email: 4, ip: 0 }));
check("5 wrong tries for an email: next try refused", pw.isLockedOut({ email: 5, ip: 0 }));
check("19 wrong tries from an address: next try allowed", !pw.isLockedOut({ email: 0, ip: 19 }));
check("20 wrong tries from an address: next try refused", pw.isLockedOut({ email: 0, ip: 20 }));
check("the window is 15 minutes", pw.LOCKOUT.windowMinutes === 15);

// ---------- lockout counting, in the database ----------
if (!process.env.DATABASE_URL) {
  console.log("skip lockout counting in the database (run with --env-file=.env.local to include it)");
} else {
  const postgres = (await import("postgres")).default;
  const { SUPABASE_CA } = await import("../lib/db/supabase-ca.ts");
  const url = process.env.DATABASE_URL;
  const sql = postgres(url, {
    prepare: false,
    max: 1,
    host: process.env.DATABASE_HOSTADDR || undefined,
    ssl: { ca: SUPABASE_CA, servername: new URL(url).hostname, rejectUnauthorized: true },
    transform: postgres.camel, // same as the app
  });
  const rollback = new Error("rollback");
  const tag = random(8).toLowerCase();
  const mail = (n) => `armada-check-${tag}-${n}@example.com`;
  const ipA = `check-${tag}-a`;
  const ipB = `check-${tag}-b`;
  try {
    await sql.begin(async (tx) => {
      await tx`select set_config('armada.system', 'on', true)`;

      // Five wrong tries are checked; the sixth is refused without a check. The email has no account.
      const results = [];
      for (let i = 0; i < 6; i++) results.push(await pw.beginAttempt(tx, mail(1), ipA));
      check("database: 5 tries for one email are let through", results.slice(0, 5).every((r) => !r.locked));
      check("database: the 6th try for that email is refused", results[5].locked === true);
      const [lockedRow] = await tx`select count(*)::int as n from armada.login_attempts where email = ${mail(1)} and outcome = 'locked'`;
      check("database: the refused try is recorded as refused", lockedRow.n === 1);
      const c1 = await pw.failureCounts(tx, mail(1), ipA);
      check("database: refused tries don't add to the count", c1.email === 5 && c1.ip === 5, JSON.stringify(c1));
      check("database: a different email from another address is unaffected", !(await pw.beginAttempt(tx, mail(2), ipB)).locked);

      // Wrong tries older than 15 minutes don't count.
      for (let i = 0; i < 5; i++) await tx`insert into armada.login_attempts (email, ip, outcome, at) values (${mail(3)}, ${ipB}, 'wrong', now() - interval '16 minutes')`;
      const c3 = await pw.failureCounts(tx, mail(3), ipB);
      check("database: wrong tries older than 15 minutes don't count", c3.email === 0, JSON.stringify(c3));

      // A successful sign-in clears the email's count; later wrong tries count again.
      for (let i = 0; i < 5; i++) await tx`insert into armada.login_attempts (email, ip, outcome, at) values (${mail(4)}, ${ipB}, 'wrong', now() - interval '5 minutes')`;
      check("database: 5 recent wrong tries lock the email", pw.isLockedOut(await pw.failureCounts(tx, mail(4), `check-${tag}-c`)));
      await tx`insert into armada.login_attempts (email, ip, outcome, at) values (${mail(4)}, ${ipB}, 'ok', now() - interval '2 minutes')`;
      check("database: a successful sign-in after them clears the email's count", (await pw.failureCounts(tx, mail(4), `check-${tag}-c`)).email === 0);
      await tx`insert into armada.login_attempts (email, ip, outcome, at) values (${mail(4)}, ${ipB}, 'wrong', now() - interval '1 minute')`;
      check("database: wrong tries after that success count again", (await pw.failureCounts(tx, mail(4), `check-${tag}-c`)).email === 1);

      // Twenty wrong tries from one address, across many emails, refuse the next from that address.
      const ipC = `check-${tag}-c`;
      const ipBefore = (await pw.failureCounts(tx, mail(99), ipC)).ip;
      for (let i = 0; i < 20 - ipBefore; i++) await tx`insert into armada.login_attempts (email, ip, outcome) values (${mail(100 + i)}, ${ipC}, 'wrong')`;
      check("database: 20 wrong tries from one address refuse its next try, for any email", (await pw.beginAttempt(tx, mail(200), ipC)).locked === true);
      check("database: the same email from a different address is still let through", !(await pw.beginAttempt(tx, mail(200), `check-${tag}-d`)).locked);

      // A try starts out counted as wrong and only becomes ok when marked.
      const attempt = await pw.beginAttempt(tx, mail(5), `check-${tag}-e`);
      const [before] = await tx`select outcome, ok from armada.login_attempts where id = ${attempt.id}`;
      await pw.markAttemptOk(tx, attempt.id);
      const [after] = await tx`select outcome, ok from armada.login_attempts where id = ${attempt.id}`;
      check("database: a try is counted as wrong until the password is confirmed", before.outcome === "wrong" && before.ok === false && after.outcome === "ok" && after.ok === true);

      // Outside system mode the app's database login can't see or write sign-in tries.
      await tx`select set_config('armada.system', '', true)`;
      const [hidden] = await tx`select count(*)::int as n from armada.login_attempts where email like ${`armada-check-${tag}-%`}`;
      check("database: sign-in tries are invisible outside system mode", hidden.n === 0, `saw ${hidden.n}`);
      const blocked = await tx
        .savepoint((sp) => sp`insert into armada.login_attempts (email, ip, outcome) values (${mail(6)}, ${ipA}, 'wrong')`)
        .then(() => false)
        .catch(() => true);
      check("database: sign-in tries can't be written outside system mode", blocked);
      const [who] = await tx`select current_user as u`;
      console.log(`     (connected as ${who.u})`);
      throw rollback;
    });
  } catch (e) {
    if (e !== rollback) {
      failed++;
      console.log(`FAIL database checks stopped: ${e instanceof Error ? e.message : String(e)}`);
    }
  } finally {
    await sql.end();
  }
}

console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
