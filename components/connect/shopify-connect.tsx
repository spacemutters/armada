"use client";

import { Plus } from "lucide-react";
import { useId, useRef, useState } from "react";
import { ShimmerText, ThinkingOrb } from "@/components/fx";
import { buttonClass, cx, inputClass } from "@/components/ui";
import { ADDRESS_HINTS, normalizeShopAddress } from "@/connectors/shopify/address";
import { SHOPIFY_PATHS } from "@/connectors/shopify/config";
import { useCardBusy } from "./card-shell";

/**
 * "Connect Shopify": the one thing Shopify needs from the person is which store, so that's the only
 * field. Anything recognisable is accepted ("yourstore", the full address, the admin address) and
 * the line under the field says exactly which store Shopify will open. Pressing Connect goes straight
 * to Shopify's approval screen for that store (a plain form, so it works before scripts load too).
 */
export function ShopifyConnect({ defaultShop = "", startCollapsed = false }: { defaultShop?: string; startCollapsed?: boolean }) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const { busyKey, setBusyKey } = useCardBusy();
  const busy = busyKey === id;
  const [open, setOpen] = useState(!startCollapsed);
  const [value, setValue] = useState(defaultShop);
  const [tried, setTried] = useState(Boolean(defaultShop));
  const address = normalizeShopAddress(value);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          requestAnimationFrame(() => input.current?.focus());
        }}
        className={buttonClass("secondary", "min-h-11 self-start md:min-h-10")}
      >
        <Plus aria-hidden className="size-4" strokeWidth={2} />
        Connect another store
      </button>
    );
  }

  const showProblem = tried && !address.ok;
  const hint = address.ok
    ? `Shopify will ask you to approve Armada for ${address.shop}.`
    : showProblem
      ? ADDRESS_HINTS[address.reason]
      : "Find it in Shopify under Settings, then Domains. It ends in .myshopify.com.";

  return (
    <form
      action={SHOPIFY_PATHS.start}
      method="get"
      noValidate
      onSubmit={(e) => {
        if (!address.ok) {
          e.preventDefault();
          setTried(true);
          input.current?.focus();
          return;
        }
        setBusyKey(id);
      }}
      className="flex flex-col gap-2"
    >
      <input type="hidden" name="purpose" value="connect" />
      <label htmlFor={`${id}-shop`} className="text-[13px] font-medium">
        Your store&apos;s Shopify address
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          ref={input}
          id={`${id}-shop`}
          name="shop"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => value.trim() && setTried(true)}
          placeholder="yourstore.myshopify.com"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          inputMode="url"
          enterKeyHint="go"
          maxLength={300}
          readOnly={busy}
          aria-invalid={showProblem || undefined}
          aria-describedby={`${id}-hint`}
          className={cx(inputClass, "min-h-11 min-w-0 md:min-h-10 sm:flex-1", showProblem && "border-attention")}
        />
        <button type="submit" aria-busy={busy || undefined} className={buttonClass("primary", cx("min-h-11 shrink-0 md:min-h-10", busy && "cursor-progress"))}>
          {busy ? (
            <>
              <ThinkingOrb state="connecting" size={16} decorative ink="inverse" />
              <ShimmerText tone="current">Opening Shopify…</ShimmerText>
            </>
          ) : (
            "Connect Shopify"
          )}
        </button>
      </div>
      <p id={`${id}-hint`} aria-live="polite" className={cx("text-[13px]", showProblem ? "text-attention" : "text-muted")}>
        {hint}
      </p>
    </form>
  );
}
