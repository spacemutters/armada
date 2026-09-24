// Armada's build checks. Every rule that matters is a check here, and --selftest plants a break for
// each one in a scratch copy to prove the check actually fires.
//
//   node scripts/preflight.mjs            static checks (run before every deploy)
//   node scripts/preflight.mjs --live     also the database checks, inside transactions that roll back
//   node scripts/preflight.mjs --selftest break each check on purpose and confirm it fails
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = process.cwd();
const args = new Set(process.argv.slice(2));

// ---------- file helpers ----------
function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".next", ".git", ".shots"].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const rel = (root, p) => path.relative(root, p).replace(/\\/g, "/");
const sourceFiles = (root) => walk(root).filter((p) => /\.(ts|tsx|mjs|js)$/.test(p) && !rel(root, p).startsWith("scripts/"));

// ---------- the checks ----------
const PLATFORM_HOSTS = /(myshopify\.com\/admin|api\.ebay\.com|api\.sandbox\.ebay\.com|developers\.cjdropshipping\.com\/api|graph\.facebook\.com|googleads\.googleapis\.com|business-api\.tiktok\.com)/;

const checks = {
  "one-door": {
    what: "Only files in connectors/ may call Shopify, eBay, CJ or an ad platform directly",
    run(root) {
      const bad = sourceFiles(root).filter((p) => !rel(root, p).startsWith("connectors/") && PLATFORM_HOSTS.test(fs.readFileSync(p, "utf8")));
      return bad.length ? `direct platform calls in: ${bad.map((p) => rel(root, p)).join(", ")}` : null;
    },
  },
  "ads-start-off": {
    what: "No code creates an ad, ad set or campaign that is already switched on",
    run(root) {
      const re = /(status|effective_status|configured_status)\s*[:=]\s*["'`](ACTIVE|ENABLED|RUNNING|ENABLE)["'`]/;
      const bad = sourceFiles(root).filter((p) => re.test(fs.readFileSync(p, "utf8")));
      return bad.length ? `an ad created switched on in: ${bad.map((p) => rel(root, p)).join(", ")}` : null;
    },
  },
  "before-values": {
    what: "Every recorded change to a store saves its before-value",
    run(root) {
      const bad = [];
      for (const p of sourceFiles(root)) {
        const text = fs.readFileSync(p, "utf8");
        // SQL inserts into change_items must name the before column...
        for (const m of text.matchAll(/insert into armada\.change_items\s*\(([^)]*)\)/g)) if (!/\bbefore\b/.test(m[1])) bad.push(rel(root, p));
        // ...and object-style inserts must carry a before key.
        for (const m of text.matchAll(/changeSetId:[^}]*}/gs)) if (/targetType/.test(m[0]) && !/\bbefore\s*:/.test(m[0])) bad.push(rel(root, p));
      }
      return bad.length ? `change items without a before-value in: ${[...new Set(bad)].join(", ")}` : null;
    },
  },
  "no-double-orders": {
    what: "A sale can only ever produce one supplier order",
    run(root) {
      const migrations = walk(path.join(root, "supabase", "migrations")).map((p) => fs.readFileSync(p, "utf8")).join("\n");
      if (!/order_line_id uuid not null unique references armada\.order_lines/.test(migrations)) return "supplier_orders.order_line_id is no longer unique";
      const send = path.join(root, "lib", "orders", "send.ts");
      if (!fs.existsSync(send) || !/on conflict \(order_line_id\) do nothing/.test(fs.readFileSync(send, "utf8"))) return "sending orders no longer skips lines already sent";
      return null;
    },
  },
  "ebay-one-listing": {
    what: "eBay's one-listing-per-seller rule is checked before listing",
    run(root) {
      const f = path.join(root, "lib", "changes", "engine.ts");
      const t = fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "";
      if (!/ebaySeller\.has\(key\)/.test(t) || !/eBay allows one/.test(t)) return "the listing planner no longer enforces one eBay listing per seller";
      if (!/eBay doesn't allow dropshipping from retail sites/.test(t)) return "the listing planner no longer refuses retail sources for eBay";
      return null;
    },
  },
  "locked-keys": {
    what: "No secret or access key is written into the code, and no settings file is tracked",
    run(root) {
      // A connection string only counts with a literal password, not a ${template}.
      const re = /(shpat_[a-f0-9]{8,}|shpca_[a-f0-9]{8,}|sb_secret_[A-Za-z0-9_-]{8,}|EAAG[A-Za-z0-9]{20,}|v\^1\.1#i\^1|-----BEGIN (RSA )?PRIVATE KEY|sk-ant-[A-Za-z0-9_-]{10,}|postgres(ql)?:\/\/[^:\s$]+:[^@\s${}]{8,}@)/;
      const bad = walk(root)
        .filter((p) => /\.(ts|tsx|mjs|js|json|sql|md|css)$/.test(p) && !rel(root, p).startsWith("package-lock") && rel(root, p) !== "scripts/preflight.mjs")
        .filter((p) => re.test(fs.readFileSync(p, "utf8")));
      const tracked = fs.existsSync(path.join(root, ".gitignore")) ? fs.readFileSync(path.join(root, ".gitignore"), "utf8") : "";
      if (!/^\.env\*/m.test(tracked) || !/^helper\/\.env/m.test(tracked)) bad.push(".gitignore no longer excludes settings files");
      return bad.length ? `secrets in: ${bad.map((p) => (p.includes(path.sep) ? rel(root, p) : p)).join(", ")}` : null;
    },
  },
  "cj-lane": {
    what: "Every request to CJ waits for the account's next slot (CJ allows about one a second)",
    run(root) {
      const dir = path.join(root, "connectors", "cj");
      const files = walk(dir).filter((p) => /\.ts$/.test(p));
      const problems = [];
      for (const f of files) {
        const text = fs.readFileSync(f, "utf8");
        const name = rel(root, f);
        const fetches = (text.match(/\bfetch\(/g) ?? []).length;
        if (name !== "connectors/cj/client.ts" && fetches) problems.push(`${name} calls CJ without going through client.ts`);
        if (name !== "connectors/cj/client.ts") continue;
        if (fetches !== 1) problems.push(`client.ts has ${fetches} places that send requests; only raw() should`);
        // raw() is defined once and called once, inside laned(), right after waiting for a slot.
        const calls = [...text.matchAll(/(?<!function )\braw(<[^>]*>)?\(/g)];
        if (calls.length !== 1) problems.push(`raw() is called in ${calls.length} places; only laned() may call it`);
        const laned = text.match(/async function laned[\s\S]*?\n}/)?.[0] ?? "";
        if (!/await waitForSlot\([^)]*\);\s*return raw/.test(laned)) problems.push("laned() no longer waits for a slot before sending");
      }
      if (!files.length) problems.push("connectors/cj is missing");
      return problems.length ? problems.join("; ") : null;
    },
  },
  "sealed-keys": {
    what: "Connection keys are stored encrypted, never as readable text",
    run(root) {
      const bad = [];
      for (const p of sourceFiles(root)) {
        const text = fs.readFileSync(p, "utf8");
        for (const m of text.matchAll(/insert into armada\.credentials[\s\S]*?values\s*\(([\s\S]*?)\)\s*(on conflict|returning|`)/g)) {
          if (!/\$\{seal\(/.test(m[1])) bad.push(rel(root, p));
        }
        if (/update armada\.credentials[\s\S]{0,200}set[^`]*\bsecret\s*=\s*\$\{(?!seal\()/.test(text)) bad.push(rel(root, p));
      }
      return bad.length ? `credentials saved without encryption in: ${[...new Set(bad)].join(", ")}` : null;
    },
  },
  "plain-words": {
    what: "Main screens use plain words; technical terms live under Settings > Advanced",
    run(root) {
      const MAIN = ["app/(app)/page.tsx", "app/(app)/stores", "app/(app)/builder", "app/(app)/products", "app/(app)/orders", "app/(app)/ads", "app/(app)/changes", "components/fleet-map.tsx", "components/shop-progress.tsx", "components/app-nav.tsx", "app/welcome", "app/setup", "components/passkey-setup.tsx", "components/passkey-sign-in.tsx"];
      const banned = /\b(API|APIs|OAuth|webhooks?|GraphQL|JSON|endpoints?|schema|SQL|env var|tokens?|CLI|RLS|row-level|UUID|payload|backend)\b/;
      const bad = [];
      for (const m of MAIN) {
        const target = path.join(root, m);
        const files = fs.existsSync(target) && fs.statSync(target).isDirectory() ? walk(target) : [target];
        for (const f of files.filter((x) => fs.existsSync(x) && x.endsWith(".tsx"))) {
          const text = fs.readFileSync(f, "utf8");
          // Only words a person reads: JSX text and quoted sentences with spaces.
          const visible = [...text.matchAll(/>([^<>{}]+)</g)].map((x) => x[1]).concat([...text.matchAll(/"([^"\n]*\s[^"\n]*)"/g)].map((x) => x[1]).filter((s) => !/^[\w-]+(\s[\w-]+)*$/.test(s) || /[A-Z][a-z]/.test(s)));
          for (const v of visible) {
            if (/className|text-\[|px-|py-|min-h|grid-cols|rounded|flex|border|bg-|hover:|sf-/.test(v)) continue;
            const hit = v.match(banned);
            if (hit) bad.push(`${rel(root, f)}: “${hit[0]}” in “${v.trim().slice(0, 60)}”`);
          }
        }
      }
      return bad.length ? bad.slice(0, 8).join("; ") : null;
    },
  },
  contrast: {
    what: "Every text color meets 4.5:1 on the page and on cards, in light and dark",
    run(root) {
      const css = fs.readFileSync(path.join(root, "app", "globals.css"), "utf8");
      const block = (re) => Object.fromEntries([...(css.match(re)?.[1] ?? "").matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]));
      const light = block(/:root\s*{([^}]*)}/);
      const dark = block(/prefers-color-scheme:\s*dark\)\s*{\s*:root\s*{([^}]*)}/);
      const lum = (hex) => {
        const n = parseInt(hex.slice(1), 16);
        const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
      };
      const ratio = (a, b) => {
        const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
        return (x + 0.05) / (y + 0.05);
      };
      const fails = [];
      for (const [mode, t] of [["light", light], ["dark", dark]]) {
        for (const fg of ["ink", "muted", "accent", "attention", "positive", "negative"]) {
          for (const bg of ["surface", "raised"]) {
            if (!t[fg] || !t[bg]) continue;
            const r = ratio(t[fg], t[bg]);
            if (r < 4.5) fails.push(`${mode} ${fg} on ${bg} is ${r.toFixed(2)}:1`);
          }
        }
        if (t["accent-ink"] && t.accent && ratio(t["accent-ink"], t.accent) < 4.5) fails.push(`${mode} button text is ${ratio(t["accent-ink"], t.accent).toFixed(2)}:1`);
        if (t.attention && t["attention-soft"] && ratio(t.attention, t["attention-soft"]) < 4.5) fails.push(`${mode} attention on its tint is ${ratio(t.attention, t["attention-soft"]).toFixed(2)}:1`);
      }
      if (!Object.keys(light).length || !Object.keys(dark).length) fails.push("couldn't read the color tokens");
      return fails.length ? fails.join("; ") : null;
    },
  },
  "ab-fair-count": {
    what: "Headline tests count only real shoppers: never the shop's team, never a version the browser claims, and an add only after a view",
    run(root) {
      const routeFile = path.join(root, "app", "api", "ab", "route.ts");
      const testsFile = path.join(root, "lib", "abtest", "tests.ts");
      if (!fs.existsSync(routeFile)) return "app/api/ab/route.ts is missing";
      if (!fs.existsSync(testsFile)) return "lib/abtest/tests.ts is missing";
      const route = stripComments(fs.readFileSync(routeFile, "utf8"));
      const problems = [];

      // (i) A request carrying the team's sign-in cookie returns before anything is counted.
      const recordCall = route.match(/\brecordVisit\s*\(/);
      let teamSkipped = false;
      for (const m of route.matchAll(/\bif\s*\(/g)) {
        const cond = balanced(route, m.index + m[0].length - 1);
        if (!cond) continue;
        const use = cond.inner.match(/([\w$]+)\s*\(\s*(["'`][^"'`]*armada_session[^"'`]*["'`]|SESSION_COOKIE)/);
        if (!use || negated(cond.inner, use.index)) continue;
        if (!/^(\{\s*)?return\b/.test(route.slice(cond.end).trimStart())) continue;
        if (recordCall && m.index > recordCall.index) continue;
        teamSkipped = true;
      }
      if (!teamSkipped) problems.push("app/api/ab/route.ts no longer returns early for the shop's own team (the armada_session cookie)");

      // (ii) The version comes from versionFor, worked out on the server.
      if (!recordCall) problems.push("app/api/ab/route.ts no longer calls recordVisit");
      else {
        const args = balanced(route, recordCall.index + recordCall[0].length - 1)?.inner ?? "";
        const helpers = [...route.matchAll(/(?:const|let|var)\s+([\w$]+)\s*=[^;]*\bversionFor\s*\(/g)].map((h) => h[1]);
        const fromVersionFor = /\bversionFor\s*\(/.test(route) && (/\bversionFor\b/.test(args) || helpers.some((h) => new RegExp(`\\b${h.replace(/\$/g, "\\$")}\\b`).test(args)));
        if (!fromVersionFor) problems.push("app/api/ab/route.ts no longer decides the version with versionFor");
      }

      // (iii) Nothing the browser sends can pick the version.
      const fromRequest = [
        /\.\s*(variant|version)\b/, // body.variant, body?.version
        /\[\s*["'`](variant|version)["'`]\s*\]/, // body["variant"]
        /\{[^{}]*\b(variant|version)\b[^{}]*\}\s*=[^=>]/, // const { variant } = body
        /\.get\(\s*["'`][^"'`]*(variant|version)/i, // searchParams / formData / cookie .get("variant")
      ];
      const hit = fromRequest.map((re) => route.match(re)).find(Boolean);
      if (hit) problems.push(`app/api/ab/route.ts reads a version from the request (“${hit[0].trim()}”)`);

      // An add only counts for a visitor who already has a view row, in the version they saw.
      const tests = stripComments(fs.readFileSync(testsFile, "utf8"));
      const fn = tests.match(/export async function recordVisit\b[\s\S]*?\n}/)?.[0];
      if (!fn) problems.push("lib/abtest/tests.ts no longer has recordVisit");
      else {
        const inserts = [...fn.matchAll(/`[^`]*insert into armada\.ab_events[^`]*`/g)].map((q) => q[0]);
        // The view insert names 'view' and never 'add' (it may still read ab_events, e.g. a per-address cap);
        // the add insert copies an earlier view row and names both.
        const views = inserts.filter((q) => /'view'/.test(q) && !/'add'/.test(q));
        if (!views.length || views.some((q) => !/\$\{\s*versionFor\s*\(/.test(q))) problems.push("recordVisit no longer stores the version versionFor chose for a view");
        const adds = inserts.filter((q) => /'add'/.test(q) || /\$\{\s*kind\s*\}/.test(q));
        if (!adds.length) problems.push("recordVisit no longer counts adds");
        for (const q of adds) {
          const shape = q.match(/insert into armada\.ab_events\s*\([^)]*\)\s*select\s+([\s\S]*?)\s+from armada\.ab_events\s+where\s+([\s\S]*?)(?:\bon conflict\b|`$)/);
          const ok =
            shape &&
            /\bvariant\b/.test(shape[1]) &&
            !/\$\{/.test(shape[1]) &&
            /\bkind\s*=\s*'view'/.test(shape[2]) &&
            /\bvisitor\s*=\s*\$\{\s*visitor\s*\}/.test(shape[2]) &&
            /\btest_id\s*=\s*\$\{/.test(shape[2]);
          if (!ok) {
            problems.push("recordVisit counts an add without that visitor's earlier view in the same test, or not in the version the view recorded");
            break;
          }
        }
      }
      return problems.length ? problems.join("; ") : null;
    },
  },
  "ab-math": {
    what: "Headline-test math matches independent answers: normal table, simulation, textbook sample size, fair split, signed visitor ids",
    run(root) {
      const script = path.join(root, "scripts", "check-abtest-math.mjs");
      if (!fs.existsSync(script)) return "scripts/check-abtest-math.mjs is missing";
      const r = spawnSync(process.execPath, ["--no-warnings", script], { cwd: root, encoding: "utf8", timeout: 120_000 });
      if (r.error) return `the math check couldn't run: ${r.error.message}`;
      if (r.status === 0) return null;
      const fails = (r.stdout ?? "").split(/\r?\n/).filter((l) => l.startsWith("FAIL "));
      if (!fails.length) return `the math check stopped (exit ${r.status}): ${((r.stderr ?? "").trim().split(/\r?\n/)[0] || "no output")}`;
      return fails[0].slice(5) + (fails.length > 1 ? ` (+${fails.length - 1} more)` : "");
    },
  },
};

// ---------- source-reading helpers for the headline-test checks ----------
// Drops comments so words inside them don't count. Leaves "https://" in strings alone.
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}
// The text inside the parentheses that open at `open`, and the index just past the closing one.
function balanced(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0) return { inner: text.slice(open + 1, i), end: i + 1 };
  }
  return null;
}
// Whether the call starting at `at` (e.g. `has(` in `!jar.has(...)`) is negated with a single `!`.
function negated(text, at) {
  let i = at - 1;
  while (i >= 0) {
    if (/[\w$.?\s]/.test(text[i])) i--;
    else if (text[i] === ")") {
      for (let d = 0; i >= 0; i--) {
        if (text[i] === ")") d++;
        else if (text[i] === "(" && --d === 0) {
          i--;
          break;
        }
      }
    } else break;
  }
  return text[i] === "!" && text[i - 1] !== "!";
}

// Database checks, run inside transactions that always roll back.
const liveChecks = {
  "isolation (database)": async (sql) => {
    const rollback = new Error("rollback");
    let seen;
    try {
      await sql.begin(async (tx) => {
        await tx`select set_config('armada.system', 'on', true)`;
        const [a] = await tx`insert into armada.workspaces (name) values ('check A') returning id`;
        const [b] = await tx`insert into armada.workspaces (name) values ('check B') returning id`;
        await tx`insert into armada.stores (workspace_id, platform, name) values (${a.id}, 'shopify', 'A store'), (${b.id}, 'shopify', 'B store')`;
        await tx`select set_config('armada.system', '', true), set_config('armada.workspace_id', ${a.id}, true)`;
        seen = await tx`select name from armada.stores where name in ('A store', 'B store')`;
        throw rollback;
      });
    } catch (e) {
      if (e !== rollback) throw e;
    }
    return seen.length === 1 && seen[0].name === "A store" ? null : `workspace A could see ${seen.length} stores`;
  },
  "no-double-orders (database)": async (sql) => {
    const rollback = new Error("rollback");
    let count;
    try {
      await sql.begin(async (tx) => {
        await tx`select set_config('armada.system', 'on', true)`;
        const [w] = await tx`insert into armada.workspaces (name) values ('check') returning id`;
        const [s] = await tx`insert into armada.stores (workspace_id, platform, name) values (${w.id}, 'shopify', 'S') returning id`;
        const [o] = await tx`insert into armada.orders (workspace_id, store_id, external_id, placed_at, total_cents) values (${w.id}, ${s.id}, '#1', now(), 1000) returning id`;
        const [l] = await tx`insert into armada.order_lines (workspace_id, order_id, title, quantity, price_cents) values (${w.id}, ${o.id}, 'x', 1, 1000) returning id`;
        for (let i = 0; i < 2; i++) {
          await tx`insert into armada.supplier_orders (workspace_id, order_line_id, supplier, cost_cents) values (${w.id}, ${l.id}, 'practice', 300) on conflict (order_line_id) do nothing`;
        }
        [{ count }] = await tx`select count(*)::int as count from armada.supplier_orders where order_line_id = ${l.id}`;
        throw rollback;
      });
    } catch (e) {
      if (e !== rollback) throw e;
    }
    return count === 1 ? null : `replaying a sale made ${count} supplier orders`;
  },
};

async function runAll(root, { live = false, quiet = false } = {}) {
  let failed = 0;
  for (const [name, c] of Object.entries(checks)) {
    const problem = c.run(root);
    if (problem) failed++;
    if (!quiet) console.log(`${problem ? "FAIL" : "ok  "} ${name.padEnd(18)} ${problem ?? c.what}`);
  }
  if (live) {
    const postgres = (await import("postgres")).default;
    const { SUPABASE_CA } = await import("../lib/db/supabase-ca.ts");
    const url = process.env.DATABASE_URL;
    const sql = postgres(url, { prepare: false, max: 1, host: process.env.DATABASE_HOSTADDR || undefined, ssl: { ca: SUPABASE_CA, servername: new URL(url).hostname, rejectUnauthorized: true } });
    try {
      for (const [name, fn] of Object.entries(liveChecks)) {
        const problem = await fn(sql);
        if (problem) failed++;
        console.log(`${problem ? "FAIL" : "ok  "} ${name.padEnd(18)} ${problem ?? "holds"}`);
      }
    } finally {
      await sql.end();
    }
  }
  return failed;
}

// Each plant breaks exactly one rule in a scratch copy.
const PLANTS = {
  "one-door": (dir) => fs.writeFileSync(path.join(dir, "lib", "planted.ts"), `export const x = () => fetch("https://demo.myshopify.com/admin/api/2026-07/graphql.json");\n`),
  "ads-start-off": (dir) => fs.writeFileSync(path.join(dir, "lib", "planted.ts"), `export const ad = { name: "x", status: "ACTIVE" };\n`),
  "before-values": (dir) => fs.writeFileSync(path.join(dir, "lib", "planted.ts"), "export const q = (tx: any) => tx`insert into armada.change_items (workspace_id, change_set_id, after) values (1, 2, 3)`;\n"),
  "no-double-orders": (dir) => {
    const f = path.join(dir, "lib", "orders", "send.ts");
    fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("on conflict (order_line_id) do nothing", ""));
  },
  "ebay-one-listing": (dir) => {
    const f = path.join(dir, "lib", "changes", "engine.ts");
    fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("ebaySeller.has(key)", "false"));
  },
  "locked-keys": (dir) => fs.writeFileSync(path.join(dir, "lib", "planted.ts"), `export const k = "shpat_0123456789abcdef0123456789abcdef";\n`),
  "cj-lane": (dir) => {
    const f = path.join(dir, "connectors", "cj", "client.ts");
    // A token call that skips the lane, the bug this check exists for.
    fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace('const env = await laned<TokenData>(workspaceId, gapMs, "POST", "/authentication/getAccessToken"', 'const env = await raw<TokenData>("POST", "/authentication/getAccessToken"'));
  },
  "sealed-keys": (dir) => {
    const f = path.join(dir, "connectors", "cj", "client.ts");
    fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("${seal(secret)}", "${JSON.stringify(secret)}"));
  },
  "plain-words": (dir) => {
    const f = path.join(dir, "app", "(app)", "ads", "page.tsx");
    fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("One stop button", "One OAuth token button"));
  },
  contrast: (dir) => {
    const f = path.join(dir, "app", "globals.css");
    fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("--muted: #5a6472;", "--muted: #b8bec7;"));
  },
  // A name like "ab-fair-count/team" is one of several plants for the check before the slash.
  "ab-fair-count/team": (dir) => {
    // The shop's own team browsing their storefront gets counted again.
    const f = path.join(dir, "app", "api", "ab", "route.ts");
    fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace(/^.*armada_session.*\r?\n/m, ""));
  },
  "ab-fair-count/body": (dir) => {
    // The browser gets to say which version it saw.
    const f = path.join(dir, "app", "api", "ab", "route.ts");
    fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("(testId, split) => versionFor(visitor, testId, split)", '(testId, split) => (body.variant === "b" ? "b" : versionFor(visitor, testId, split))'));
  },
  "ab-fair-count/split": (dir) => {
    // The version is a coin toss per request instead of fixed per visitor.
    const f = path.join(dir, "app", "api", "ab", "route.ts");
    fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("(testId, split) => versionFor(visitor, testId, split)", '() => (Math.random() < 0.5 ? "a" : "b")'));
  },
  "ab-fair-count/add": (dir) => {
    // An add counts even for a visitor who never saw the headline.
    const f = path.join(dir, "lib", "abtest", "tests.ts");
    const src = fs.readFileSync(f, "utf8");
    const target = "and visitor = ${visitor} and kind = 'view'";
    if (!src.includes(target)) throw new Error("the add-counting line moved; update this plant");
    fs.writeFileSync(f, src.replace(target, "and visitor = ${visitor}"));
  },
  "ab-math/sure": (dir) => {
    const f = path.join(dir, "lib", "abtest", "stats.ts");
    fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("export const SURE = 0.95;", "export const SURE = 0.5;"));
  },
  "ab-math/cdf": (dir) => {
    const f = path.join(dir, "lib", "abtest", "stats.ts");
    fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("Math.abs(z) / Math.SQRT2", "Math.abs(z)"));
  },
  "ab-math/split": (dir) => {
    const f = path.join(dir, "lib", "abtest", "visitor.ts");
    fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("h % 100 < splitB", "h % 100 <= splitB"));
  },
  "ab-math/signature": (dir) => {
    const f = path.join(dir, "lib", "abtest", "visitor.ts");
    fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("(await signature(id)) === sig ? id : null", "id"));
  },
};

function copyTree(src, dst) {
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (["node_modules", ".next", ".git", ".shots"].includes(e.name)) continue;
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) {
      fs.mkdirSync(d, { recursive: true });
      copyTree(s, d);
    } else fs.copyFileSync(s, d);
  }
}

if (args.has("--selftest")) {
  let missed = 0;
  for (const [name, plant] of Object.entries(PLANTS)) {
    const check = checks[name.split("/")[0]];
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "armada-selftest-"));
    try {
      copyTree(ROOT, dir);
      const before = check.run(dir);
      if (before) {
        // A check that fails on the untouched code can't prove anything about its plant.
        console.log(`BROKEN ${name.padEnd(20)} the clean copy already fails: ${before}`);
        missed++;
        continue;
      }
      plant(dir);
      const problem = check.run(dir);
      console.log(`${problem ? "caught" : "MISSED"} ${name.padEnd(20)} ${problem ?? "the planted break went unnoticed"}`);
      if (!problem) missed++;
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  console.log(missed ? `\n${missed} planted break(s) not caught (MISSED, or BROKEN because the clean copy already fails)` : "\nevery check caught its planted break");
  process.exit(missed ? 1 : 0);
} else {
  const failed = await runAll(ROOT, { live: args.has("--live") });
  console.log(failed ? `\n${failed} check(s) failed` : "\nall checks pass");
  process.exit(failed ? 1 : 0);
}
