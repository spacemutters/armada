import Link from "next/link";
import { ProductArt } from "@/components/product-art";
import { formatMoney } from "@/lib/money";
import type { StoreItem } from "@/lib/shops/storefront";

export function ProductCard({ item, base, feature = false }: { item: StoreItem; base: string; feature?: boolean }) {
  const p = item.product;
  return (
    <li className="sf-card list-none">
      <Link href={`${base}/products/${item.handle}`} className="block">
        <div className="sf-card-media">
          <ProductArt images={p.images} icon={p.art?.icon} title={p.title} sizes={feature ? "(min-width: 1024px) 55vw, 100vw" : "(min-width: 768px) 25vw, 50vw"} />
        </div>
        <div className="mt-4 flex items-baseline justify-between gap-4">
          <span className={`leading-snug ${feature ? "sf-heading text-[clamp(1.25rem,1.8vw,1.6rem)]" : "text-[15px]"}`}>{p.title}</span>
          <span className={`shrink-0 tabular-nums ${feature ? "text-[18px]" : "text-[15px]"}`}>{formatMoney(item.priceCents)}</span>
        </div>
        {item.imagined ? <span className="sf-label mt-1 block">Practice item</span> : null}
      </Link>
    </li>
  );
}
