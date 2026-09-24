import {
  Anchor, Apple, Armchair, Baby, Backpack, Bath, Bed, Bike, Bird, Bone, Book, Box, Brush, Cake, Camera, Car, Carrot, Cat,
  ChefHat, Coffee, Compass, Cookie, CookingPot, CupSoda, Dog, Droplet, Dumbbell, Fish, Flame, Flower2, Footprints, Gamepad2,
  Gem, Gift, Glasses, Hammer, Headphones, Heart, Key, Keyboard, Lamp, LampDesk, Leaf, Monitor, Mountain, Mouse, Music, Package,
  Palette, PawPrint, PenTool, Plane, Rabbit, Sailboat, Salad, Scissors, Shirt, ShoppingBag, Smartphone, Snowflake, Sofa,
  Sparkles, Speaker, Sprout, Sun, Tag, Tent, TreePine, Turtle, Umbrella, Utensils, Watch, Wind, Wine, Wrench,
  type LucideIcon,
} from "lucide-react";
import type { CatalogImage } from "@/lib/types";

const ICONS: Record<string, LucideIcon> = {
  anchor: Anchor, apple: Apple, armchair: Armchair, baby: Baby, backpack: Backpack, bath: Bath, bed: Bed, bike: Bike,
  bird: Bird, bone: Bone, book: Book, box: Box, brush: Brush, cake: Cake, camera: Camera, car: Car, carrot: Carrot, cat: Cat,
  "chef-hat": ChefHat, coffee: Coffee, compass: Compass, cookie: Cookie, "cooking-pot": CookingPot, "cup-soda": CupSoda,
  dog: Dog, droplet: Droplet, dumbbell: Dumbbell, fish: Fish, flame: Flame, "flower-2": Flower2, footprints: Footprints,
  "gamepad-2": Gamepad2, gem: Gem, gift: Gift, glasses: Glasses, hammer: Hammer, headphones: Headphones, heart: Heart,
  key: Key, keyboard: Keyboard, lamp: Lamp, "lamp-desk": LampDesk, leaf: Leaf, monitor: Monitor, mountain: Mountain,
  mouse: Mouse, music: Music, package: Package, palette: Palette, "paw-print": PawPrint, "pen-tool": PenTool, plane: Plane,
  rabbit: Rabbit, sailboat: Sailboat, salad: Salad, scissors: Scissors, shirt: Shirt, "shopping-bag": ShoppingBag,
  smartphone: Smartphone, snowflake: Snowflake, sofa: Sofa, sparkles: Sparkles, speaker: Speaker, sprout: Sprout, sun: Sun,
  tag: Tag, tent: Tent, "tree-pine": TreePine, turtle: Turtle, umbrella: Umbrella, utensils: Utensils, watch: Watch,
  wind: Wind, wine: Wine, wrench: Wrench,
};

export function iconFor(name: string | undefined): LucideIcon {
  return (name && ICONS[name]) || Package;
}

/**
 * A product's picture: the supplier photo when there is one, otherwise the illustrated tile used
 * for practice items (clearly not a photo, so it can't pass as the real thing).
 */
export function ProductArt({
  images,
  icon,
  title,
  className,
  sizes = "(min-width: 768px) 25vw, 50vw",
}: {
  images: CatalogImage[];
  icon?: string;
  title: string;
  className?: string;
  sizes?: string;
}) {
  const first = images?.[0];
  if (first?.url) {
    return (
      // Supplier images come from many hosts; a plain img avoids an allow-list per supplier.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={first.url} alt={first.alt ?? title} sizes={sizes} loading="lazy" className={`h-full w-full object-cover ${className ?? ""}`} />
    );
  }
  const Icon = iconFor(icon);
  return (
    <div
      role="img"
      aria-label={`${title} (practice item illustration)`}
      className={`flex h-full w-full items-center justify-center ${className ?? ""}`}
      style={{ background: "color-mix(in srgb, var(--art-bg, #e8eefc) 100%, transparent)" }}
    >
      <Icon aria-hidden strokeWidth={1.25} className="h-1/3 w-1/3" style={{ color: "var(--art-fg, #1f4fd1)" }} />
    </div>
  );
}
