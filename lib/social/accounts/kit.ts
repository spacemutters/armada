import type { Blueprint } from "@/lib/shops/types";

// The profile kit: what a shop's social profiles should say, cut to each platform's limits, for
// the parts no app is allowed to fill in (Instagram's and TikTok's bio, picture and link) and for
// the Facebook Page parts Armada fills in itself. Pure, so the offline check can test the limits.
//
// The words come from the shop's own copy, which the AI wrote in the shop's voice (tagline, the
// footer line, the value points). Nothing here invents a claim the shop didn't make.
//
// Limits, checked 2026-09-24:
//   Instagram bio 150 characters (Instagram Help Center); username 30.
//   TikTok bio 80 characters (the long-standing cap; some accounts now get more, 80 fits all); username 2 to 24.
//   Facebook Page "about" 100 characters (Graph API Page reference: "Limit of 100 characters").

export const LIMITS = {
  instagram: { bio: 150, username: 30 },
  tiktok: { bio: 80, username: 24 },
  facebook: { about: 100 },
} as const;

export type KitPlatform = "instagram" | "facebook" | "tiktok";

export interface KitBrand {
  name: string;
  tagline: string;
  footerBlurb: string;
  subhead: string;
  points: string[];
}

export function kitBrand(bp: Blueprint, fallbackName: string): KitBrand {
  return {
    name: (bp.brand?.name || fallbackName).trim(),
    tagline: (bp.brand?.tagline ?? "").trim(),
    footerBlurb: (bp.footerBlurb ?? "").trim(),
    subhead: (bp.hero?.subhead ?? "").trim(),
    points: (bp.valueProps ?? []).map((v) => v.title.trim()).filter(Boolean),
  };
}

/** Length as the platforms count it, erring long: an emoji counts as two, so a fit here always fits there. */
export const length = (s: string) => s.length;

const squash = (s: string) => s.replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();

/** Cuts text to `max` at a word boundary, without a dangling comma or dash. Never longer than `max`. */
export function fit(text: string, max: number): string {
  const t = squash(text);
  if (length(t) <= max) return t;
  const cut = t.slice(0, max + 1);
  const space = Math.max(cut.lastIndexOf(" "), cut.lastIndexOf("\n"));
  const out = (space > max * 0.5 ? cut.slice(0, space) : t.slice(0, max)).replace(/[\s,;:·–—-]+$/, "");
  return out.length <= max ? out : out.slice(0, max);
}

/** The first candidate that fits whole, else the first one cut to fit. */
function firstThatFits(candidates: string[], max: number): string {
  const c = candidates.map(squash).filter(Boolean);
  return c.find((s) => length(s) <= max) ?? fit(c[0] ?? "", max);
}

/** The bio (or Page description) for one platform, always within its limit. */
export function bioFor(platform: KitPlatform, b: KitBrand): string {
  if (platform === "facebook") return firstThatFits([b.footerBlurb, b.tagline, b.subhead, b.name], LIMITS.facebook.about);
  if (platform === "tiktok") return firstThatFits([b.tagline, b.subhead, b.footerBlurb, b.name], LIMITS.tiktok.bio);
  // Instagram: the tagline, then the shop's value points on a second line when they fit.
  const max = LIMITS.instagram.bio;
  const first = firstThatFits([b.tagline, b.subhead, b.footerBlurb, b.name], max);
  let points = "";
  for (const p of b.points.slice(0, 3)) {
    const next = points ? `${points} · ${p}` : p;
    if (length(`${first}\n${next}`) > max) break;
    points = next;
  }
  return points ? `${first}\n${points}` : first;
}

/** Username ideas from the brand name, within the platform's rules (letters, numbers, dots, underscores). */
export function usernameIdeas(name: string, platform: "instagram" | "tiktok"): string[] {
  const max = LIMITS[platform].username;
  const base = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "");
  if (base.length < 2) return [];
  const ideas = [base, `${base}.shop`, `shop${base}`, `${base}_store`, `the${base}`]
    .map((s) => s.slice(0, max).replace(/[._]+$/, ""))
    .filter((s) => s.length >= 2 && /^[a-z0-9._]+$/.test(s));
  return [...new Set(ideas)].slice(0, 3);
}

export interface ProfileKit {
  instagram: { bio: string; usernames: string[]; link: string };
  tiktok: { bio: string; usernames: string[]; link: string };
  facebook: { about: string; website: string };
}

export function buildKit(b: KitBrand, link: string): ProfileKit {
  return {
    instagram: { bio: bioFor("instagram", b), usernames: usernameIdeas(b.name, "instagram"), link },
    tiktok: { bio: bioFor("tiktok", b), usernames: usernameIdeas(b.name, "tiktok"), link },
    facebook: { about: bioFor("facebook", b), website: link },
  };
}
