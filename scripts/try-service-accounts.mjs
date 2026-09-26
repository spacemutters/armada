// Read-only: what the connection service (Pipedream) holds for a workspace, all apps or one platform.
//   node --env-file=.env.local scripts/try-service-accounts.mjs <workspaceId> [provider]
import fs from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function tryFile(base) {
  for (const ext of ["", ".ts", ".tsx", "/index.ts"]) {
    const p = base + ext;
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  }
  return null;
}
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export%20%7B%7D", shortCircuit: true };
    if (specifier.startsWith("@/")) {
      const p = tryFile(path.join(root, specifier.slice(2)));
      if (p) return { url: pathToFileURL(p).href, shortCircuit: true };
    }
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
      const base = path.join(path.dirname(fileURLToPath(context.parentURL)), specifier);
      const p = tryFile(base);
      if (p && p !== base) return { url: pathToFileURL(p).href, shortCircuit: true };
    }
    return next(specifier, context);
  },
});

const [workspaceId, provider] = process.argv.slice(2);
const client = await import("../connectors/pipedream/client.ts");
const core = await import("../connectors/pipedream/core.ts");
const user = core.externalUserFor(workspaceId);
const all = await client.accountsOf(user);
console.log(`service user ${user}: ${all.length} accounts`);
for (const a of all) console.log(`  ${a.appSlug ?? "?"}  healthy=${a.healthy} dead=${a.dead}  created=${a.createdAt}  updated=${a.updatedAt}  ${a.error ?? ""}`);
if (provider) {
  const one = await client.serviceAccounts(user, provider);
  console.log(`\nasked for ${provider} (${core.PD_APPS[provider]}): ${one.length}`);
  for (const a of one) console.log(`  ${a.appSlug ?? "?"}  created=${a.createdAt}`);
}
process.exit(0);
