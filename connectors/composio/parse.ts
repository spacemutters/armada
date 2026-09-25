// Reading Composio's answers (pure, so the offline check can load it without the server). Composio
// hosts approved apps (Instagram among them) and runs each platform call as a "tool"; a tool's
// answer carries `data` (an object, or JSON as text), `successful` and `error`.
// https://docs.composio.dev/reference/api-reference/connected-accounts , /tools/execute

export const COMPOSIO_API = "https://backend.composio.dev/api/v3.1";

/** A tool's data as an object, whether Composio sent it as an object or as JSON text. */
export function dataOf(answer: unknown): Record<string, unknown> {
  const d = (answer as { data?: unknown } | null)?.data;
  if (d && typeof d === "object") return d as Record<string, unknown>;
  if (typeof d === "string") {
    try {
      const parsed = JSON.parse(d);
      return parsed && typeof parsed === "object" ? parsed : { value: d };
    } catch {
      return { value: d };
    }
  }
  return {};
}

export function toolOk(answer: unknown): { ok: true } | { ok: false; problem: string } {
  const a = answer as { successful?: unknown; error?: unknown } | null;
  if (a?.successful === true) return { ok: true };
  const e = typeof a?.error === "string" && a.error.trim() ? a.error.trim() : "the platform refused it";
  return { ok: false, problem: e.slice(0, 300) };
}

/** The id Instagram gave a new container or post, wherever in the answer it sits. */
export function idIn(data: Record<string, unknown>): string | null {
  for (const v of [data.id, data.creation_id, (data.data as Record<string, unknown> | undefined)?.id, (data.response_data as Record<string, unknown> | undefined)?.id]) {
    if (typeof v === "string" && v) return v;
    if (typeof v === "number") return String(v);
  }
  return null;
}

/** The Instagram account a connection belongs to. */
export function igUserOf(data: Record<string, unknown>): { id: string; username: string | null; name: string | null } | null {
  const d = (data.data && typeof data.data === "object" ? data.data : data) as Record<string, unknown>;
  const id = typeof d.id === "string" ? d.id : typeof d.id === "number" ? String(d.id) : typeof d.user_id === "string" ? d.user_id : null;
  if (!id) return null;
  return { id, username: typeof d.username === "string" ? d.username : null, name: typeof d.name === "string" ? d.name : null };
}

/** The hosted sign-in page and the connection it will become. */
export function linkOf(answer: unknown): { redirectUrl: string; connectedAccountId: string } | null {
  const a = answer as { redirect_url?: unknown; connected_account_id?: unknown } | null;
  return typeof a?.redirect_url === "string" && typeof a.connected_account_id === "string" && /^https:\/\//.test(a.redirect_url)
    ? { redirectUrl: a.redirect_url, connectedAccountId: a.connected_account_id }
    : null;
}

/** A connection's state: ACTIVE once the person approved. */
export function accountStatusOf(answer: unknown): string | null {
  const s = (answer as { status?: unknown } | null)?.status;
  return typeof s === "string" ? s.toUpperCase() : null;
}

/** The managed Instagram setup in a list of Composio's auth configs, if there is one. */
export function managedConfigIn(answer: unknown, toolkit: string): string | null {
  const items = (answer as { items?: unknown[] } | null)?.items;
  if (!Array.isArray(items)) return null;
  for (const it of items as Record<string, unknown>[]) {
    const slug = (it.toolkit as { slug?: string } | undefined)?.slug;
    const managed = it.is_composio_managed === true || it.type === "use_composio_managed_auth";
    const enabled = it.status === undefined || String(it.status).toUpperCase() === "ENABLED";
    if (slug === toolkit && managed && enabled && typeof it.id === "string") return it.id;
  }
  return null;
}
