// Where a platform round trip lands afterwards, shared by the eBay and Facebook routes, plus the tiny
// page shown in Meta's popup when it's done (or refused). No imports, so
// scripts/check-store-openers.mjs tests it directly.

/** An Armada path to go back to, never another site: "/x" is kept, "//evil.com" or "https://…" is not. */
export function safeReturnPath(path: unknown, fallback: string): string {
  return typeof path === "string" && /^\/(?![/\\])/.test(path) && !/[\r\n]/.test(path) ? path : fallback;
}

/** Adds ?problem=<code> (the page turns the code into a sentence), keeping any #section at the end. */
export function withProblem(path: string, code: string): string {
  const [base, hash] = path.split("#", 2);
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}problem=${encodeURIComponent(code)}${hash ? `#${hash}` : ""}`;
}

// The popup's last page: it tells the Armada tab that opened it where to go next, then closes
// itself. If there's no opener (the popup was blocked and the whole tab went to Meta instead), it
// just goes there itself. `to` is always an Armada path.

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const js = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");

export function bridgePage(to: string, origin: string): Response {
  const path = safeReturnPath(to, "/stores/new");
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Back to Armada</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; font: 15px/1.5 ui-sans-serif, -apple-system, "Segoe UI", system-ui, sans-serif; background: #f5f6f8; color: #111418; }
  a { color: #1f4fd1; }
  @media (prefers-color-scheme: dark) { body { background: #0d1015; color: #e9ecf1; } a { color: #86a8ff; } }
</style>
</head>
<body>
<p>Back to Armada. <a href="${esc(path)}">Continue</a></p>
<script>
(function () {
  var to = ${js(path)};
  try {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage({ type: "armada:meta-setup", to: to }, ${js(origin)});
      window.close();
      return;
    }
  } catch (e) {}
  location.replace(to);
})();
</script>
</body>
</html>`;
  return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
