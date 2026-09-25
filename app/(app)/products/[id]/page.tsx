import { ArrowLeft, Megaphone } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { makeProductAdsAction } from "./actions";
import { PendingButton } from "@/components/fx/pending-button";
import { ProductArt } from "@/components/product-art";
import { buttonClass, ButtonLink, Card, PageHeader, platformName, ScoreBadge, Section, StatusPill } from "@/components/ui";
import { helperStatus } from "@/lib/ai/jobs";
import { requireSession } from "@/lib/auth/session";
import { withWorkspace } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { retailPrice, unitProfitCents } from "@/lib/pricing";
import { readNote } from "@/lib/social/accounts/config";
import { shopsWithProduct, uuid } from "@/lib/social/posts/queries";
import { POSTS_PER_PRODUCT } from "@/lib/social/posts/schema";
import type { CatalogImage, ScoreParts } from "@/lib/types";

export const metadata = { title: "Product" };

interface ProductView {
  id: string;
  title: string;
  description: string;
  bullets: string[];
  images: CatalogImage[];
  category: string;
  costCents: number;
  shipCents: number;
  score: number | null;
  scoreParts: ScoreParts | Record<string, never>;
  status: string;
  source: string | null;
  unconfirmed: boolean;
}

interface ListingView {
  id: string;
  storeId: string;
  storeName: string;
  platform: string;
  mode: string;
  priceCents: number;
  status: string;
}

const PART_NAMES: [keyof Omit<ScoreParts, "penalty" | "reasons">, string][] = [
  ["margin", "Profit"],
  ["demand", "Demand"],
  ["shipping", "Delivery"],
  ["reliability", "Stock"],
  ["competition", "Competition"],
];

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

export default async function ProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const { id } = await params;
  const sp = await searchParams;
  if (!uuid(id)) notFound();

  const data = await withWorkspace(session.workspaceId, async (tx) => {
    const [product] = await tx<ProductView[]>`
      select p.id, p.title, p.description, p.bullets, p.images, p.category, p.cost_cents, p.ship_cents, p.score, p.score_parts, p.status,
             c.source,
             coalesce(c.source in ('cj', 'aliexpress') and coalesce(c.attributes -> c.source ->> 'checked', 'false') <> 'true', false) as unconfirmed
      from armada.products p left join armada.catalog_items c on c.id = p.catalog_item_id
      where p.id = ${id}`;
    if (!product) return null;
    const listings = await tx<ListingView[]>`
      select l.id, l.store_id, s.name as store_name, s.platform, s.mode, l.price_cents, l.status
      from armada.listings l join armada.stores s on s.id = l.store_id
      where l.product_id = ${id} order by l.status, s.name limit 200`;
    return { product, listings };
  });
  if (!data) notFound();
  const { product: p, listings } = data;
  const [shops, helper] = await Promise.all([shopsWithProduct(session.workspaceId, id), helperStatus()]);

  const problem = readNote(one(sp.why), one(sp.ws));
  const canEdit = session.role !== "viewer";
  const delivered = p.costCents + p.shipCents;
  const active = listings.filter((l) => l.status === "active");
  const typical = active.length ? [...active].sort((a, b) => a.priceCents - b.priceCents)[Math.floor(active.length / 2)].priceCents : null;
  const price = typical ?? retailPrice(p.costCents, p.shipCents, "mid");
  const profit = unitProfitCents(price, p.costCents, p.shipCents);
  const parts = "margin" in p.scoreParts ? (p.scoreParts as ScoreParts) : null;
  const gallery = (p.images ?? []).filter((img) => img?.url).slice(0, 6);

  return (
    <>
      <Link href="/products" className="mb-3 inline-flex min-h-11 items-center gap-1.5 text-[14px] text-muted hover:text-ink md:min-h-8">
        <ArrowLeft aria-hidden className="size-4" />
        Products
      </Link>
      <PageHeader
        title={p.title}
        subtitle={[p.category, p.status === "paused" ? "paused: out of stock at the supplier" : null, p.unconfirmed ? "shipping not confirmed by the supplier yet" : null]
          .filter(Boolean)
          .join(" · ")}
      />

      {problem ? (
        <p role="alert" className="mb-4 rounded-xl bg-attention-soft px-4 py-3 text-[14px] text-attention">
          {problem}
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-3">
          <div className="aspect-square overflow-hidden rounded-2xl border border-line bg-sunken">
            <ProductArt images={p.images ?? []} title={p.title} sizes="(min-width: 1024px) 45vw, 100vw" />
          </div>
          {gallery.length > 1 ? (
            <ul className="grid grid-cols-6 gap-2" aria-label="More photos">
              {gallery.map((img, i) => (
                <li key={img.url} className="aspect-square overflow-hidden rounded-lg border border-line bg-sunken">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.url} alt={img.alt ?? `${p.title}, photo ${i + 1}`} loading="lazy" className="h-full w-full object-cover" />
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="flex flex-col gap-4">
          <Card className="p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-line bg-sunken">
                <Megaphone className="size-5" strokeWidth={1.75} />
              </span>
              <div className="min-w-0">
                <h2 className="text-[16px] font-semibold">Make an ad with AI</h2>
                <p className="mt-1 text-[14px] text-muted">
                  {POSTS_PER_PRODUCT} carousel ads about this product, each built on a different idea, with slides drawn in the shop&apos;s look, a caption
                  and hashtags. Only its real facts and photos: no made-up reviews, sales or deadlines. They arrive as drafts on Social posts for you to
                  check before anything goes out.
                </p>
              </div>
            </div>
            {shops.length ? (
              canEdit ? (
                <form action={makeProductAdsAction.bind(null, p.id)} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
                  {shops.length > 1 ? (
                    <label className="flex min-w-0 flex-1 flex-col gap-1 text-[13px] text-muted">
                      In the look of
                      <select name="shop" defaultValue={shops[0].id} className="min-h-11 rounded-xl border border-line bg-raised px-3 text-[15px] text-ink md:min-h-10">
                        {shops.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <>
                      <input type="hidden" name="shop" value={shops[0].id} />
                      <p className="min-w-0 flex-1 text-[13px] text-muted">In the look of {shops[0].name}.</p>
                    </>
                  )}
                  <PendingButton pendingLabel="Starting" beam orb="composing" className={buttonClass("primary", "min-h-11 shrink-0 px-5 md:min-h-10 sm:self-end")}>
                    <Megaphone aria-hidden className="size-4" />
                    Make an ad with AI
                  </PendingButton>
                </form>
              ) : (
                <p className="mt-4 text-[13px] text-muted">Only people who can change things in this team can make ads.</p>
              )
            ) : (
              <div className="mt-4 rounded-xl bg-sunken px-4 py-3 text-[14px]">
                Ads are drawn in a shop&apos;s look and go on its accounts, and this product isn&apos;t in a finished shop yet.{" "}
                <Link href="/builder/new" className="text-accent hover:underline">
                  Build a shop
                </Link>
              </div>
            )}
            {shops.length && !helper.online ? (
              <p className="mt-3 text-[13px] text-attention">The AI helper on your computer is off right now. The ads get written once it&apos;s on.</p>
            ) : null}
          </Card>

          <Card className="p-5 sm:p-6">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-4 text-[14px] sm:grid-cols-3">
              <div>
                <dt className="text-[12px] text-muted">{p.unconfirmed ? "Costs you, about" : "Costs you"}</dt>
                <dd className="tabular mt-0.5 text-[20px] font-semibold tracking-tight">{formatMoney(delivered)}</dd>
                <dd className="text-[12px] text-muted">delivered</dd>
              </div>
              <div>
                <dt className="text-[12px] text-muted">{typical ? "Usual price" : "Suggested price"}</dt>
                <dd className="tabular mt-0.5 text-[20px] font-semibold tracking-tight">{formatMoney(price)}</dd>
                <dd className="text-[12px] text-muted">{typical ? `in ${active.length} ${active.length === 1 ? "store" : "stores"}` : "from your pricing rules"}</dd>
              </div>
              <div>
                <dt className="text-[12px] text-muted">Left per sale</dt>
                <dd className="tabular mt-0.5 text-[20px] font-semibold tracking-tight">{formatMoney(profit)}</dd>
                <dd className="text-[12px] text-muted">after fees and a starting ad cost</dd>
              </div>
            </dl>
            <div className="mt-5 border-t border-line pt-4">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[14px] font-medium">Score</span>
                <ScoreBadge score={p.score} />
              </div>
              {parts ? (
                <ul className="mt-3 flex flex-col gap-2">
                  {PART_NAMES.map(([key, name]) => (
                    <li key={key} className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-baseline gap-3 text-[13px]">
                      <span className="text-muted">{name}</span>
                      <span>
                        {parts[key].note}
                        {parts[key].measured ? "" : <span className="text-muted"> (estimate)</span>}
                      </span>
                    </li>
                  ))}
                  {parts.penalty.reasons.map((r) => (
                    <li key={r} className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-baseline gap-3 text-[13px]">
                      <span className="text-muted">Watch out</span>
                      <span className="text-attention">{r}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            {canEdit ? (
              <div className="mt-5 flex flex-wrap gap-2 border-t border-line pt-4">
                <ButtonLink href={`/products/list?ids=${p.id}`} variant="secondary" className="min-h-11 md:min-h-9">
                  List in stores…
                </ButtonLink>
                <ButtonLink href={`/products/reprice?ids=${p.id}`} variant="secondary" className="min-h-11 md:min-h-9">
                  Change price…
                </ButtonLink>
              </div>
            ) : null}
          </Card>
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <Section title="Description">
          {p.bullets?.length ? (
            <ul className="mb-3 flex flex-col gap-1.5 text-[14px]">
              {p.bullets.map((b) => (
                <li key={b} className="flex gap-2">
                  <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-muted" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="max-w-[65ch] text-[14px] leading-relaxed whitespace-pre-line text-muted">{p.description || "No description yet."}</p>
        </Section>
        <Section title="Where it's listed" action={<span className="text-[13px] text-muted">{active.length} live</span>}>
          {listings.length ? (
            <ul className="flex flex-col divide-y divide-line">
              {listings.map((l) => (
                <li key={l.id} className="flex min-h-11 items-center justify-between gap-3 py-2 text-[14px]">
                  <Link href={`/stores/${l.storeId}`} className="min-w-0 truncate hover:underline">
                    {l.storeName}
                    <span className="text-muted">
                      {" "}
                      · {platformName(l.platform)}
                      {l.mode === "practice" ? " practice" : ""}
                    </span>
                  </Link>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="tabular">{formatMoney(l.priceCents)}</span>
                    {l.status !== "active" ? <StatusPill tone="off">{l.status === "hidden" ? "Hidden" : l.status}</StatusPill> : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[14px] text-muted">Not in any store yet. Use List in stores to put it in as many as you like.</p>
          )}
        </Section>
      </div>
    </>
  );
}
