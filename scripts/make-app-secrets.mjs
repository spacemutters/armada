// Adds Armada's own internal secrets to .env.local if they aren't there yet: the session signing
// key and the AI helper's shared token. These are generated here and belong to Armada itself.
import crypto from "node:crypto";
import fs from "node:fs";

const file = ".env.local";
let env = fs.existsSync(file) ? fs.readFileSync(file, "utf8").replace(/^﻿/, "") : "";
const add = (name, value) => {
  if (new RegExp(`^${name}=`, "m").test(env)) return false;
  if (env && !env.endsWith("\n")) env += "\n";
  env += `${name}=${value}\n`;
  return true;
};
const added = [
  add("SESSION_SECRET", crypto.randomBytes(48).toString("base64url")) && "SESSION_SECRET",
  add("HELPER_TOKEN", crypto.randomBytes(40).toString("base64url")) && "HELPER_TOKEN",
].filter(Boolean);
fs.writeFileSync(file, env);
console.log(added.length ? `added ${added.join(", ")}` : "nothing to add");
