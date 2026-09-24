import type { Metadata } from "next";
import Link from "next/link";
import { Fragment } from "react";
import { BuilderDemo } from "@/components/marketing/builder-demo";
import { ChangeSequence } from "@/components/marketing/change-sequence";
import { HeroFleet } from "@/components/marketing/hero-fleet";
import { NightSea } from "@/components/marketing/night-sea";
import { OrdersDemo } from "@/components/marketing/orders-demo";
import { ScoreDemo } from "@/components/marketing/score-demo";
import { BatchStrip, RoleList, SectionHead, SiteFooter, SiteNav } from "@/components/marketing/site";
import { SmoothScroll } from "@/components/marketing/smooth-scroll";
import { TestDemo } from "@/components/marketing/test-demo";

// Armada's public homepage. Signed-out visitors to "/" see this (proxy.ts rewrites "/" here, so the
// address stays "/"); signed-in people get the fleet dashboard at "/" as before. Every store, order
// and number on the page is an example, and it says so where it shows.

export const metadata: Metadata = {
  title: { absolute: "Armada · Every shop you run, on one screen" },
  description:
    "Build online shops with AI, find products worth selling, and change prices across every store at once, with a preview first and an undo after.",
  openGraph: {
    title: "Armada · Every shop you run, on one screen",
    description:
      "Build online shops with AI, find products worth selling, and change prices across every store at once, with a preview first and an undo after.",
    type: "website",
    siteName: "Armada",
  },
};

const HEADLINE = ["Every", "shop", "you", "run,", "on", "one", "screen."];

const TODAY = [
  "The AI shop builder, up to 10 shops at a time",
  "The product catalog, with a score that shows its working",
  "Prices from your pricing rules",
  "Listing products and changing prices across many stores, with a preview, approval and undo",
  "One orders inbox",
  "CJ Dropshipping: the real catalog, real costs, photos and shipping checked per product",
  "Headline tests on your shops",
  "A practice fleet that behaves like real stores, without real money",
  "Passkey sign-in and team roles",
];

const COMING = ["Connecting your real Shopify stores", "Connecting your real eBay accounts", "Ads on Meta, Google and TikTok"];

export default function HomePage() {
  return (
    <>
      <a href="#main" className="mk-skip">
        Skip to content
      </a>
      <SmoothScroll />
      <SiteNav />

      <main id="main">
        <section className="mk-hero" id="top" aria-labelledby="mk-hero-title">
          <div className="mk-wrap">
            <h1 id="mk-hero-title" className="mk-display">
              {HEADLINE.map((w, i) => (
                <Fragment key={i}>
                  <span className="mk-w">
                    <span style={{ animationDelay: `${120 + i * 70}ms` }}>{w}</span>
                  </span>{" "}
                </Fragment>
              ))}
            </h1>
            <div className="mk-hero-grid">
              <div className="mk-hero-copy">
                <p className="mk-lead">
                  Armada builds online shops with AI, finds products worth selling, and changes prices across all your stores at once, with a preview
                  before anything changes and an undo after.
                </p>
                <div className="mk-cta">
                  <Link href="/welcome" className="mk-btn mk-btn-primary mk-btn-lg">
                    Sign in
                  </Link>
                  <a href="#how-it-works" className="mk-btn mk-btn-lg">
                    How it works
                  </a>
                </div>
                <p className="mk-note">Invite only for now. If you were sent a setup link, open it to make your passkey.</p>
              </div>
              <HeroFleet />
            </div>
          </div>
        </section>

        <ChangeSequence />

        <section className="mk-section" id="builder" aria-labelledby="mk-builder-title">
          <div className="mk-wrap mk-split">
            <div className="mk-split-copy">
              <SectionHead id="mk-builder-title" eyebrow="Shop builder" title="Describe an idea. Get a whole shop.">
                <p>
                  Type one line about what you want to sell. In about 2 to 4 minutes the AI names the brand, picks the colours and fonts, sorts the
                  range into collections, chooses the products and writes every product page. Then it writes the About, questions, shipping and
                  contact pages, and drafts the refund and shipping policies for you to read.
                </p>
                <p>Build up to 10 shops at once from one idea, each with its own look.</p>
              </SectionHead>
            </div>
            <BuilderDemo />
          </div>
          <div className="mk-wrap">
            <BatchStrip />
          </div>
        </section>

        <section className="mk-section mk-section-alt" id="products" aria-labelledby="mk-products-title">
          <div className="mk-wrap mk-split mk-split-flip">
            <div className="mk-split-copy">
              <SectionHead id="mk-products-title" eyebrow="Products" title="A score that shows its working.">
                <p>
                  Every product gets a score from 1 to 100, built from five parts: margin, demand, competition, shipping and stock. Open a score to
                  see each part, and whether Armada measured it or estimated it. An estimate is never passed off as a fact.
                </p>
              </SectionHead>
              <dl className="mk-facts">
                <div>
                  <dt>A real supplier</dt>
                  <dd>
                    Connect CJ Dropshipping to search its real catalog at real costs. Photos and shipping times are checked for each product before it
                    goes in.
                  </dd>
                </div>
                <div>
                  <dt>Prices from your rules</dt>
                  <dd>Landed cost times the markup for the price level you chose, ending in .99. The AI writes the words; it never sets a price.</dd>
                </div>
              </dl>
            </div>
            <ScoreDemo />
          </div>
        </section>

        <section className="mk-section" id="tests" aria-labelledby="mk-tests-title">
          <div className="mk-wrap">
            <div className="mk-head-row">
              <SectionHead id="mk-tests-title" eyebrow="Headline tests" title="Let your shoppers choose the headline." />
              <p className="mk-head-aside">
                The AI writes three new versions of a shop&apos;s headline. You choose one, and can edit it. Half the visitors see it and half see the
                original, each person always the same one. Armada counts who adds something to their bag, says plainly which version wins, and says
                when it&apos;s too early to tell. You and your team are never counted.
              </p>
            </div>
            <TestDemo />
          </div>
        </section>

        <section className="mk-section mk-section-alt" id="orders" aria-labelledby="mk-orders-title">
          <div className="mk-wrap mk-split">
            <div className="mk-split-copy">
              <SectionHead id="mk-orders-title" eyebrow="Orders" title="Every order from every store, in one inbox.">
                <p>New orders go to the supplier, and tracking numbers flow back to the store. Anything stuck waits under Needs you.</p>
              </SectionHead>
            </div>
            <OrdersDemo />
          </div>
          <div className="mk-wrap">
            <dl className="mk-facts mk-facts-row">
              <div>
                <dt>A practice fleet</dt>
                <dd>
                  Pretend Shopify stores and eBay accounts with a month of believable orders, a stock problem and a late-shipping warning. Try
                  everything safely: practice stores never touch real money.
                </dd>
              </div>
              <div>
                <dt>Passkeys, not passwords</dt>
                <dd>Sign in with your face, fingerprint or phone. There is no password to steal or forget.</dd>
              </div>
              <div>
                <dt>A role for each person</dt>
                <dd>
                  <RoleList />
                </dd>
              </div>
            </dl>
          </div>
        </section>

        <section className="mk-section" id="status" aria-labelledby="mk-status-title">
          <div className="mk-wrap">
            <SectionHead id="mk-status-title" eyebrow="Where it stands" title="What works today, and what's coming." />
            <div className="mk-status">
              <div>
                <h3 className="mk-h3">Working today</h3>
                <ul className="mk-list" data-kind="today">
                  {TODAY.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="mk-h3">Coming</h3>
                <ul className="mk-list" data-kind="coming">
                  {COMING.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
                <p className="mk-muted mk-status-note">
                  Until then, shops the AI builds open as previews, and everything else runs on the practice fleet.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="mk-close" aria-labelledby="mk-close-title">
          <NightSea>
            <div className="mk-wrap mk-close-inner">
              <h2 id="mk-close-title" className="mk-display mk-close-title">
                Your whole fleet, on one screen.
              </h2>
              <div className="mk-cta">
                <Link href="/welcome" className="mk-btn mk-btn-light mk-btn-lg">
                  Sign in
                </Link>
              </div>
              <p className="mk-close-note">Invite only for now. If you were sent a setup link, open it to make your passkey.</p>
            </div>
          </NightSea>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
