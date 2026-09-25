"use client";

import { Sparkles } from "lucide-react";
import { createElement, useState } from "react";
import { PendingButton } from "./fx/pending-button";
import { ThinkingOrb } from "./fx/thinking-orb";
import { iconFor } from "./product-art";
import { buttonClass, cx } from "./ui";

/**
 * A store's icon on its page: the icon as it shows on the fleet map, one press to have the AI make
 * one, and a grid to choose one by hand (or none, for a plain square).
 */
export function StoreIcon({
  icon,
  icons,
  making,
  canEdit,
  choose,
  make,
}: {
  icon: string | null;
  icons: readonly string[];
  making: boolean;
  canEdit: boolean;
  choose: (formData: FormData) => Promise<void>;
  make: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div id="icon" className="scroll-mt-6">
      <div className="flex flex-wrap items-center gap-4">
        <span className="flex size-16 items-center justify-center rounded-2xl" style={{ background: "var(--tile-busy)" }} aria-hidden>
          {icon ? createElement(iconFor(icon), { className: "size-8", strokeWidth: 1.8, style: { color: "var(--tile-busy-ink)" } }) : null}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-medium">{icon ? "This store's icon" : "No icon yet"}</p>
          <p className="text-[13px] text-muted">
            {making ? "The AI is picking one from what this store sells…" : icon ? "Shown on your fleet map." : "It shows as a plain square on your fleet map."}
          </p>
        </div>
        {canEdit ? (
          <div className="flex flex-wrap items-center gap-2">
            {making ? (
              <span className="inline-flex min-h-9 items-center gap-2 px-2 text-[14px] text-muted" role="status">
                <ThinkingOrb state="thinking" size={18} decorative /> Making one…
              </span>
            ) : (
              <form action={make}>
                <PendingButton pendingLabel="Asking the AI…" className={buttonClass("primary")}>
                  <Sparkles aria-hidden className="size-4" /> Make one with AI
                </PendingButton>
              </form>
            )}
            <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className={buttonClass("secondary")}>
              {open ? "Close" : "Choose one"}
            </button>
          </div>
        ) : null}
      </div>
      {open && canEdit ? (
        <div className="mt-4">
          <p className="mb-2 text-[13px] text-muted">Pick an icon. It saves as soon as you press it.</p>
          {/* One small form per icon: the icon's name travels as a hidden field, which every browser sends. */}
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(44px,1fr))] gap-1.5">
            <li>
              <form action={choose}>
                <input type="hidden" name="icon" value="none" />
                <button
                  type="submit"
                  data-icon="none"
                  aria-label="No icon (plain square)"
                  aria-pressed={!icon}
                  className={cx("flex size-11 items-center justify-center rounded-xl border", !icon ? "border-accent bg-accent-soft" : "border-line hover:border-line-strong")}
                >
                  <span aria-hidden className="size-5 rounded-[5px]" style={{ background: "var(--tile-mid)" }} />
                </button>
              </form>
            </li>
            {icons.map((name) => (
              <li key={name}>
                <form action={choose}>
                  <input type="hidden" name="icon" value={name} />
                  <button
                    type="submit"
                    data-icon={name}
                    aria-label={name.replace(/-\d+$/, "").replace(/-/g, " ")}
                    aria-pressed={icon === name}
                    className={cx(
                      "flex size-11 items-center justify-center rounded-xl border",
                      icon === name ? "border-accent bg-accent-soft" : "border-line hover:border-line-strong hover:bg-sunken",
                    )}
                  >
                    {createElement(iconFor(name), { "aria-hidden": true, className: "size-5", strokeWidth: 1.8 })}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
