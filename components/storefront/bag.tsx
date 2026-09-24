"use client";

import { ShoppingBag } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { iconFor } from "@/components/product-art";
import { formatMoney } from "@/lib/money";
import { addToBag, onBagChange, readBag, writeBag, type BagLine } from "./cart-store";

function useBag(slug: string): BagLine[] {
  const [lines, setLines] = useState<BagLine[]>([]);
  useEffect(() => {
    const update = () => setLines(readBag(slug));
    update();
    return onBagChange(update);
  }, [slug]);
  return lines;
}

export function BagLink({ slug }: { slug: string }) {
  const lines = useBag(slug);
  const count = lines.reduce((n, l) => n + l.qty, 0);
  return (
    <Link href={`/s/${slug}/cart`} className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 text-[15px]" aria-label={`Bag, ${count} items`}>
      <ShoppingBag aria-hidden className="size-5" strokeWidth={1.6} />
      <span className="tabular-nums">{count}</span>
    </Link>
  );
}

export function AddToBag({ slug, line }: { slug: string; line: Omit<BagLine, "qty"> }) {
  const [added, setAdded] = useState(false);
  return (
    <button
      className="sf-button w-full sm:w-auto"
      onClick={() => {
        addToBag(slug, line);
        setAdded(true);
        setTimeout(() => setAdded(false), 1600);
      }}
    >
      {added ? "Added to your bag" : "Add to bag"}
    </button>
  );
}

export function BagView({ slug }: { slug: string }) {
  const lines = useBag(slug);
  const total = lines.reduce((n, l) => n + l.priceCents * l.qty, 0);
  const setQty = (handle: string, qty: number) =>
    writeBag(
      slug,
      readBag(slug)
        .map((l) => (l.handle === handle ? { ...l, qty } : l))
        .filter((l) => l.qty > 0),
    );

  if (!lines.length) {
    return (
      <div className="flex flex-col items-start gap-5">
        <p className="sf-lead sf-muted">Your bag is empty.</p>
        <Link href={`/s/${slug}`} className="sf-button">
          Back to the shop
        </Link>
      </div>
    );
  }

  return (
    <div className="grid gap-12 lg:grid-cols-[7fr_5fr]">
      <ul className="flex flex-col">
        {lines.map((l) => {
          const Icon = iconFor(l.icon ?? undefined);
          return (
            <li key={l.handle} className="sf-line flex items-center gap-5 border-b py-5">
              <Link href={`/s/${slug}/products/${l.handle}`} className="sf-card-media block w-24 shrink-0" style={{ aspectRatio: "1 / 1" }}>
                {l.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={l.image} alt={l.title} className="h-full w-full" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center" style={{ color: "var(--s-accent)" }}>
                    <Icon aria-hidden className="size-8" strokeWidth={1.25} />
                  </span>
                )}
              </Link>
              <div className="min-w-0 flex-1">
                <Link href={`/s/${slug}/products/${l.handle}`} className="font-medium">
                  {l.title}
                </Link>
                <div className="sf-muted mt-1 tabular-nums">{formatMoney(l.priceCents)}</div>
              </div>
              <div className="flex items-center gap-1">
                <button className="sf-button sf-button-ghost !min-h-11 !px-3" aria-label={`One fewer ${l.title}`} onClick={() => setQty(l.handle, l.qty - 1)}>
                  −
                </button>
                <span className="w-8 text-center tabular-nums">{l.qty}</span>
                <button className="sf-button sf-button-ghost !min-h-11 !px-3" aria-label={`One more ${l.title}`} onClick={() => setQty(l.handle, Math.min(20, l.qty + 1))}>
                  +
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <aside className="sf-line flex h-fit flex-col gap-4 rounded-[var(--s-radius)] border p-6">
        <div className="flex items-baseline justify-between">
          <span>Subtotal</span>
          <span className="text-xl font-medium tabular-nums">{formatMoney(total)}</span>
        </div>
        <p className="sf-muted text-[15px]">Shipping is worked out at checkout.</p>
        <button className="sf-button w-full" aria-disabled="true" disabled>
          Checkout
        </button>
        <p className="sf-muted text-[14px]">
          This is a preview built with Armada, so checkout is switched off. Once the shop is published to a real Shopify store, checkout runs
          there.
        </p>
      </aside>
    </div>
  );
}
