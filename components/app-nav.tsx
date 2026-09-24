"use client";

import { History, House, Megaphone, MoreHorizontal, Package, Receipt, Settings, Store, WandSparkles } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { FleetMark } from "./auth-frame";
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
  { href: "/changes", label: "Changes", icon: History },
];

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

export function AppNav({ workspaceName, memberName, helperOnline }: { workspaceName: string; memberName: string; helperOnline: boolean }) {
  const pathname = usePathname();
  const item = (n: { href: string; label: string; icon: typeof House }) => {
    const active = isActive(pathname, n.href);
    return (
      <Link
        key={n.href}
        href={n.href}
        aria-current={active ? "page" : undefined}
        className={cx(
          "flex min-h-9 items-center gap-3 rounded-xl px-3 text-[14px] transition-colors",
          active ? "bg-sunken font-semibold text-ink" : "text-muted hover:bg-sunken hover:text-ink",
        )}
      >
        <n.icon aria-hidden className="size-[18px] shrink-0" strokeWidth={active ? 2.2 : 1.8} />
        {n.label}
      </Link>
    );
  };

  return (
    <>
      {/* Computer: sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-[232px] shrink-0 flex-col border-r border-line bg-raised px-3 py-4 md:flex">
        <div className="mb-6 flex items-center gap-2.5 px-3">
          <FleetMark />
          <div className="min-w-0">
            <div className="truncate text-[15px] font-semibold tracking-tight">{workspaceName}</div>
            <div className="truncate text-[12px] text-muted">Armada</div>
          </div>
        </div>
        <nav aria-label="Main" className="flex flex-col gap-0.5">
          {MAIN.map(item)}
          <div className="my-2 border-t border-line" />
          {MORE.map(item)}
        </nav>
        <div className="mt-auto flex flex-col gap-0.5">
          <Link href="/settings#ai" className="flex min-h-9 items-center gap-2 rounded-xl px-3 text-[13px] text-muted hover:bg-sunken hover:text-ink">
            {helperOnline ? (
              <span aria-hidden className="size-2 rounded-full bg-positive" />
            ) : (
              <span aria-hidden className="size-2 rounded-full border border-muted" />
            )}
            {helperOnline ? "AI helper on" : "AI helper off"}
          </Link>
          {item({ href: "/settings", label: "Settings", icon: Settings })}
          <div className="flex items-center justify-between px-3 pt-2 text-[12px] text-muted">
            <span className="truncate">{memberName}</span>
            <SignOut className="rounded-md px-1 hover:text-ink" />
          </div>
        </div>
      </aside>

      {/* Phone: top bar and bottom tabs */}
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-line bg-raised/95 px-4 py-2 backdrop-blur md:hidden">
        <div className="flex items-center gap-2">
          <FleetMark size={18} />
          <span className="text-[15px] font-semibold">{workspaceName}</span>
        </div>
        <details className="relative">
          <summary className="flex size-11 cursor-pointer list-none items-center justify-center rounded-xl hover:bg-sunken" aria-label="More">
            <MoreHorizontal aria-hidden className="size-5" />
          </summary>
          <div className="absolute right-0 mt-1 w-52 rounded-2xl border border-line bg-raised p-2 shadow-lg">
            {[...MORE, { href: "/settings", label: "Settings", icon: Settings }].map((n) => (
              <Link key={n.href} href={n.href} className="flex min-h-11 items-center gap-3 rounded-xl px-3 hover:bg-sunken">
                <n.icon aria-hidden className="size-[18px]" />
                {n.label}
              </Link>
            ))}
            <SignOut className="flex min-h-11 w-full items-center rounded-xl px-3 text-left text-muted hover:bg-sunken" />
          </div>
        </details>
      </header>
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t border-line bg-raised/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        {MAIN.map((n) => {
          const active = isActive(pathname, n.href);
          return (
            <Link
              key={n.href}
              href={n.href}
              aria-current={active ? "page" : undefined}
              className={cx("flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px]", active ? "font-semibold text-ink" : "text-muted")}
            >
              <n.icon aria-hidden className="size-5" strokeWidth={active ? 2.2 : 1.8} />
              {n.short ?? n.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
