// Runs once when a server starts, before it answers anything: Armada's pasted app keys
// (lib/app-keys.ts) are loaded into the server's settings, then refreshed every minute so a paste on
// Connections reaches every server without a redeploy.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { loadAppKeys } = await import("./lib/app-keys");
  await loadAppKeys(true).catch((e) => console.error("loading pasted app keys failed", e));
  const timer = setInterval(() => {
    loadAppKeys(true).catch((e) => console.error("refreshing pasted app keys failed", e));
  }, 60_000);
  timer.unref?.();
}
