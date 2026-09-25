import { Clapperboard, Gavel, Megaphone, PackageSearch, Printer, Search, Shirt, ShoppingBag, Store, Warehouse, type LucideIcon } from "lucide-react";
import type { Provider } from "@/lib/connections/types";
import { cx } from "@/components/ui";

// Each platform's mark: one plain monochrome glyph on a quiet tile. Deliberately not the platforms'
// logos (those are theirs); the name beside the mark says which platform it is.
const GLYPH: Record<Provider, LucideIcon> = {
  shopify: ShoppingBag,
  ebay: Gavel,
  facebook: Store,
  cj: Warehouse,
  aliexpress: PackageSearch,
  printful: Shirt,
  printify: Printer,
  meta_ads: Megaphone,
  google_ads: Search,
  tiktok_ads: Clapperboard,
};

export function PlatformMark({ provider, dim = false, className }: { provider: Provider; dim?: boolean; className?: string }) {
  const Icon = GLYPH[provider];
  return (
    <span aria-hidden className={cx("flex size-11 shrink-0 items-center justify-center rounded-xl border border-line bg-sunken", dim ? "text-muted" : "text-ink", className)}>
      <Icon className="size-5" strokeWidth={1.75} />
    </span>
  );
}
