import { ArrowLeft, OctagonX, Pause, Power } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { after } from "next/server";
import {
  discardAction,
  endAction,
  launchAction,
  makeAdsAction,
  pauseAction,
  remakePictureAction,
  removeAdAction,
  restoreAdAction,
  retryAction,
  rewriteAdAction,
  saveAdAction,
  saveBudgetAction,
  stopEverythingAction,
  switchOnAction,
} from "../actions";
import { FeedPreview, PreviewSkeleton, type PreviewAd, type PreviewShop } from "@/components/ads/ad-preview";
import { BudgetPanel } from "@/components/ads/budget-form";
import { PracticeNote, ResultsPanel } from "@/components/ads/results";
import { FormatPill, VariationCard, WrittenByAi, type PictureData, type VariationData } from "@/components/ads/variation-card";
import { BorderBeam } from "@/components/fx/border-beam";
import { PendingButton } from "@/components/fx/pending-button";
import { ShimmerText } from "@/components/fx/shimmer-text";
import { ThinkingOrb } from "@/components/fx/thinking-orb";
import { RefreshEvery } from "@/components/refresh-every";
import { Button, ButtonLink, Card, EmptyState, PageHeader, StatusPill, buttonClass, cx } from "@/components/ui";
import { shopAdsView, type ShopAdsView } from "@/lib/ads/queries";
import type { AdPictureView } from "@/lib/ads/pictures";
import { BUDGET, CARDS, CTA_LABEL, CTAS, LIMITS, normalizeCards } from "@/lib/ads/schema";
import { ensureShopAdPictures, syncPractice, syncRealResults } from "@/lib/ads/sets";
import { PRACTICE_LABEL, PRACTICE_MODEL, PRACTICE_MODEL_LINES } from "@/lib/ads/simulator";
import type { AdSet, AdVariation } from "@/lib/ads/types";
import { helperStatus } from "@/lib/ai/jobs";
import { requireSession } from "@/lib/auth/session";
import { countryName } from "@/lib/countries";
import { formatMoney } from "@/lib/money";

export const metadata = { title: "Ads" };

const touch = "min-h-11 md:min-h-9";
const CTA_OPTIONS = CTAS.map((value) => ({ value, label: CTA_LABEL[value] }));
const PLATFORM_WORDS: Record<AdSet["platform"], string> = {
  practice: "Practice",
  meta: "Facebook and Instagram",
  google: "Google",
  tiktok: "TikTok",
};

function previewShop(view: ShopAdsView, helperOff = false): PreviewShop {
  const p = view.shop.blueprint.theme?.palette;
  return {
    brand: view.shop.blueprint.brand?.name ?? view.shop.niche,
    domain: view.domain,
    accent: p?.accent ?? "#1f4fd1",
    accentInk: p?.accentInk ?? "#ffffff",
    artBg: p?.surface ?? "#e8eefc",
    artFg: p?.accent ?? "#1f4fd1",
    practice: view.set?.platform === "practice",
    helperOff,
  };
}

const pictureData = (p: AdPictureView): PictureData => ({
  key: p.key,
  state: p.state,
  src: p.src,
  practiceItem: p.practiceItem,
  alt: p.alt,
  mode: p.mode,
  label: p.label,
  note: p.note,
  redo: p.redo,
});

const cardsOf = (v: AdVariation) =>
  normalizeCards(v.cards).map((c) => ({ key: c.key, kind: c.kind, productId: c.productId, headline: c.headline, description: c.description }));

function toData(v: AdVariation, pictures: AdPictureView[]): VariationData {
  return {
    id: v.id,
    position: v.position,
    status: v.status,
    format: v.format,
    idea: v.idea,
    primaryText: v.primaryText,
    headline: v.headline,
    description: v.description,
    callToAction: v.callToAction,
    productIds: v.productIds,
    cards: cardsOf(v),
    pictures: pictures.map(pictureData),
    writtenBy: v.writtenBy,
    error: v.error,
  };
}

const previewOf = (v: AdVariation, pictures: AdPictureView[]): PreviewAd => ({
  format: v.format,
  primaryText: v.primaryText,
  headline: v.headline,
  description: v.description,
  cta: CTA_LABEL[v.callToAction] ?? "Shop now",
  productIds: v.productIds,
  cards: cardsOf(v),
  pictures: pictures.map(pictureData),
});

/** Which day of its run a live ad set is on (1-based, capped at its length). Server-rendered per request. */
function dayOfRun(switchedOnAt: Date | string, days: number): number {
  return Math.min(days, Math.floor((Date.now() - new Date(switchedOnAt).getTime()) / 86_400_000) + 1);
}

export default async function ShopAdsPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const { shopId } = await params;
  const sp = await searchParams;
  await syncPractice(session.workspaceId).catch(() => undefined);
  // Opening the ads asks for any pictures they're still missing (older ads, or ads put back).
  await ensureShopAdPictures(session.workspaceId, shopId).catch((e) => console.error("asking for ad pictures failed", e));
  const view = await shopAdsView(session.workspaceId, shopId);
  if (!view) notFound();
  const { shop, set } = view;
  if (set && set.platform !== "practice" && set.launchedAt) {
    const ws = session.workspaceId;
    after(() => syncRealResults(ws, set.id).catch(() => undefined));
  }
  const waitingOnAi = set?.status === "writing" || view.variations.some((v) => v.status === "rewriting");
  const picturesBusy = view.variations.some((v) => v.status !== "removed" && (view.pictures[v.id] ?? []).some((p) => p.state === "making" || p.state === "waiting"));
  const helper = waitingOnAi || picturesBusy ? await helperStatus() : null;

  const brand = shop.blueprint.brand?.name ?? shop.niche;
  const canEdit = session.role !== "viewer";
  const canSpend = session.role === "owner" || session.role === "manager";
  const problem = typeof sp.problem === "string" ? sp.problem : null;
  const ready = ["ready", "published"].includes(shop.status);
  const pshop = previewShop(view, helper ? !helper.online : false);

  return (
    <>
      <Link href="/ads" className="mb-4 inline-flex min-h-11 items-center gap-1.5 text-[14px] text-muted hover:text-ink md:min-h-9">
        <ArrowLeft aria-hidden className="size-4" /> Ads
      </Link>
      <PageHeader
        title={`Ads for ${brand}`}
        subtitle={
          set && set.status !== "stopped"
            ? set.platform === "practice"
              ? (set.practiceReason ?? "Practice ads: nothing is spent and the results are made up.")
              : `On ${PLATFORM_WORDS[set.platform]}${set.external.accountName ? `, in the ad account ${set.external.accountName}` : ""}. Real money, only once you switch them on.`
            : "One press writes 3 to 5 ads from this shop's own products and photos, including carousels, and ChatGPT makes their pictures. You check them before anything is made."
        }
        actions={set ? <StatusPill tone={set.platform === "practice" ? "off" : "ok"}>{PLATFORM_WORDS[set.platform]}</StatusPill> : null}
      />
      {problem ? (
        <p role="alert" className="mb-4 rounded-xl bg-sunken px-4 py-3 text-[14px] text-negative">
          {problem}
        </p>
      ) : null}
      {set?.error && set.status === "draft" ? (
        <p role="alert" className="mb-4 rounded-xl bg-attention-soft px-4 py-3 text-[14px] text-attention">
          {set.error} Nothing was switched on.
        </p>
      ) : null}
      {waitingOnAi ? (
        <RefreshEvery seconds={3} />
      ) : picturesBusy ? (
        <RefreshEvery seconds={6} />
      ) : set?.status === "on" ? (
        <RefreshEvery seconds={set.platform === "practice" ? 15 : 120} />
      ) : null}

      {!ready ? (
        <EmptyState title="This shop isn't finished yet" body="Ads are written from a finished shop's products and photos. Come back once it's built." action={<ButtonLink href={`/builder/${shop.id}`}>See the shop</ButtonLink>} />
      ) : !set || set.status === "stopped" ? (
        <>
          {set ? <Finished view={view} set={set} canEdit={canEdit} /> : <Start shopId={shop.id} brand={brand} canEdit={canEdit} />}
        </>
      ) : set.status === "writing" ? (
        <Writing brand={brand} set={set} canEdit={canEdit} helperOnline={helper?.online ?? true} />
      ) : set.status === "failed" ? (
        <Card className="flex flex-col gap-4 p-6">
          <p className="text-[16px] font-semibold">{set.error ?? "The AI couldn't write the ads."}</p>
          {canEdit ? (
            <div className="flex flex-wrap gap-2">
              <form key="retry" action={retryAction.bind(null, shop.id, set.id)}>
                <PendingButton orb="composing" pendingLabel="Asking again…" className={buttonClass("primary", touch)}>
                  Try again
                </PendingButton>
              </form>
              <form key="discard" action={discardAction.bind(null, shop.id, set.id)}>
                <Button type="submit" variant="quiet" className={touch}>
                  Never mind
                </Button>
              </form>
            </div>
          ) : null}
        </Card>
      ) : set.status === "draft" ? (
        <Draft view={view} set={set} canEdit={canEdit} pshop={pshop} helperOnline={helper?.online ?? true} />
      ) : (
        <Live view={view} set={set} canEdit={canEdit} canSpend={canSpend} pshop={pshop} />
      )}

      {view.earlier.length ? (
        <section className="mt-10">
          <h2 className="mb-3 text-[15px] font-semibold">Earlier ads for {brand}</h2>
          <ul className="divide-y divide-line rounded-2xl border border-line bg-raised">
            {view.earlier.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-[14px]">
                <span className="w-16 shrink-0 text-muted">{new Date(e.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                <span className="min-w-0 flex-1 truncate">{e.stopReason ?? "Finished"}</span>
                <span className="text-[13px] text-muted tabular">
                  {formatMoney(e.totals.spendCents, "USD")} spent · {e.totals.purchases} sales{e.platform === "practice" ? " · practice" : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

function Start({ shopId, brand, canEdit }: { shopId: string; brand: string; canEdit: boolean }) {
  const steps: [string, string][] = [
    ["The AI writes 3 to 5 ads", "Each tries a different idea in the shop's voice: single photos and carousels of four or more cards, using only facts the shop can stand behind."],
    ["ChatGPT makes the pictures", "Scenes in the shop's look around each product's own photo. A product is never redrawn, so shoppers get what the ad shows."],
    ["You check every one", "See each ad as it looks in a feed and between videos. Change the words, make a picture again, have the ad written again, or take it out."],
    ["They're made switched off", "In practice, or on your connected ad account. Nothing spends yet."],
    ["You switch them on", "With the daily budget and the most they can ever spend in plain money. One press stops them."],
  ];
  return (
    <div className="grid items-start gap-8 lg:grid-cols-[5fr_6fr]">
      <div className="flex flex-col gap-5">
        <ol className="flex flex-col gap-4 text-[14px]">
          {steps.map(([title, body], i) => (
            <li key={title} className="flex gap-3">
              <span aria-hidden className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-line-strong text-[12px] font-semibold">
                {i + 1}
              </span>
              <span>
                <span className="block font-medium">{title}</span>
                <span className="block text-muted">{body}</span>
              </span>
            </li>
          ))}
        </ol>
        {canEdit ? (
          <form key="makeAds" action={makeAdsAction.bind(null, shopId)}>
            <PendingButton beam orb="composing" pendingLabel="Starting…" className={buttonClass("primary", cx(touch, "w-full sm:w-auto"))}>
              Make ads for {brand}
            </PendingButton>
          </form>
        ) : (
          <p className="text-[14px] text-muted">Someone who can make changes can write ads for this shop.</p>
        )}
      </div>
      <div className="hidden gap-4 opacity-80 sm:flex" aria-hidden>
        <PreviewSkeleton />
      </div>
    </div>
  );
}

function Writing({ brand, set, canEdit, helperOnline }: { brand: string; set: AdSet; canEdit: boolean; helperOnline: boolean }) {
  return (
    <div className="flex flex-col gap-6">
      <Card className="flex flex-col gap-3 p-6">
        <div className="flex items-center gap-3">
          <ThinkingOrb state="composing" size={32} decorative />
          <p className="text-[17px] font-semibold" role="status">
            <ShimmerText>Writing ads for {brand}</ShimmerText>
          </p>
        </div>
        <p className="max-w-2xl text-[14px] text-muted">
          The AI reads the shop&apos;s products, photos, prices and promises, and writes 3 to 5 different ads, including carousels, plus who to show them to and a
          starting budget. This usually takes a minute or two. Then ChatGPT makes each ad&apos;s pictures, about a minute each; you can read the ads while they
          arrive.
        </p>
        {!helperOnline ? (
          <p className="rounded-xl bg-attention-soft px-4 py-3 text-[13px] text-attention">
            The AI helper on your computer is off, so this is waiting. Start it and the ads arrive on their own.
          </p>
        ) : null}
        {canEdit ? (
          <form key="discard" action={discardAction.bind(null, set.shopId, set.id)}>
            <Button type="submit" variant="quiet" className={touch}>
              Cancel
            </Button>
          </form>
        ) : null}
      </Card>
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3" aria-hidden>
        {[0, 1, 2].map((i) => (
          <BorderBeam key={i} active size="md" radius={16} className="block" strength={i === 0 ? 1 : 0.6}>
            <div className="rounded-2xl">
              <PreviewSkeleton />
            </div>
          </BorderBeam>
        ))}
      </div>
    </div>
  );
}

function AudienceLines({ set }: { set: AdSet }) {
  const a = set.audience;
  const where = (a.countries ?? []).map((c) => countryName(c)).join(", ") || "Your shop's country";
  return (
    <div className="flex flex-col gap-1.5 text-[14px]">
      {a.description ? <p>{a.description}</p> : null}
      <p className="text-muted">
        Ages {a.ageMin ?? 18} to {a.ageMax ?? 65} · {where}
      </p>
      {a.interests?.length ? (
        <ul className="mt-1 flex flex-wrap gap-1.5" aria-label="Interests">
          {a.interests.map((i) => (
            <li key={i} className="rounded-full border border-line px-2.5 py-0.5 text-[12px] text-muted">
              {i}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function BudgetSummary({ set }: { set: AdSet }) {
  const money = (c: number) => formatMoney(c, set.currency);
  return (
    <div className="flex flex-col gap-1">
      <p className="text-[20px] font-semibold tracking-tight tabular">
        {money(set.dailyBudgetCents)} a day for {set.days} {set.days === 1 ? "day" : "days"}
      </p>
      <p className="text-[14px]">
        Never more than <span className="font-semibold tabular">{money(set.spendCapCents)}</span> in total.
      </p>
    </div>
  );
}

function Draft({ view, set, canEdit, pshop, helperOnline }: { view: ShopAdsView; set: AdSet; canEdit: boolean; pshop: PreviewShop; helperOnline: boolean }) {
  const live = view.variations.filter((v) => v.status !== "removed");
  const removed = view.variations.filter((v) => v.status === "removed");
  const rewriting = live.some((v) => v.status === "rewriting");
  const shopId = view.shop.id;
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
      <div className="flex min-w-0 flex-col gap-5">
        {set.plan ? (
          <p className="flex items-start gap-2 text-[15px]">
            <ThinkingOrb state="done" size={20} decorative className="mt-0.5" />
            <span>
              <span className="font-medium">The plan, written by AI:</span> {set.plan}
            </span>
          </p>
        ) : null}
        {!helperOnline && rewriting ? (
          <p className="rounded-xl bg-attention-soft px-4 py-3 text-[13px] text-attention">The AI helper on your computer is off, so the ad being written again is waiting.</p>
        ) : null}
        {live.map((v) => (
          <VariationCard
            key={v.id}
            v={toData(v, view.pictures[v.id] ?? [])}
            products={view.products}
            shop={pshop}
            ctaOptions={CTA_OPTIONS}
            limits={LIMITS}
            minCards={CARDS.min}
            editable={canEdit}
            actions={{
              save: saveAdAction.bind(null, shopId, v.id),
              rewrite: rewriteAdAction.bind(null, shopId, v.id),
              remove: removeAdAction.bind(null, shopId, v.id),
              remake: remakePictureAction.bind(null, shopId, v.id),
            }}
          />
        ))}
        {removed.length ? (
          <section aria-label="Removed ads" className="rounded-2xl border border-dashed border-line-strong p-4">
            <h3 className="mb-2 text-[14px] font-medium">Taken out</h3>
            <ul className="flex flex-col gap-2">
              {removed.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center gap-3 text-[14px]">
                  <span className="min-w-0 flex-1 truncate text-muted">
                    Ad {v.position + 1}: {v.headline}
                  </span>
                  {canEdit ? (
                    <form action={restoreAdAction.bind(null, shopId, v.id)}>
                      <Button type="submit" variant="quiet" className={touch}>
                        Put back
                      </Button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>

      <aside className="flex flex-col gap-4 lg:sticky lg:top-6">
        <Card className="flex flex-col gap-5 p-5">
          <div>
            <h2 className="mb-2 text-[13px] font-medium text-muted">Who sees them</h2>
            <AudienceLines set={set} />
          </div>
          <div className="border-t border-line pt-4">
            <h2 className="mb-2 text-[13px] font-medium text-muted">Budget</h2>
            <BudgetPanel
              canChange={canEdit}
              summary={
                <>
                  <BudgetSummary set={set} />
                  {set.budgetReason ? (
                    <p className="text-[13px] text-muted">
                      <span className="font-medium text-ink">Why, written by AI:</span> {set.budgetReason}
                    </p>
                  ) : null}
                </>
              }
              daily={Math.round(set.dailyBudgetCents / 100)}
              days={set.days}
              currency={set.currency}
              minDaily={BUDGET.minDaily}
              maxDaily={BUDGET.maxDaily}
              maxDays={BUDGET.maxDays}
              spentCents={0}
              audience={{ description: set.audience.description ?? "", ageMin: set.audience.ageMin ?? 18, ageMax: set.audience.ageMax ?? 65 }}
              save={saveBudgetAction.bind(null, shopId, set.id, false)}
            />
          </div>
          <div className="flex flex-col gap-2 border-t border-line pt-4">
            {set.platform === "practice" ? (
              <p className="text-[13px] text-muted">These will be practice ads: nothing is spent and the results are made up.</p>
            ) : null}
            {canEdit ? (
              <form key="launch" action={launchAction.bind(null, shopId, set.id)}>
                <PendingButton
                  beam
                  pendingLabel="Creating them, switched off…"
                  disabled={!live.length || rewriting || Boolean(set.launchingAt)}
                  className={buttonClass("primary", cx(touch, "w-full"))}
                >
                  Create these ads — paused
                </PendingButton>
              </form>
            ) : null}
            <p className="text-[13px] text-muted">
              {live.length} {live.length === 1 ? "ad is" : "ads are"} made switched off. Nothing spends until you press Switch on.
            </p>
            {canEdit ? (
              <form key="discard" action={discardAction.bind(null, shopId, set.id)}>
                <Button type="submit" variant="quiet" className={cx(touch, "px-0")}>
                  Throw these away
                </Button>
              </form>
            ) : null}
          </div>
        </Card>
      </aside>
    </div>
  );
}

function AdsGrid({ view, pshop }: { view: ShopAdsView; pshop: PreviewShop }) {
  const ads = view.variations.filter((v) => v.status === "created");
  return (
    <section aria-labelledby="ads-heading" className="flex flex-col gap-3">
      <h2 id="ads-heading" className="text-[15px] font-semibold">
        The ads
      </h2>
      <ul className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {ads.map((v) => (
          <li key={v.id} className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[14px] font-semibold">Ad {v.position + 1}</span>
              <FormatPill format={v.format} cards={normalizeCards(v.cards).length || 1} />
              <WrittenByAi edited={v.writtenBy === "ai_edited"} />
            </div>
            <FeedPreview ad={previewOf(v, view.pictures[v.id] ?? [])} shop={pshop} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function perAd(view: ShopAdsView) {
  return view.variations
    .filter((v) => v.status === "created")
    .map((v) => ({ id: v.id, label: `Ad ${v.position + 1}`, idea: v.idea, totals: view.byVariation[v.id] ?? { ...view.totals, impressions: 0, reach: 0, clicks: 0, addToCarts: 0, purchases: 0, spendCents: 0, salesCents: 0, days: 0 } }));
}

function reachOf(view: ShopAdsView, set: AdSet): number {
  return set.platform === "practice" ? view.totals.reach : (set.external.reach ?? view.totals.reach);
}

function Live({ view, set, canEdit, canSpend, pshop }: { view: ShopAdsView; set: AdSet; canEdit: boolean; canSpend: boolean; pshop: PreviewShop }) {
  const money = (c: number) => formatMoney(c, set.currency);
  const on = set.status === "on";
  const practice = set.platform === "practice";
  const shopId = view.shop.id;
  const hasResults = view.totals.impressions > 0 || on;
  const dayLine = practice
    ? on
      ? `Practice day ${view.totals.days} of ${set.days} · a new day every ${PRACTICE_MODEL.minutesPerDay === 1 ? "minute" : `${PRACTICE_MODEL.minutesPerDay} minutes`}`
      : `${view.totals.days} of ${set.days} practice days run`
    : set.switchedOnAt
      ? `Day ${dayOfRun(set.switchedOnAt, set.days)} of ${set.days}`
      : undefined;

  return (
    <div className="flex flex-col gap-6">
      <Card className="flex flex-col gap-5 p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-3">
          <StatusPill tone={on ? "working" : "off"}>{on ? "On" : "Switched off"}</StatusPill>
          <p className="text-[17px] font-semibold" role="status">
            {on
              ? practice
                ? "Your practice ads are on."
                : "Your ads are on and spending."
              : set.stopReason && view.totals.spendCents
                ? `Paused. ${set.stopReason}.`
                : "Your ads are made and switched off."}
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-4">
            <BudgetPanel
              canChange={canSpend}
              summary={<BudgetSummary set={set} />}
              daily={Math.round(set.dailyBudgetCents / 100)}
              days={set.days}
              currency={set.currency}
              minDaily={BUDGET.minDaily}
              maxDaily={BUDGET.maxDaily}
              maxDays={BUDGET.maxDays}
              spentCents={view.totals.spendCents}
              save={saveBudgetAction.bind(null, shopId, set.id, true)}
            />
            <p className="text-[13px] text-muted">
              {practice
                ? "Practice: no real money. The numbers below are made up."
                : `Real money from your ad account. The ${money(set.spendCapCents)} total is set inside Meta too, so it holds even if Armada is down.`}
            </p>
          </div>
          <div className="flex flex-col gap-2">
            {on ? (
              canEdit ? (
                <>
                  <form key="pause" action={pauseAction.bind(null, shopId, set.id)}>
                    <PendingButton variant="secondary" pendingLabel="Pausing…" className={buttonClass("secondary", cx(touch, "w-full sm:w-auto"))}>
                      <Pause aria-hidden className="size-4" /> Pause these ads
                    </PendingButton>
                  </form>
                  <form key="stopEverything" action={stopEverythingAction.bind(null, `/ads/${shopId}`)}>
                    <PendingButton variant="secondary" pendingLabel="Stopping every ad…" className={buttonClass("quiet", cx(touch, "text-negative"))}>
                      <OctagonX aria-hidden className="size-4" /> Stop every ad in every shop
                    </PendingButton>
                  </form>
                </>
              ) : null
            ) : canSpend ? (
              <>
                <form key="switchOn" action={switchOnAction.bind(null, shopId, set.id)}>
                  <PendingButton beam pendingLabel="Switching on…" className={buttonClass("primary", cx(touch, "w-full text-[15px] sm:w-auto sm:px-6"))}>
                    <Power aria-hidden className="size-4" /> Switch on
                  </PendingButton>
                </form>
                <p className="text-[13px] text-muted">
                  {money(set.dailyBudgetCents)} a day, never more than {money(set.spendCapCents)} in total. You can pause at any time.
                </p>
              </>
            ) : (
              <p className="text-[14px] text-muted">Only the owner or a manager can switch ads on.</p>
            )}
            {canEdit && !on ? (
              <form key="end" action={endAction.bind(null, shopId, set.id)}>
                <Button type="submit" variant="quiet" className={cx(touch, "px-0")}>
                  End these ads for good
                </Button>
              </form>
            ) : null}
          </div>
        </div>
      </Card>

      {hasResults ? (
        <ResultsPanel
          totals={{ ...view.totals, practice }}
          reach={reachOf(view, set)}
          capCents={set.spendCapCents}
          currency={set.currency}
          perAd={perAd(view)}
          practiceLabel={PRACTICE_LABEL}
          practiceLines={PRACTICE_MODEL_LINES}
          dayLine={dayLine}
        />
      ) : practice ? (
        <PracticeNote label="Once you switch these on, practice results appear here within a minute: made-up shoppers, clearly labelled." lines={PRACTICE_MODEL_LINES} />
      ) : null}

      <AdsGrid view={view} pshop={pshop} />
    </div>
  );
}

function Finished({ view, set, canEdit }: { view: ShopAdsView; set: AdSet; canEdit: boolean }) {
  const brand = view.shop.blueprint.brand?.name ?? view.shop.niche;
  const pshop = previewShop(view);
  const practice = set.platform === "practice";
  return (
    <div className="flex flex-col gap-6">
      <Card className="flex flex-col gap-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-3">
          <StatusPill tone="ok">Finished</StatusPill>
          <p className="text-[17px] font-semibold" role="status">
            {set.stopReason ?? "These ads have finished."}
          </p>
        </div>
        {canEdit ? (
          <form key="makeAds" action={makeAdsAction.bind(null, view.shop.id)}>
            <PendingButton beam orb="composing" pendingLabel="Starting…" className={buttonClass("primary", cx(touch, "w-full sm:w-auto"))}>
              Make new ads for {brand}
            </PendingButton>
          </form>
        ) : null}
      </Card>
      {view.totals.impressions > 0 ? (
        <ResultsPanel
          totals={{ ...view.totals, practice }}
          reach={reachOf(view, set)}
          capCents={set.spendCapCents}
          currency={set.currency}
          perAd={perAd(view)}
          practiceLabel={PRACTICE_LABEL}
          practiceLines={PRACTICE_MODEL_LINES}
          dayLine={`${view.totals.days} ${view.totals.days === 1 ? "day" : "days"} run`}
        />
      ) : null}
      <AdsGrid view={view} pshop={pshop} />
    </div>
  );
}
