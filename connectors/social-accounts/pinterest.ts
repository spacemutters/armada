import type { Fetch, PostOutcome, SlideIn } from "./types";

// Pinterest (API v5). Armada has no Pinterest app of its own: a shop's Pinterest connects through the
// connection service's approved app, and every request here goes through the service's relay, which
// adds the person's access (connectors/pipedream/social.ts turns the relay into the fetch passed in).
// No server imports, so the offline check drives it with a fake fetch.
// https://developers.pinterest.com/docs/api/v5/

export const PINTEREST_API = "https://api.pinterest.com/v5";

/** Pinterest's limits on a pin's words, and on a carousel's pictures. */
export const PIN_LIMITS = { title: 100, description: 800, alt: 500, carouselMin: 2, carouselMax: 5 };

export class PinterestProblem extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "PinterestProblem";
  }
}

export interface PinterestMe {
  id: string;
  username: string;
  name: string;
  /** "BUSINESS" accounts can make carousel pins; personal ones ("PINNER") post one picture. */
  business: boolean;
  link: string;
}

export interface PinterestBoard {
  id: string;
  name: string;
}

async function ask<T>(fetch: Fetch, method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${PINTEREST_API}${path}`, {
    method,
    headers: { accept: "application/json", ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (r.status < 200 || r.status > 299) {
    const said = (json as { message?: unknown } | null)?.message;
    throw new PinterestProblem(r.status, typeof said === "string" && said ? said : `Pinterest answered ${r.status}.`);
  }
  return json as T;
}

export const pinterestProfileUrl = (username: string) => `https://www.pinterest.com/${encodeURIComponent(username)}/`;

export async function pinterestMe(fetch: Fetch): Promise<PinterestMe> {
  const me = await ask<{ id?: unknown; username?: unknown; business_name?: unknown; account_type?: unknown }>(fetch, "GET", "/user_account");
  const username = typeof me?.username === "string" ? me.username : "";
  if (!username) throw new PinterestProblem(502, "Pinterest didn't say which account this is.");
  return {
    id: typeof me.id === "string" && me.id ? me.id : username,
    username,
    name: typeof me.business_name === "string" && me.business_name ? me.business_name : username,
    business: me.account_type === "BUSINESS",
    link: pinterestProfileUrl(username),
  };
}

/** The person's boards (up to 300). */
export async function pinterestBoards(fetch: Fetch): Promise<PinterestBoard[]> {
  const out: PinterestBoard[] = [];
  let bookmark: string | null = null;
  for (let i = 0; i < 3; i++) {
    const q = new URLSearchParams({ page_size: "100", ...(bookmark ? { bookmark } : {}) });
    const page: { items?: { id?: unknown; name?: unknown }[]; bookmark?: unknown } = await ask(fetch, "GET", `/boards?${q}`);
    for (const b of page?.items ?? []) if (typeof b.id === "string" && typeof b.name === "string") out.push({ id: b.id, name: b.name });
    bookmark = typeof page?.bookmark === "string" && page.bookmark ? page.bookmark : null;
    if (!bookmark) break;
  }
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** The board already named for the shop, if there is one. */
export function boardNamed(boards: PinterestBoard[], brand: string): PinterestBoard | null {
  const want = norm(brand);
  return (want && boards.find((b) => norm(b.name) === want)) || null;
}

export async function makeBoard(fetch: Fetch, name: string, description: string): Promise<PinterestBoard> {
  const b = await ask<{ id?: unknown; name?: unknown }>(fetch, "POST", "/boards", {
    name: name.slice(0, 50),
    description: description.slice(0, 500),
    privacy: "PUBLIC",
  });
  if (typeof b?.id !== "string") throw new PinterestProblem(502, "Pinterest didn't make the board.");
  return { id: b.id, name: typeof b.name === "string" ? b.name : name };
}

/**
 * The board a shop's pins go to: one already named for the shop, or a new one Armada makes with the
 * shop's name. When Pinterest won't let Armada make boards, the person's only board is used; with
 * several, null (the person makes one named for the shop, then connects again).
 */
export async function boardForShop(fetch: Fetch, brand: string, tagline: string): Promise<{ board: PinterestBoard | null; made: boolean }> {
  const boards = await pinterestBoards(fetch);
  const named = boardNamed(boards, brand);
  if (named) return { board: named, made: false };
  try {
    return { board: await makeBoard(fetch, brand, tagline), made: true };
  } catch (e) {
    if (e instanceof PinterestProblem && e.status === 401) throw e;
    return { board: boards.length === 1 ? boards[0] : null, made: false };
  }
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** A pin's title: the caption's first line without hashtags. */
export function pinTitle(caption: string, fallback: string): string {
  const first = caption.split("\n").map((l) => l.replace(/#[\p{L}\p{N}_]+/gu, "").trim()).find(Boolean) ?? "";
  return clip(first || fallback, PIN_LIMITS.title);
}

/** What Armada sends to make one pin: a carousel when the account and the pictures allow, otherwise the first picture. */
export function pinBody(input: { boardId: string; caption: string; link: string | null; slides: SlideIn[]; carousel: boolean; fallbackTitle: string }) {
  const slides = input.slides.slice(0, PIN_LIMITS.carouselMax);
  const title = pinTitle(input.caption, input.fallbackTitle);
  const link = input.link && /^https:\/\//.test(input.link) ? input.link : undefined;
  const media =
    input.carousel && slides.length >= PIN_LIMITS.carouselMin
      ? {
          source_type: "multiple_image_urls",
          index: 0,
          items: slides.map((s) => ({ url: s.imageUrl, title, description: clip(s.alt || title, PIN_LIMITS.description), ...(link ? { link } : {}) })),
        }
      : { source_type: "image_url", url: slides[0]?.imageUrl };
  return {
    board_id: input.boardId,
    title,
    description: clip(input.caption.trim(), PIN_LIMITS.description),
    ...(link ? { link } : {}),
    ...(slides[0]?.alt ? { alt_text: clip(slides[0].alt, PIN_LIMITS.alt) } : {}),
    media_source: media,
  };
}

/** The platform's refusal in plain words, and whether the account must be connected again. */
export function describePinterestError(e: unknown): { problem: string; reconnect: boolean } {
  if (e instanceof PinterestProblem) {
    if (e.status === 401) return { problem: "Pinterest stopped accepting Armada's access to this account. Press Connect again.", reconnect: true };
    if (e.status === 429) return { problem: "Pinterest asked Armada to slow down. Try again in a few minutes.", reconnect: false };
    return { problem: `Pinterest said: ${e.message}`, reconnect: false };
  }
  return { problem: "Couldn't reach Pinterest just now. Try again in a minute.", reconnect: false };
}

/**
 * Posts one pin. A carousel Pinterest refuses (personal accounts can't always make them) is sent
 * again as a single-picture pin, so the post still goes out.
 */
export async function publishPin(
  fetch: Fetch,
  input: { boardId: string; caption: string; link: string | null; slides: SlideIn[]; business: boolean; fallbackTitle: string },
): Promise<PostOutcome> {
  const carousel = input.business && input.slides.length >= PIN_LIMITS.carouselMin;
  const send = (asCarousel: boolean) => ask<{ id?: unknown }>(fetch, "POST", "/pins", pinBody({ ...input, carousel: asCarousel }));
  try {
    let pin: { id?: unknown };
    try {
      pin = await send(carousel);
    } catch (e) {
      if (!carousel || !(e instanceof PinterestProblem) || e.status !== 400) throw e;
      pin = await send(false);
    }
    const id = typeof pin?.id === "string" ? pin.id : null;
    if (!id) return { ok: false, problem: "Pinterest didn't say the pin was made." };
    return { ok: true, externalId: id, url: `https://www.pinterest.com/pin/${id}/` };
  } catch (e) {
    const d = describePinterestError(e);
    return { ok: false, problem: d.problem, reconnect: d.reconnect };
  }
}
