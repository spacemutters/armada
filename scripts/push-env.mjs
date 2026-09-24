// Copies Armada's own server settings from .env.local into the Vercel project's production
// environment. Values travel through stdin and are never printed.
// usage: node scripts/push-env.mjs NAME [NAME...]
import { spawnSync } from "node:child_process";
import fs from "node:fs";

const env = Object.fromEntries(
  fs
    .readFileSync(".env.local", "utf8")
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .map((l) => l.match(/^([A-Z_]+)=(.*)$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
);
const scope = ["--scope", "spacemutters-projects"];
for (const name of process.argv.slice(2)) {
  const value = env[name];
  if (!value) {
    console.log(`${name}: not in .env.local, skipped`);
    continue;
  }
  spawnSync("vercel", ["env", "rm", name, "production", "--yes", ...scope], { shell: true, encoding: "utf8" });
  const r = spawnSync("vercel", ["env", "add", name, "production", ...scope], { shell: true, input: value, encoding: "utf8" });
  console.log(`${name}: ${r.status === 0 ? "set" : `failed (${(r.stderr || r.stdout).split("\n").filter((l) => /Error|error/.test(l)).join(" ").slice(0, 200)})`}`);
}
