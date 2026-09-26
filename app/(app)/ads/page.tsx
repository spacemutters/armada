import { ArrowRight, OctagonX } from "lucide-react";
import Link from "next/link";
import type { CSSProperties } from "react";
import { makeAdsAction, stopEverythingAction, chooseMetaAction, disconnectMetaAction } from "./actions";
import { Expand } from "@/components/fx/expand";
import { PendingButton } from "@/components/fx/pending-button";
import { ShimmerText } from "@/components/fx/shimmer-text";
import { ThinkingOrb } from "@/components/fx/thinking-orb";
import { ProductArt } from "@/components/product-art";
import { ButtonLink, Card, EmptyState, PageHeader, Section, Stat, StatusPill, buttonClass, cx, inputClass, type Tone } from "@/components/ui";
import { costPerSale } from "@/components/ads/results";
import { adsOverview, isPlatformAdmin, platformRows, type PlatformRow, type ShopAdsRow } from "@/lib/ads/queries";
import { syncPractice } from "@/lib/ads/sets";
import { requireSession } from "@/lib/auth/session";
import { formatMoney } from "@/lib/money";

export const metadata = { title: "Ads" };

const RAILS = [
  { title: "Every ad starts switched off", body: "Nothing spends until you press Switch on." },
  { title: "A cap on every set of ads", body: "A daily budget and a total it can never pass." },
  { title: "One stop button", body: "Stops every ad in every shop at once." },
  { title: "People stay in charge", body: "You check every ad first. Every change is recorded." },
];

const touch = "min-h-11 md:min-h-9";
const n = (x: number) => x.toLocaleString("en-US");

function stateOf(r: ShopAdsRow): { tone: Tone; label: string; line: React.ReactNode } {
  const set = r.set;
  if (!set) return { tone: "off", label: "No ads yet", line: "No ads yet" };
  const money = (c: number) => formatMoney(c, set.currency);
  switch (set.status) {
    case "writing":
      return { tone: "working", label: "Writing", line: <ShimmerText>The AI is writing ads…</ShimmerText> };
    case "failed":
      return { tone: "attention", label: "Needs you", line: "The AI couldn't write them. Open to try again." };
    case "draft":
      return { tone: "attention", label: "Ready to check", line: `${r.ads} ${r.ads === 1 ? "ad" : "ads"} written, ready for you to check` };
    case "paused":
      return {
        tone: "off",
        label: "Switched off",
        line: set.launchedAt && r.totals.spendCents ? `Paused · ${money(r.totals.spendCents)} of ${money(set.spendCapCents)} spent` : `${r.ads} ${r.ads === 1 ? "ad" : "ads"} made, switched off`,
      };
    case "on":
      return { tone: "working", label: "On", line: `${money(set.dailyBudgetCents)} a day · ${money(r.totals.spendCents)} of ${money(set.spendCapCents)} spent` };
    case "stopped":
      return { tone: "ok", label: "Finished", line: `${n(r.totals.purchases)} ${r.totals.purchases === 1 ? "sale" : "sales"} from ${money(r.totals.spendCents)} spent` };
  }
}

export default async function AdsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  const sp = await searchParams;
  // Practice ads run on a practice clock; catch them up before showing numbers.
  await syncPractice(session.workspaceId).catch(() => undefined);
  const [{ rows, onCount, totals }, platforms, admin] = await Promise.all([adsOverview(session.workspaceId), platformRows(session.workspaceId), isPlatformAdmin(session.memberId)]);

  const canEdit = session.role !== "viewer";
  const canSpend = session.role === "owner" || session.role === "manager";
  const problem = typeof sp.problem === "string" ? sp.problem : null;
  const stopped = typeof sp.stopped === "string" ? Number(sp.stopped) : null;
  const connected = sp.connected === "meta";
  const anyResults = totals.impressions > 0;

  return (
    <>
      <PageHeader
        title="Ads"
        subtitle="AI-written ads for each shop. Every ad starts switched off."
        actions={
          onCount && canEdit ? (
            <form action={stopEverythingAction.bind(null, "/ads")}>
              <PendingButton variant="secondary" pendingLabel="Stopping every ad…" className={buttonClass("secondary", cx(touch, "text-negative"))}>
                <OctagonX aria-hidden className="size-4" /> Stop every ad
              </PendingButton>
            </form>
          ) : null
        }
      />

      {problem ? (
        <p role="alert" className="mb-4 rounded-xl bg-sunken px-4 py-3 text-[14px] text-negative">
          {problem}
        </p>
      ) : null}
      {stopped != null && !problem ? (
        <p role="status" className="mb-4 rounded-xl bg-sunken px-4 py-3 text-[14px]">
          {stopped ? `Stopped. ${stopped} ${stopped === 1 ? "shop's ads are" : "shops' ads are"} paused.` : "Nothing was on, so nothing needed stopping."}
        </p>
      ) : null}
      {connected ? (
        <p role="status" className="mb-4 rounded-xl bg-sunken px-4 py-3 text-[14px]">
          Meta ad account connected. New ads start switched off.
        </p>
      ) : null}

      {anyResults ? (
        <Card className="mb-6 p-5">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <h2 className="text-[15px] font-semibold">All shops</h2>
            {totals.practice ? <span className="rounded-lg bg-attention-soft px-2.5 py-1 text-[13px] text-attention">Includes practice numbers, which are made up</span> : null}
          </div>
          <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
            <Stat label="Spent" value={formatMoney(totals.spendCents, "USD")} rollIn />
            <Stat label="People reached" value={n(totals.reach)} rollIn />
            <Stat label="Sales" value={n(totals.purchases)} tone={totals.purchases ? "positive" : undefined} rollIn />
            <Stat label="Cost per sale" value={costPerSale(totals, "USD")} />
          </div>
        </Card>
      ) : null}

      <section aria-labelledby="shops-heading" className="mb-6">
        <h2 id="shops-heading" className="mb-3 text-[15px] font-semibold">
          Your shops
        </h2>
        {rows.length === 0 ? (
          <EmptyState
            mark={<ThinkingOrb state="idle" size={32} decorative />}
            title="No finished shops yet"
            body="Build a shop first. Then one press writes its ads."
            action={<ButtonLink href="/builder" className={touch}>Build a shop</ButtonLink>}
          />
        ) : (
          <Card>
            <ul className="flex flex-col divide-y divide-line">
              {rows.map((r) => (
                <ShopRow key={r.shop.id} r={r} canEdit={canEdit} />
              ))}
            </ul>
          </Card>
        )}
      </section>

      <section id="platforms" aria-labelledby="platforms-heading" className="mb-6 scroll-mt-6">
        <h2 id="platforms-heading" className="mb-3 text-[15px] font-semibold">
          Where ads run
        </h2>
        <Card>
          <ul className="flex flex-col divide-y divide-line">
            <li className="flex flex-wrap items-start gap-3 px-5 py-4">
              <div className="min-w-0 flex-1">
                <div className="font-medium">Practice</div>
                <p className="mt-0.5 max-w-2xl text-[13px] text-muted">
                  Always ready. Nothing is spent; practice numbers are labelled.
                </p>
              </div>
              <StatusPill tone="ok">Ready</StatusPill>
            </li>
            {platforms.map((p) => (
              <PlatformItem key={p.provider} p={p} admin={admin} canSpend={canSpend} />
            ))}
          </ul>
        </Card>
      </section>

      <Section title="How spending stays safe">
        <ul className="grid gap-5 sm:grid-cols-2">
          {RAILS.map((r) => (
            <li key={r.title}>
              <div className="font-medium">{r.title}</div>
              <p className="mt-0.5 text-[13px] text-muted">{r.body}</p>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}

function ShopRow({ r, canEdit }: { r: ShopAdsRow; canEdit: boolean }) {
  const state = stateOf(r);
  const set = r.set;
  const canMake = canEdit && (!set || set.status === "stopped");
  const palette = r.shop.palette;
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-4 sm:px-5" data-shop={r.shop.id}>
      <div
        className="size-14 shrink-0 overflow-hidden rounded-xl border border-line bg-sunken"
        style={palette ? ({ "--art-bg": palette.surface, "--art-fg": palette.accent } as CSSProperties) : undefined}
      >
        {r.cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={r.cover} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : r.thumb ? (
          <ProductArt images={r.thumb.imageUrl ? [{ url: r.thumb.imageUrl }] : []} icon={r.thumb.icon ?? undefined} title={r.thumb.title} sizes="56px" />
        ) : null}
      </div>
      <div className="min-w-0 flex-1 basis-48">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/ads/${r.shop.id}`} className="truncate text-[15px] font-semibold hover:underline">
            {r.shop.brand}
          </Link>
          <StatusPill tone={state.tone}>{state.label}</StatusPill>
          {set?.platform === "practice" || (!set && r.shop.practice) ? <span className="text-[12px] text-muted">Practice</span> : null}
        </div>
        <div className="mt-0.5 truncate text-[13px] text-muted">{state.line}</div>
      </div>
      <div className="w-full sm:w-auto">
        {canMake ? (
          <form action={makeAdsAction.bind(null, r.shop.id)}>
            <PendingButton beam orb="composing" pendingLabel="Starting…" className={buttonClass("primary", cx(touch, "w-full sm:w-auto"))}>
              Make ads for {r.shop.brand}
            </PendingButton>
          </form>
        ) : set ? (
          <ButtonLink href={`/ads/${r.shop.id}`} variant="secondary" className={cx(touch, "w-full sm:w-auto")}>
            {set.status === "draft" ? "Check the ads" : set.status === "on" || set.status === "stopped" ? "See results" : "Open"}
            <ArrowRight aria-hidden className="size-4" />
          </ButtonLink>
        ) : null}
      </div>
    </li>
  );
}

function PlatformItem({ p, admin, canSpend }: { p: PlatformRow; admin: boolean; canSpend: boolean }) {
  const conn = p.meta;
  const account = conn?.adAccounts.find((a) => a.id === conn.adAccountId);
  const page = conn?.pages.find((x) => x.id === conn.pageId);
  const tone: Tone = !p.available ? "off" : conn?.status === "connected" ? "ok" : conn ? "attention" : "off";
  const label = !p.available ? "Coming soon" : conn?.status === "connected" ? "Connected" : conn ? "Needs you" : "Not connected";
  return (
    <li className="flex flex-col gap-3 px-5 py-4" data-platform={p.provider}>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-medium">{p.name}</div>
          <p className="mt-0.5 max-w-2xl text-[13px] text-muted">{p.blurb}</p>
          {conn && p.available ? (
            <p className="mt-1 text-[13px]">
              {conn.status === "connected" ? `Signed in as ${conn.personName}` : "Meta signed Armada out. Connect again to keep making ads there."}
              {account ? ` · Ad account: ${account.name}` : ""}
              {page ? ` · Page: ${page.name}` : ""}
            </p>
          ) : null}
          {conn?.lastError && p.available ? <p className="mt-1 text-[13px] text-attention">{conn.lastError}</p> : null}
        </div>
        <StatusPill tone={tone}>{label}</StatusPill>
      </div>

      {p.available && canSpend ? (
        <div className="flex flex-wrap items-end gap-2">
          {!conn || conn.status !== "connected" ? (
            <a href={`/api/connect/${p.provider}/start`} className={buttonClass("primary", touch)}>
              {conn ? "Connect again" : "Connect your ad account"}
            </a>
          ) : (
            <>
              {conn.adAccounts.length > 1 || conn.pages.length > 1 ? (
                <form action={chooseMetaAction} className="flex flex-wrap items-end gap-2">
                  <label className="block">
                    <span className="text-[13px] text-muted">Ad account</span>
                    <select name="adAccountId" defaultValue={conn.adAccountId ?? ""} className={cx(inputClass, "mt-1")}>
                      {conn.adAccounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name} ({a.currency}){a.active ? "" : " · can't run ads"}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-[13px] text-muted">Facebook Page</span>
                    <select name="pageId" defaultValue={conn.pageId ?? ""} className={cx(inputClass, "mt-1")}>
                      {conn.pages.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <PendingButton variant="secondary" pendingLabel="Saving…" className={buttonClass("secondary", touch)}>
                    Use these
                  </PendingButton>
                </form>
              ) : null}
              <form action={disconnectMetaAction}>
                <PendingButton variant="secondary" pendingLabel="Disconnecting…" className={buttonClass("quiet", touch)}>
                  Disconnect
                </PendingButton>
              </form>
            </>
          )}
        </div>
      ) : null}

      {!p.available && admin ? (
        <Expand
          summary={<span className="text-[13px] font-medium">What switches this on (only platform admins see this)</span>}
          buttonClassName={cx(touch, "text-ink")}
        >
          <ol className="mt-2 flex list-decimal flex-col gap-1.5 pl-5 text-[13px] text-muted">
            {p.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          {p.missing.length ? (
            <p className="mt-3 text-[13px]">
              Still missing in Vercel&apos;s settings: <span className="font-mono text-[12px]">{p.missing.join(", ")}</span>
            </p>
          ) : (
            <p className="mt-3 text-[13px]">Every setting it needs is in place.</p>
          )}
        </Expand>
      ) : null}
    </li>
  );
}
