"use client";

import { ChevronDown } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { cx } from "@/components/ui";

/** Switches the posts screen to another shop. */
export function ShopPicker({ shops, current }: { shops: { id: string; name: string }[]; current: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <label className="relative inline-flex items-center">
      <span className="sr-only">Shop</span>
      <select
        value={current}
        onChange={(e) => start(() => router.push(`/social?shop=${e.target.value}`))}
        aria-busy={pending || undefined}
        className={cx(
          "min-h-11 appearance-none rounded-xl border border-line-strong bg-raised py-2 pr-9 pl-3 text-[14px] font-medium text-ink hover:bg-sunken focus:border-accent focus:outline-none md:min-h-9",
          pending && "opacity-70",
        )}
      >
        {shops.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <ChevronDown aria-hidden className="pointer-events-none absolute right-3 size-4 text-muted" />
    </label>
  );
}
