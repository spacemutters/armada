"use client";

import { Sparkles } from "lucide-react";
import { useState, type CSSProperties } from "react";
import type { Candidate, HeroCopy } from "@/lib/abtest/prompt";
import type { CatalogImage } from "@/lib/types";
import { HeroPreview } from "./hero-preview";
import { Button, cx, inputClass } from "./ui";

/**
 * Picking the new version: the AI's three versions as choices, then A and B side by side, with B
 * updating as the owner edits it. Nothing reaches the shop until "Start the test".
 */
export function TestChoose({
  vars,
  brand,
  image,
  original,
  candidates,
  start,
  writeMore,
  cancel,
}: {
  vars: CSSProperties;
  brand: string;
  image: CatalogImage | null;
  original: HeroCopy;
  candidates: Candidate[];
  start: (formData: FormData) => Promise<void>;
  writeMore: () => Promise<void>;
  cancel: () => Promise<void>;
}) {
  const [pick, setPick] = useState(0);
  const [draft, setDraft] = useState<Candidate>(candidates[0]);
  const choose = (i: number) => {
    setPick(i);
    setDraft(candidates[i]);
  };
  const edit = (field: keyof HeroCopy) => (e: React.ChangeEvent<HTMLInputElement>) => setDraft((d) => ({ ...d, [field]: e.target.value }));

  return (
    <form action={start} className="flex flex-col gap-8">
      <fieldset>
        <legend className="mb-3 text-[15px] font-semibold">Choose a new version to test</legend>
        <div className="grid gap-3 lg:grid-cols-3">
          {candidates.map((c, i) => (
            <label
              key={i}
              className={cx(
                "flex cursor-pointer flex-col gap-2 rounded-2xl border bg-raised p-4 transition-colors",
                pick === i ? "border-accent ring-1 ring-accent" : "border-line hover:border-line-strong",
              )}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-[12px] text-muted">
                  <Sparkles aria-hidden className="size-3.5" strokeWidth={1.8} />
                  Written by AI
                </span>
                <input
                  type="radio"
                  name="pick"
                  value={i}
                  checked={pick === i}
                  onChange={() => choose(i)}
                  className="size-5 accent-[var(--accent)]"
                  aria-label={`Use: ${c.headline}`}
                />
              </span>
              <span data-candidate-headline={c.headline} className="text-[16px] leading-snug font-semibold">
                {c.headline}
              </span>
              <span className="text-[13px] text-muted">{c.idea}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <h2 className="mb-3 text-[15px] font-semibold">Your test</h2>
        <div className="grid gap-6 lg:grid-cols-2">
          <HeroPreview vars={vars} brand={brand} hero={original} image={image} label="The original" side="a" />
          <div className="flex min-w-0 flex-col gap-4">
            <HeroPreview vars={vars} brand={brand} hero={draft} image={image} label="The new version" side="b" highlight />
            <div className="grid gap-3 rounded-2xl border border-line bg-raised p-4">
              <p className="text-[13px] text-muted">You can change the new version before it goes live.</p>
              <label className="grid gap-1 text-[13px]">
                Headline
                <input name="headline" value={draft.headline} onChange={edit("headline")} maxLength={70} required className={inputClass} />
              </label>
              <label className="grid gap-1 text-[13px]">
                Line under it
                <input name="subhead" value={draft.subhead} onChange={edit("subhead")} maxLength={170} className={inputClass} />
              </label>
              <label className="grid gap-1 text-[13px]">
                Button
                <input name="cta" value={draft.cta} onChange={edit("cta")} maxLength={28} className={inputClass} />
              </label>
              <input type="hidden" name="idea" value={draft.idea} />
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 border-t border-line pt-6">
        <p className="max-w-2xl text-[14px] text-muted">
          Half your visitors see the new version, half the original. Your team is never counted.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit">Start the test</Button>
          <Button type="submit" variant="secondary" formAction={writeMore} formNoValidate>
            Write three more
          </Button>
          <Button type="submit" variant="quiet" formAction={cancel} formNoValidate>
            Cancel the test
          </Button>
        </div>
      </div>
    </form>
  );
}
