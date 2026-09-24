// Buttons on the store-opening screens: 44 px tall so they're easy to hit on a phone, in the same
// look as components/ui.tsx buttons.

export const bigButton =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-5 text-[15px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";
export const bigPrimary = `${bigButton} bg-accent text-accent-ink hover:opacity-90`;
export const bigSecondary = `${bigButton} border border-line-strong bg-raised text-ink hover:bg-sunken`;
