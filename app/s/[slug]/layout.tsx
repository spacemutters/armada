import Link from "next/link";
import { notFound } from "next/navigation";
import "../storefront.css";
import { BagLink } from "@/components/storefront/bag";
import { loadStorefront, shopBase, storefrontVars } from "@/lib/shops/storefront";
import { googleFontsHref } from "@/lib/shops/style";

export async function generateMetadata({ params }: LayoutProps<"/s/[slug]">) {
  const { slug } = await params;
  const data = await loadStorefront(slug);
  if (!data) return { title: "Shop not found" };
  const bp = data.shop.blueprint;
  return {
    title: { absolute: bp.seo?.title || `${bp.brand?.name} · ${bp.brand?.tagline}` },
    description: bp.seo?.description,
    robots: { index: false, follow: false },
  };
}

export default async function StorefrontLayout({ children, params }: LayoutProps<"/s/[slug]">) {
  const { slug } = await params;
  const data = await loadStorefront(slug);
  if (!data) notFound();
  const bp = data.shop.blueprint;
  const base = shopBase(slug);
  const brand = bp.brand?.name ?? "Shop";
  const collections = bp.collections ?? [];
  const nav = [
    ...collections.map((c) => ({ href: `${base}/collections/${c.handle}`, label: c.title })),
    { href: `${base}/pages/about`, label: "About" },
  ];

  return (
    <div className="sf flex flex-col" style={storefrontVars(bp)}>
      <link rel="stylesheet" href={googleFontsHref(bp.theme!.fonts.display, bp.theme!.fonts.body)} precedence="default" />
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-[var(--s-bg)] focus:px-3 focus:py-2">
        Skip to content
      </a>
      {bp.announcement ? (
        <div className="sf-line border-b py-2 text-center text-[13px]" style={{ background: "var(--s-surface)" }}>
          <span className="sf-muted">{bp.announcement}</span>
        </div>
      ) : null}
      <header className="sf-line sticky top-0 z-20 border-b" style={{ background: "var(--s-bg)" }}>
        <div className="sf-wrap flex h-16 items-center justify-between gap-6">
          <Link href={base} className="sf-heading shrink-0 text-[24px]">
            {brand}
          </Link>
          <nav aria-label="Shop" className="hidden items-center gap-8 text-[15px] md:flex">
            {nav.map((n) => (
              <Link key={n.href} href={n.href} className="sf-link !no-underline hover:!underline">
                {n.label}
              </Link>
            ))}
          </nav>
          <BagLink slug={slug} />
        </div>
        <nav aria-label="Shop" className="sf-wrap flex gap-6 overflow-x-auto pb-1 text-[15px] md:hidden">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} className="flex min-h-11 shrink-0 items-center">
              {n.label}
            </Link>
          ))}
        </nav>
      </header>

      <main id="main" className="flex-1">
        {children}
      </main>

      <footer className="sf-line border-t" style={{ background: "var(--s-surface)" }}>
        <div className="sf-wrap grid gap-12 py-16 md:grid-cols-[5fr_7fr]">
          <div className="max-w-sm">
            <div className="sf-heading text-[30px]">{brand}</div>
            <p className="sf-muted mt-3 text-[15px]">{bp.footerBlurb}</p>
          </div>
          <div className="grid grid-cols-2 gap-8 text-[15px] sm:grid-cols-3">
            <div className="flex flex-col gap-2">
              <span className="sf-label mb-1">Shop</span>
              {collections.map((c) => (
                <Link key={c.handle} href={`${base}/collections/${c.handle}`}>
                  {c.title}
                </Link>
              ))}
            </div>
            <div className="flex flex-col gap-2">
              <span className="sf-label mb-1">Help</span>
              <Link href={`${base}/pages/shipping`}>Shipping and returns</Link>
              <Link href={`${base}/pages/faq`}>Questions</Link>
              <Link href={`${base}/pages/contact`}>Contact</Link>
            </div>
            <div className="flex flex-col gap-2">
              <span className="sf-label mb-1">About</span>
              <Link href={`${base}/pages/about`}>About {brand}</Link>
              <Link href={`${base}/policies/refund`}>Refund policy</Link>
              <Link href={`${base}/policies/shipping`}>Shipping policy</Link>
            </div>
          </div>
        </div>
        <div className="sf-wrap sf-line sf-muted flex flex-wrap justify-between gap-3 border-t py-6 text-[14px]">
          <span>
            © {new Date().getFullYear()} {brand}
          </span>
          <span>A practice shop built with Armada. Checkout is off.</span>
        </div>
      </footer>
    </div>
  );
}
