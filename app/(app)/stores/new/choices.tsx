"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { BorderBeam, ShimmerText, ThinkingOrb } from "@/components/fx";
import { cx } from "@/components/ui";
import { bigPrimary, bigSecondary } from "./styles";

// The presses on "Open a new store" that leave Armada for a platform's own page.

/**
 * A link to a platform's sign-in page that says what's happening once pressed, since the page can
 * take a moment to arrive. Coming back with the browser's Back button resets it.
 */
export function LeaveLink({ href, children, pendingLabel, variant = "primary", className }: { href: string; children: ReactNode; pendingLabel: string; variant?: "primary" | "secondary"; className?: string }) {
  const [pending, setPending] = useState(false);
  useEffect(() => {
    const reset = () => setPending(false);
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);
  const link = (
    <a
      href={href}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        setPending(true);
      }}
      aria-busy={pending || undefined}
      className={cx(variant === "primary" ? bigPrimary : bigSecondary, className)}
    >
      {pending ? (
        <>
          <ThinkingOrb state="connecting" size={16} decorative ink={variant === "primary" ? "inverse" : "auto"} />
          <ShimmerText tone={variant === "primary" ? "current" : "muted"}>{pendingLabel}</ShimmerText>
        </>
      ) : (
        children
      )}
    </a>
  );
  return variant === "primary" ? (
    <BorderBeam active={pending} size="md" className="inline-flex">
      {link}
    </BorderBeam>
  ) : (
    link
  );
}

interface ShopifyChoice {
  id: string;
  name: string;
  domain: string | null;
}

/**
 * Facebook and Instagram, one press: pick the Shopify store buyers pay on (the first is already
 * picked), press, and Meta's own setup window opens over Armada. When Meta is done, the window
 * closes itself and this page moves on to the live setup view. If the browser blocks the window,
 * the whole tab goes to Meta instead and comes back the same way.
 */
export function FacebookOpener({ shops, enabled }: { shops: ShopifyChoice[]; enabled: boolean }) {
  const router = useRouter();
  const [shopId, setShopId] = useState(shops[0]?.id ?? "");
  const [waiting, setWaiting] = useState(false);
  const popup = useRef<Window | null>(null);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const data = e.data as { type?: string; to?: unknown } | null;
      if (data?.type !== "armada:meta-setup" || typeof data.to !== "string") return;
      if (!data.to.startsWith("/") || data.to.startsWith("//")) return;
      popup.current = null;
      setWaiting(false);
      router.push(data.to);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [router]);

  useEffect(() => {
    if (!waiting) return;
    // Closed without finishing: stop waiting, and refresh in case setup finished in another way.
    const timer = window.setInterval(() => {
      if (popup.current && popup.current.closed) {
        popup.current = null;
        setWaiting(false);
        router.refresh();
      }
    }, 700);
    return () => window.clearInterval(timer);
  }, [waiting, router]);

  const start = () => {
    if (!shopId) return;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
    const base = `/api/connect/facebook/start?purpose=open&shopify=${encodeURIComponent(shopId)}&tz=${encodeURIComponent(tz)}`;
    const w = 620;
    const h = 760;
    const left = Math.max(0, window.screenX + (window.outerWidth - w) / 2);
    const top = Math.max(0, window.screenY + (window.outerHeight - h) / 2);
    const win = window.open(`${base}&popup=1`, "armada-meta-setup", `popup=yes,width=${w},height=${h},left=${Math.round(left)},top=${Math.round(top)}`);
    if (!win) {
      window.location.assign(base);
      return;
    }
    popup.current = win;
    setWaiting(true);
  };

  if (!shops.length) return null;

  return (
    <div className="flex flex-col gap-3">
      {shops.length > 1 ? (
        <label className="block">
          <span className="text-[13px] text-muted">Buyers pay on</span>
          <select
            value={shopId}
            onChange={(e) => setShopId(e.target.value)}
            disabled={waiting}
            className="mt-1.5 block min-h-11 w-full rounded-xl border border-line-strong bg-raised px-3 text-[15px] text-ink focus:border-accent focus:outline-none"
          >
            {shops.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.domain ? ` (${s.domain})` : ""}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="text-[13px] text-muted">
          Buyers pay on <span className="font-medium text-ink">{shops[0].name}</span>
          {shops[0].domain ? <> ({shops[0].domain})</> : null}.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <BorderBeam active={waiting} size="md" className="inline-flex">
          <button type="button" onClick={start} disabled={!enabled || !shopId} aria-busy={waiting || undefined} className={bigPrimary} style={waiting ? { opacity: 1 } : undefined}>
            {waiting ? (
              <>
                <ThinkingOrb state="listening" size={16} decorative ink="inverse" />
                <ShimmerText tone="current">Finish in Meta&rsquo;s window</ShimmerText>
              </>
            ) : enabled ? (
              "Set up on Facebook"
            ) : (
              "Coming soon"
            )}
          </button>
        </BorderBeam>
        {waiting ? (
          <button type="button" onClick={() => popup.current?.focus()} className="min-h-11 rounded-xl px-3 text-[14px] text-accent hover:bg-accent-soft">
            Show Meta&rsquo;s window
          </button>
        ) : null}
      </div>
    </div>
  );
}
