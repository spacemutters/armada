// One real, read-only CJ search through a workspace's connected CJ account, showing CJ's own results
// and what the relevance filter keeps. Nothing is saved.
//   node --env-file=.env.local scripts/try-cj-relevance.mjs <workspaceId> "desk lamp" ["water bottle" ...]
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

const [workspaceId, ...queries] = process.argv.slice(2);
const { searchProducts } = await import("../connectors/cj/api.ts");
const { rankByQuery } = await import("../lib/catalog/relevance.ts");
for (const q of queries) {
  const raw = await searchProducts(workspaceId, { keyword: q, size: 20 });
  const kept = rankByQuery(q, raw, (x) => x?.nameEn ?? "");
  console.log(`\n== "${q}": CJ sent ${raw.length}, kept ${kept.length}`);
  const keptIds = new Set(kept.map((x) => x.id));
  for (const p of raw) console.log(`  ${keptIds.has(p.id) ? "keep" : "DROP"}  ${(p.nameEn ?? "").slice(0, 90)}`);
}
process.exit(0);
