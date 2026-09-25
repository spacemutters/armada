import Link from "next/link";
import { addToProducts } from "./actions";
import { SearchBox } from "./search-box";
import { SegmentedNav } from "@/components/fx/glide";
import { PendingButton } from "@/components/fx/pending-button";
import { ProductArt } from "@/components/product-art";
import { buttonClass, Button, Card, EmptyState, PageHeader, ScoreBadge } from "@/components/ui";
import { aliexpressStatus, describeAliexpressError } from "@/connectors/aliexpress/client";
import { cjStatus, describeCjError } from "@/connectors/cj/client";
import { requireSession } from "@/lib/auth/session";
import { formatMoney } from "@/lib/money";
import { findProducts, listProducts, type FindSource, type FoundItem } from "@/lib/products/queries";

export const metadata = { title: "Products" };

// Adding CJ or AliExpress products checks each one with the supplier after the page moves on (about two seconds each).
export const maxDuration = 300;

export default async function ProductsPage({ searchParams }: PageProps<"/products">) {
  const session = await requireSession();
  const sp = await searchParams;
  const tab = sp.tab === "find" ? "find" : "yours";
  const q = typeof sp.q === "string" ? sp.q.slice(0, 120) : "";

  const tabs = (
    <SegmentedNav
      label="Products"
      active={tab}
      className="mb-5"
      items={[
        { key: "yours", label: "Your products", href: "/products" },
        { key: "find", label: "Find products", href: "/products?tab=find" },
      ]}
    />
  );

  if (tab === "find") {
    const [cj, ali] = await Promise.all([cjStatus(session.workspaceId), aliexpressStatus(session.workspaceId)]);
    // Connected suppliers first, then the practice catalog, which is always there.
    const sources: { key: FindSource; label: string }[] = [
      ...(cj.connected ? [{ key: "cj" as const, label: "CJ Dropshipping" }] : []),
      ...(ali.connected ? [{ key: "aliexpress" as const, label: "AliExpress" }] : []),
      { key: "practice", label: "Practice catalog" },
    ];
    const from = sources.find((x) => x.key === sp.from)?.key ?? sources[0].key;
    let results: FoundItem[] = [];
    let problem: string | null = null;
    if (q) {
      try {
        results = await findProducts(session.workspaceId, q, from);
      } catch (e) {
        problem = from === "aliexpress" ? describeAliexpressError(e) : describeCjError(e);
      }
    }
    const hrefFor = (key: FindSource) => `/products?tab=find&from=${key}${q ? `&q=${encodeURIComponent(q)}` : ""}`;
    const supplierName = from === "cj" ? "CJ Dropshipping" : "AliExpress";
    return (
      <>
        <PageHeader
          title="Products"
          subtitle="Search the supplier catalog. Every result shows its 1 to 100 score, what it costs you delivered, and a suggested price from your pricing rules."
        />
        <div className="flex">{tabs}</div>
        {sources.length > 1 ? (
          <div className="flex">
            <SegmentedNav label="Search in" active={from} className="mb-4" items={sources.map((x) => ({ key: x.key, label: x.label, href: hrefFor(x.key) }))} />
          </div>
        ) : null}
        <SearchBox q={q} from={from} />
        <p className="mb-4 max-w-3xl text-[13px] text-muted">
          {from !== "practice" ? (
            <>
              Searching {supplierName}&apos;s real catalog. Shipping is estimated in these results. When you add a product, Armada checks its real
              shipping cost and time with {from === "cj" ? "CJ" : "AliExpress"}.
            </>
          ) : sources.length > 1 ? (
            <>Searching the practice catalog: real sample products with simulated costs and stock.</>
          ) : (
            <>
              This is the practice catalog: real sample products with simulated costs and stock.{" "}
              <Link href="/connections" className="text-accent hover:underline">
                Connect CJ Dropshipping or AliExpress
              </Link>{" "}
              to search a real catalog with real costs, stock and delivery times.
            </>
          )}
        </p>
        {problem ? (
          <p role="alert" className="mb-4 rounded-xl bg-sunken px-4 py-3 text-[14px] text-negative">
            {problem}
          </p>
        ) : !q ? null : results.length === 0 ? (
          <EmptyState title="Nothing matched" body="Try plainer words, like “bottle” instead of “hydration solution”." />
        ) : (
          <form action={addToProducts}>
            <ul className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
              {results.map((r) => (
                <li key={r.id}>
                  <label className="flex h-full cursor-pointer flex-col gap-2 rounded-2xl border border-line bg-raised p-3 has-[:checked]:border-accent">
                    <div className="aspect-square overflow-hidden rounded-xl bg-sunken">
                      <ProductArt images={r.images} title={r.title} />
                    </div>
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-[14px] leading-snug font-medium">{r.title}</span>
                      <input type="checkbox" name="catalogIds" value={r.id} disabled={r.alreadyAdded} className="mt-0.5 size-5 shrink-0 accent-[var(--accent)]" aria-label={`Choose ${r.title}`} />
                    </div>
                    <ScoreBadge score={r.score} />
                    <div className="tabular text-[12px] text-muted">
                      {r.shippingKnown ? "Costs" : "Costs about"} {formatMoney(r.costCents + r.shipCents)} delivered · sells around{" "}
                      {formatMoney(r.suggestedPriceCents)}
                      {r.shipDaysMax ? ` · up to ${r.shipDaysMax} days` : ""}
                      {r.shippingKnown ? "" : " · shipping estimated"}
                    </div>
                    <div className="text-[12px] text-muted">{r.alreadyAdded ? "Already in your products" : r.reasons.join(", ")}</div>
                  </label>
                </li>
              ))}
            </ul>
            <div className="sticky bottom-[calc(88px+env(safe-area-inset-bottom))] mt-6 flex justify-end md:bottom-6">
              <PendingButton pendingLabel="Adding…" className={buttonClass("primary", "shadow-lg")}>
                Add chosen to your products
              </PendingButton>
            </div>
          </form>
        )}
      </>
    );
  }

  const products = await listProducts(session.workspaceId);
  const added = Number(sp.added);
  return (
    <>
      <PageHeader title="Products" subtitle="One catalog for every store. Choose products, then list them in any number of stores or change their prices everywhere at once." />
      <div className="flex">{tabs}</div>
      {added > 0 ? <p className="mb-4 rounded-xl bg-accent-soft px-4 py-3 text-[14px]">Added {added} {added === 1 ? "product" : "products"}. Choose them below to list them in stores.</p> : null}
      {products.length === 0 ? (
        <EmptyState
          title="No products yet"
          body="Find products in the supplier catalog, or build a shop and its products arrive here on their own."
          action={
            <Link href="/products?tab=find" className="text-accent hover:underline">
              Find products
            </Link>
          }
        />
      ) : (
        <form>
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-[14px]">
              <thead className="text-[12px] text-muted">
                <tr className="border-b border-line">
                  <th className="w-10 px-4 py-3">
                    <span className="sr-only">Choose</span>
                  </th>
                  <th className="px-2 py-3 font-medium">Product</th>
                  <th className="px-3 py-3 font-medium">Score</th>
                  <th className="px-3 py-3 text-right font-medium">Costs you</th>
                  <th className="px-3 py-3 text-right font-medium">Usual price</th>
                  <th className="px-3 py-3 text-right font-medium">Sold, 30 days</th>
                  <th className="px-4 py-3 text-right font-medium">In stores</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.id} className="border-b border-line last:border-0 hover:bg-sunken">
                    <td className="px-4 py-2.5">
                      <input type="checkbox" name="ids" value={p.id} className="size-5 accent-[var(--accent)]" aria-label={`Choose ${p.title}`} />
                    </td>
                    <td className="px-2 py-2.5">
                      <div className="flex items-center gap-3">
                        <span className="size-10 shrink-0 overflow-hidden rounded-lg bg-sunken">
                          <ProductArt images={p.images} title={p.title} />
                        </span>
                        <span className="min-w-0">
                          <Link href={`/products/${p.id}`} className="block truncate font-medium hover:underline">
                            {p.title}
                          </Link>
                          <span className="block text-[12px] text-muted">
                            {p.category}
                            {p.status === "paused" ? " · paused, supplier out of stock" : ""}
                            {p.unconfirmed ? " · shipping not confirmed by the supplier yet" : ""}
                          </span>
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <ScoreBadge score={p.score} />
                    </td>
                    <td className="tabular px-3 py-2.5 text-right">{formatMoney(p.costCents + p.shipCents)}</td>
                    <td className="tabular px-3 py-2.5 text-right">{p.typicalPriceCents ? formatMoney(p.typicalPriceCents) : "Not listed"}</td>
                    <td className="tabular px-3 py-2.5 text-right">{p.unitsSold30}</td>
                    <td className="tabular px-4 py-2.5 text-right">
                      {p.activeListings}
                      {p.hiddenListings ? <span className="text-muted"> +{p.hiddenListings} hidden</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <div className="glass sticky bottom-[calc(88px+env(safe-area-inset-bottom))] mt-4 flex flex-wrap items-center justify-end gap-2 rounded-2xl p-3 md:bottom-6">
            <span className="mr-auto px-2 text-[13px] text-ink">Choose products, then:</span>
            <Button type="submit" formAction="/products/list" formMethod="get" variant="secondary">
              List in stores…
            </Button>
            <Button type="submit" formAction="/products/reprice" formMethod="get" variant="secondary">
              Change prices…
            </Button>
          </div>
        </form>
      )}
    </>
  );
}
