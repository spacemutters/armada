// The AI engines the helper can run. Each engine is a command-line tool on this computer, run on the
// owner's own login, with every tool the AI could use switched off: the AI can only write text back.
//
//   claude  the Claude command-line tool (his Claude login)
//   codex   OpenAI's Codex command-line tool (his ChatGPT login)
//
// Which engine a job uses is decided on the site (lib/ai/config.ts, AI_ENGINES) and arrives as
// job.input.engine. Jobs without one run on claude, as they always have.
//
// The one exception to "every tool off": an image job (input.image, see runCodexImage) runs Codex
// with ChatGPT's image maker switched back on, and nothing else.
//
// Nothing here runs on import, so scripts/check-engines.mjs can build and inspect the commands.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const ENGINES = ["claude", "codex"];

/** The engine a job asks for. Anything missing or unknown runs on claude. */
export function engineOf(input) {
  return input?.engine === "codex" ? "codex" : "claude";
}

// ---------- finding the tools ----------

/** Finds the newest Claude command-line tool, inside or outside the desktop app's private folder. */
export function findClaude(config = {}) {
  if (process.env.CLAUDE_EXE || config.CLAUDE_EXE) return process.env.CLAUDE_EXE || config.CLAUDE_EXE;
  const roots = [
    path.join(os.homedir(), "AppData", "Roaming", "Claude", "claude-code"),
    path.join(os.homedir(), "AppData", "Local", "Packages", "Claude_pzs8sxrjxfjjc", "LocalCache", "Roaming", "Claude", "claude-code"),
  ];
  const found = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const v of readdirSync(root)) {
      const exe = path.join(root, v, "claude.exe");
      if (existsSync(exe)) found.push({ v, exe });
    }
  }
  found.sort((a, b) => a.v.localeCompare(b.v, undefined, { numeric: true }));
  return found.at(-1)?.exe ?? null;
}

/**
 * Finds the newest Codex command-line tool. It lives in a folder named by a hash that changes when
 * Codex updates itself, so the newest codex.exe under ...\OpenAI\Codex\bin wins. CODEX_EXE (in the
 * environment or helper/.env) overrides the search.
 */
export function findCodex(config = {}) {
  if (process.env.CODEX_EXE || config.CODEX_EXE) return process.env.CODEX_EXE || config.CODEX_EXE;
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  const roots = [
    path.join(local, "OpenAI", "Codex", "bin"),
    path.join(os.homedir(), "AppData", "Local", "OpenAI", "Codex", "bin"),
    path.join(os.homedir(), "AppData", "Local", "Packages", "Claude_pzs8sxrjxfjjc", "LocalCache", "Local", "OpenAI", "Codex", "bin"),
  ];
  const found = [];
  for (const root of new Set(roots)) {
    if (!existsSync(root)) continue;
    for (const v of readdirSync(root)) {
      const exe = path.join(root, v, "codex.exe");
      try {
        found.push({ exe, at: statSync(exe).mtimeMs });
      } catch {}
    }
  }
  found.sort((a, b) => a.at - b.at);
  return found.at(-1)?.exe ?? null;
}

// ---------- environment ----------

/**
 * A copy of this process's environment without anything that could tie a run to another session,
 * swap the login, or send the request somewhere else (API keys, base URLs, a different Codex home).
 */
export function cleanEnv(engine, env = process.env) {
  const drop =
    engine === "codex"
      ? /^(OPENAI_|AZURE_OPENAI_|CODEX_|ANTHROPIC_|CLAUDE_|CLAUDECODE|RUST_LOG|RUST_BACKTRACE)/i
      : /^(ANTHROPIC_|CLAUDE_|CLAUDECODE)/;
  return Object.fromEntries(Object.entries(env).filter(([k]) => !drop.test(k)));
}

// ---------- claude ----------

/** The Claude tool's arguments: tools, settings and connectors all switched off. */
export function claudeArgs(input) {
  const args = [
    "-p",
    "--output-format", "json",
    "--model", input.model || "sonnet",
    "--system-prompt", input.system,
    "--tools", "",
    "--setting-sources", "",
    "--strict-mcp-config",
    "--no-session-persistence",
    "--json-schema", JSON.stringify(input.schema),
  ];
  if (input.effort) args.push("--effort", input.effort);
  return args;
}

/** Runs one job through the Claude tool with tools, settings and connectors all switched off. */
export function runClaude(exe, input) {
  return new Promise((resolve) => {
    const args = claudeArgs(input);
    // Strip anything that would tie this run to another Claude session on the machine.
    const env = cleanEnv("claude");
    const started = Date.now();
    const child = spawn(exe, args, { env, windowsHide: true, cwd: os.tmpdir() });
    let out = "";
    let err = "";
    const timeout = setTimeout(() => {
      child.kill();
      resolve({ ok: false, error: "The AI took too long to answer." });
    }, input.timeoutMs || 240000);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timeout);
      resolve({ ok: false, error: `Couldn't start the Claude tool: ${e.message}` });
    });
    child.on("close", () => {
      clearTimeout(timeout);
      const ms = Date.now() - started;
      let parsed;
      try {
        parsed = JSON.parse(out);
      } catch {
        return resolve({ ok: false, error: `The Claude tool gave no usable answer. ${err.slice(0, 300)}`.trim() });
      }
      const usage = {
        ms,
        inputTokens: parsed.usage?.input_tokens ?? null,
        outputTokens: parsed.usage?.output_tokens ?? null,
        cacheReadTokens: parsed.usage?.cache_read_input_tokens ?? null,
        cacheWriteTokens: parsed.usage?.cache_creation_input_tokens ?? null,
      };
      if (parsed.is_error || parsed.structured_output == null) {
        const reason = parsed.result || parsed.subtype || "no structured answer";
        return resolve({ ok: false, error: `The AI couldn't finish: ${String(reason).slice(0, 500)}`, usage });
      }
      resolve({ ok: true, output: parsed.structured_output, usage });
    });
    child.stdin.end(input.prompt);
  });
}

// ---------- codex ----------

/** Used when a codex job arrives without a model. The site normally sets one (lib/ai/config.ts). */
export const CODEX_DEFAULT_MODEL = "gpt-6-sol";

/**
 * Codex features that give the model a way to act: running code or commands, looking at images,
 * browsing, apps, plugins, hooks, memories and so on. All of them are switched off for every job.
 * With code_mode_host off, Codex's one remaining "exec" tool fails closed.
 */
export const CODEX_DISABLED_FEATURES = [
  "shell_tool",
  "unified_exec",
  "code_mode_host",
  "shell_snapshot",
  "view_image",
  "image_generation",
  "browser_use",
  "browser_use_external",
  "computer_use",
  "in_app_browser",
  "apps",
  "plugins",
  "remote_plugin",
  "skill_search",
  "skill_mcp_dependency_install",
  "tool_suggest",
  "multi_agent",
  "goals",
  "hooks",
  "memories",
  "sleep_tool",
  "workspace_dependencies",
];

/** Added after the job's own instructions: Codex also slips in the owner's global AGENTS.md. */
export const CODEX_NOTE = `

These instructions are the only ones that apply to this task. Ignore any AGENTS.md or other house rules that appear later in the conversation; they belong to other projects. You have no tools: never try to run commands, read files or browse. Answer with one JSON object that matches the required schema and nothing else.`;

/** The one Codex feature an image job switches back on: ChatGPT's image maker. */
export const CODEX_IMAGE_FEATURE = "image_generation";

/** Replaces CODEX_NOTE for image jobs, whose one tool is the image maker. */
export const CODEX_IMAGE_NOTE = `

These instructions are the only ones that apply to this task. Ignore any AGENTS.md or other house rules that appear later in the conversation; they belong to other projects. Your only tool is the image generation tool: call it exactly once. Never try to run commands, read files or browse. Then answer with one JSON object that matches the required schema and nothing else.`;

const EFFORTS = new Set(["low", "medium", "high", "xhigh"]);

/**
 * Makes a job's JSON schema acceptable to OpenAI's strict structured output: every object lists all
 * of its properties as required and allows no others. A property the job left optional becomes
 * "may be null", and dropAddedNulls() takes those nulls back out of the answer.
 */
export function strictSchema(schema) {
  if (Array.isArray(schema)) return schema.map(strictSchema);
  if (!schema || typeof schema !== "object") return schema;
  const out = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === "$schema") continue;
    if (k === "properties") out.properties = mapValues(v, strictSchema);
    else if (k === "$defs" || k === "definitions") out[k] = mapValues(v, strictSchema);
    else if (k === "items") out.items = strictSchema(v);
    else if (k === "anyOf" || k === "oneOf" || k === "allOf") out[k === "oneOf" ? "anyOf" : k] = v.map(strictSchema);
    else out[k] = v;
  }
  if (isObjectSchema(out)) {
    const props = out.properties ?? {};
    const required = new Set(Array.isArray(schema.required) ? schema.required : []);
    for (const key of Object.keys(props)) if (!required.has(key)) props[key] = nullable(props[key]);
    out.properties = props;
    out.required = Object.keys(props);
    out.additionalProperties = false;
  }
  return out;
}

function mapValues(obj, fn) {
  return Object.fromEntries(Object.entries(obj ?? {}).map(([k, v]) => [k, fn(v)]));
}

function isObjectSchema(s) {
  return s.type === "object" || (Array.isArray(s.type) && s.type.includes("object")) || (s.properties && !s.type);
}

function allowsNull(s) {
  return s?.type === "null" || (Array.isArray(s?.type) && s.type.includes("null")) || (Array.isArray(s?.anyOf) && s.anyOf.some(allowsNull));
}

function nullable(s) {
  if (allowsNull(s)) return s;
  const withEnum = (t) => (Array.isArray(s.enum) ? { ...t, enum: [...s.enum, null] } : t);
  if (typeof s.type === "string") return withEnum({ ...s, type: [s.type, "null"] });
  if (Array.isArray(s.type)) return withEnum({ ...s, type: [...s.type, "null"] });
  return { anyOf: [s, { type: "null" }] };
}

/** Removes the nulls strictSchema() made the AI write for properties the job left optional. */
export function dropAddedNulls(schema, value) {
  if (!schema || typeof schema !== "object" || value == null) return value;
  if (Array.isArray(value)) return schema.items ? value.map((v) => dropAddedNulls(schema.items, v)) : value;
  if (typeof value !== "object" || !schema.properties) return value;
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    const prop = schema.properties[k];
    if (v === null && !required.has(k) && prop && !allowsNull(prop)) continue;
    out[k] = prop ? dropAddedNulls(prop, v) : v;
  }
  return out;
}

/** A small JSON-schema check of the answer against the job's own schema. Returns a problem or null. */
export function schemaProblem(schema, value, at = "answer") {
  if (!schema || typeof schema !== "object") return null;
  if (Array.isArray(schema.anyOf) || Array.isArray(schema.oneOf)) {
    const options = schema.anyOf ?? schema.oneOf;
    return options.some((s) => schemaProblem(s, value, at) == null) ? null : `${at} matches none of the allowed shapes`;
  }
  if ("const" in schema && JSON.stringify(schema.const) !== JSON.stringify(value)) return `${at} has the wrong value`;
  if (Array.isArray(schema.enum) && !schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(value))) return `${at} isn't one of the allowed values`;
  const types = schema.type == null ? null : Array.isArray(schema.type) ? schema.type : [schema.type];
  if (types && !types.some((t) => isType(t, value))) return `${at} should be ${types.join(" or ")}`;
  if (Array.isArray(value)) {
    if (schema.minItems != null && value.length < schema.minItems) return `${at} has ${value.length} items, needs at least ${schema.minItems}`;
    if (schema.maxItems != null && value.length > schema.maxItems) return `${at} has ${value.length} items, allows at most ${schema.maxItems}`;
    if (schema.items) {
      for (let i = 0; i < value.length; i++) {
        const p = schemaProblem(schema.items, value[i], `${at}[${i}]`);
        if (p) return p;
      }
    }
  } else if (value && typeof value === "object") {
    for (const key of schema.required ?? []) if (!(key in value)) return `${at}.${key} is missing`;
    for (const [k, v] of Object.entries(value)) {
      const prop = schema.properties?.[k];
      if (!prop) {
        if (schema.additionalProperties === false) return `${at}.${k} isn't allowed`;
        continue;
      }
      const p = schemaProblem(prop, v, `${at}.${k}`);
      if (p) return p;
    }
  }
  return null;
}

function isType(t, v) {
  switch (t) {
    case "null":
      return v === null;
    case "array":
      return Array.isArray(v);
    case "object":
      return v !== null && typeof v === "object" && !Array.isArray(v);
    case "integer":
      return Number.isInteger(v);
    case "number":
      return typeof v === "number" && Number.isFinite(v);
    default:
      return typeof v === t;
  }
}

/** A value inside a -c key=value override, written as a TOML string. */
function tomlString(s) {
  return JSON.stringify(String(s));
}

/**
 * Lays out one codex job's scratch folder and returns the command for it. The folder holds the
 * instructions, the strict schema and the answer file, plus an empty "work" folder that Codex runs
 * in, so it never starts inside the project or anywhere with files in it.
 */
export function codexCommand(input, scratch, { imageTool = false } = {}) {
  const work = path.join(scratch, "work");
  mkdirSync(work, { recursive: true });
  const files = {
    work,
    instructions: path.join(scratch, "instructions.md"),
    schema: path.join(scratch, "schema.json"),
    answer: path.join(scratch, "answer.json"),
  };
  writeFileSync(files.instructions, `${input.system ?? ""}${imageTool ? CODEX_IMAGE_NOTE : CODEX_NOTE}\n`);
  writeFileSync(files.schema, JSON.stringify(strictSchema(input.schema)));
  const args = [
    "exec",
    "--ephemeral", // no saved session
    "--ignore-user-config", // none of the owner's MCP servers, plugins, hooks or profiles
    "--ignore-rules",
    "--skip-git-repo-check", // the scratch folder is not a git repository
    "--sandbox", "read-only",
    "--cd", work,
    "--model", input.model || CODEX_DEFAULT_MODEL,
    "--output-schema", files.schema,
    "--output-last-message", files.answer,
    "--json",
    "--color", "never",
    "-c", `approval_policy="never"`,
    "-c", `web_search="disabled"`,
    "-c", `model_instructions_file=${tomlString(files.instructions)}`,
    "-c", "include_permissions_instructions=false",
    "-c", "include_apps_instructions=false",
    "-c", "include_environment_context=false",
    "-c", "include_collaboration_mode_instructions=false",
    "-c", "skills.include_instructions=false",
    "-c", "project_doc_max_bytes=0",
    "-c", `shell_environment_policy.inherit="none"`,
    "-c", `history.persistence="none"`,
    "-c", "check_for_update_on_startup=false",
  ];
  if (input.effort && EFFORTS.has(input.effort)) args.push("-c", `model_reasoning_effort="${input.effort}"`);
  for (const feature of CODEX_DISABLED_FEATURES) {
    if (imageTool && feature === CODEX_IMAGE_FEATURE) continue;
    args.push("--disable", feature);
  }
  // An image job gets exactly one tool back: ChatGPT's image maker. Everything else stays off.
  if (imageTool) args.push("--enable", CODEX_IMAGE_FEATURE);
  args.push("-"); // the prompt comes on stdin
  return { args, files };
}

/** The plain message inside one of Codex's error texts (which are sometimes a JSON error body). */
function codexMessage(text) {
  const s = String(text ?? "").trim();
  try {
    const j = JSON.parse(s);
    return j?.error?.message || j?.message || s;
  } catch {
    return s;
  }
}

function signedOut(text) {
  return /not logged in|log ?in again|please (re-?)?authenticate|401 unauthorized|refresh token|token (has )?expired|codex login/i.test(text);
}

function parseAnswer(text) {
  const s = String(text ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(s);
  } catch {}
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first >= 0 && last > first) {
    try {
      return JSON.parse(s.slice(first, last + 1));
    } catch {}
  }
  return undefined;
}

/** Stops Codex and anything it started. */
function killTree(child) {
  if (process.platform === "win32" && child.pid) {
    spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true });
  } else {
    child.kill("SIGKILL");
  }
}

/** Runs one job through Codex with every tool switched off, in an empty scratch folder. */
export function runCodex(exe, input) {
  return new Promise((resolve) => {
    let scratch;
    try {
      scratch = mkdtempSync(path.join(os.tmpdir(), "armada-codex-"));
    } catch (e) {
      return resolve({ ok: false, error: `Couldn't make a scratch folder for the ChatGPT tool: ${e.message}` });
    }
    let settled = false;
    let timeout = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      try {
        rmSync(scratch, { recursive: true, force: true });
      } catch {}
      resolve(result);
    };

    let command;
    try {
      command = codexCommand(input, scratch);
    } catch (e) {
      return finish({ ok: false, error: `Couldn't prepare the job for the ChatGPT tool: ${e.message}` });
    }
    const started = Date.now();
    const child = spawn(exe, command.args, { env: cleanEnv("codex"), windowsHide: true, cwd: command.files.work });
    let out = "";
    let err = "";
    timeout = setTimeout(() => {
      killTree(child);
      finish({ ok: false, error: "The AI took too long to answer." });
    }, input.timeoutMs || 240000);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.stdin.on("error", () => {}); // Codex may exit before reading all of the prompt
    child.on("error", (e) => finish({ ok: false, error: `Couldn't start the ChatGPT tool: ${e.message}` }));
    child.on("close", (code) => {
      if (settled) return;
      let answerText = null;
      try {
        if (existsSync(command.files.answer)) answerText = readFileSync(command.files.answer, "utf8");
      } catch {}
      try {
        finish(readCodexRun(input, { out, err, code, answerText, ms: Date.now() - started }));
      } catch (e) {
        finish({ ok: false, error: `The ChatGPT tool's answer couldn't be read: ${e.message}` });
      }
    });
    child.stdin.end(input.prompt ?? "");
  });
}

/**
 * Turns what Codex printed into the helper's result. `out` is its event stream (one JSON event per
 * line: the answer, token counts and any failure); `answerText` is its last-message file, if any.
 */
export function readCodexRun(input, { out = "", err = "", code = null, answerText = null, ms = 0 }) {
  const tokens = { input: null, cached: null, cacheWrite: null, output: null, reasoning: null };
  const add = (key, n) => {
    if (typeof n === "number") tokens[key] = (tokens[key] ?? 0) + n;
  };
  const failures = [];
  let lastMessage = null;
  for (const line of out.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e.type === "turn.completed" && e.usage) {
      add("input", e.usage.input_tokens);
      add("cached", e.usage.cached_input_tokens);
      add("cacheWrite", e.usage.cache_write_input_tokens);
      add("output", e.usage.output_tokens);
      add("reasoning", e.usage.reasoning_output_tokens);
    } else if (e.type === "turn.failed") {
      failures.push(codexMessage(e.error?.message));
    } else if (e.type === "error") {
      failures.push(codexMessage(e.message));
    } else if (e.type === "item.completed" && e.item?.type === "agent_message" && typeof e.item.text === "string") {
      lastMessage = e.item.text;
    }
  }
  // OpenAI counts cached tokens inside input tokens; report them apart, as the Claude path does.
  const usage = {
    ms,
    engine: "codex",
    model: input.model || CODEX_DEFAULT_MODEL,
    inputTokens: tokens.input == null ? null : tokens.input - (tokens.cached ?? 0),
    outputTokens: tokens.output,
    cacheReadTokens: tokens.cached,
    cacheWriteTokens: tokens.cacheWrite,
    reasoningTokens: tokens.reasoning,
  };

  if (!answerText?.trim()) answerText = lastMessage;

  const problems = [...failures, err.trim()].filter(Boolean).join(" ");
  if (signedOut(problems)) {
    return { ok: false, error: "The ChatGPT tool on the helper computer isn't signed in. Sign in once with: codex login", usage };
  }
  if (!answerText?.trim()) {
    const reason = failures.at(-1) || err.trim().split(/\r?\n/).at(-1) || `it stopped with code ${code}`;
    return { ok: false, error: `The AI couldn't finish: ${String(reason).slice(0, 500)}`, usage };
  }
  const parsed = parseAnswer(answerText);
  if (parsed === undefined) {
    return { ok: false, error: `The ChatGPT tool gave no usable answer. ${answerText.slice(0, 300)}`.trim(), usage };
  }
  const output = dropAddedNulls(input.schema, parsed);
  const problem = schemaProblem(input.schema, output);
  if (problem) return { ok: false, error: `The AI's answer didn't fit: ${problem}.`, usage };
  return { ok: true, output, usage };
}

// ---------- images: ChatGPT's image maker, through Codex ----------
//
// A job whose input carries `image` asks for one picture. Codex runs exactly as for a text job
// (read-only, empty scratch folder, no settings, no connectors, every tool off) except that the image
// tool is switched back on. Codex saves the picture under <home>/.codex/generated_images/<thread id>/;
// the helper reads it from there, cuts it to the sizes the job asks for, compresses it, and deletes
// Codex's copy. The AI's JSON answer says what prompt it used and a plain description (alt text).
//
// The model has to call tools directly: the gpt-6 and gpt-5.6 families only reach tools through
// Codex's code-mode host, which stays off, so on those the image tool can't be reached.

/** True when a job asks for an image: input.image.outputs lists the sizes wanted. */
export function isImageJob(input) {
  return Boolean(input && typeof input.image === "object" && input.image && Array.isArray(input.image.outputs) && input.image.outputs.length);
}

/** The sizes an image job may ask for, checked. At most 4, each 64 to 2400 pixels a side. */
export function imageOutputs(input) {
  const out = [];
  for (const o of input?.image?.outputs ?? []) {
    const name = typeof o?.name === "string" && /^[a-z][a-z0-9-]{0,19}$/.test(o.name) ? o.name : null;
    const width = Number.isInteger(o?.width) && o.width >= 64 && o.width <= 2400 ? o.width : null;
    const height = Number.isInteger(o?.height) && o.height >= 64 && o.height <= 2400 ? o.height : null;
    if (!name || !width || !height || out.some((x) => x.name === name)) continue;
    const format = o.format === "jpeg" ? "jpeg" : "webp";
    const maxBytes = Number.isInteger(o.maxBytes) && o.maxBytes >= 20_000 && o.maxBytes <= 600_000 ? o.maxBytes : 200_000;
    out.push({ name, width, height, format, maxBytes });
    if (out.length === 4) break;
  }
  return out;
}

/** Where Codex saved the pictures of one run. Null for anything that isn't a plain thread id. */
export function codexImagesDir(threadId, home = os.homedir()) {
  if (typeof threadId !== "string" || !/^[0-9a-zA-Z-]{8,64}$/.test(threadId)) return null;
  return path.join(home, ".codex", "generated_images", threadId);
}

/** The thread id Codex printed when the run started. */
export function codexThreadId(out) {
  for (const line of String(out ?? "").split(/\r?\n/)) {
    if (!line.includes("thread.started")) continue;
    try {
      const e = JSON.parse(line);
      if (e.type === "thread.started" && typeof e.thread_id === "string") return e.thread_id;
    } catch {}
  }
  return null;
}

/** The newest picture in a folder, or null. */
function newestImage(dir) {
  if (!dir || !existsSync(dir)) return null;
  const found = [];
  for (const name of readdirSync(dir)) {
    if (!/\.(png|webp|jpe?g)$/i.test(name)) continue;
    try {
      found.push({ file: path.join(dir, name), at: statSync(path.join(dir, name)).mtimeMs });
    } catch {}
  }
  found.sort((a, b) => a.at - b.at);
  return found.at(-1)?.file ?? null;
}

let sharpModule = null;
/** sharp comes with Next.js in the project's node_modules; the helper borrows it. */
async function loadSharp() {
  if (!sharpModule) sharpModule = (await import("sharp")).default;
  return sharpModule;
}

/**
 * Cuts one picture to each size asked for (cover crop, centred on the most interesting part, never
 * enlarged: a crop smaller than asked keeps its own size) and compresses each under its byte budget.
 */
export async function renderImageOutputs(source, outputs) {
  const sharp = await loadSharp();
  const meta = await sharp(source).metadata();
  const srcW = meta.width ?? 0;
  const srcH = meta.height ?? 0;
  if (!srcW || !srcH) throw new Error("the picture couldn't be read");
  const files = [];
  for (const o of outputs) {
    const ratio = o.width / o.height;
    const cropW = Math.min(srcW, srcH * ratio);
    let scale = Math.min(1, cropW / o.width);
    let width = 0;
    let height = 0;
    let data = null;
    // Lower the quality first (down to 42), then, for a very busy picture, the size, a tenth at a time.
    for (let shrink = 0; shrink < 4 && !(data && data.length <= o.maxBytes); shrink++, scale *= 0.9) {
      width = Math.round(o.width * scale);
      height = Math.round(o.height * scale);
      for (let quality = 80; quality >= 42; quality -= 6) {
        const img = sharp(source).rotate().resize(width, height, { fit: "cover", position: sharp.strategy.attention }).removeAlpha();
        data = o.format === "jpeg" ? await img.jpeg({ quality, mozjpeg: true }).toBuffer() : await img.webp({ quality, effort: 5 }).toBuffer();
        if (data.length <= o.maxBytes) break;
      }
    }
    files.push({ name: o.name, width, height, type: o.format === "jpeg" ? "image/jpeg" : "image/webp", bytes: data.length, data: data.toString("base64") });
  }
  return { files, source: { width: srcW, height: srcH } };
}

/**
 * Runs one image job: Codex with only the image tool on, then the picture cut to size. The result
 * is a normal job result plus `files` (base64), which the helper hands back to Armada's image door.
 */
export function runCodexImage(exe, input) {
  return new Promise((resolve) => {
    const outputs = imageOutputs(input);
    if (!outputs.length) return resolve({ ok: false, error: "The image job didn't say what sizes it needs." });
    let scratch;
    try {
      scratch = mkdtempSync(path.join(os.tmpdir(), "armada-image-"));
    } catch (e) {
      return resolve({ ok: false, error: `Couldn't make a scratch folder for the ChatGPT tool: ${e.message}` });
    }
    let settled = false;
    let timeout = null;
    let imagesDir = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      for (const dir of [scratch, imagesDir]) {
        if (!dir) continue;
        try {
          rmSync(dir, { recursive: true, force: true });
        } catch {}
      }
      resolve(result);
    };

    let command;
    try {
      command = codexCommand(input, scratch, { imageTool: true });
    } catch (e) {
      return finish({ ok: false, error: `Couldn't prepare the job for the ChatGPT tool: ${e.message}` });
    }
    const started = Date.now();
    const child = spawn(exe, command.args, { env: cleanEnv("codex"), windowsHide: true, cwd: command.files.work });
    let out = "";
    let err = "";
    timeout = setTimeout(() => {
      killTree(child);
      imagesDir = codexImagesDir(codexThreadId(out));
      finish({ ok: false, error: "The AI took too long to make the picture." });
    }, input.timeoutMs || 300000);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.stdin.on("error", () => {});
    child.on("error", (e) => finish({ ok: false, error: `Couldn't start the ChatGPT tool: ${e.message}` }));
    child.on("close", async (code) => {
      if (settled) return;
      imagesDir = codexImagesDir(codexThreadId(out));
      let answerText = null;
      try {
        if (existsSync(command.files.answer)) answerText = readFileSync(command.files.answer, "utf8");
      } catch {}
      let run;
      try {
        run = readCodexRun(input, { out, err, code, answerText, ms: Date.now() - started });
      } catch (e) {
        return finish({ ok: false, error: `The ChatGPT tool's answer couldn't be read: ${e.message}` });
      }
      const usage = { ...run.usage, images: 0 };
      const source = newestImage(imagesDir);
      if (!source) {
        const codeModeOnly = /code[- ]mode (host )?is (unavailable|disabled)/i.test(out + err);
        return finish({
          ok: false,
          usage,
          error: codeModeOnly
            ? `The model ${input.model || CODEX_DEFAULT_MODEL} can't reach the image tool with the helper's lockdown. Image jobs need a model that calls tools directly, such as gpt-5.5 (lib/ai/config.ts).`
            : run.ok
              ? "ChatGPT answered but didn't make a picture."
              : run.error,
        });
      }
      try {
        const { files, source: size } = await renderImageOutputs(source, outputs);
        usage.images = 1;
        const answer = run.ok && run.output && typeof run.output === "object" ? run.output : {};
        finish({ ok: true, output: { ...answer, source: size }, usage, files });
      } catch (e) {
        finish({ ok: false, usage, error: `The picture was made but couldn't be resized: ${e.message}` });
      }
    });
    child.stdin.end(input.prompt ?? "");
  });
}

/** Runs one job on the engine it asks for. `exes` holds each engine's tool, or null when missing. */
export function runJob(exes, input) {
  const engine = engineOf(input);
  if (engine === "codex") {
    const exe = exes.codex;
    if (!exe) return Promise.resolve({ ok: false, error: "The ChatGPT command-line tool (Codex) isn't installed on the helper computer." });
    return isImageJob(input) ? runCodexImage(exe, input) : runCodex(exe, input);
  }
  if (isImageJob(input)) return Promise.resolve({ ok: false, error: "Pictures are made with the ChatGPT tool; this image job was sent to another engine." });
  return runClaude(exes.claude, input);
}
