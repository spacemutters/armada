"use client";

import { Sparkles } from "lucide-react";
import { useId, useState } from "react";
import type { CSSProperties } from "react";
import { PendingButton } from "./fx/pending-button";
import { Tick } from "./fx/tick";
import { ProductArt } from "./product-art";
import { buttonClass, cx } from "./ui";
import { formatMoney } from "@/lib/money";

/** One proposed product, as the chooser shows it. */
export interface ChooserCard {
  id: string;
  title: string;
  why: string;
  collection: string;
  priceCents: number;
  priceEstimated: boolean;
  score: number;
  reasons: string[];
  image: { url: string; alt?: string } | null;
  icon: string | null;
  practice: boolean;
}

/**
 * The owner's step in a shop build: the AI proposed twice the products the shop will sell, and the
 * owner taps the ones they want. A live count says how many are chosen, and the build button only
 * works at exactly the right number. "Let the AI pick for me" takes the AI's own top picks in one press.
 *
 * Each card is a real checkbox (keyboard and screen readers work as usual). A chosen card shows a
 * check mark and a heavier border, so the choice never rests on colour alone.
 */
export function ProductChooser({
  need,
  cards,
  artColors,
  choose,
  aiPick,
}: {
  need: number;
  cards: ChooserCard[];
  artColors?: { bg: string; fg: string };
  choose: (formData: FormData) => Promise<void>;
  aiPick: () => Promise<void>;
}) {
  const formId = useId();
  const [chosen, setChosen] = useState<string[]>([]);
  // Cards that were ticked while this page was open draw their check mark.
  const [touched, setTouched] = useState<string[]>([]);
  const count = chosen.length;
  const exact = count === need;
  const artVars = artColors ? ({ "--art-bg": artColors.bg, "--art-fg": artColors.fg } as CSSProperties) : undefined;
  const estimated = cards.some((c) => c.priceEstimated);

  const toggle = (id: string) => {
    setChosen((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
    setTouched((cur) => (cur.includes(id) ? cur : [...cur, id]));
  };

  const status =
    count < need ? `${need - count} more to choose` : count === need ? "Ready to build" : `${count - need} too many. Untick ${count - need === 1 ? "one" : count - need}.`;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-[13px] text-muted">
          Best fit first.{" "}
          {estimated
            ? "Prices come from your pricing rules and are estimates until CJ confirms shipping for the ones you choose."
            : "Prices come from your pricing rules."}
        </p>
        <form action={aiPick}>
          <PendingButton variant="secondary" pendingLabel="Picking…" className={buttonClass("secondary", "min-h-11 md:min-h-9")}>
            <Sparkles aria-hidden className="size-4" />
            Let the AI pick for me
          </PendingButton>
        </form>
      </div>

      <ul className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
        {cards.map((c) => {
          const on = chosen.includes(c.id);
          return (
            <li key={c.id} className="min-w-0">
              <label
                data-proposal={c.id}
                className={cx(
                  "group flex h-full cursor-pointer flex-col overflow-hidden rounded-2xl border bg-raised transition-[border-color,box-shadow] duration-200",
                  "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent",
                  on ? "border-accent shadow-[0_0_0_1px_var(--accent)]" : "border-line hover:border-line-strong",
                )}
              >
                <input
                  type="checkbox"
                  name="pick"
                  value={c.id}
                  form={formId}
                  checked={on}
                  onChange={() => toggle(c.id)}
                  aria-labelledby={`${c.id}-t`}
                  aria-describedby={`${c.id}-d`}
                  className="sr-only"
                />
                <span className="relative block aspect-square overflow-hidden bg-sunken" style={artVars}>
                  <ProductArt images={c.image ? [c.image] : []} icon={c.icon ?? undefined} title={c.title} sizes="(min-width: 1280px) 22vw, (min-width: 1024px) 28vw, 50vw" />
                  <span aria-hidden className="absolute top-2.5 right-2.5 flex size-7 items-center justify-center">
                    {on ? (
                      <Tick size={28} look="filled" weight={2.25} draw={touched.includes(c.id)} className="text-accent drop-shadow-sm" />
                    ) : (
                      <span className="block size-6 rounded-full border-[1.5px] border-muted bg-raised/90 shadow-sm backdrop-blur-sm transition-colors group-hover:border-ink" />
                    )}
                  </span>
                </span>
                <span className="flex flex-1 flex-col gap-1.5 p-3 sm:p-3.5">
                  <span id={`${c.id}-t`} className="line-clamp-2 text-[14px] leading-snug font-medium break-words text-ink">
                    {c.title}
                  </span>
                  <span id={`${c.id}-d`} className="flex flex-1 flex-col gap-1.5">
                    {c.why ? <span className="line-clamp-3 text-[13px] leading-snug text-muted">{c.why}</span> : null}
                    <span className="mt-auto flex flex-wrap items-baseline justify-between gap-x-2 pt-1.5">
                      <span className="tabular text-[15px] font-semibold text-ink">
                        {c.priceEstimated ? <span className="text-[12px] font-normal text-muted">about </span> : null}
                        {formatMoney(c.priceCents)}
                      </span>
                      <span className="tabular text-[13px] text-muted">
                        <span className="font-semibold text-ink">{c.score}</span>/100
                        <span className="sr-only"> score</span>
                      </span>
                    </span>
                    {c.reasons.length ? <span className="text-[12px] leading-snug text-muted">{c.reasons.join(", ")}</span> : null}
                    <span className="truncate text-[12px] text-muted">
                      {c.collection}
                      {c.practice ? " · practice item" : ""}
                    </span>
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      <div className="glass sticky bottom-[calc(88px+env(safe-area-inset-bottom))] z-10 flex flex-col gap-2.5 rounded-2xl px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 md:bottom-6">
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-3 sm:flex-col sm:items-start sm:gap-0" aria-live="polite">
              <span className="tabular text-[15px] font-semibold text-ink">
                {count} of {need} chosen
              </span>
              <span className={cx("text-[12px] text-ink", count > need ? "font-semibold" : "")}>{status}</span>
            </div>
            <div aria-hidden className="flex w-full gap-0.5 sm:w-36">
              {Array.from({ length: need }, (_, i) => (
                <span key={i} className={cx("h-1 flex-1 rounded-full transition-colors duration-200", i < count ? (count > need ? "bg-attention" : "bg-ink") : "bg-line-strong")} />
              ))}
            </div>
          </div>
          <form id={formId} action={choose} className="sm:shrink-0">
            <PendingButton pendingLabel="Starting the build…" disabled={!exact} className={buttonClass("primary", "min-h-11 w-full sm:w-auto md:min-h-10")}>
              Build the shop with these {need}
            </PendingButton>
          </form>
      </div>
    </div>
  );
}
