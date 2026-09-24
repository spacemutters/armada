// Armada AI helper.
// Runs Armada's AI jobs on this computer through the owner's own command-line AI tools: the Claude
// tool on his Claude login, and OpenAI's Codex tool on his ChatGPT login (each job says which, see
// engines.mjs). It asks Armada for work, runs each job with every tool switched off (the AI can only
// write text back, never touch files or run commands), and sends the answer back.
import { appendFileSync, existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { engineOf, findClaude, findCodex, runJob } from "./engines.mjs";

const VERSION = "0.2.0";
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

/** Each engine's tool. Codex is looked up again for every job: its folder changes when it updates. */
function toolsNow(claudeExe) {
  return { claude: claudeExe, codex: findCodex(config) };
}

async function work(claudeExe, job) {
  running++;
  const engine = engineOf(job.input);
  log(`start ${job.kind} ${job.id}${engine === "claude" ? "" : ` on ${engine}`}`);
  try {
    const result = await runJob(toolsNow(claudeExe), job.input);
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

  const exe = findClaude(config);
  if (!exe) {
    log("Couldn't find the Claude command-line tool on this computer.");
    process.exit(1);
  }
  const codexExe = findCodex(config);
  log(
    `Armada AI helper ${VERSION} on ${helperId}, engines: claude (${exe}), ` +
      `codex (${codexExe ?? "not found: ad and social jobs will fail until Codex is installed"}), serving ${ARMADA_URL}`,
  );

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
