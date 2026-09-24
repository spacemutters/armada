// The choices the shop builder's AI may pick from. Keeping these closed lists means every shop
// renders with fonts that load and icons that exist.

export const DISPLAY_FONTS = [
  "Fraunces",
  "Instrument Serif",
  "DM Serif Display",
  "Cormorant Garamond",
  "Young Serif",
  "Bodoni Moda",
  "Newsreader",
  "Space Grotesk",
  "Syne",
  "Archivo",
  "Bricolage Grotesque",
  "Sora",
  "Unbounded",
  "Familjen Grotesk",
] as const;

export const BODY_FONTS = [
  "Inter",
  "DM Sans",
  "Manrope",
  "Figtree",
  "Work Sans",
  "Karla",
  "Public Sans",
  "IBM Plex Sans",
  "Source Serif 4",
  "Libre Franklin",
] as const;

export const ART_ICONS = [
  "paw-print", "dog", "cat", "fish", "bird", "bone", "rabbit", "turtle",
  "armchair", "sofa", "lamp", "lamp-desk", "bed", "bath", "cooking-pot", "utensils", "chef-hat",
  "coffee", "cup-soda", "wine", "cake", "cookie", "apple", "carrot", "salad",
  "dumbbell", "bike", "tent", "mountain", "backpack", "footprints", "compass", "anchor", "sailboat",
  "shirt", "watch", "glasses", "gem", "gift", "tag", "shopping-bag", "package", "box",
  "headphones", "keyboard", "mouse", "monitor", "smartphone", "gamepad-2", "speaker", "camera",
  "sparkles", "flower-2", "leaf", "sprout", "tree-pine", "sun", "umbrella", "snowflake", "droplet", "wind", "flame",
  "baby", "palette", "brush", "pen-tool", "book", "music", "car", "plane", "scissors", "hammer", "wrench", "key", "heart",
] as const;

export type DisplayFont = (typeof DISPLAY_FONTS)[number];
export type BodyFont = (typeof BODY_FONTS)[number];
export type ArtIcon = (typeof ART_ICONS)[number];

// These ship in one weight only; asking Google Fonts for others makes the whole request fail.
const SINGLE_WEIGHT = new Set(["Instrument Serif", "DM Serif Display", "Young Serif"]);

export function googleFontsHref(display: string, body: string): string {
  const fam = (name: string, weights: string) =>
    `family=${encodeURIComponent(name).replace(/%20/g, "+")}:wght@${SINGLE_WEIGHT.has(name) ? "400" : weights}`;
  const families =
    display === body ? [fam(display, "400;500;600;700")] : [fam(display, "400;500;600;700"), fam(body, "400;500;600")];
  return `https://fonts.googleapis.com/css2?${families.join("&")}&display=swap`;
}
