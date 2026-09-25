import type { SocialPlatform } from "@/lib/social/types";

// Simple original marks for the three platforms, drawn in the text colour. Not the platforms' logos:
// the name always sits beside the mark, so the mark only has to give each card its own shape.
//   Instagram: a stack of pictures (a carousel). Facebook Page: a flag (a place of your own).
//   TikTok: a tall screen with a play shape (short video). Pinterest: a push pin (pinned to a board).

const PATHS: Record<SocialPlatform, React.ReactNode> = {
  instagram: (
    <>
      <rect x="7" y="3" width="14" height="14" rx="3.5" />
      <path d="M3.5 8v9.5A3.5 3.5 0 0 0 7 21h9.5" />
      <path d="m10 14 3-3.5 2.5 2.5 1.5-1.5 2 2.5" />
    </>
  ),
  facebook: (
    <>
      <path d="M5.5 21V3.5" />
      <path d="M5.5 4.5h12l-2.6 4 2.6 4h-12" />
    </>
  ),
  tiktok: (
    <>
      <rect x="6.5" y="2.5" width="11" height="19" rx="3" />
      <path d="M10.5 9.5v5l4-2.5z" />
    </>
  ),
  pinterest: (
    <>
      <path d="M9 3h6l-1 5.5 3 3H7l3-3z" />
      <path d="M12 11.5V21" />
    </>
  ),
};

export function PlatformMark({ platform, className }: { platform: SocialPlatform; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}>
      {PATHS[platform]}
    </svg>
  );
}
