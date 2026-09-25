"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { BorderBeam } from "@/components/fx/border-beam";
import { ShimmerText } from "@/components/fx/shimmer-text";
import { ThinkingOrb } from "@/components/fx/thinking-orb";
import { buttonClass, inputClass } from "@/components/ui";

/**
 * The "Find products" search. It still posts as a plain form without scripts; with them it moves in
 * place and a light travels round the box for as long as the search is running.
 */
export function SearchBox({ q, from }: { q: string; from: string }) {
  const router = useRouter();
  const [searching, start] = useTransition();
  return (
    <form
      className="mb-6 flex max-w-2xl gap-2"
      action="/products"
      role="search"
      aria-busy={searching || undefined}
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        const params = new URLSearchParams();
        for (const [k, v] of data) if (typeof v === "string" && (k !== "q" || v.trim())) params.set(k, k === "q" ? v.trim() : v);
        start(() => router.push(`/products?${params.toString()}`));
      }}
    >
      <input type="hidden" name="tab" value="find" />
      <input type="hidden" name="from" value={from} />
      <BorderBeam active={searching} className="min-w-0 flex-1">
        <input name="q" defaultValue={q} className={inputClass} placeholder="Try: kitchen knife, water bottle, lamp" aria-label="Search products" />
      </BorderBeam>
      <button type="submit" className={buttonClass("primary", "min-h-10 min-w-[8.5rem] shrink-0")} disabled={searching} style={searching ? { opacity: 1, cursor: "progress" } : undefined}>
        {searching ? (
          <>
            <ThinkingOrb state="searching" size={16} decorative ink="inverse" />
            <ShimmerText tone="current">Searching…</ShimmerText>
          </>
        ) : (
          "Search"
        )}
      </button>
    </form>
  );
}
