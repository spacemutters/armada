import { Megaphone, Share2 } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { after } from "next/server";
import {
  cancelRunAction,
  captionAction,
  makeWeekAction,
  postNowAction,
  remakeSlidePictureAction,
  removeAction,
  rewriteAction,
  scheduleAction,
  scheduleAllAction,
  slidesAction,
  unscheduleAction,
} from "./posts/actions";
import { BorderBeam } from "@/components/fx/border-beam";
import { PendingButton } from "@/components/fx/pending-button";
import { ShimmerText } from "@/components/fx/shimmer-text";
import { ThinkingOrb } from "@/components/fx/thinking-orb";
import { RefreshEvery } from "@/components/refresh-every";
import { PostCard } from "@/components/social/post-card";
import type { TargetAccount } from "@/components/social/schedule-panel";
import { ShopPicker } from "@/components/social/shop-picker";
import { Button, buttonClass, ButtonLink, Card, EmptyState, PageHeader, StatusPill } from "@/components/ui";
import { helperStatus } from "@/lib/ai/jobs";
import { requireSession } from "@/lib/auth/session";
import { readNote } from "@/lib/social/accounts/config";
import { lookFromBlueprint } from "@/lib/social/posts/design";
import { isDue } from "@/lib/social/posts/due";
import { ensureShopPostPictures, latestRun, photoChoices, postsForShop, uuid } from "@/lib/social/posts/queries";
import { platformLabel, publishDuePosts } from "@/lib/social/posts/schedule";
import { MAX_SLIDES, MIN_SLIDES, POSTS_PER_PRODUCT, POSTS_PER_WEEK } from "@/lib/social/posts/schema";
import { shopAccounts } from "@/lib/social/posts/targets";
import type { PostWithSlides } from "@/lib/social/posts/types";
import { listShops } from "@/lib/shops/queries";
import type { ShopRow } from "@/lib/shops/types";

export const metadata = { title: "Social posts" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const READY = new Set(["ready", "publishing", "published"]);
const shopName = (s: ShopRow) => s.blueprint.brand?.name ?? s.niche;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : null);

export default async function SocialPostsPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await requireSession();
  const sp = await searchParams;
  const shops = (await listShops(session.workspaceId)).filter((s) => READY.has(s.status) && s.blueprint.theme);
  const wanted = one(sp.shop);
  const shop = wanted && uuid(wanted) ? shops.find((s) => s.id === wanted) : undefined;

  if (!shop) {
    if (shops.length === 1) redirect(`/social?shop=${shops[0].id}`);
    return <PickShop shops={shops} />;
  }

  const look = lookFromBlueprint(shop.blueprint)!;
  // Pictures that failed only because ChatGPT was down are asked for again (as the ads page does).
  await ensureShopPostPictures(session.workspaceId, shop.id).catch((e) => console.error("asking for post pictures failed", e));
  const [accounts, posts, run, helper, choices] = await Promise.all([
    shopAccounts(session.workspaceId, shop.id),
    postsForShop(session.workspaceId, shop.id),
    latestRun(session.workspaceId, shop.id),
    helperStatus(),
    photoChoices(session.workspaceId, shop),
  ]);

  const now = requestTime();
  const due = (p: PostWithSlides) => isDue(p, now);
  // Anything due for this workspace goes out now, as well as on the helper's once-a-minute sweep.
  if (posts.some(due)) {
    const workspaceId = session.workspaceId;
    after(() => publishDuePosts({ workspaceId }).catch((e) => console.error("posts page sweep failed", e)));
  }

  const canEdit = session.role !== "viewer";
  const writing = run?.status === "writing" ? run : null;
  const drafts = posts.filter((p) => p.status === "draft").sort(bySuggested);
  const queue = posts.filter((p) => p.status === "scheduled" || p.status === "posting").sort(byScheduled);
  const failed = posts.filter((p) => p.status === "failed");
  const posted = posts.filter((p) => p.status === "posted").sort((a, b) => time(b.postedAt) - time(a.postedAt));
  const picturesBusy = posts.some((p) => p.slides.some((s) => s.pictureState === "making" || s.pictureState === "waiting"));
  const busy = Boolean(writing) || posts.some((p) => p.rewriting || p.status === "posting" || due(p));
  const soon = queue.some((p) => p.scheduledAt && time(p.scheduledAt) - now < 90_000);
  const lastFailed = run?.status === "failed" && !posts.some((p) => time(p.createdAt) > time(run.createdAt)) ? run : null;

  const targets: TargetAccount[] = accounts.eligible.map((a) => ({
    id: a.id,
    platform: platformLabel(a.platform),
    name: a.handle ? `@${a.handle.replace(/^@/, "")}` : a.name,
    practice: a.status === "practice",
  }));
  const handle = accounts.eligible.find((a) => a.platform === "instagram")?.handle ?? accounts.eligible[0]?.handle ?? null;
  const problem = readNote(one(sp.why) ?? undefined, one(sp.ws) ?? undefined);
  const scheduledCount = Number(one(sp.scheduled));
  const pastCount = Number(one(sp.past));
  const note =
    pastCount > 0 && Number.isInteger(pastCount) && Number.isInteger(scheduledCount)
      ? `${scheduledCount} scheduled. ${pastCount} ${pastCount === 1 ? "draft's" : "drafts'"} suggested time has passed, so ${pastCount === 1 ? "it needs" : "they need"} a new time.`
      : null;
  const saved = one(sp.saved);
  const problemFor = one(sp.for);
  const topProblem = problem && !(problemFor && posts.some((p) => p.id === problemFor)) ? problem : null;

  const card = (p: PostWithSlides) => (
    <PostCard
      key={p.id}
      post={p}
      look={look}
      handle={handle}
      accounts={targets}
      canEdit={canEdit}
      choices={choices}
      saved={saved === p.id}
      problem={problemFor === p.id ? problem : null}
      now={now}
      helperOff={!helper.online}
      actions={{
        schedule: scheduleAction.bind(null, shop.id, p.id),
        postNow: postNowAction.bind(null, shop.id, p.id),
        caption: captionAction.bind(null, shop.id, p.id),
        slides: slidesAction.bind(null, shop.id, p.id),
        rewrite: rewriteAction.bind(null, shop.id, p.id),
        remove: removeAction.bind(null, shop.id, p.id),
        unschedule: unscheduleAction.bind(null, shop.id, p.id),
        remakePicture: remakeSlidePictureAction.bind(null, shop.id, p.id),
      }}
    />
  );

  return (
    <>
      {busy ? <RefreshEvery seconds={4} /> : picturesBusy ? <RefreshEvery seconds={8} /> : soon ? <RefreshEvery seconds={20} /> : null}
      <PageHeader
        title="Social posts"
        subtitle={
          <>
            Carousel posts for <span className="font-medium text-ink">{shopName(shop)}</span>, written by AI from the shop&apos;s own products and photos.
            Nothing goes out until you schedule it.
          </>
        }
        actions={shops.length > 1 ? <ShopPicker shops={shops.map((s) => ({ id: s.id, name: shopName(s) }))} current={shop.id} /> : null}
      />

      {topProblem ? (
        <p role="alert" className="mb-4 rounded-xl bg-sunken px-4 py-3 text-[14px] text-negative">
          {topProblem}
        </p>
      ) : null}
      {note ? (
        <p role="status" className="mb-4 rounded-xl bg-attention-soft px-4 py-3 text-[14px] text-attention">
          {note}
        </p>
      ) : null}

      <Accounts shopId={shop.id} accounts={accounts} canEdit={canEdit} />

      <section id="writing" aria-label="Make posts" className="mt-4 scroll-mt-6">
        {writing ? (
          <BorderBeam active size="md" className="block rounded-2xl">
            <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:gap-5 sm:p-6">
              <ThinkingOrb state="composing" size={48} label="Writing" />
              <div className="min-w-0 flex-1">
                <p role="status" className="text-[16px] font-semibold">
                  <ShimmerText>
                    {writing.kind === "product"
                      ? `Writing ${POSTS_PER_PRODUCT} ads for ${writing.productTitle ?? "your product"}`
                      : `Writing ${POSTS_PER_WEEK} carousel posts for ${shopName(shop)}`}
                  </ShimmerText>
                </p>
                <p className="mt-1 max-w-2xl text-[14px] text-muted">
                  {writing.kind === "product"
                    ? "The AI reads the product's facts and photos and the shop's voice, and writes each ad around a different idea. This usually takes a minute or two. You can leave this page; they'll be here."
                    : "The AI reads the shop's products, photos and voice, picks a different idea for each post, and suggests a time for each. This usually takes two or three minutes. You can leave this page; they'll be here."}
                </p>
                {!helper.online ? (
                  <p className="mt-3 rounded-xl bg-attention-soft px-4 py-3 text-[13px] text-attention">
                    The AI helper on your computer is off. Start it and the posts arrive on their own.
                  </p>
                ) : null}
              </div>
              {canEdit ? (
                <form action={cancelRunAction.bind(null, shop.id, writing.id)}>
                  <Button type="submit" variant="quiet" className="min-h-11 md:min-h-9">
                    Cancel
                  </Button>
                </form>
              ) : null}
            </Card>
          </BorderBeam>
        ) : (
          <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
            <div className="min-w-0">
              <h2 className="text-[16px] font-semibold">{posts.length ? "Make another week of posts" : "Make a week of posts"}</h2>
              <p className="mt-1 max-w-2xl text-[14px] text-muted">
                {POSTS_PER_WEEK} carousel posts, each with {MIN_SLIDES} to {MAX_SLIDES} slides drawn in the shop&apos;s own colors and fonts, a caption,
                hashtags and a suggested time. Products appear in their own photos, with scenes made by ChatGPT around them. Only facts about the
                shop&apos;s products, and no made-up reviews, sales or deadlines.
              </p>
              {lastFailed ? <p className="mt-2 text-[13px] text-negative">{lastFailed.error ?? "The AI couldn't write the posts."} Try again.</p> : null}
              {!helper.online ? (
                <p className="mt-2 text-[13px] text-attention">The AI helper on your computer is off right now. The posts get written once it&apos;s on.</p>
              ) : null}
            </div>
            {canEdit ? (
              <form action={makeWeekAction.bind(null, shop.id)} className="shrink-0">
                <PendingButton pendingLabel="Starting" beam orb="composing" className={buttonClass("primary", "min-h-11 px-5 md:min-h-10")}>
                  <Megaphone aria-hidden className="size-4" />
                  {lastFailed ? "Try again" : posts.length ? "Make another week" : "Make a week of posts"}
                </PendingButton>
              </form>
            ) : null}
          </Card>
        )}
      </section>

      {drafts.length ? (
        <section aria-labelledby="drafts-heading" className="mt-10">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="drafts-heading" className="text-[17px] font-semibold tracking-tight">
                Ready for you to review <span className="text-muted tabular-nums">· {drafts.length}</span>
              </h2>
              <p className="mt-0.5 text-[13px] text-muted">Swipe through each one. Change any words, then schedule it or post it now.</p>
            </div>
            {canEdit && targets.length && drafts.some((d) => !d.rewriting && d.suggestedAt && time(d.suggestedAt) > now + 120_000) ? (
              <form action={scheduleAllAction.bind(null, shop.id)}>
                <PendingButton pendingLabel="Scheduling" variant="secondary" className={buttonClass("secondary", "min-h-11 md:min-h-9")}>
                  Schedule all at the suggested times
                </PendingButton>
              </form>
            ) : null}
          </div>
          <div className="flex flex-col gap-5">{drafts.map(card)}</div>
        </section>
      ) : null}

      {queue.length ? (
        <section id="queue" aria-labelledby="queue-heading" className="mt-10 scroll-mt-6">
          <h2 id="queue-heading" className="mb-4 text-[17px] font-semibold tracking-tight">
            Scheduled <span className="text-muted tabular-nums">· {queue.length}</span>
          </h2>
          <div className="flex flex-col gap-5">{queue.map(card)}</div>
        </section>
      ) : null}

      {failed.length ? (
        <section aria-labelledby="failed-heading" className="mt-10">
          <h2 id="failed-heading" className="mb-4 text-[17px] font-semibold tracking-tight">
            Didn&apos;t go out <span className="text-muted tabular-nums">· {failed.length}</span>
          </h2>
          <div className="flex flex-col gap-5">{failed.map(card)}</div>
        </section>
      ) : null}

      {posted.length ? (
        <section aria-labelledby="posted-heading" className="mt-10">
          <h2 id="posted-heading" className="mb-4 text-[17px] font-semibold tracking-tight">
            Posted
          </h2>
          <div className="flex flex-col gap-5">{posted.map(card)}</div>
        </section>
      ) : null}

      {!posts.length && !writing ? (
        <p className="mt-8 max-w-2xl text-[13px] text-muted">
          Each post is a set of real images Armada draws for this shop, ready for Instagram, Facebook and TikTok. You&apos;ll see every slide here before
          anything goes out.
        </p>
      ) : null}
    </>
  );
}

/** When this page is being drawn. A server page draws once per request, so reading the clock here is safe. */
function requestTime(): number {
  return Date.now();
}

function time(d: Date | string | null | undefined): number {
  return d ? new Date(d).getTime() : 0;
}
const bySuggested = (a: PostWithSlides, b: PostWithSlides) => time(a.suggestedAt) - time(b.suggestedAt);
const byScheduled = (a: PostWithSlides, b: PostWithSlides) => time(a.scheduledAt) - time(b.scheduledAt);

function Accounts({ shopId, accounts, canEdit }: { shopId: string; accounts: Awaited<ReturnType<typeof shopAccounts>>; canEdit: boolean }) {
  if (!accounts.all.length) {
    return (
      <Card className="flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="min-w-0">
          <h2 className="text-[16px] font-semibold">This shop has no social media accounts yet</h2>
          <p className="mt-1 max-w-xl text-[14px] text-muted">
            {accounts.failed
              ? "Armada couldn't check this shop's accounts just now. You can still make posts and schedule them once the accounts are set up."
              : "You can make and review posts now. To send them anywhere, set up the shop's accounts first. It takes a few minutes."}
          </p>
        </div>
        {canEdit ? (
          <ButtonLink href={`/social/connect?shop=${shopId}`} className="min-h-11 shrink-0 px-5 md:min-h-10">
            <Share2 aria-hidden className="size-4" />
            Set up this shop&apos;s social media
          </ButtonLink>
        ) : null}
      </Card>
    );
  }
  return (
    <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-[13px] text-muted">Posts go to</span>
        {accounts.all.map((a) => {
          const ok = accounts.eligible.some((e) => e.id === a.id);
          return (
            <span key={a.id} className="inline-flex items-center gap-2 text-[14px]">
              <StatusPill tone={a.status === "needs_attention" ? "attention" : ok ? "ok" : "off"}>{platformLabel(a.platform)}</StatusPill>
              <span className="text-muted">
                {a.handle ? `@${a.handle.replace(/^@/, "")}` : a.name}
                {a.status === "practice" ? " (practice)" : a.status === "needs_attention" ? " needs you to reconnect it" : !ok ? " can't take these posts" : ""}
              </span>
            </span>
          );
        })}
      </div>
      <Link href={`/social/connect?shop=${shopId}`} className="inline-flex min-h-11 shrink-0 items-center text-[14px] text-accent hover:underline md:min-h-9">
        Manage accounts
      </Link>
    </Card>
  );
}

function PickShop({ shops }: { shops: ShopRow[] }) {
  return (
    <>
      <PageHeader title="Social posts" subtitle="Pick a shop." />
      {shops.length ? (
        <ul className="flex flex-col divide-y divide-line rounded-2xl border border-line bg-raised">
          {shops.map((s) => (
            <li key={s.id}>
              <Link href={`/social?shop=${s.id}`} className="flex min-h-14 items-center gap-3 px-4 py-3 hover:bg-sunken">
                <span
                  aria-hidden
                  className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-[14px] font-semibold"
                  style={{ background: s.blueprint.theme?.palette.accent, color: s.blueprint.theme?.palette.accentInk }}
                >
                  {(shopName(s).trim()[0] ?? "A").toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{shopName(s)}</span>
                  <span className="block truncate text-[13px] text-muted">{s.blueprint.brand?.tagline ?? s.niche}</span>
                </span>
                <span className="text-[14px] text-accent">Make posts</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          title="No finished shops yet"
          body="Posts are made from a shop's products and look, so build a shop first."
          action={
            <ButtonLink href="/builder" className="min-h-11 md:min-h-9">
              Open the shop builder
            </ButtonLink>
          }
        />
      )}
    </>
  );
}
