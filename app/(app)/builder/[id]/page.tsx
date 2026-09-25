import { ExternalLink } from "lucide-react";
import { createElement } from "react";
import { notFound } from "next/navigation";
import { buildAgain, chooseProducts, letAiPick, putInPracticeStore } from "./actions";
import { launchShop } from "./launch-actions";
import { LaunchSection } from "@/components/launch/launch-section";
import { launchable, launchView } from "@/lib/launch/run";
import { iconFor, ProductArt } from "@/components/product-art";
import { PendingButton } from "@/components/fx/pending-button";
import { ProductChooser, type ChooserCard } from "@/components/product-chooser";
import { ShopImages } from "@/components/shop-images";
import { BuildSteps, ShopProgress } from "@/components/shop-progress";
import { Button, buttonClass, ButtonLink, Card, PageHeader, ScoreBadge, Section, StatusPill } from "@/components/ui";
import { testsForShop } from "@/lib/abtest/tests";
import { helperStatus } from "@/lib/ai/jobs";
import { requireSession } from "@/lib/auth/session";
import { contrast } from "@/lib/color";
import { formatMoney } from "@/lib/money";
import { unitProfitCents } from "@/lib/pricing";
import { getShop, getShopProducts } from "@/lib/shops/queries";
import { googleFontsHref } from "@/lib/shops/style";
import { chooseCount, type ShopRow } from "@/lib/shops/types";

export const metadata = { title: "Shop" };

// Choosing products runs CJ's shipping check for the chosen ones after the page is sent back.
export const maxDuration = 300;

const SWATCH_NAMES: Record<string, string> = {
  background: "Page",
  surface: "Cards",
  ink: "Text",
  muted: "Quiet text",
  accent: "Buttons and links",
  accentInk: "Button text",
};

/** The owner's step: the AI proposed twice the products, and the build waits for them to choose. */
function ChooseProducts({ shop, problem }: { shop: ShopRow; problem: string | null }) {
  const bp = shop.blueprint;
  const proposals = [...(bp.proposals ?? [])].sort((a, b) => a.rank - b.rank);
  const need = chooseCount(shop.brief.productCount, proposals.length);
  const titles = new Map((bp.collections ?? []).map((c) => [c.handle, c.title]));
  const cards: ChooserCard[] = proposals.map((p) => ({
    id: p.id,
    title: p.title,
    why: p.why,
    collection: titles.get(p.collection) ?? "",
    priceCents: p.priceCents,
    priceEstimated: p.priceEstimated,
    score: p.score,
    reasons: p.reasons,
    image: p.image,
    icon: p.icon,
    practice: Boolean(p.imagined),
  }));
  const palette = bp.theme?.palette;
  return (
    <>
      <PageHeader
        title={bp.brand?.name ? `Choose ${need} products for ${bp.brand.name}` : `Choose ${need} products`}
        subtitle={`The AI found ${proposals.length} that fit “${shop.niche}”. Tap the ${need} you want, and the rest of the shop builds by itself.`}
      />
      <BuildSteps progress={shop.progress} className="mb-6" />
      {problem ? (
        <p role="alert" className="mb-5 max-w-3xl rounded-xl bg-attention-soft px-4 py-3 text-[13px] text-attention">
          {problem}
        </p>
      ) : null}
      <ProductChooser
        need={need}
        cards={cards}
        artColors={palette ? { bg: palette.surface, fg: palette.accent } : undefined}
        choose={chooseProducts.bind(null, shop.id)}
        aiPick={letAiPick.bind(null, shop.id)}
      />
    </>
  );
}

export default async function ShopPage({ params, searchParams }: PageProps<"/builder/[id]">) {
  const session = await requireSession();
  const { id } = await params;
  const shop = await getShop(session.workspaceId, id);
  if (!shop) notFound();
  const bp = shop.blueprint;
  const { problem } = await searchParams;

  if (shop.status === "choosing") {
    return <ChooseProducts shop={shop} problem={typeof problem === "string" ? problem.slice(0, 300) : null} />;
  }

  if (shop.status === "building" || shop.status === "failed" || shop.status === "draft") {
    const helper = await helperStatus();
    return (
      <>
        <PageHeader
          title={shop.status === "failed" ? "This build stopped" : "Building your shop"}
          subtitle={`“${shop.niche}”`}
          actions={
            shop.status === "failed" ? (
              <form action={buildAgain.bind(null, shop.id)}>
                <PendingButton pendingLabel="Starting again…" className={buttonClass("primary")}>
                  Build it again
                </PendingButton>
              </form>
            ) : null
          }
        />
        <div className="max-w-2xl">
          <ShopProgress
            shopId={shop.id}
            initial={{ status: shop.status, progress: shop.progress, error: shop.error, brandName: bp.brand?.name ?? null, helperOnline: helper.online }}
          />
        </div>
      </>
    );
  }

  const [products, tests, launch] = await Promise.all([
    getShopProducts(session.workspaceId, (bp.products ?? []).map((p) => p.productId)),
    testsForShop(session.workspaceId, shop.id),
    launchView(session.workspaceId, shop.id),
  ]);
  const canLaunch = session.role !== "viewer" && launchable(shop);
  const launchAction = launchShop.bind(null, shop.id);
  const openTest = tests.find((t) => ["writing", "choosing", "running"].includes(t.status));
  const byId = new Map(products.map((p) => [p.id, p]));
  const palette = bp.theme!.palette;
  const fonts = bp.theme!.fonts;
  const monogram = iconFor(bp.brand?.monogramIcon);
  const previewHref = `/s/${shop.slug}`;
  const practiceCount = (bp.products ?? []).filter((p) => p.imagined).length;
  const artVars = { "--art-bg": palette.surface, "--art-fg": palette.accent } as React.CSSProperties;

  return (
    <>
      <link rel="stylesheet" href={googleFontsHref(fonts.display, fonts.body)} precedence="default" />
      <PageHeader
        title={bp.brand?.name ?? "Your shop"}
        subtitle={bp.brand?.tagline}
        actions={
          <>
            <ButtonLink href={previewHref} target="_blank" variant="secondary">
              Open the shop <ExternalLink aria-hidden className="size-4" />
            </ButtonLink>
            {shop.status === "published" && shop.storeId ? (
              <ButtonLink href={`/stores/${shop.storeId}`} variant="secondary">
                Go to its store
              </ButtonLink>
            ) : (
              <form action={putInPracticeStore.bind(null, shop.id)}>
                <PendingButton pendingLabel="Setting up the store…" variant="secondary" className={buttonClass("secondary")}>
                  Put it in a practice store
                </PendingButton>
              </form>
            )}
            {!launch && canLaunch ? (
              <form action={launchAction}>
                <PendingButton pendingLabel="Launching…" className={buttonClass("primary")}>
                  Launch
                </PendingButton>
              </form>
            ) : null}
          </>
        }
      />

      <div className="mb-6 flex flex-wrap items-center gap-2 text-[13px] text-muted">
        <StatusPill tone="ok">{shop.status === "published" ? "In a practice store" : "Ready"}</StatusPill>
        <span>
          {(bp.products ?? []).length} products
          {bp.choice && bp.choice.by !== "all" ? ` (${bp.choice.by === "you" ? "you chose them" : "the AI picked them"} from ${bp.choice.offered})` : ""} ·{" "}
          {(bp.collections ?? []).length} collections · built from “{shop.niche}”
        </span>
      </div>

      <LaunchSection
        brand={bp.brand?.name ?? shop.niche}
        practice={shop.brief?.source === "practice"}
        view={launch}
        launch={launchAction}
        canLaunch={canLaunch}
        problem={typeof problem === "string" ? problem.slice(0, 300) : null}
      />

      <Card className="mb-6 flex flex-wrap items-center gap-4 p-5">
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold">Headline test</h2>
          <p className="mt-1 max-w-2xl text-[13px] text-muted">
            {openTest?.status === "running"
              ? `Testing “${openTest.variant?.headline}” against your current headline.`
              : openTest
                ? "New versions of your headline are being written or waiting for you to choose."
                : "The AI writes new versions of your home-page headline, and half your visitors see one. Armada tells you which gets more people to add to their bag."}
          </p>
        </div>
        <ButtonLink href={`/builder/${shop.id}/test`} variant={openTest ? "primary" : "secondary"}>
          {openTest ? "See the test" : "Test your headline"}
        </ButtonLink>
      </Card>

      {practiceCount > 0 ? (
        <p className="mb-6 max-w-3xl rounded-xl bg-attention-soft px-4 py-3 text-[13px] text-attention">
          {practiceCount} of these products are practice items the AI suggested because the practice catalog had no close match. They show as
          illustrations, not photos. Once your supplier account is connected, the builder uses real supplier products with real photos.
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Section title="The brand" className="lg:col-span-1">
          <div className="flex items-center gap-3">
            <span className="flex size-12 items-center justify-center rounded-2xl" style={{ background: palette.accent, color: palette.accentInk }}>
              {createElement(monogram, { "aria-hidden": true, className: "size-6" })}
            </span>
            <div className="text-[22px]" style={{ fontFamily: `'${fonts.display}', serif`, color: "var(--ink)" }}>
              {bp.brand?.name}
            </div>
          </div>
          <dl className="mt-4 flex flex-col gap-3 text-[14px]">
            <div>
              <dt className="text-[13px] text-muted">Voice</dt>
              <dd>{bp.brand?.voice}</dd>
            </div>
            <div>
              <dt className="text-[13px] text-muted">Who it&apos;s for</dt>
              <dd>{bp.brand?.audience}</dd>
            </div>
            <div>
              <dt className="text-[13px] text-muted">Other names it considered</dt>
              <dd>{bp.brand?.alternativeNames.join(", ")}</dd>
            </div>
          </dl>
        </Section>

        <Section title="The look" className="lg:col-span-2">
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {(Object.keys(SWATCH_NAMES) as (keyof typeof palette)[]).map((k) => (
              <li key={k} className="flex items-center gap-3">
                <span className="size-10 shrink-0 rounded-xl border border-line" style={{ background: palette[k] }} />
                <span className="min-w-0">
                  <span className="block text-[13px]">{SWATCH_NAMES[k]}</span>
                  <span className="tabular block text-[12px] text-muted">{palette[k]}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-line p-4" style={{ background: palette.background, color: palette.ink }}>
              <div style={{ fontFamily: `'${fonts.display}', serif` }} className="text-[24px] leading-tight">
                {bp.hero?.headline}
              </div>
              <p style={{ fontFamily: `'${fonts.body}', sans-serif`, color: palette.muted }} className="mt-2 text-[14px]">
                {bp.hero?.subhead}
              </p>
              <span className="mt-3 inline-block rounded-lg px-3 py-1.5 text-[13px]" style={{ background: palette.accent, color: palette.accentInk, fontFamily: `'${fonts.body}', sans-serif` }}>
                {bp.hero?.cta}
              </span>
            </div>
            <div className="text-[13px] text-muted">
              <p>
                Headings in <span className="text-ink">{fonts.display}</span>, text in <span className="text-ink">{fonts.body}</span>.
              </p>
              <p className="mt-2">
                Text reads at <span className="tabular text-ink">{contrast(palette.ink, palette.background).toFixed(1)}:1</span>, quiet text at{" "}
                <span className="tabular text-ink">{contrast(palette.muted, palette.background).toFixed(1)}:1</span>, and buttons at{" "}
                <span className="tabular text-ink">{contrast(palette.accentInk, palette.accent).toFixed(1)}:1</span>.
              </p>
              {bp.theme?.contrastFixes.length ? (
                <p className="mt-2">Armada adjusted {bp.theme.contrastFixes.length === 1 ? "one color" : `${bp.theme.contrastFixes.length} colors`} so every line stays readable.</p>
              ) : null}
            </div>
          </div>
        </Section>
      </div>

      <div className="mt-4">
        <ShopImages workspaceId={session.workspaceId} shopId={shop.id} canEdit={session.role !== "viewer"} />
      </div>

      <div className="mt-4 flex flex-col gap-4">
        {(bp.collections ?? []).map((col) => (
          <Section key={col.handle} title={col.title} action={<span className="text-[13px] text-muted">{col.productIds.length} products</span>}>
            <p className="-mt-2 mb-4 text-[13px] text-muted">{col.description}</p>
            <ul className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
              {col.productIds.map((pid) => {
                const p = byId.get(pid);
                const ref = bp.products?.find((x) => x.productId === pid);
                if (!p || !ref) return null;
                const profit = unitProfitCents(ref.priceCents, p.costCents, p.shipCents);
                return (
                  <li key={pid} className="flex flex-col gap-2">
                    <div className="aspect-square overflow-hidden rounded-xl bg-sunken" style={artVars}>
                      <ProductArt images={p.images} icon={p.art?.icon} title={p.title} />
                    </div>
                    <div className="text-[14px] leading-snug font-medium">{p.title}</div>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="tabular font-semibold">{formatMoney(ref.priceCents)}</span>
                      <ScoreBadge score={p.score} />
                    </div>
                    <div className="tabular text-[12px] text-muted">
                      Costs {formatMoney(p.costCents + p.shipCents)} delivered · keeps about {formatMoney(profit)} after fees and ads
                      {ref.imagined ? " · practice item" : ""}
                    </div>
                    {"reasons" in p.scoreParts && p.scoreParts.reasons.length ? (
                      <div className="text-[12px] text-muted">{p.scoreParts.reasons.join(", ")}</div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </Section>
        ))}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Section title="Pages">
          <ul className="flex flex-col divide-y divide-line">
            {[
              { name: "About", href: `${previewHref}/pages/about`, note: `${bp.pages?.about.split(/\s+/).length ?? 0} words` },
              { name: "Questions and answers", href: `${previewHref}/pages/faq`, note: `${bp.pages?.faq.length ?? 0} answers` },
              { name: "Shipping and returns", href: `${previewHref}/pages/shipping`, note: `${bp.facts?.deliveryMin}-${bp.facts?.deliveryMax} business days, ${bp.facts?.returnDays}-day returns` },
              { name: "Contact", href: `${previewHref}/pages/contact`, note: "Uses your support email" },
            ].map((pg) => (
              <li key={pg.name} className="flex items-center justify-between gap-3 py-2.5">
                <a href={pg.href} target="_blank" className="font-medium text-accent hover:underline">
                  {pg.name}
                </a>
                <span className="text-right text-[13px] text-muted">{pg.note}</span>
              </li>
            ))}
          </ul>
        </Section>
        <Section title="Policies">
          <p className="text-[13px] text-muted">
            A refund policy and a shipping policy are drafted from the facts above. They are drafts: read them before a real store goes live, and use
            Shopify&apos;s own generator for the privacy policy and terms.
          </p>
          <ul className="mt-3 flex flex-col divide-y divide-line">
            <li className="flex items-center justify-between py-2.5">
              <a href={`${previewHref}/policies/refund`} target="_blank" className="font-medium text-accent hover:underline">
                Refund policy
              </a>
              <span className="text-[13px] text-muted">Draft</span>
            </li>
            <li className="flex items-center justify-between py-2.5">
              <a href={`${previewHref}/policies/shipping`} target="_blank" className="font-medium text-accent hover:underline">
                Shipping policy
              </a>
              <span className="text-[13px] text-muted">Draft</span>
            </li>
          </ul>
        </Section>
      </div>

      <Card className="mt-4 p-5">
        <h2 className="text-[15px] font-semibold">Publish to Shopify</h2>
        <p className="mt-1 max-w-2xl text-[13px] text-muted">
          This needs a connected Shopify store, which needs your Shopify partner account first (step 4 in your sign-up list). Until then, the practice
          store runs everything else exactly as a real one would.
        </p>
        <Button className="mt-3" variant="secondary" disabled>
          Publish to Shopify
        </Button>
      </Card>
    </>
  );
}
