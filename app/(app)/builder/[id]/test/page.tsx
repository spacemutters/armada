import { ArrowLeft, ExternalLink } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import "@/app/s/storefront.css";
import {
  cancelAction,
  clearPracticeAction,
  practiceAction,
  runTestAction,
  startTestAction,
  undoAction,
  winnerAction,
  writeMoreAction,
} from "./actions";
import { HeroPreview } from "@/components/hero-preview";
import { RefreshEvery } from "@/components/refresh-every";
import { TestChoose } from "@/components/test-choose";
import { Button, ButtonLink, Card, cx, PageHeader, StatusPill } from "@/components/ui";
import type { HeroCopy } from "@/lib/abtest/prompt";
import { readTest, type Reading } from "@/lib/abtest/stats";
import { countsFor, testsForShop, type AbTest, type Counts } from "@/lib/abtest/tests";
import { helperStatus } from "@/lib/ai/jobs";
import { requireSession } from "@/lib/auth/session";
import { getShop, getShopProducts } from "@/lib/shops/queries";
import { storefrontVars } from "@/lib/shops/storefront";
import { googleFontsHref } from "@/lib/shops/style";

export const metadata = { title: "Headline test" };

const n = (x: number) => x.toLocaleString("en-US");
const pct = (x: number) => `${(x * 100).toFixed(x > 0 && x < 0.1 ? 1 : 0)}%`;
const day = (d: Date | null) => (d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "");

export default async function HeadlineTestPage({ params, searchParams }: PageProps<"/builder/[id]/test">) {
  const session = await requireSession();
  const { id } = await params;
  const sp = await searchParams;
  const shop = await getShop(session.workspaceId, id);
  if (!shop || !["ready", "published"].includes(shop.status) || !shop.blueprint.hero) notFound();
  const bp = shop.blueprint;

  const [tests, products, helper] = await Promise.all([
    testsForShop(session.workspaceId, shop.id),
    getShopProducts(session.workspaceId, (bp.products ?? []).map((p) => p.productId)),
    helperStatus(),
  ]);
  const counts = await countsFor(
    session.workspaceId,
    tests.filter((t) => t.status === "running" || t.status === "finished").map((t) => t.id),
  );
  const open = tests.find((t) => ["writing", "choosing", "running"].includes(t.status)) ?? null;
  const latest = tests[0] ?? null;
  const current = open ?? (latest && (latest.status === "finished" || latest.status === "failed") ? latest : null);
  const past = tests.filter((t) => t !== current && (t.status === "finished" || t.status === "cancelled"));

  const vars = storefrontVars(bp);
  const brand = bp.brand?.name ?? "Your shop";
  const image = products.find((p) => p.images.length)?.images[0] ?? null;
  const canEdit = session.role !== "viewer";
  const preview = `/s/${shop.slug}`;
  const problem = typeof sp.problem === "string" ? sp.problem : null;

  return (
    <>
      <link rel="stylesheet" href={googleFontsHref(bp.theme!.fonts.display, bp.theme!.fonts.body)} precedence="default" />
      <Link href={`/builder/${shop.id}`} className="mb-4 inline-flex min-h-9 items-center gap-1.5 text-[14px] text-muted hover:text-ink">
        <ArrowLeft aria-hidden className="size-4" /> {brand}
      </Link>
      <PageHeader
        title="Headline test"
        subtitle="Find out which home-page headline gets more visitors to add something to their bag. The AI writes the new versions; you choose, and the numbers decide."
      />
      {problem ? (
        <p role="alert" className="mb-4 rounded-xl bg-sunken px-4 py-3 text-[14px] text-negative">
          {problem}
        </p>
      ) : null}

      {!current ? (
        <StartCard shopId={shop.id} canEdit={canEdit} vars={vars} brand={brand} hero={bp.hero!} image={image} helperOnline={helper.online} />
      ) : current.status === "writing" ? (
        <Card className="p-6">
          <RefreshEvery seconds={3} />
          <div className="flex items-center gap-3">
            <span aria-hidden className="size-2.5 animate-pulse rounded-full bg-accent motion-reduce:animate-none" />
            <p className="text-[16px] font-semibold" role="status">
              Writing three other headlines for {brand}
            </p>
          </div>
          <p className="mt-2 max-w-2xl text-[14px] text-muted">
            The AI reads the shop&apos;s voice, products and promises, and tries a different idea in each version. This usually takes under a minute.
          </p>
          {!helper.online ? (
            <p className="mt-3 rounded-xl bg-attention-soft px-4 py-3 text-[13px] text-attention">
              The AI helper on your computer is off, so this is waiting. Start it and the versions arrive on their own.
            </p>
          ) : null}
          {canEdit ? (
            <form action={cancelAction.bind(null, shop.id, current.id)} className="mt-4">
              <Button type="submit" variant="quiet">
                Cancel
              </Button>
            </form>
          ) : null}
        </Card>
      ) : current.status === "failed" ? (
        <Card className="p-6">
          <p className="text-[16px] font-semibold">{current.error ?? "The AI couldn't write the versions."}</p>
          {canEdit ? (
            <div className="mt-4 flex gap-2">
              <form action={writeMoreAction.bind(null, shop.id, current.id)}>
                <Button type="submit">Try again</Button>
              </form>
              <form action={cancelAction.bind(null, shop.id, current.id)}>
                <Button type="submit" variant="quiet">
                  Never mind
                </Button>
              </form>
            </div>
          ) : null}
        </Card>
      ) : current.status === "choosing" ? (
        canEdit ? (
          <TestChoose
            vars={vars}
            brand={brand}
            image={image}
            original={current.original}
            candidates={current.candidates}
            start={runTestAction.bind(null, shop.id, current.id)}
            writeMore={writeMoreAction.bind(null, shop.id, current.id)}
            cancel={cancelAction.bind(null, shop.id, current.id)}
          />
        ) : (
          <p className="text-[14px] text-muted">The new versions are ready for someone who can make changes to choose from.</p>
        )
      ) : (
        <TestView
          test={current}
          counts={counts.get(current.id)!}
          shopId={shop.id}
          canEdit={canEdit}
          vars={vars}
          brand={brand}
          image={image}
          preview={preview}
          liveHero={bp.hero!}
        />
      )}

      {past.length ? (
        <section className="mt-10">
          <h2 className="mb-3 text-[15px] font-semibold">Earlier tests</h2>
          <ul className="divide-y divide-line rounded-2xl border border-line bg-raised">
            {past.map((t) => {
              const c = counts.get(t.id);
              return (
                <li key={t.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-[14px]">
                  <span className="w-16 shrink-0 text-muted">{day(t.finishedAt ?? t.createdAt)}</span>
                  <span className="min-w-0 flex-1 truncate">“{t.variant?.headline ?? t.candidates[0]?.headline ?? t.original.headline}”</span>
                  {c ? <span className="text-[13px] text-muted tabular-nums">{n(c.a.visitors + c.b.visitors)} visitors</span> : null}
                  <span className="text-[13px] text-muted">{outcome(t)}</span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </>
  );
}

function outcome(t: AbTest): string {
  if (t.status === "cancelled") return "Cancelled";
  if (t.winner === "b") return t.undoneAt ? "New version won, original put back" : "New version won";
  if (t.winner === "a") return "Kept the original";
  return "Stopped";
}

function StartCard({
  shopId,
  canEdit,
  vars,
  brand,
  hero,
  image,
  helperOnline,
}: {
  shopId: string;
  canEdit: boolean;
  vars: React.CSSProperties;
  brand: string;
  hero: HeroCopy;
  image: { url: string; alt?: string } | null;
  helperOnline: boolean;
}) {
  return (
    <div className="grid items-start gap-8 lg:grid-cols-[5fr_6fr]">
      <div className="flex flex-col gap-4">
        <ol className="flex flex-col gap-4 text-[14px]">
          {[
            ["The AI writes three new versions", "Each tries a different idea, in your shop's voice, using only facts the shop can stand behind."],
            ["You pick one and can change it", "You see it side by side with the original, exactly as shoppers will."],
            ["Half your visitors see it", "Each person always sees the same version. You and your team are never counted."],
            ["Armada tells you which one works", "It counts who adds something to their bag, and says when there's a real winner."],
          ].map(([title, body], i) => (
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
          <form action={startTestAction.bind(null, shopId)}>
            <Button type="submit">Write three new versions</Button>
          </form>
        ) : null}
        {!helperOnline ? (
          <p className="text-[13px] text-attention">The AI helper on your computer is off right now. The versions get written once it&apos;s on.</p>
        ) : null}
      </div>
      <HeroPreview vars={vars} brand={brand} hero={hero} image={image} label="Your headline now" side="a" />
    </div>
  );
}

function TestView({
  test,
  counts,
  shopId,
  canEdit,
  vars,
  brand,
  image,
  preview,
  liveHero,
}: {
  test: AbTest;
  counts: Counts;
  shopId: string;
  canEdit: boolean;
  vars: React.CSSProperties;
  brand: string;
  image: { url: string; alt?: string } | null;
  preview: string;
  liveHero: HeroCopy;
}) {
  const reading = readTest(counts.a, counts.b);
  const variant = test.variant!;
  const running = test.status === "running";
  const practice = counts.a.practice + counts.b.practice;
  const bIsLive = test.winner === "b" && !test.undoneAt;

  return (
    <div className="flex flex-col gap-6">
      {running ? <RefreshEvery seconds={15} /> : null}

      {!running ? (
        <Card className="flex flex-col gap-3 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone="ok">Finished {day(test.finishedAt)}</StatusPill>
          </div>
          <p className="text-[17px] font-semibold" role="status">
            {test.winner === "b"
              ? test.undoneAt
                ? "The original is back."
                : "The new version is now your headline."
              : test.winner === "a"
                ? "You kept the original headline."
                : "Test stopped. Your headline didn't change."}
          </p>
          {canEdit ? (
            <div className="flex flex-wrap gap-2">
              {bIsLive && liveHero.headline === variant.headline ? (
                <form action={undoAction.bind(null, shopId, test.id)}>
                  <Button type="submit" variant="secondary">
                    Put the original back
                  </Button>
                </form>
              ) : null}
              <form action={startTestAction.bind(null, shopId)}>
                <Button type="submit">Test another headline</Button>
              </form>
            </div>
          ) : null}
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-3">
          <HeroPreview vars={vars} brand={brand} hero={test.original} image={image} label="The original" side="a" />
          <a href={`${preview}?version=a`} target="_blank" className="inline-flex min-h-9 items-center gap-1.5 self-start text-[14px] text-accent hover:underline">
            See the original <ExternalLink aria-hidden className="size-3.5" />
          </a>
        </div>
        <div className="flex flex-col gap-3">
          <HeroPreview vars={vars} brand={brand} hero={variant} image={image} label="The new version" side="b" highlight />
          <p className="text-[13px] text-muted">
            <span className="font-medium text-ink">The idea:</span> {variant.idea || "Your own edit"}
          </p>
          <a href={`${preview}?version=b`} target="_blank" className="inline-flex min-h-9 items-center gap-1.5 self-start text-[14px] text-accent hover:underline">
            See the new version <ExternalLink aria-hidden className="size-3.5" />
          </a>
        </div>
      </div>

      <Results reading={reading} practice={practice} />

      {running && canEdit ? (
        <div className="flex flex-col gap-4 rounded-2xl border border-line bg-raised p-5">
          <div className="flex flex-wrap items-center gap-2">
            <form action={winnerAction.bind(null, shopId, test.id, "b")}>
              <Button type="submit" variant={reading.verdict === "b_better" ? "primary" : "secondary"}>
                Make the new version the winner
              </Button>
            </form>
            <form action={winnerAction.bind(null, shopId, test.id, "a")}>
              <Button type="submit" variant={reading.verdict === "a_better" ? "primary" : "secondary"}>
                Keep the original
              </Button>
            </form>
            <form action={cancelAction.bind(null, shopId, test.id)}>
              <Button type="submit" variant="quiet">
                Stop the test
              </Button>
            </form>
          </div>
          {reading.verdict !== "b_better" ? (
            <p className="text-[13px] text-muted">
              You can pick a winner any time. Until the numbers show a clear winner, it&apos;s your call rather than a proven result. Making the new version
              the winner can be undone.
            </p>
          ) : (
            <p className="text-[13px] text-muted">Making the new version the winner puts it on the shop for everyone. You can undo it.</p>
          )}
          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
            <form action={practiceAction.bind(null, shopId, test.id)}>
              <Button type="submit" variant="secondary">
                Add 1,000 practice visitors
              </Button>
            </form>
            {practice ? (
              <form action={clearPracticeAction.bind(null, shopId, test.id)}>
                <Button type="submit" variant="quiet">
                  Clear practice visitors
                </Button>
              </form>
            ) : null}
            <span className="text-[13px] text-muted">Made-up shoppers, to see how results read before real ones arrive.</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** The numbers, in the order a person asks them: who's ahead, how sure, how far along. */
function Results({ reading, practice }: { reading: Reading; practice: number }) {
  const top = Math.max(reading.a.rate, reading.b.rate, 0.0001);
  const early = reading.verdict === "too_early";
  const rows = [
    { side: "a" as const, label: "The original", s: reading.a },
    { side: "b" as const, label: "The new version", s: reading.b },
  ];
  return (
    <section id="results" aria-labelledby="results-heading" className="scroll-mt-6 rounded-2xl border border-line bg-raised p-5 sm:p-6">
      <h2 id="results-heading" className="text-[13px] font-medium text-muted">
        Results
      </h2>
      <p className="mt-1 max-w-3xl text-[18px] leading-snug font-semibold text-balance">{reading.headline}</p>

      {practice ? (
        <p className="mt-3 inline-flex rounded-lg bg-attention-soft px-3 py-1.5 text-[13px] text-attention">
          Includes {n(practice)} practice visitors. They&apos;re made up to show how results read, not real shoppers.
        </p>
      ) : null}

      <div className="mt-5 flex flex-col gap-4">
        {rows.map(({ side, label, s }) => (
          <div key={side} data-side={side} data-visitors={s.visitors} data-adds={s.adds} className="grid gap-1.5 sm:grid-cols-[10rem_1fr_auto] sm:items-center sm:gap-4">
            <span className="text-[14px] font-medium">{label}</span>
            <div className="h-3 overflow-hidden rounded-full bg-sunken" aria-hidden>
              <div className={cx("h-full rounded-full", side === "b" ? "bg-accent" : "bg-muted")} style={{ width: `${(s.rate / top) * 100}%` }} />
            </div>
            <span className="text-[14px] tabular-nums">
              <span className="font-semibold">{pct(s.rate)}</span>
              <span className="text-muted">
                {" "}
                added to bag · {n(s.adds)} of {n(s.visitors)} visitors
              </span>
            </span>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-6 border-t border-line pt-5 md:grid-cols-2">
        <div>
          <p className="text-[14px]">
            Chance the new version is really better:{" "}
            <span className="font-semibold tabular-nums">{early ? "not enough visitors yet" : pct(reading.chanceB)}</span>
          </p>
          <div className="relative mt-3 h-2 rounded-full bg-sunken" aria-hidden>
            <div className="absolute inset-y-0 left-[5%] right-[5%] border-x border-line-strong" />
            {!early ? (
              <div
                className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-raised bg-accent"
                style={{ left: `${reading.chanceB * 100}%` }}
              />
            ) : null}
          </div>
          <div className="mt-1.5 flex justify-between text-[12px] text-muted">
            <span>Original better</span>
            <span>New version better</span>
          </div>
          <p className="mt-2 text-[12px] text-muted">A winner is called at 95% either way.</p>
        </div>
        <div>
          <p className="text-[14px]">
            Visitors so far: <span className="font-semibold tabular-nums">{n(Math.min(reading.a.visitors, reading.b.visitors))}</span> of about{" "}
            <span className="tabular-nums">{n(reading.neededEach)}</span> per version
          </p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-sunken" aria-hidden>
            <div className="h-full rounded-full bg-ink" style={{ width: `${Math.max(reading.progress * 100, reading.progress > 0 ? 1 : 0)}%` }} />
          </div>
          <p className="mt-2 text-[12px] text-muted">That many is enough to reliably spot a difference of one fifth in how often people add to their bag.</p>
        </div>
      </div>
    </section>
  );
}
