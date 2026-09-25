// Armada's build checks. Every rule that matters is a check here, and --selftest plants a break for
// each one in a scratch copy to prove the check actually fires.
//
//   node scripts/preflight.mjs            static checks (run before every deploy)
//   node scripts/preflight.mjs --live     also the database checks, inside transactions that roll back
//   node scripts/preflight.mjs --selftest break each check on purpose and confirm it fails
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const args = new Set(process.argv.slice(2));
// --only=<check> runs just that check (and, with --selftest, just its planted breaks).
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7) ?? null;

// ---------- file helpers ----------
function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".next", ".git", ".shots"].includes(e.name) || e.name.startsWith(".selftest-")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const rel = (root, p) => path.relative(root, p).replace(/\\/g, "/");
const sourceFiles = (root) => walk(root).filter((p) => /\.(ts|tsx|mjs|js)$/.test(p) && !rel(root, p).startsWith("scripts/"));

// ---------- the checks ----------
const PLATFORM_HOSTS = /(myshopify\.com\/admin|api\.ebay\.com|api\.sandbox\.ebay\.com|developers\.cjdropshipping\.com\/api|api-sg\.aliexpress\.com|api\.stripe\.com|graph\.facebook\.com|googleads\.googleapis\.com|business-api\.tiktok\.com|open\.tiktokapis\.com|backend\.composio\.dev|api\.pinterest\.com)/;

const checks = {
  "one-door": {
    what: "Only files in connectors/ may call Shopify, eBay, CJ, AliExpress, Stripe or an ad platform directly",
    run(root) {
      const bad = sourceFiles(root).filter((p) => !rel(root, p).startsWith("connectors/") && PLATFORM_HOSTS.test(fs.readFileSync(p, "utf8")));
      return bad.length ? `direct platform calls in: ${bad.map((p) => rel(root, p)).join(", ")}` : null;
    },
  },
  "ads-start-off": {
    what: "No code creates an ad, ad set or campaign that is already switched on, and Launch never switches ads on",
    run(root) {
      const re = /(status|effective_status|configured_status)\s*[:=]\s*["'`](ACTIVE|ENABLED|RUNNING|ENABLE)["'`]/;
      const bad = sourceFiles(root).filter((p) => re.test(fs.readFileSync(p, "utf8"))).map((p) => `an ad created switched on in ${rel(root, p)}`);
      // Launch prepares ads switched off; only a person's press in Ads switches them on.
      for (const p of walk(path.join(root, "lib", "launch")).filter((x) => /\.(ts|tsx)$/.test(x))) {
        if (/\bswitchOn\b/.test(stripComments(fs.readFileSync(p, "utf8")))) bad.push(`${rel(root, p)} switches ads on`);
      }
      return bad.length ? bad.join("; ") : null;
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
      if (!fs.existsSync(send)) return "sending orders no longer skips lines already sent";
      // Every supplier order Armada inserts (practice or a real CJ reservation) must skip a line already sent.
      const inserts = [...fs.readFileSync(send, "utf8").matchAll(/insert into armada\.supplier_orders[\s\S]*?`/g)].map((m) => m[0]);
      if (!inserts.length || inserts.some((q) => !/on conflict \(order_line_id\) do nothing/.test(q))) return "sending orders no longer skips lines already sent";
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
      // Launch lists on eBay only through the planner, so the same rules hold there.
      const launch = walk(path.join(root, "lib", "launch")).filter((x) => /\.ts$/.test(x));
      const text = launch.map((f) => stripComments(fs.readFileSync(f, "utf8"))).join("\n");
      if (launch.length && !/\bplanListing\(/.test(text)) return "Launch no longer lists on eBay through the listing planner (planListing)";
      if (/insert into armada\.listings/.test(text)) return "Launch writes listings itself instead of through the changes engine";
      return null;
    },
  },
  "real-items-only": {
    what: "Only real supplier products (CJ, AliExpress) are ever published to a real marketplace; practice items never are",
    run(root) {
      const problems = [];
      const lf = path.join(root, "connectors", "ebay", "listing.ts");
      const fn = (fs.existsSync(lf) ? stripComments(fs.readFileSync(lf, "utf8")) : "").match(/export async function publishEbayListing[\s\S]*?\n}/)?.[0] ?? "";
      if (!fn) problems.push("connectors/ebay/listing.ts no longer has publishEbayListing");
      else {
        const guard = fn.search(/const blocked = listingBlocker\(facts\);\s*if \(blocked\) throw/);
        const firstCall = fn.search(/\b(call|ebayCall|planEbayListing)(<[^>]*>)?\(/);
        if (guard < 0 || (firstCall >= 0 && firstCall < guard)) problems.push("publishEbayListing no longer refuses non-supplier products before it calls eBay");
      }
      const core = path.join(root, "connectors", "ebay", "listing-core.ts");
      const c = fs.existsSync(core) ? stripComments(fs.readFileSync(core, "utf8")) : "";
      if (!/REAL_SOURCES = \["cj", "aliexpress"\] as const/.test(c)) problems.push("the list of real suppliers changed (only CJ and AliExpress products are real)");
      if (!/if \(!isRealSupplierProduct\(f\)\) return PRACTICE_OFF_EBAY;/.test(c)) problems.push("listingBlocker no longer refuses practice items first");
      if (!/return !f\.imagined && /.test(c)) problems.push("isRealSupplierProduct no longer refuses imagined items");
      const engine = path.join(root, "lib", "changes", "engine.ts");
      const e = fs.existsSync(engine) ? stripComments(fs.readFileSync(engine, "utf8")) : "";
      const live = e.match(/export async function applyLiveEbayItems[\s\S]*?\n}/)?.[0] ?? "";
      if (!live || live.search(/listingBlocker\(facts\)/) < 0 || live.search(/listingBlocker\(facts\)/) > live.search(/publishEbayListing\(/)) problems.push("the changes engine no longer checks each product before publishing it to eBay");
      return problems.length ? problems.join("; ") : null;
    },
  },
  "no-auto-signup": {
    what: "Armada never makes platform accounts itself: sign-up pages are only links a person presses, and the app has no browser robot or captcha solver",
    run(root) {
      const bad = [];
      const SIGNUP = /(instagram\.com\/accounts\/emailsignup|facebook\.com\/pages\/creat|SIGN_UP_PAGES|META_CREATE_PAGE_URL|signup\.ebay\.com|reg\.ebay\.com)/;
      for (const p of sourceFiles(root)) {
        const text = stripComments(fs.readFileSync(p, "utf8"));
        for (const m of text.matchAll(/\b(fetch|ebayCall|ebayRequest|ebayRequestVia|relay|send)\s*(<[^>]*>)?\s*\(/g)) {
          const args = balanced(text, m.index + m[0].length - 1)?.inner ?? "";
          if (SIGNUP.test(args)) bad.push(`${rel(root, p)} sends a request to a sign-up page`);
        }
        if (/from\s+["'](puppeteer|puppeteer-core|playwright|playwright-core|selenium-webdriver|2captcha|@2captcha\/[\w-]+|anticaptcha|capsolver)["']/.test(text)) bad.push(`${rel(root, p)} drives a browser or solves captchas`);
      }
      const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
      for (const d of Object.keys(pkg.dependencies ?? {})) if (/^(puppeteer|playwright|selenium|2captcha|@2captcha|anticaptcha|capsolver)/.test(d)) bad.push(`the app ships ${d}`);
      return bad.length ? [...new Set(bad)].join("; ") : null;
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
  "aliexpress-lane": {
    what: "Every request to AliExpress waits for the account's next slot",
    run(root) {
      const dir = path.join(root, "connectors", "aliexpress");
      const files = walk(dir).filter((p) => /\.ts$/.test(p));
      const problems = [];
      for (const f of files) {
        const text = fs.readFileSync(f, "utf8");
        const name = rel(root, f);
        const fetches = (text.match(/\bfetch\(/g) ?? []).length;
        if (name !== "connectors/aliexpress/client.ts") {
          if (fetches) problems.push(`${name} calls AliExpress without going through client.ts`);
          continue;
        }
        if (fetches !== 1) problems.push(`client.ts has ${fetches} places that send requests; only send() should`);
        // Every call to send() comes right after waiting for a slot (within the two lines before it).
        const lines = text.split("\n");
        lines.forEach((line, i) => {
          if (!/(?<!function )\bsend\(/.test(line)) return;
          if (!lines.slice(Math.max(0, i - 2), i + 1).some((l) => /await waitForSlot\(/.test(l))) problems.push(`client.ts line ${i + 1} sends without waiting for a slot`);
        });
      }
      if (!files.length) problems.push("connectors/aliexpress is missing");
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
        // Armada's own app keys and the connection service's secret, too.
        for (const m of text.matchAll(/insert into armada\.(app_keys|connection_service)[\s\S]*?values\s*\(([\s\S]*?)\)\s*(on conflict|returning|`)/g)) {
          if (!/\$\{seal\(/.test(m[2])) bad.push(rel(root, p));
        }
        if (/update armada\.credentials[\s\S]{0,200}set[^`]*\bsecret\s*=\s*\$\{(?!seal\()/.test(text)) bad.push(rel(root, p));
      }
      return bad.length ? `credentials saved without encryption in: ${[...new Set(bad)].join(", ")}` : null;
    },
  },
  "plain-words": {
    what: "Main screens use plain words; technical terms live under Settings > Advanced",
    run(root) {
      const MAIN = ["app/(app)/page.tsx", "app/(app)/stores", "app/(app)/builder", "app/(app)/products", "app/(app)/orders", "app/(app)/ads", "app/(app)/changes", "components/fleet-map.tsx", "components/shop-progress.tsx", "components/app-nav.tsx", "app/welcome", "app/setup", "components/passkey-setup.tsx", "components/passkey-sign-in.tsx", "app/(app)/social", "components/social-connect", "components/social", "components/launch", "lib/launch", "connectors/ebay/listing-core.ts"];
      // Code files whose sentences reach the screen as they are (Launch's step notes, eBay's refusals).
      const SPOKEN = ["lib/launch", "connectors/ebay/listing-core.ts"];
      const banned = /\b(API|APIs|OAuth|webhooks?|GraphQL|JSON|endpoints?|schema|SQL|env var|tokens?|CLI|RLS|row-level|UUID|payload|backend)\b/;
      const bad = [];
      for (const m of MAIN) {
        const target = path.join(root, m);
        const files = fs.existsSync(target) && fs.statSync(target).isDirectory() ? walk(target) : [target];
        for (const f of files.filter((x) => fs.existsSync(x) && (x.endsWith(".tsx") || (SPOKEN.includes(m) && x.endsWith(".ts"))))) {
          const text = fs.readFileSync(f, "utf8");
          // Only words a person reads: JSX text and quoted sentences with spaces.
          const visible = f.endsWith(".ts")
            ? spokenLiterals(text)
            : [...text.matchAll(/(?<![=\-])>([^<>{}]+)(?=[<{])/g)].map((x) => x[1]).concat([...text.matchAll(/"([^"\n]*\s[^"\n]*)"/g)].map((x) => x[1]).filter((s) => !/^[\w-]+(\s[\w-]+)*$/.test(s) || /[A-Z][a-z]/.test(s)));
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
        // Glass: ink must read on floating glass whatever scrolls beneath (pure black and pure white),
        // and muted must read on the sidebar's glass, which only has the page behind it.
        const pct = (name) => {
          const block = mode === "light" ? css.match(/:root\s*{([^}]*)}/)?.[1] : css.match(/prefers-color-scheme:\s*dark\)\s*{\s*:root\s*{([^}]*)}/)?.[1];
          const m = (block ?? "").match(new RegExp(`--${name}:\\s*([0-9.]+)%`));
          return m ? Number(m[1]) / 100 : null;
        };
        const mix = (hexA, a, hexB) => {
          const pa = parseInt(hexA.slice(1), 16);
          const pb = parseInt(hexB.slice(1), 16);
          const ch = (n, s) => (n >> s) & 255;
          const c = [16, 8, 0].map((s) => Math.round(ch(pa, s) * a + ch(pb, s) * (1 - a)));
          return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
        };
        const float = pct("glass-pct");
        const strong = pct("glass-strong-pct");
        if (!t["glass-tint"] || float === null || strong === null) fails.push(`${mode} glass tokens are missing`);
        else {
          for (const under of ["#000000", "#ffffff"]) {
            const r = ratio(t.ink, mix(t["glass-tint"], float, under));
            if (r < 4.5) fails.push(`${mode} ink on floating glass over ${under} is ${r.toFixed(2)}:1`);
          }
          for (const fg of ["ink", "muted"]) {
            for (const under of ["surface", "page-top"]) {
              if (!t[under]) continue;
              const r = ratio(t[fg], mix(t["glass-tint"], strong, t[under]));
              if (r < 4.5) fails.push(`${mode} ${fg} on the sidebar's glass is ${r.toFixed(2)}:1`);
            }
          }
        }
        if (t.attention && t["attention-soft"] && ratio(t.attention, t["attention-soft"]) < 4.5) fails.push(`${mode} attention on its tint is ${ratio(t.attention, t["attention-soft"]).toFixed(2)}:1`);
      }
      if (!Object.keys(light).length || !Object.keys(dark).length) fails.push("couldn't read the color tokens");
      return fails.length ? fails.join("; ") : null;
    },
  },
  "key-boxes": {
    what: "Boxes for pasted keys never take a saved password: Chrome ignores autocomplete off there, so they say new-password",
    run(root) {
      const bad = [];
      for (const f of sourceFiles(root).filter((p) => p.endsWith(".tsx") && !p.endsWith("password-input.tsx"))) {
        const text = fs.readFileSync(f, "utf8");
        for (const m of text.matchAll(/<(input|PasswordInput)\b[^>]*>/g)) {
          const tag = m[0];
          if (m[1] === "input" && !/type="password"/.test(tag)) continue;
          if (/autoComplete="(current-password|new-password)"/.test(tag)) continue;
          bad.push(`${rel(root, f)}: ${tag.replace(/\s+/g, " ").slice(0, 70)}`);
        }
      }
      return bad.length ? `password boxes without current-password or new-password: ${bad.slice(0, 4).join("; ")}` : null;
    },
  },
  "glass-layer": {
    what: "Glass only floats above content (menus, bars, pop-ups): never on cards, rows or pages, and no muted words on bars content scrolls under",
    run(root) {
      const bad = [];
      for (const f of sourceFiles(root).filter((p) => p.endsWith(".tsx"))) {
        const text = fs.readFileSync(f, "utf8");
        for (const m of text.matchAll(/className=(?:"([^"]*)"|\{[^}]*?"([^"]*)")/g)) {
          const cls = m[1] ?? m[2] ?? "";
          if (!/(^|\s)glass(\s|$)/.test(cls)) continue;
          const tag = text.slice(text.lastIndexOf("<", m.index), m.index);
          // Floating means sticky, fixed or absolutely placed; a Card or Section is content.
          if (/<(Card|Section)\b/.test(tag) || !/(^|\s)(sticky|fixed|absolute)(\s|$)/.test(cls)) bad.push(`${rel(root, f)}: “${cls.slice(0, 60)}”`);
          // Words on a bar that content scrolls under stay ink (the sidebar, which has only the page behind it, may use muted).
          if (!/glass-strong/.test(cls)) {
            const after = text.slice(m.index, m.index + 600);
            const close = after.search(/<\/(div|header|nav|aside)>/);
            if (/text-muted|text-attention/.test(after.slice(0, close < 0 ? 600 : close))) bad.push(`${rel(root, f)}: muted or colored words on floating glass near “${cls.slice(0, 40)}”`);
          }
        }
      }
      return bad.length ? bad.slice(0, 6).join("; ") : null;
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
  "honest-pictures": {
    what: "Ads and posts show a product only in its real photo: ChatGPT makes scenes, and practice items' pictures in practice shops only; carousels have 4+ cards",
    run(root) {
      const problems = [];
      const src = (p) => (fs.existsSync(path.join(root, p)) ? stripComments(fs.readFileSync(path.join(root, p), "utf8")) : "");
      const queueItem = src("lib/creative/pictures.ts").match(/export async function queueItem[\s\S]*?\n}/)?.[0] ?? "";
      const guard = queueItem.search(/!mayPictureItem\(shop, productId\)\) return false/);
      if (guard < 0 || guard > queueItem.indexOf("enqueueJob")) problems.push("queueItem no longer refuses anything but a practice shop's imagined item before asking ChatGPT");
      const brief = src("lib/creative/brief.ts");
      if (!/shop\.brief\?\.source !== "practice"\) return false/.test(brief) || !/p\.imagined === true/.test(brief)) problems.push("mayPictureItem no longer means a practice shop's imagined item");
      if (!/never a product the shop sells/.test(src("lib/shops/craft.ts"))) problems.push("PICTURE_CRAFT no longer tells ChatGPT that a scene never shows a product");
      const migrations = walk(path.join(root, "supabase", "migrations")).map((p) => fs.readFileSync(p, "utf8")).join("\n");
      if (!/create trigger creative_item_is_practice/.test(migrations)) problems.push("the database no longer refuses item pictures outside practice shops");
      const launch = src("lib/ads/sets.ts").match(/export async function launchPaused[\s\S]*?\n}\n/)?.[0] ?? "";
      if (/images\[0\]/.test(launch) || !/adPictureViews\(/.test(launch)) problems.push("launchPaused sends the ad platform something other than the composed pictures the previews show");
      const cards = Number(src("lib/ads/schema.ts").match(/export const CARDS = \{ min: (\d+)/)?.[1] ?? 0);
      if (cards < 4) problems.push(`carousel ads can have ${cards} cards; they need at least 4`);
      const slides = Number(src("lib/social/posts/schema.ts").match(/export const MIN_SLIDES = (\d+)/)?.[1] ?? 0);
      if (slides < 4) problems.push(`carousel posts can have ${slides} slides; they need at least 4`);
      if (/ProductArt|iconFor/.test(src("components/ads/ad-preview.tsx"))) problems.push("ad previews draw a product icon instead of a picture");
      return problems.length ? problems.join("; ") : null;
    },
  },
  suites: {
    what: "Every offline test suite passes (scripts/check-*.mjs: ads, AliExpress, chooser, engines, passwords, Shopify, social, store openers, Stripe…)",
    run(root) {
      // Suites that need the live site, a real account or the database run by hand, not here.
      const LIVE_ONLY = new Set(["check-cj-live.mjs", "check-live-pages.mjs", "check-ebay-deletion.mjs", "check-abtest-math.mjs"]);
      const REQUIRED = ["check-ads.mjs", "check-aliexpress.mjs", "check-engines.mjs", "check-launch.mjs", "check-password.mjs", "check-shopify.mjs", "check-store-openers.mjs", "check-stripe.mjs"];
      const dir = path.join(root, "scripts");
      const present = fs.readdirSync(dir).filter((f) => /^check-.*\.mjs$/.test(f));
      const problems = REQUIRED.filter((f) => !present.includes(f)).map((f) => `scripts/${f} is missing`);
      for (const f of present.filter((x) => !LIVE_ONLY.has(x)).sort()) {
        // No settings passed in, so every suite runs its offline part only.
        const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(DATABASE_|SUPABASE_|STRIPE_|ENCRYPTION_KEY)/.test(k)));
        const r = spawnSync(process.execPath, ["--no-warnings", path.join(dir, f)], { cwd: root, encoding: "utf8", timeout: 180_000, env });
        if (r.error) {
          problems.push(`${f} couldn't run: ${r.error.message}`);
          continue;
        }
        if (r.status === 0) continue;
        const fails = (r.stdout ?? "").split(/\r?\n/).filter((l) => /^(FAIL|not ok|✗)\b/.test(l.trim()));
        problems.push(
          fails.length
            ? `${f}: ${fails[0].trim().replace(/^(FAIL|not ok|✗)\s*/, "")}${fails.length > 1 ? ` (+${fails.length - 1} more)` : ""}`
            : `${f} stopped (exit ${r.status}): ${((r.stderr ?? "").trim().split(/\r?\n/).find((l) => /error/i.test(l)) || (r.stderr ?? "").trim().split(/\r?\n/)[0] || "no output").slice(0, 160)}`,
        );
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

// The sentences in a code file, read literal by literal in order (so quotes never pair up wrongly):
// double- and single-quoted strings and untagged template literals with a space in them. Tagged
// templates (database queries) and comments are left out.
function spokenLiterals(text) {
  const out = [];
  for (const m of stripComments(text).matchAll(/"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|([\w$]?)`((?:[^`\\]|\\.)*)`/g)) {
    if (m[3]) continue;
    const s = (m[1] ?? m[2] ?? m[4] ?? "").replace(/\$\{[^}]*\}/g, " ");
    if (/\s/.test(s.trim()) && /[A-Za-z]{2}/.test(s)) out.push(s);
  }
  return out;
}

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
    if (only && name !== only) continue;
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
  "ebay-one-listing/launch": (dir) => {
    // Launch plans its eBay listings some other way, skipping the one-listing rule.
    const f = path.join(dir, "lib", "launch", "run.ts");
    fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("await planListing(tx,", "await planDirect(tx,"));
  },
  "ads-start-off/launch": (dir) =>
    fs.writeFileSync(path.join(dir, "lib", "launch", "planted.ts"), `import { switchOn } from "@/lib/ads/sets";\nexport const go = (w: string, m: string, s: string) => switchOn(w, m, s);\n`),
  "real-items-only": (dir) => {
    // The connector stops checking what it's given before calling eBay.
    const f = path.join(dir, "connectors", "ebay", "listing.ts");
    fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace('  const blocked = listingBlocker(facts);\n  if (blocked) throw new ListingProblem("item", blocked);\n', ""));
  },
  "real-items-only/practice": (dir) => {
    const f = path.join(dir, "connectors", "ebay", "listing-core.ts");
    fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("if (!isRealSupplierProduct(f)) return PRACTICE_OFF_EBAY;", 'if (f.source === "none") return PRACTICE_OFF_EBAY;'));
  },
  "real-items-only/engine": (dir) => {
    const f = path.join(dir, "lib", "changes", "engine.ts");
    fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace('const blocked = facts ? listingBlocker(facts) : "This product isn\'t in Armada any more";', 'const blocked = facts ? null : "This product isn\'t in Armada any more";'));
  },
  "no-auto-signup": (dir) =>
    fs.writeFileSync(path.join(dir, "lib", "planted.ts"), `import { SIGN_UP_PAGES } from "@/lib/launch/core";\nexport const signUp = () => fetch(SIGN_UP_PAGES.instagram, { method: "POST", body: "email=x" });\n`),
  "no-auto-signup/robot": (dir) => fs.writeFileSync(path.join(dir, "lib", "planted.ts"), `import puppeteer from "puppeteer-core";\nexport const robot = puppeteer;\n`),
  "suites/launch": (dir) => {
    // eBay's selling limit counted at double: check-launch.mjs must notice.
    const f = path.join(dir, "connectors", "ebay", "listing-core.ts");
    fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("(limit.quantity && q > limit.quantity)", "(limit.quantity && q > limit.quantity * 2)"));
  },
  "plain-words/launch": (dir) => {
    const f = path.join(dir, "lib", "launch", "run.ts");
    fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace('"The AI is writing the ads."', '"The AI is writing the ads through the API."'));
  },
  "locked-keys": (dir) => fs.writeFileSync(path.join(dir, "lib", "planted.ts"), `export const k = "shpat_0123456789abcdef0123456789abcdef";\n`),
  "cj-lane": (dir) => {
    const f = path.join(dir, "connectors", "cj", "client.ts");
    // A token call that skips the lane, the bug this check exists for.
    fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace('const env = await laned<TokenData>(workspaceId, gapMs, "POST", "/authentication/getAccessToken"', 'const env = await raw<TokenData>("POST", "/authentication/getAccessToken"'));
  },
  "aliexpress-lane": (dir) => {
    const f = path.join(dir, "connectors", "aliexpress", "client.ts");
    // A token call that skips the lane.
    fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace('  await waitForSlot(workspaceId, "aliexpress", GAP_MS);\n  const t = await send("/auth/token/create"', '  const t = await send("/auth/token/create"'));
  },
  "honest-pictures/item": (dir) => {
    // A real product pictured by ChatGPT: the guard that allows practice items only is gone.
    const f = path.join(dir, "lib", "creative", "pictures.ts");
    fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("if (!UUID.test(productId) || !mayPictureItem(shop, productId)) return false;", "if (!UUID.test(productId)) return false;"));
  },
  "honest-pictures/launch": (dir) => {
    // The platform gets the bare supplier photo instead of the picture that was checked.
    const f = path.join(dir, "lib", "ads", "sets.ts");
    const src = fs.readFileSync(f, "utf8");
    const target = 'imageUrl: a.format === "single" && pics.get("main")?.src.portrait ? `${origin}${pics.get("main")!.src.portrait}` : null,';
    if (!src.includes(target)) throw new Error("the launch picture line moved; update this plant");
    fs.writeFileSync(f, src.replace(target, "imageUrl: first?.images[0]?.url ?? null,"));
  },
  "honest-pictures/cards": (dir) => {
    const f = path.join(dir, "lib", "ads", "schema.ts");
    fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("export const CARDS = { min: 4,", "export const CARDS = { min: 2,"));
  },
  "honest-pictures/slides": (dir) => {
    const f = path.join(dir, "lib", "social", "posts", "schema.ts");
    fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("export const MIN_SLIDES = 4;", "export const MIN_SLIDES = 3;"));
  },
  suites: (dir) => {
    const f = path.join(dir, "connectors", "aliexpress", "parse.ts");
    // Shipping picked regardless of how long it takes: check-aliexpress.mjs must notice.
    fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("o.daysMax <= 14", "o.daysMax <= 60"));
  },
  "key-boxes": (dir) => fs.writeFileSync(path.join(dir, "components", "planted.tsx"), `export const X = () => <input name="apiKey" type="password" autoComplete="off" />;
`),
  "glass-layer": (dir) => fs.writeFileSync(path.join(dir, "components", "planted.tsx"), `export const X = () => <Card className="glass p-4">A card</Card>;
`),
  "contrast/glass": (dir) => {
    const f = path.join(dir, "app", "globals.css");
    // Floating glass so thin that ink over a black photo stops reading.
    fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("--glass-pct: 78%;", "--glass-pct: 30%;"));
  },
  "sealed-keys/app-keys": (dir) => {
    const f = path.join(dir, "lib", "app-keys.ts");
    fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("${seal(value)}", "${value}"));
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
    if (["node_modules", ".next", ".git", ".shots"].includes(e.name) || e.name.startsWith(".selftest-")) continue;
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
    if (only && name.split("/")[0] !== only) continue;
    const check = checks[name.split("/")[0]];
    // Inside the project, so the copy's test suites find the project's installed packages.
    const dir = fs.mkdtempSync(path.join(ROOT, ".selftest-"));
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
