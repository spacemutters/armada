// Armada AI helper.
// Runs Armada's AI jobs on this computer through the Claude command-line tool, on the owner's
// own Claude login. It asks Armada for work, runs each job with every tool switched off (the AI
// can only write text back, never touch files or run commands), and sends the answer back.
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = "0.1.0";
const here = path.dirname(fileURLToPath(import.meta.url));
const config = loadConfig(path.join(here, ".env"));
const ARMADA_URL = (process.env.ARMADA_URL || config.ARMADA_URL || "").replace(/\/$/, "");
const TOKEN = process.env.HELPER_TOKEN || config.HELPER_TOKEN || "";
const CONCURRENCY = Number(process.env.HELPER_CONCURRENCY || config.HELPER_CONCURRENCY || 2);
const POLL_MS = 2000;
const HEARTBEAT_MS = 15000;
const helperId = `${os.hostname()}-helper`.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 80);
const logFile = path.join(here, "helper.log");
const lockFile = path.join(here, "helper.lock");

let running = 0;

function loadConfig(file) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
  }
  return out;
}

function log(message) {
  const line = `${new Date().toISOString()} ${message}`;
  console.log(line);
  try {
    appendFileSync(logFile, line + "\n");
  } catch {}
}

/** Finds the newest Claude command-line tool, inside or outside the desktop app's private folder. */
function findClaude() {
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

// Every request gives up after 30 seconds, so a laptop waking from sleep (with dead connections)
// never leaves the helper stuck waiting.
async function post(route, body) {
  const res = await fetch(`${ARMADA_URL}${route}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  return res;
}

/** Runs one job through the Claude tool with tools, settings and connectors all switched off. */
function runClaude(exe, input) {
  return new Promise((resolve) => {
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
    // Strip anything that would tie this run to another Claude session on the machine.
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(ANTHROPIC_|CLAUDE_|CLAUDECODE)/.test(k)));
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

async function work(exe, job) {
  running++;
  log(`start ${job.kind} ${job.id}`);
  try {
    const result = await runClaude(exe, job.input);
    log(`${result.ok ? "done" : "failed"} ${job.kind} ${job.id} in ${Math.round((result.usage?.ms ?? 0) / 1000)}s${result.ok ? "" : ` (${result.error})`}`);
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const res = await post("/api/helper/complete", { helperId, jobId: job.id, ...result });
        if (res.ok) break;
        log(`complete answered ${res.status}`);
      } catch (e) {
        log(`couldn't reach Armada to hand back ${job.id}: ${e.message}`);
      }
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  } finally {
    running--;
  }
}

async function main() {
  if (!ARMADA_URL || TOKEN.length < 32) {
    log("Missing ARMADA_URL or HELPER_TOKEN in helper/.env");
    process.exit(1);
  }
  if (existsSync(lockFile)) {
    const pid = Number(readFileSync(lockFile, "utf8"));
    try {
      process.kill(pid, 0);
      log(`Another helper is already running (process ${pid}).`);
      process.exit(0);
    } catch {}
  }
  writeFileSync(lockFile, String(process.pid));
  const cleanup = () => {
    try {
      unlinkSync(lockFile);
    } catch {}
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  const exe = findClaude();
  if (!exe) {
    log("Couldn't find the Claude command-line tool on this computer.");
    process.exit(1);
  }
  log(`Armada AI helper ${VERSION} on ${helperId}, using ${exe}, serving ${ARMADA_URL}`);

  setInterval(() => {
    post("/api/helper/heartbeat", { helperId, version: VERSION, busy: running > 0, running }).catch(() => {});
  }, HEARTBEAT_MS);

  let quietErrors = 0;
  for (;;) {
    if (running < CONCURRENCY) {
      try {
        const res = await post("/api/helper/claim", { helperId, version: VERSION, running });
        quietErrors = 0;
        if (res.status === 200) {
          const job = await res.json();
          work(exe, job);
          continue; // look for another job straight away
        }
        if (res.status === 401) log("Armada refused the helper token. Check helper/.env.");
      } catch (e) {
        if (quietErrors++ % 30 === 0) log(`Can't reach Armada right now: ${e.message}`);
      }
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main();
