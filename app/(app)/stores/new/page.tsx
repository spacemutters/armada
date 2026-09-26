import Link from "next/link";
import { serviceOn } from "@/lib/connections/service";
import type { ReactNode } from "react";
import { isPlatformAdmin } from "../../admin/access";
import { openPractice } from "./actions";
import { FacebookOpener, LeaveLink } from "./choices";
import { MarketplaceMark, PracticeMark, SocialShopMark, WebsiteStoreMark } from "./marks";
import { bigPrimary, bigSecondary } from "./styles";
import { PendingButton } from "@/components/fx/pending-button";
import { cx, PageHeader, platformName, StatusPill } from "@/components/ui";
import { ebayInfo } from "@/connectors/ebay/info";
import { facebookInfo } from "@/connectors/meta/info";
import type { SetupStep } from "@/connectors/ebay/core";
import { requireSession } from "@/lib/auth/session";
import type { ConnectorInfo } from "@/lib/connections/types";
import { appOrigin } from "@/lib/connections/types";
import { withWorkspace } from "@/lib/db";

export const metadata = { title: "Open a new store" };

// One press per platform. The honest limit, said once at the top: nobody's software can make a
// seller account for someone, so a press opens the platform's own sign-up or sign-in page, and
// Armada does everything else when they come back.

const PROBLEMS: Record<string, string> = {
  role: "Only the owner or a manager can open stores.",
  expired: "That took more than 15 minutes, so Armada stopped it to keep your account safe. Press the button again.",
  ebay_off: "eBay isn't switched on in Armada yet.",
  ebay_declined: "eBay didn't give Armada access, so nothing was set up. Press Continue to eBay and choose Agree on eBay's page.",
  ebay_failed: "eBay didn't finish signing you in. Press Continue to eBay to try again.",
  ebay_busy: "eBay is busy right now. Try again in a minute.",
  meta_off: "Facebook and Instagram shops aren't switched on in Armada yet.",
  meta_declined: "Meta's window was closed before it finished, so nothing was set up. Press Set up on Facebook to try again.",
  meta_unfinished: "Meta's window closed before the business was set up. Press Set up on Facebook to finish.",
  meta_failed: "Meta didn't finish setting up the shop. Press Set up on Facebook to try again.",
  meta_busy: "Meta is busy right now. Try again in a minute.",
  needs_shopify: "Pick the Shopify store buyers will pay on.",
};

const SHOPIFY_SIGNUP = "https://www.shopify.com/free-trial";

interface Unfinished {
  id: string;
  name: string;
  platform: string;
  steps: SetupStep[] | null;
}

export default async function OpenStorePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  const { problem } = await searchParams;
  const canOpen = session.role === "owner" || session.role === "manager";
  const admin = await isPlatformAdmin(session.memberId);

  const { shops, unfinished } = await withWorkspace(session.workspaceId, async (tx) => {
    const shops = await tx<{ id: string; name: string; domain: string | null }[]>`
      select id, name, domain from armada.stores
      where platform = 'shopify' and mode = 'live' and status <> 'disconnected'
      order by created_at`;
    const unfinished = await tx<Unfinished[]>`
      select id, name, platform, meta -> 'setup' -> 'steps' as steps from armada.stores
      where mode = 'live' and status = 'setting_up' and platform in ('ebay', 'facebook')
      order by created_at desc limit 5`;
    return { shops, unfinished };
  });

  const ebayOn = ebayInfo.available() || (await serviceOn());
  const facebookOn = facebookInfo.available();
  const message = typeof problem === "string" ? PROBLEMS[problem] : undefined;

  return (
    <div className="mx-auto max-w-[980px]">
      <PageHeader
        title="Open a new store"
        subtitle="Each press opens the platform's own sign-up. Armada does the rest when you're back."
      />

      {message ? (
        <p role="alert" className="mb-5 rounded-xl border border-line bg-raised px-4 py-3 text-[14px] text-negative">
          {message}
        </p>
      ) : null}

      {!canOpen ? (
        <p className="mb-5 rounded-xl bg-attention-soft px-4 py-3 text-[14px] text-attention">Only the owner or a manager can open stores. You can look around.</p>
      ) : null}

      {unfinished.length ? (
        <section aria-labelledby="unfinished" className="mb-6 rounded-2xl border border-line bg-raised p-5">
          <h2 id="unfinished" className="text-[15px] font-semibold">
            Finishing setup
          </h2>
          <ul className="mt-3 flex flex-col divide-y divide-line">
            {unfinished.map((u) => {
              const waitingOn = (u.steps ?? []).find((s) => s.state !== "done");
              return (
                <li key={u.id} className="flex flex-wrap items-center gap-3 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{u.name}</span>
                    <span className="block text-[13px] text-muted">
                      {platformName(u.platform)}
                      {waitingOn ? ` · next: ${waitingOn.label.toLowerCase()}` : ""}
                    </span>
                  </span>
                  <Link href={`/stores/new/setup/${u.id}`} className={bigSecondary}>
                    Carry on
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        {/* eBay */}
        <Choice
          id="ebay"
          mark={<MarketplaceMark />}
          name="eBay"
          lead="A seller account on eBay, ready to list: business policies, payment terms, 30-day returns, free delivery and a ship-from place, all set for you."
          next="eBay's page lets you sign in or create an account."
          info={ebayInfo}
          on={ebayOn}
          admin={admin}
        >
          {ebayOn && canOpen ? (
            <div className="flex flex-wrap items-center gap-3">
              <LeaveLink href="/api/connect/ebay/start?purpose=open" pendingLabel="Opening eBay">
                Continue to eBay
              </LeaveLink>
              <a href="/api/connect/ebay/start?purpose=connect" className="inline-flex min-h-11 items-center rounded-xl px-3 text-[14px] text-accent hover:bg-accent-soft">
                Already sell on eBay? Connect it
              </a>
            </div>
          ) : (
            <Unavailable on={ebayOn} />
          )}
        </Choice>

        {/* Facebook and Instagram */}
        <Choice
          id="facebook"
          mark={<SocialShopMark />}
          name="Facebook and Instagram"
          lead="A shop on your Facebook Page and Instagram, with your products in its catalog. Buyers pay on your Shopify store, the way Meta's shops work now."
          next="Meta's own window sets up the business, catalog and shop."
          info={facebookInfo}
          on={facebookOn}
          admin={admin}
        >
          {!facebookOn || !canOpen ? (
            <Unavailable on={facebookOn} />
          ) : !shops.length ? (
            <div className="flex flex-col items-start gap-3">
              <p className="text-[13px] text-muted">Meta&rsquo;s shops send buyers to a website to pay, so this needs a Shopify store first.</p>
              <Link href="/connections" className={bigSecondary}>
                Connect a Shopify store
              </Link>
            </div>
          ) : (
            <FacebookOpener shops={shops} enabled />
          )}
        </Choice>

        {/* Shopify */}
        <Choice
          id="shopify"
          mark={<WebsiteStoreMark />}
          name="Shopify"
          lead="Your own website store, with its own address and checkout. Armada lists products, keeps prices in step and sends its orders to suppliers."
          next="Shopify only lets people sign up on Shopify's page. Then connect it here."
          on
          admin={false}
        >
          <div className="flex flex-wrap items-center gap-3">
            <a href={SHOPIFY_SIGNUP} target="_blank" rel="noopener noreferrer" className={bigPrimary}>
              Sign up on Shopify
              <span className="sr-only"> (opens in a new tab)</span>
              <OutArrow />
            </a>
            <Link href="/connections" className="inline-flex min-h-11 items-center rounded-xl px-3 text-[14px] text-accent hover:bg-accent-soft">
              Already have one? Connect it
            </Link>
          </div>
        </Choice>

        {/* Practice */}
        <Choice
          id="practice"
          mark={<PracticeMark />}
          name="Practice store"
          lead="No real money. A pretend store with real-looking products, to try listing, pricing and orders before going live."
          next="Opens straight away."
          on
          admin={false}
        >
          <form action={openPractice} className="flex flex-col gap-4">
            <fieldset>
              <legend className="text-[13px] text-muted">Acts like</legend>
              <div className="mt-1.5 inline-flex rounded-xl border border-line-strong bg-sunken p-1">
                {(["shopify", "ebay", "facebook"] as const).map((p, i) => (
                  <label key={p} className="relative">
                    <input type="radio" name="platform" value={p} defaultChecked={i === 0} className="peer sr-only" />
                    <span className="inline-flex min-h-11 cursor-pointer items-center rounded-lg px-3.5 text-[14px] text-muted transition-colors peer-checked:bg-raised peer-checked:font-medium peer-checked:text-ink peer-checked:shadow-sm peer-focus-visible:outline-2 peer-focus-visible:outline-accent">
                      {platformName(p)}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="block">
              <span className="text-[13px] text-muted">Name, if you like</span>
              <input
                name="name"
                maxLength={60}
                placeholder="Armada picks one"
                className="mt-1.5 block min-h-11 w-full rounded-xl border border-line-strong bg-raised px-3 text-[15px] text-ink placeholder:text-muted focus:border-accent focus:outline-none"
              />
            </label>
            <div>
              <PendingButton pendingLabel="Opening the store" beam className={bigPrimary} disabled={!canOpen}>
                Open a practice store
              </PendingButton>
            </div>
          </form>
        </Choice>
      </div>
    </div>
  );
}

function Choice({
  id,
  mark,
  name,
  lead,
  next,
  info,
  on,
  admin,
  children,
}: {
  id: string;
  mark: ReactNode;
  name: string;
  lead: string;
  next: string;
  info?: ConnectorInfo;
  on: boolean;
  admin: boolean;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-name`} className="flex scroll-mt-6 flex-col gap-5 rounded-2xl border border-line bg-raised p-6">
      <div className="flex items-start justify-between gap-3">
        <span className="flex size-12 items-center justify-center rounded-xl bg-sunken text-ink">{mark}</span>
        {!on ? <StatusPill tone="off">Coming soon</StatusPill> : null}
      </div>
      <div>
        <h2 id={`${id}-name`} className="text-[18px] font-semibold tracking-tight">
          {name}
        </h2>
        <p className="mt-1.5 text-[14px] text-muted">{lead}</p>
        <p className="mt-2 text-[13px] text-muted">{next}</p>
      </div>
      <div className="mt-auto">{children}</div>
      {admin && info && !on ? <AdminDetails info={info} /> : null}
    </section>
  );
}

function Unavailable({ on }: { on: boolean }) {
  return (
    <button type="button" disabled className={cx(bigPrimary)}>
      {on ? "Owner or manager only" : "Coming soon"}
    </button>
  );
}

/** For platform admins only: exactly what's missing to switch this on. Setting names, never values. */
function AdminDetails({ info }: { info: ConnectorInfo }) {
  const callback = info.callbackPath ? appOrigin() + info.callbackPath : null;
  const extras: [string, boolean][] =
    info.provider === "facebook" ? [["META_SHOPS_APPROVED=yes", /^(1|yes|true|on)$/i.test(process.env.META_SHOPS_APPROVED?.trim() ?? "")]] : [];
  return (
    <details className="group rounded-xl border border-dashed border-line-strong px-4 py-3 text-[13px]">
      <summary className="cursor-pointer list-none font-medium text-ink marker:hidden">
        <span className="inline-flex min-h-7 items-center gap-2">
          <span aria-hidden className="inline-block transition-transform group-open:rotate-90">›</span>
          For you as admin: what&rsquo;s missing
        </span>
      </summary>
      <div className="mt-3 flex flex-col gap-3 text-muted">
        <div>
          <div className="font-medium text-ink">Server settings</div>
          <ul className="mt-1 flex flex-col gap-1">
            {info.requiredEnv.map((n) => {
              const has = Boolean(process.env[n]);
              return (
                <li key={n} className="flex items-center gap-2">
                  <StatusPill tone={has ? "ok" : "attention"}>{has ? "Set" : "Missing"}</StatusPill>
                  <code className="text-ink">{n}</code>
                </li>
              );
            })}
            {extras.map(([n, has]) => (
              <li key={n} className="flex items-center gap-2">
                <StatusPill tone={has ? "ok" : "attention"}>{has ? "Set" : "Missing"}</StatusPill>
                <code className="text-ink">{n}</code>
              </li>
            ))}
          </ul>
        </div>
        {callback ? (
          <div>
            <div className="font-medium text-ink">Address to register on the platform</div>
            <code className="mt-1 block break-all text-ink">{callback}</code>
            {info.provider === "ebay" ? (
              <>
                <div className="mt-2 font-medium text-ink">Declined address</div>
                <code className="mt-1 block break-all text-ink">{`${callback}?declined=1`}</code>
              </>
            ) : null}
          </div>
        ) : null}
        <p>{info.ownerSetup}</p>
      </div>
    </details>
  );
}

function OutArrow() {
  return (
    <svg aria-hidden viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 3.5h6.5V10M12.5 3.5 4 12" />
    </svg>
  );
}
