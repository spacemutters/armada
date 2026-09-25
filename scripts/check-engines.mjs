// Checks the two AI engines: which jobs go where (lib/ai/config.ts), and that the helper builds
// each engine's command with every tool off, outside the project, and with the job's schema
// (helper/engines.mjs). Prints one PASS/FAIL line per check and exits 1 on any FAIL.
//
//   node scripts/check-engines.mjs          offline: no network, no AI calls
//   node scripts/check-engines.mjs --live   also runs two tiny real jobs through Codex on this PC
//                                           (uses the owner's ChatGPT login; about 10k tokens)

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const live = process.argv.includes("--live");

let failures = 0;
function report(ok, label, detail) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? ` (${detail})` : ""}`);
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

let config, engines;
try {
  config = await import("../lib/ai/config.ts");
  engines = await import("../helper/engines.mjs");
} catch (e) {
  console.log(`FAIL couldn't load the engine code: ${e.message}`);
  process.exit(1);
}
const { AI_DEFAULT_MODELS, AI_ENGINES, AI_MODELS, engineFor, modelFor } = config;
const {
  CODEX_DEFAULT_MODEL,
  CODEX_DISABLED_FEATURES,
  CODEX_NOTE,
  claudeArgs,
  cleanEnv,
  codexCommand,
  dropAddedNulls,
  engineOf,
  findCodex,
  readCodexRun,
  runJob,
  schemaProblem,
  strictSchema,
} = engines;

// ---------- 1. routing ----------

const routes = {
  "ads.copy": "claude",
  "ads.headlines.v2": "claude",
  "social.carousel": "claude",
  "images.scene": "codex",
  "shop.concept": "claude",
  "shop.products": "claude",
  "shop.pages": "claude",
  "ab.variants": "claude",
  "adsx.copy": "claude",
  "something.new": "claude",
};
for (const [kind, want] of Object.entries(routes)) report(engineFor(kind) === want, `engineFor("${kind}") is ${want}`, engineFor(kind));
report(AI_ENGINES.default === "claude", "anything unlisted runs on claude");
report(modelFor("ads.copy") === AI_DEFAULT_MODELS.claude, "ad jobs get the claude model", modelFor("ads.copy"));
report(modelFor("social.carousel") === AI_DEFAULT_MODELS.claude, "social jobs get the claude model", modelFor("social.carousel"));
report(modelFor("shop.concept") === "sonnet" && modelFor("ab.variants") === "sonnet", "shop and headline jobs keep sonnet");
const claudeAlias = /^(sonnet|opus|haiku|claude)/i;
const crossed = Object.entries(AI_MODELS).filter(([kind, model]) => (engineFor(kind) === "codex") === claudeAlias.test(model));
report(crossed.length === 0 && !claudeAlias.test(AI_DEFAULT_MODELS.codex) && claudeAlias.test(AI_DEFAULT_MODELS.claude),
  "no kind is given another engine's model", crossed.map(([k, m]) => `${k}=${m}`).join(", "));
report(CODEX_DEFAULT_MODEL === AI_DEFAULT_MODELS.codex, "the helper's fallback codex model matches the site's", `${CODEX_DEFAULT_MODEL} vs ${AI_DEFAULT_MODELS.codex}`);
const jobsSource = fs.readFileSync(path.join(root, "lib", "ai", "jobs.ts"), "utf8");
report(/engine:\s*engineFor\(job\.kind\)/.test(jobsSource), "enqueueJob stamps the engine from the config");
report(engineOf({}) === "claude" && engineOf({ engine: "codex" }) === "codex" && engineOf({ engine: "other" }) === "claude",
  "the helper runs jobs without an engine on claude");

// ---------- 2. the commands ----------

const schema = { type: "object", properties: { ok: { type: "boolean" }, note: { type: "string" } }, required: ["ok"] };
const input = {
  engine: "codex",
  system: "You write short ads for a test shop.",
  prompt: "PROMPT-MARKER write nothing",
  schema,
  model: "gpt-6-sol",
  effort: "low",
};

// claude
const cArgs = claudeArgs({ ...input, engine: "claude", model: "sonnet" });
const after = (args, flag) => args[args.indexOf(flag) + 1];
report(cArgs.includes("--tools") && after(cArgs, "--tools") === "", "claude: tools switched off (--tools \"\")");
report(cArgs.includes("--setting-sources") && after(cArgs, "--setting-sources") === "", "claude: no settings files");
report(cArgs.includes("--strict-mcp-config") && cArgs.includes("--no-session-persistence"), "claude: no connectors, no saved session");
report(same(JSON.parse(after(cArgs, "--json-schema")), schema), "claude: the job's schema is passed as is");
report(after(cArgs, "--system-prompt") === input.system && after(cArgs, "--model") === "sonnet", "claude: system prompt and model");
report(!cArgs.some((a) => a.includes("PROMPT-MARKER")), "claude: the prompt goes on stdin, not the command line");
const enginesSource = fs.readFileSync(path.join(root, "helper", "engines.mjs"), "utf8");
report(/spawn\(exe, args, \{[^}]*cwd: os\.tmpdir\(\)/.test(enginesSource), "claude: runs in the temp folder, not the project");

// codex
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "armada-codex-check-"));
try {
  const { args, files } = codexCommand(input, scratch);
  const has = (...seq) => args.some((_, i) => seq.every((s, j) => args[i + j] === s));
  const configs = args.filter((_, i) => args[i - 1] === "-c");
  const disabled = new Set(args.filter((_, i) => args[i - 1] === "--disable"));

  report(args[0] === "exec" && args.at(-1) === "-", "codex: non-interactive exec, prompt read from stdin");
  report(!args.some((a) => a.includes("PROMPT-MARKER")), "codex: the prompt is not on the command line");
  report(has("--sandbox", "read-only"), "codex: read-only sandbox");
  report(!args.some((a) => /danger|workspace-write|--search|--add-dir|--full-auto|--worktree/.test(a)), "codex: nothing that widens access");
  for (const f of ["--ephemeral", "--ignore-user-config", "--ignore-rules", "--skip-git-repo-check"]) report(args.includes(f), `codex: ${f}`);
  const mustBeOff = ["shell_tool", "unified_exec", "code_mode_host", "view_image", "apps", "plugins", "browser_use", "computer_use", "image_generation", "multi_agent", "hooks", "memories"];
  const stillOn = mustBeOff.filter((f) => !disabled.has(f));
  report(stillOn.length === 0 && CODEX_DISABLED_FEATURES.every((f) => disabled.has(f)), "codex: every tool feature is switched off", stillOn.join(", "));
  for (const c of [`approval_policy="never"`, `web_search="disabled"`, "project_doc_max_bytes=0", "include_environment_context=false", `shell_environment_policy.inherit="none"`]) {
    report(configs.includes(c), `codex: -c ${c}`);
  }
  report(configs.includes(`model_reasoning_effort="low"`), "codex: the job's effort is passed on");
  report(after(args, "--model") === "gpt-6-sol", "codex: the job's model is used", after(args, "--model"));

  const cd = after(args, "--cd");
  const rel = path.relative(root, cd);
  report(cd === files.work && (rel.startsWith("..") || path.isAbsolute(rel)), "codex: runs outside the project", cd);
  report(fs.existsSync(cd) && fs.readdirSync(cd).length === 0, "codex: its working folder is empty");
  report(/spawn\(exe, command\.args, \{[^}]*cwd: command\.files\.work/.test(enginesSource), "codex: the process starts in that folder too");

  const instrArg = configs.find((c) => c.startsWith("model_instructions_file="));
  const instrPath = instrArg ? JSON.parse(instrArg.slice("model_instructions_file=".length)) : null;
  const instr = instrPath && fs.existsSync(instrPath) ? fs.readFileSync(instrPath, "utf8") : "";
  report(instr.startsWith(input.system) && instr.includes(CODEX_NOTE.trim()), "codex: the job's system prompt replaces Codex's own instructions");

  const sent = JSON.parse(fs.readFileSync(after(args, "--output-schema"), "utf8"));
  report(same(sent, strictSchema(schema)) && sent.additionalProperties === false && same(sent.required, ["ok", "note"]),
    "codex: the job's schema is sent in strict form", JSON.stringify(sent));
  report(same(sent.properties.note.type, ["string", "null"]) && same(sent.properties.ok.type, "boolean"), "codex: optional properties become nullable, required ones stay");
  report(path.dirname(after(args, "--output-last-message")) === scratch, "codex: the answer file is in the scratch folder");
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}

const fakeEnv = { PATH: "x", OPENAI_API_KEY: "k", OPENAI_BASE_URL: "u", CODEX_HOME: "h", ANTHROPIC_API_KEY: "a", CLAUDE_CODE_X: "c", CLAUDECODE: "1", RUST_LOG: "trace" };
const cEnv = cleanEnv("codex", fakeEnv);
report(same(Object.keys(cEnv), ["PATH"]), "codex: API keys, base URLs and other homes are stripped from its environment", Object.keys(cEnv).join(","));
const clEnv = cleanEnv("claude", fakeEnv);
report(!("ANTHROPIC_API_KEY" in clEnv) && !("CLAUDECODE" in clEnv) && !("CLAUDE_CODE_X" in clEnv) && "PATH" in clEnv, "claude: its environment is stripped as before");

// ---------- 3. schemas and answers ----------

const already = {
  type: "object",
  additionalProperties: false,
  required: ["names", "fonts"],
  properties: {
    names: { type: "array", minItems: 2, maxItems: 2, items: { type: "string" } },
    fonts: { type: "object", additionalProperties: false, required: ["display"], properties: { display: { type: "string", enum: ["A", "B"] } } },
  },
};
report(same(strictSchema(already), already), "a schema that is already strict (like the shop schemas) is sent unchanged");
report(same(dropAddedNulls(schema, { ok: true, note: null }), { ok: true }), "nulls for optional properties are taken back out");
report(schemaProblem(schema, { ok: true }) === null && schemaProblem(schema, { ok: "yes" }) !== null, "answers are checked against the job's schema");
report(schemaProblem(already, { names: ["a"], fonts: { display: "A" } }) !== null, "too few items is caught");
report(schemaProblem(already, { names: ["a", "b"], fonts: { display: "C" } }) !== null, "a value outside the allowed list is caught");
report(schemaProblem(already, { names: ["a", "b"], fonts: { display: "A" }, extra: 1 }) !== null, "an extra property is caught");

const events = [
  { type: "thread.started", thread_id: "t" },
  { type: "item.completed", item: { id: "item_0", type: "error", message: "Code Mode is unavailable because code-mode host is disabled." } },
  { type: "turn.started" },
  { type: "item.completed", item: { id: "item_1", type: "agent_message", text: '{"ok":true,"note":null}' } },
  { type: "turn.completed", usage: { input_tokens: 10940, cached_input_tokens: 5120, cache_write_input_tokens: 0, output_tokens: 701, reasoning_output_tokens: 531 } },
].map((e) => JSON.stringify(e)).join("\n");
const good = readCodexRun(input, { out: events, code: 0, ms: 1234 });
report(good.ok && same(good.output, { ok: true }), "a finished run hands back the answer (from the event stream when there's no answer file)", JSON.stringify(good.output));
report(good.usage?.inputTokens === 5820 && good.usage?.cacheReadTokens === 5120 && good.usage?.outputTokens === 701 && good.usage?.reasoningTokens === 531,
  "token use is reported, cached tokens apart", JSON.stringify(good.usage));
const failed = readCodexRun(input, {
  out: JSON.stringify({ type: "turn.failed", error: { message: JSON.stringify({ type: "error", error: { message: "Invalid schema for response_format" } }) } }),
  code: 1,
});
report(!failed.ok && /Invalid schema for response_format/.test(failed.error), "a failed run reports Codex's reason", failed.error);
const signedOut = readCodexRun(input, { err: "Error: Not logged in. Run codex login.", code: 1 });
report(!signedOut.ok && /isn't signed in/.test(signedOut.error), "a signed-out Codex says so plainly", signedOut.error);
// OpenAI's 2026-09-25 outage: its servers refused their own internal key, which looked like a sign-in problem.
const outageEvent = JSON.stringify({ type: "turn.failed", error: { message: "unexpected status 401 Unauthorized: Incorrect API key provided: sk-svcac****fvMA. You can find your API key at https://platform.openai.com/account/api-keys., url: https://chatgpt.com/backend-api/codex/responses" } });
const outage = readCodexRun(input, { out: outageEvent, code: 1 });
report(!outage.ok && /isn't answering right now/.test(outage.error) && !/signed in/.test(outage.error), "OpenAI's own outage isn't blamed on the sign-in", outage.error);
const wrong = readCodexRun(input, { answerText: '{"ok":"maybe"}', code: 0 });
report(!wrong.ok && /didn't fit/.test(wrong.error), "an answer that breaks the schema is refused", wrong.error);
const missing = await runJob({ claude: "claude.exe", codex: null }, input);
report(!missing.ok && /isn't installed/.test(missing.error), "a codex job with no Codex installed fails plainly");

// ---------- 4. live (optional) ----------

if (live) {
  const exe = findCodex();
  report(Boolean(exe), "live: found codex.exe", exe ?? "not found");
  if (exe) {
    const tiny = {
      engine: "codex",
      model: AI_DEFAULT_MODELS.codex,
      system: "You answer tiny test questions.",
      prompt: "Reply with ok set to true.",
      schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
      timeoutMs: 180000,
    };
    const r1 = await runJob({ codex: exe }, tiny);
    console.log(`     result: ${JSON.stringify(r1)}`);
    report(r1.ok && r1.output?.ok === true, "live: a tiny codex job returns {\"ok\":true}", r1.ok ? "" : r1.error);

    const probe = {
      ...tiny,
      system: "You are a diagnostic assistant. Answer honestly.",
      prompt: `Use any tool you have to read the file ${path.join(root, "package.json")} and put its "name" field in "name". If you cannot read files, put "cannot".`,
      schema: { type: "object", additionalProperties: false, required: ["name"], properties: { name: { type: "string" } } },
    };
    const r2 = await runJob({ codex: exe }, probe);
    console.log(`     result: ${JSON.stringify(r2)}`);
    report(r2.ok && r2.output?.name !== "armada", "live: the AI cannot read files on this computer", r2.ok ? r2.output?.name : r2.error);
  }
}

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll engine checks passed.");
process.exit(failures ? 1 : 0);
