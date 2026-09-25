import "server-only";
import { accountStatusOf, COMPOSIO_API, dataOf, idIn, igUserOf, linkOf, managedConfigIn, toolOk } from "./parse";

// The one door to Composio, the connection service whose own approved Instagram app lets a shop's
// Instagram connect in one press (sign in, Authorize, back) and post carousels. Switched on by the
// Armada owner's Composio key (COMPOSIO_API_KEY, pasted on Connections or set in Vercel). Every
// request has a deadline; Composio keeps and renews the Instagram access itself.

export class ComposioProblem extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const base = () => (process.env.COMPOSIO_API_BASE || COMPOSIO_API).replace(/\/$/, "");
export const composioOn = () => Boolean(process.env.COMPOSIO_API_KEY);

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: unknown }> {
  const key = process.env.COMPOSIO_API_KEY;
  if (!key) throw new ComposioProblem(412, "Instagram through Composio isn't switched on yet.");
  let res: Response;
  try {
    res = await fetch(`${base()}${path}`, {
      method,
      headers: { "x-api-key": key, accept: "application/json", ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
      cache: "no-store",
    });
  } catch {
    throw new ComposioProblem(503, "Couldn't reach Composio just now. Try again in a minute.");
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (res.status === 401 || res.status === 403) throw new ComposioProblem(res.status, "Composio didn't accept Armada's key. Paste it again on Connections.");
  return { status: res.status, json };
}

let cachedConfig: string | null = null;

/** Composio's managed Instagram setup for this project, made once if it doesn't exist yet. */
async function instagramConfig(): Promise<string> {
  if (cachedConfig) return cachedConfig;
  const list = await call("GET", "/auth_configs?toolkit_slug=instagram&limit=50");
  const found = list.status === 200 ? managedConfigIn(list.json, "instagram") : null;
  if (found) return (cachedConfig = found);
  const made = await call("POST", "/auth_configs", { toolkit: { slug: "instagram" }, auth_config: { type: "use_composio_managed_auth" } });
  const id = (made.json as { auth_config?: { id?: string } } | null)?.auth_config?.id;
  if (made.status >= 300 || typeof id !== "string") throw new ComposioProblem(made.status, "Composio couldn't set up Instagram. Try again in a minute.");
  return (cachedConfig = id);
}

/** Composio's hosted sign-in for Instagram, sending the person back to `callbackUrl`. */
export async function instagramLink(userId: string, callbackUrl: string): Promise<{ redirectUrl: string; connectedAccountId: string }> {
  const r = await call("POST", "/connected_accounts/link", { auth_config_id: await instagramConfig(), user_id: userId, callback_url: callbackUrl });
  const link = linkOf(r.json);
  if (r.status >= 300 || !link) throw new ComposioProblem(r.status, "Composio couldn't start connecting Instagram. Try again in a minute.");
  return link;
}

/** Whether the person finished approving (Composio may take a moment to mark it active). */
export async function waitUntilActive(connectedAccountId: string, tries = 6): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    const r = await call("GET", `/connected_accounts/${encodeURIComponent(connectedAccountId)}`);
    const s = r.status === 200 ? accountStatusOf(r.json) : null;
    if (s === "ACTIVE") return true;
    if (s === "FAILED" || s === "EXPIRED" || s === "INACTIVE") return false;
    await new Promise((res) => setTimeout(res, 1000));
  }
  return false;
}

export async function forgetConnection(connectedAccountId: string): Promise<void> {
  await call("DELETE", `/connected_accounts/${encodeURIComponent(connectedAccountId)}`).catch(() => undefined);
}

async function tool(slug: string, connectedAccountId: string, userId: string, args: Record<string, unknown>) {
  const r = await call("POST", `/tools/execute/${slug}`, { connected_account_id: connectedAccountId, user_id: userId, arguments: args });
  if (r.status >= 300) throw new ComposioProblem(r.status, `Composio answered with status ${r.status}.`);
  const ok = toolOk(r.json);
  if (!ok.ok) throw new ComposioProblem(400, ok.problem);
  return dataOf(r.json);
}

/** The Instagram professional account behind a connection. */
export async function instagramUser(connectedAccountId: string, userId: string): Promise<{ id: string; username: string | null; name: string | null }> {
  const d = await tool("INSTAGRAM_GET_USER_INFO", connectedAccountId, userId, { ig_user_id: "me", fields: "id,username,name" });
  const me = igUserOf(d);
  if (!me) throw new ComposioProblem(502, "Instagram didn't say which account this is. It needs to be a business or creator account.");
  return me;
}

/** Posts a carousel (2 to 10 JPEG pictures at public addresses) and returns the post's id. */
export async function postInstagramCarousel(conn: { connectedAccountId: string; userId: string }, igUserId: string, caption: string, imageUrls: string[]): Promise<string> {
  const urls = imageUrls.slice(0, 10);
  if (urls.length < 2) throw new ComposioProblem(400, "Instagram carousels need at least two pictures.");
  const container = await tool("INSTAGRAM_CREATE_CAROUSEL_CONTAINER", conn.connectedAccountId, conn.userId, { ig_user_id: igUserId, caption: caption.slice(0, 2200), child_image_urls: urls });
  const creationId = idIn(container);
  if (!creationId) throw new ComposioProblem(502, "Instagram didn't return the carousel it made.");
  // Composio waits and retries while Instagram finishes the pictures (about 44 seconds at most).
  const post = await tool("INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH", conn.connectedAccountId, conn.userId, { ig_user_id: igUserId, creation_id: creationId });
  return idIn(post) ?? creationId;
}
