"use client";

import { CreditCard, GalleryHorizontalEnd, History, House, Megaphone, MoreHorizontal, Package, Plug, Receipt, Settings, ShieldCheck, Store, WandSparkles } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { FleetMark } from "./auth-frame";
import styles from "./fx/fx.module.css";
import { useGlide } from "./fx/glide";
import { StatusText } from "./fx/status-text";
import { ThinkingOrb } from "./fx/thinking-orb";
import { cx } from "./ui";

const MAIN = [
  { href: "/", label: "Home", icon: House },
  { href: "/stores", label: "Stores", icon: Store },
  { href: "/builder", label: "Shop builder", short: "Builder", icon: WandSparkles },
  { href: "/products", label: "Products", icon: Package },
  { href: "/orders", label: "Orders", icon: Receipt },
];
const MORE = [
  { href: "/ads", label: "Ads", icon: Megaphone },
  { href: "/social", label: "Social posts", icon: GalleryHorizontalEnd },
  { href: "/changes", label: "Changes", icon: History },
  { href: "/connections", label: "Connections", icon: Plug },
  { href: "/billing", label: "Plan and billing", icon: CreditCard },
];
const ADMIN = { href: "/admin", label: "Admin", icon: ShieldCheck };

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");
}

function SignOut({ className }: { className?: string }) {
  const router = useRouter();
  return (
    <button
      className={className}
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        router.replace("/welcome");
        router.refresh();
      }}
    >
      Sign out
    </button>
  );
}

/** The AI helper's state in the sidebar: a still ring when it's on, the working orb while it works, a faded ring when it's off. */
function HelperStatus({ online, busy }: { online: boolean; busy: boolean }) {
  const words = busy ? "AI helper working" : online ? "AI helper on" : "AI helper off";
  return (
    <Link href="/settings#ai" className="flex min-h-9 items-center gap-2.5 rounded-xl px-3 text-[13px] text-muted hover:bg-sunken hover:text-ink">
      <ThinkingOrb state={busy ? "working" : online ? "idle" : "off"} size={16} decorative />
      <StatusText text={words} shimmer={busy} />
    </Link>
  );
}

export function AppNav({
  workspaceName,
  memberName,
  helperOnline,
  helperBusy = false,
  isAdmin = false,
}: {
  workspaceName: string;
  memberName: string;
  helperOnline: boolean;
  helperBusy?: boolean;
  /** Platform admins also see the Admin page. */
  isAdmin?: boolean;
}) {
  const pathname = usePathname();
  const more = isAdmin ? [...MORE, ADMIN] : MORE;
  const activeHref = [...MAIN, ...more].find((n) => isActive(pathname, n.href))?.href ?? null;
  const tabHref = MAIN.find((n) => isActive(pathname, n.href))?.href ?? null;
  // The highlight slides to the page you picked, in the sidebar and in the phone's tab bar.
  const side = useGlide<HTMLElement>(activeHref);
  const tabs = useGlide<HTMLElement>(tabHref, { stretch: false });

  const item = (n: { href: string; label: string; icon: typeof House }) => {
    const active = isActive(pathname, n.href);
    return (
      <Link
        key={n.href}
        href={n.href}
        data-glide-key={n.href}
        data-glide-on={active ? "" : undefined}
        aria-current={active ? "page" : undefined}
        className={cx(
          "flex min-h-9 items-center gap-3 rounded-xl px-3 text-[14px] transition-colors",
          active ? "font-semibold text-ink" : "glass-hover text-muted hover:text-ink",
        )}
      >
        <n.icon aria-hidden className="size-[18px] shrink-0" strokeWidth={active ? 2.2 : 1.8} />
        {n.label}
      </Link>
    );
  };
  const settingsActive = isActive(pathname, "/settings");

  return (
    <>
      {/* Computer: sidebar */}
      <aside className="glass glass-strong sticky top-3 z-10 my-3 ml-3 hidden h-[calc(100dvh-24px)] w-[232px] shrink-0 flex-col rounded-[22px] px-3 py-4 md:flex">
        <div className="mb-6 flex items-center gap-2.5 px-3">
          <FleetMark />
          <div className="min-w-0">
            <div className="truncate text-[15px] font-semibold tracking-tight">{workspaceName}</div>
            <div className="truncate text-[12px] text-muted">Armada</div>
          </div>
        </div>
        <nav ref={side} aria-label="Main" className={cx(styles.glide, "relative flex flex-col gap-0.5")}>
          <span data-glide-ind="" aria-hidden className={cx(styles.glideInd, "glass-select rounded-xl")} />
          {MAIN.map(item)}
          <div className="mx-3 my-2 border-t border-line" />
          {more.map(item)}
        </nav>
        <div className="mt-auto flex flex-col gap-0.5">
          <HelperStatus online={helperOnline} busy={helperOnline && helperBusy} />
          <Link
            href="/settings"
            aria-current={settingsActive ? "page" : undefined}
            className={cx(
              "flex min-h-9 items-center gap-3 rounded-xl px-3 text-[14px] transition-colors",
              settingsActive ? "glass-select font-semibold text-ink" : "glass-hover text-muted hover:text-ink",
            )}
          >
            <Settings aria-hidden className="size-[18px] shrink-0" strokeWidth={settingsActive ? 2.2 : 1.8} />
            Settings
          </Link>
          <div className="flex items-center justify-between px-3 pt-2 text-[12px] text-muted">
            <span className="truncate">{memberName}</span>
            <SignOut className="rounded-md px-1 hover:text-ink" />
          </div>
        </div>
      </aside>

      {/* Phone: top bar and bottom tabs */}
      <header className="glass sticky top-0 z-20 flex items-center justify-between rounded-none border-x-0 border-t-0 px-4 py-2 md:hidden">
        <div className="flex min-w-0 items-center gap-2">
          <FleetMark size={18} />
          <span className="truncate text-[15px] font-semibold">{workspaceName}</span>
        </div>
        <div className="flex items-center gap-1">
          <Link
            href="/settings#ai"
            className="glass-hover glass-press flex size-11 items-center justify-center rounded-xl"
            aria-label={helperOnline ? (helperBusy ? "AI helper working" : "AI helper on") : "AI helper off"}
          >
            <ThinkingOrb state={helperOnline && helperBusy ? "working" : helperOnline ? "idle" : "off"} size={20} decorative />
          </Link>
          <details className="relative">
            <summary className="glass-hover glass-press flex size-11 cursor-pointer list-none items-center justify-center rounded-xl" aria-label="More">
              <MoreHorizontal aria-hidden className="size-5" />
            </summary>
            <div className="glass absolute right-0 mt-1 w-56 rounded-2xl p-2">
              {[...more, { href: "/settings", label: "Settings", icon: Settings }].map((n) => (
                <Link key={n.href} href={n.href} className="glass-hover flex min-h-11 items-center gap-3 rounded-xl px-3 text-ink">
                  <n.icon aria-hidden className="size-[18px]" />
                  {n.label}
                </Link>
              ))}
              <SignOut className="glass-hover flex min-h-11 w-full items-center rounded-xl px-3 text-left text-ink" />
            </div>
          </details>
        </div>
      </header>
      <nav
        ref={tabs}
        aria-label="Main"
        className={cx(styles.glide, "glass fixed inset-x-3 bottom-[calc(10px+env(safe-area-inset-bottom))] z-20 grid grid-cols-5 rounded-[26px] p-1 md:hidden")}
      >
        <span data-glide-ind="" aria-hidden className={cx(styles.glideInd, "glass-select rounded-full")} />
        {MAIN.map((n) => {
          const active = isActive(pathname, n.href);
          return (
            <Link
              key={n.href}
              href={n.href}
              data-glide-key={n.href}
              aria-current={active ? "page" : undefined}
              className={cx("glass-press flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] text-ink transition-colors", active ? "font-semibold" : "")}
            >
              <span data-glide-target="" data-glide-on={active ? "" : undefined} className="flex h-7 w-12 items-center justify-center rounded-full">
                <n.icon aria-hidden className={cx("size-5", active ? "text-accent" : "")} strokeWidth={active ? 2.2 : 1.8} />
              </span>
              {n.short ?? n.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
