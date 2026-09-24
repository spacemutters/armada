import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { RollingNumber } from "./fx/rolling-number";

// Shared building blocks. Quiet by default: identity lives in the fleet map, not in chrome.

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[26px] font-semibold tracking-tight">{title}</h1>
        {subtitle ? <p className="mt-1 max-w-2xl text-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function Card({ children, className, ...rest }: ComponentProps<"section">) {
  return (
    <section className={cx("rounded-2xl border border-line bg-raised", className)} {...rest}>
      {children}
    </section>
  );
}

export function Section({ title, action, children, className }: { title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Card className={cx("p-5", className)}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </Card>
  );
}

type Variant = "primary" | "secondary" | "quiet";
const buttonBase =
  "inline-flex min-h-9 items-center justify-center gap-2 rounded-xl px-4 text-[14px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";
const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink hover:opacity-90",
  secondary: "border border-line-strong bg-raised text-ink hover:bg-sunken",
  quiet: "text-accent hover:bg-accent-soft",
};

/** The classes a button of this variant wears, for buttons built elsewhere (a hold or pending button). */
export function buttonClass(variant: Variant = "primary", className?: string): string {
  return cx(buttonBase, variants[variant], className);
}

export function Button({ variant = "primary", className, ...rest }: ComponentProps<"button"> & { variant?: Variant }) {
  return <button className={cx(buttonBase, variants[variant], className)} {...rest} />;
}

export function ButtonLink({ variant = "primary", className, ...rest }: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link className={cx(buttonBase, variants[variant], className)} {...rest} />;
}

/**
 * A labelled number. Numbers (or formatted number text) roll to their new value when it changes;
 * `rollIn` also rolls them up from zero when the page opens (use it for a page's one headline row).
 */
export function Stat({
  label,
  value,
  hint,
  tone,
  rollIn = false,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "positive" | "negative" | "attention";
  rollIn?: boolean;
}) {
  const toneClass = tone === "positive" ? "text-positive" : tone === "negative" ? "text-negative" : tone === "attention" ? "text-attention" : "";
  return (
    <div className="min-w-0">
      <div className="text-[13px] text-muted">{label}</div>
      <div className={cx("tabular mt-1 text-[26px] font-semibold tracking-tight", toneClass)}>
        {typeof value === "string" || typeof value === "number" ? <RollingNumber value={value} rollIn={rollIn} /> : value}
      </div>
      {hint ? <div className="mt-0.5 text-[13px] text-muted">{hint}</div> : null}
    </div>
  );
}

export function EmptyState({ title, body, action, mark }: { title: string; body: ReactNode; action?: ReactNode; mark?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-2xl border border-dashed border-line-strong p-8">
      {mark}
      <h3 className="text-[16px] font-semibold">{title}</h3>
      <p className="max-w-xl text-muted">{body}</p>
      {action}
    </div>
  );
}

export type Tone = "ok" | "attention" | "off" | "working" | "error";

const MARK: Record<Tone, string> = {
  ok: "rounded-full border-positive bg-positive",
  attention: "rotate-45 rounded-[1px] border-attention bg-attention",
  error: "rounded-[1px] border-negative bg-negative",
  working: "pulse rounded-full border-accent bg-accent",
  off: "rounded-full border-muted bg-transparent",
};

/**
 * Status shown by shape and word, never by color alone. The mark is one element, so when a status
 * changes on a page that refreshes (building to ready), it eases from one shape to the next.
 */
export function StatusPill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-line px-2.5 py-0.5 text-[13px]">
      <span
        aria-hidden
        className={cx("size-2 shrink-0 border transition-[background-color,border-color,border-radius,rotate] duration-300 ease-out", MARK[tone] ?? MARK.off)}
      />
      {children}
    </span>
  );
}

/** Plain names for where a store sells. */
export function platformName(platform: string, form: "short" | "long" = "short"): string {
  if (platform === "ebay") return form === "long" ? "eBay account" : "eBay";
  if (platform === "facebook") return "Facebook shop";
  return form === "long" ? "Shopify store" : "Shopify";
}

export function ScoreBadge({ score }: { score: number | null }) {
  if (score == null) return <span className="text-muted">No score</span>;
  const band = score >= 80 ? "Strong" : score >= 60 ? "Worth testing" : "Weak";
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className={cx("tabular text-[15px] font-semibold", score >= 80 ? "text-positive" : score < 60 ? "text-muted" : "")}>{score}</span>
      <span className="text-[13px] text-muted">{band}</span>
    </span>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-[14px] font-medium">{label}</span>
      {hint ? <span className="mt-0.5 block text-[13px] text-muted">{hint}</span> : null}
      <span className="mt-2 block">{children}</span>
    </label>
  );
}

export const inputClass =
  "w-full min-h-10 rounded-xl border border-line-strong bg-raised px-3 py-2 text-[14px] text-ink placeholder:text-muted focus:border-accent focus:outline-none";
