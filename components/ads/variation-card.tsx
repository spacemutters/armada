"use client";

import { Images, Image as ImageIcon, PenLine, RotateCcw, Sparkles, Trash2 } from "lucide-react";
import { useState } from "react";
import { BorderBeam } from "@/components/fx/border-beam";
import { PendingButton } from "@/components/fx/pending-button";
import { ShimmerText } from "@/components/fx/shimmer-text";
import { ThinkingOrb } from "@/components/fx/thinking-orb";
import { buttonClass, cx, inputClass } from "@/components/ui";
import { FeedPreview, ShortPreview, type PreviewAd, type PreviewProduct, type PreviewShop } from "./ad-preview";

// One AI-written ad: how it looks in a feed and as a full-screen card, and what a person can do with
// it (change the words, have the AI write it again, or take it out). While it's being edited the
// previews follow every keystroke; while the AI rewrites it, a light runs round its border.

export interface VariationData {
  id: string;
  position: number;
  status: "draft" | "rewriting" | "removed" | "created" | "failed";
  format: "single" | "carousel";
  idea: string;
  primaryText: string;
  headline: string;
  description: string;
  callToAction: string;
  productIds: string[];
  cards: { productId: string; headline: string; description: string }[];
  writtenBy: "ai" | "ai_edited";
  error: string | null;
}

type Result = { problem?: string } | void;

export interface VariationActions {
  save: (form: FormData) => Promise<Result>;
  rewrite: () => Promise<Result>;
  remove: () => Promise<Result>;
}

interface Limits {
  primaryText: number;
  primaryShown: number;
  headline: number;
  description: number;
  cardHeadline: number;
  cardDescription: number;
}

interface Draft {
  primaryText: string;
  headline: string;
  description: string;
  callToAction: string;
  cards: { productId: string; headline: string; description: string; remove: boolean }[];
}

const toDraft = (v: VariationData): Draft => ({
  primaryText: v.primaryText,
  headline: v.headline,
  description: v.description,
  callToAction: v.callToAction,
  cards: v.cards.map((c) => ({ ...c, remove: false })),
});

const touch = "min-h-11 md:min-h-9";

export function WrittenByAi({ edited }: { edited: boolean }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[12px] text-muted">
      <Sparkles aria-hidden className="size-3" />
      {edited ? "Written by AI, changed by you" : "Written by AI"}
    </span>
  );
}

export function FormatPill({ format, cards }: { format: "single" | "carousel"; cards: number }) {
  const Icon = format === "carousel" ? Images : ImageIcon;
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[12px] text-muted">
      <Icon aria-hidden className="size-3" />
      {format === "carousel" ? `Carousel · ${cards} cards` : "Single photo"}
    </span>
  );
}

export function VariationCard({
  v,
  products,
  shop,
  ctaOptions,
  limits,
  editable,
  actions,
}: {
  v: VariationData;
  products: Record<string, PreviewProduct>;
  shop: PreviewShop;
  ctaOptions: { value: string; label: string }[];
  limits: Limits;
  editable: boolean;
  actions: VariationActions;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => toDraft(v));
  const [problem, setProblem] = useState<string | null>(null);
  const rewriting = v.status === "rewriting";
  const label = (value: string) => ctaOptions.find((o) => o.value === value)?.label ?? "Shop now";

  const shownCards = editing ? draft.cards.filter((c) => !c.remove) : v.cards;
  const ad: PreviewAd = editing
    ? {
        format: v.format,
        primaryText: draft.primaryText,
        headline: draft.headline,
        description: draft.description,
        cta: label(draft.callToAction),
        productIds: v.format === "carousel" ? shownCards.map((c) => c.productId) : v.productIds,
        cards: shownCards,
      }
    : { format: v.format, primaryText: v.primaryText, headline: v.headline, description: v.description, cta: label(v.callToAction), productIds: v.productIds, cards: v.cards };

  const run = async (work: () => Promise<Result>, after?: () => void) => {
    const r = await work();
    if (r && r.problem) setProblem(r.problem);
    else {
      setProblem(null);
      after?.();
    }
  };

  return (
    <BorderBeam active={rewriting} size="md" radius={16} className="block">
      <article
        data-variation={v.id}
        aria-busy={rewriting || undefined}
        className={cx("flex flex-col gap-4 rounded-2xl border bg-raised p-4 sm:p-5", editing ? "border-line-strong" : "border-line")}
      >
        <header className="flex flex-wrap items-center gap-2">
          <h3 className="text-[15px] font-semibold">Ad {v.position + 1}</h3>
          <FormatPill format={v.format} cards={v.format === "carousel" ? ad.cards.length : 1} />
          <WrittenByAi edited={v.writtenBy === "ai_edited"} />
        </header>

        {rewriting ? (
          <p className="flex items-center gap-2 text-[14px]" role="status">
            <ThinkingOrb state="composing" size={20} decorative />
            <ShimmerText>Writing this ad again…</ShimmerText>
          </p>
        ) : (
          <p className="max-w-2xl text-[14px] text-muted">
            <span className="font-medium text-ink">The idea:</span> {v.idea || "Your own words"}
          </p>
        )}
        {v.error ? <p className="rounded-xl bg-attention-soft px-3 py-2 text-[13px] text-attention">{v.error}</p> : null}
        {problem ? (
          <p role="alert" className="rounded-xl bg-sunken px-3 py-2 text-[13px] text-negative">
            {problem}
          </p>
        ) : null}

        <div className={cx("flex flex-col gap-5", rewriting && "opacity-60")}>
          <div className="flex gap-4 overflow-x-auto pb-1 sm:overflow-visible">
            <FeedPreview ad={ad} shop={shop} products={products} className="w-[300px] shrink-0 sm:w-[340px]" />
            <ShortPreview ad={ad} shop={shop} products={products} className="hidden sm:block" />
          </div>

          {editing ? (
            <form
              action={(fd) => run(() => actions.save(fd), () => setEditing(false))}
              className="flex min-w-0 flex-1 flex-col gap-4"
              aria-label={`Change the words of ad ${v.position + 1}`}
            >
              <label className="block">
                <span className="text-[14px] font-medium">Words above the picture</span>
                <textarea
                  name="primaryText"
                  required
                  rows={4}
                  maxLength={limits.primaryText}
                  value={draft.primaryText}
                  onChange={(e) => setDraft({ ...draft, primaryText: e.target.value })}
                  className={cx(inputClass, "mt-2 resize-y leading-snug")}
                />
                <span className="mt-1 block text-[12px] text-muted">
                  {draft.primaryText.length > limits.primaryShown
                    ? `People see the first ${limits.primaryShown} characters before “more”.`
                    : `${limits.primaryShown - draft.primaryText.length} characters left before “more”.`}
                </span>
              </label>
              {v.format === "single" ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="text-[14px] font-medium">Headline</span>
                    <input
                      name="headline"
                      required
                      maxLength={limits.headline}
                      value={draft.headline}
                      onChange={(e) => setDraft({ ...draft, headline: e.target.value })}
                      className={cx(inputClass, "mt-2")}
                    />
                  </label>
                  <label className="block">
                    <span className="text-[14px] font-medium">Line under the headline</span>
                    <input
                      name="description"
                      maxLength={limits.description}
                      value={draft.description}
                      onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                      className={cx(inputClass, "mt-2")}
                    />
                  </label>
                </div>
              ) : (
                <>
                  <input type="hidden" name="headline" value={draft.headline} />
                  <input type="hidden" name="description" value={draft.description} />
                  <fieldset className="flex flex-col gap-3">
                    <legend className="mb-2 text-[14px] font-medium">Cards</legend>
                    {draft.cards.map((c, i) => (
                      <div key={`${c.productId}-${i}`} className={cx("grid gap-2 rounded-xl border border-line p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end", c.remove && "opacity-50")}>
                        <input type="hidden" name={`card_${i}_remove`} value={c.remove ? "1" : ""} />
                        <label className="block min-w-0">
                          <span className="block truncate text-[12px] text-muted">{products[c.productId]?.title ?? "Product"}</span>
                          <input
                            name={`card_${i}_headline`}
                            aria-label={`Card ${i + 1} headline`}
                            maxLength={limits.cardHeadline}
                            value={c.headline}
                            disabled={c.remove}
                            onChange={(e) => setDraft({ ...draft, cards: draft.cards.map((x, j) => (j === i ? { ...x, headline: e.target.value } : x)) })}
                            className={cx(inputClass, "mt-1")}
                          />
                        </label>
                        <label className="block">
                          <span className="block text-[12px] text-muted">Under it</span>
                          <input
                            name={`card_${i}_description`}
                            aria-label={`Card ${i + 1} line under the headline`}
                            maxLength={limits.cardDescription}
                            value={c.description}
                            disabled={c.remove}
                            onChange={(e) => setDraft({ ...draft, cards: draft.cards.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)) })}
                            className={cx(inputClass, "mt-1")}
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() => setDraft({ ...draft, cards: draft.cards.map((x, j) => (j === i ? { ...x, remove: !x.remove } : x)) })}
                          disabled={!c.remove && draft.cards.filter((x) => !x.remove).length <= 2}
                          className={buttonClass("quiet", touch)}
                        >
                          {c.remove ? "Put back" : "Take out"}
                        </button>
                      </div>
                    ))}
                  </fieldset>
                </>
              )}
              <label className="block sm:max-w-xs">
                <span className="text-[14px] font-medium">Button</span>
                <select
                  name="callToAction"
                  value={draft.callToAction}
                  onChange={(e) => setDraft({ ...draft, callToAction: e.target.value })}
                  className={cx(inputClass, "mt-2")}
                >
                  {ctaOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex flex-wrap gap-2">
                <PendingButton pendingLabel="Saving…" className={buttonClass("primary", touch)}>
                  Save changes
                </PendingButton>
                <button
                  type="button"
                  className={buttonClass("quiet", touch)}
                  onClick={() => {
                    setEditing(false);
                    setProblem(null);
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : null}
        </div>

        {editable && !editing ? (
          <div className="flex flex-wrap gap-2 border-t border-line pt-3">
            <button
              type="button"
              disabled={rewriting}
              onClick={() => {
                setDraft(toDraft(v));
                setEditing(true);
              }}
              className={buttonClass("secondary", touch)}
            >
              <PenLine aria-hidden className="size-4" /> Edit
            </button>
            <form action={() => run(actions.rewrite)}>
              <PendingButton variant="secondary" orb="composing" pendingLabel="Asking the AI…" disabled={rewriting} className={buttonClass("secondary", touch)}>
                <RotateCcw aria-hidden className="size-4" /> Write again
              </PendingButton>
            </form>
            <form action={() => run(actions.remove)}>
              <PendingButton variant="secondary" pendingLabel="Taking it out…" disabled={rewriting} className={buttonClass("quiet", touch)}>
                <Trash2 aria-hidden className="size-4" /> Remove
              </PendingButton>
            </form>
          </div>
        ) : null}
      </article>
    </BorderBeam>
  );
}
