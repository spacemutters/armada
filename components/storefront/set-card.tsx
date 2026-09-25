import Link from "next/link";
import { ProductArt } from "@/components/product-art";
import { formatMoney } from "@/lib/money";
import type { ShopSet } from "@/lib/shops/sets";
import type { StoreItem } from "@/lib/shops/storefront";
import { AddTogether } from "./sets";

/** A set: its products side by side, what it's for, its price and the real price of its items bought separately. */
export function SetCard({ set, items, base, slug }: { set: ShopSet; items: StoreItem[]; base: string; slug: string }) {
  const members = set.productHandles.map((h) => items.find((i) => i.handle === h)).filter((i): i is StoreItem => Boolean(i));
  if (members.length < 2) return null;
  const lines = members.map((m) => ({ handle: m.handle, title: m.product.title, priceCents: m.priceCents, image: m.product.images[0]?.url ?? null, icon: m.product.art?.icon ?? null }));
  return (
    <li className="sf-line flex list-none flex-col gap-5 rounded-[var(--s-radius)] border p-5">
      <div className={`grid gap-3 ${members.length === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
        {members.map((m) => (
          <Link key={m.handle} href={`${base}/products/${m.handle}`} className="sf-card-media block" style={{ aspectRatio: "1 / 1" }} aria-label={m.product.title}>
            <ProductArt images={m.product.images} icon={m.product.art?.icon} title={m.product.title} sizes="(min-width: 1024px) 12vw, 30vw" />
          </Link>
        ))}
      </div>
      <div>
        <h3 className="sf-heading text-[clamp(1.2rem,1.6vw,1.45rem)]">{set.title}</h3>
        {set.why ? <p className="sf-muted mt-2">{set.why}</p> : null}
        <p className="sf-muted mt-2 text-[14px]">{members.map((m) => m.product.title).join(" · ")}</p>
      </div>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-4">
        <p className="tabular-nums">
          <span className="text-[20px]">{formatMoney(set.priceCents)}</span>
          <span className="sf-muted ml-2 text-[14px]">together · {formatMoney(set.separateCents)} separately</span>
        </p>
        <AddTogether slug={slug} lines={lines} label="Add the set" />
      </div>
    </li>
  );
}
