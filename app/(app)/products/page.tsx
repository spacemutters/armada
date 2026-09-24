import Link from "next/link";
import { addToProducts } from "./actions";
import { ProductArt } from "@/components/product-art";
import { Button, Card, EmptyState, inputClass, PageHeader, ScoreBadge } from "@/components/ui";
import { cjStatus, describeCjError } from "@/connectors/cj/client";
import { requireSession } from "@/lib/auth/session";
import { formatMoney } from "@/lib/money";
import { findProducts, listProducts, type FoundItem } from "@/lib/products/queries";

export const metadata = { title: "Products" };

// Adding CJ products checks each one with CJ after the page moves on (about two seconds each).
export const maxDuration = 300;

export default async function ProductsPage({ searchParams }: PageProps<"/products">) {
  const session = await requireSession();
  const sp = await searchParams;
  const tab = sp.tab === "find" ? "find" : "yours";
  const q = typeof sp.q === "string" ? sp.q.slice(0, 120) : "";

  const tabs = (
    <div className="mb-5 flex gap-1 rounded-xl border border-line bg-raised p-1 text-[14px]" role="tablist">
      {[
        { key: "yours", label: "Your products", href: "/products" },
        { key: "find", label: "Find products", href: "/products?tab=find" },
      ].map((t) => (
        <Link
          key={t.key}
          href={t.href}
          role="tab"
          aria-selected={tab === t.key}
          className={`flex min-h-9 items-center rounded-lg px-4 ${tab === t.key ? "bg-sunken font-semibold" : "text-muted hover:text-ink"}`}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );

  if (tab === "find") {
    const cj = await cjStatus(session.workspaceId);
    const from = cj.connected && sp.from !== "practice" ? "cj" : "practice";
    let results: FoundItem[] = [];
    let problem: string | null = null;
    if (q) {
      try {
        results = await findProducts(session.workspaceId, q, from);
      } catch (e) {
        problem = describeCjError(e);
      }
    }
    const otherHref = `/products?tab=find${from === "cj" ? "&from=practice" : ""}${q ? `&q=${encodeURIComponent(q)}` : ""}`;
    return (
      <>
        <PageHeader
          title="Products"
          subtitle="Search the supplier catalog. Every result shows its 1 to 100 score, what it costs you delivered, and a suggested price from your pricing rules."
        />
        <div className="flex">{tabs}</div>
        <form className="mb-6 flex max-w-2xl gap-2" action="/products">
          <input type="hidden" name="tab" value="find" />
          {from === "practice" && cj.connected ? <input type="hidden" name="from" value="practice" /> : null}
          <input name="q" defaultValue={q} className={inputClass} placeholder="Try: kitchen knife, water bottle, lamp" aria-label="Search products" />
          <Button type="submit">Search</Button>
        </form>
        <p className="mb-4 max-w-3xl text-[13px] text-muted">
          {from === "cj" ? (
            <>
              Searching CJ Dropshipping&apos;s real catalog. Shipping is estimated in these results. When you add a product, Armada checks its real
              shipping cost and time with CJ.{" "}
              <Link href={otherHref} className="text-accent hover:underline">
                Search the practice catalog instead
              </Link>
            </>
          ) : cj.connected ? (
            <>
              Searching the practice catalog.{" "}
              <Link href={otherHref} className="text-accent hover:underline">
                Search CJ instead
              </Link>
            </>
          ) : (
            <>
              This is the practice catalog: real sample products with simulated costs and stock.{" "}
              <Link href="/settings#connections" className="text-accent hover:underline">
                Connect CJ Dropshipping
              </Link>{" "}
              to search the real catalog with real costs, stock and delivery times.
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
            <div className="sticky bottom-20 mt-6 flex justify-end md:bottom-6">
              <Button type="submit" className="shadow-lg">
                Add chosen to your products
              </Button>
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
                          <span className="block truncate font-medium">{p.title}</span>
                          <span className="block text-[12px] text-muted">
                            {p.category}
                            {p.status === "paused" ? " · paused, supplier out of stock" : ""}
                            {p.unconfirmed ? " · shipping not confirmed by CJ yet" : ""}
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
          <div className="sticky bottom-20 mt-4 flex flex-wrap items-center justify-end gap-2 rounded-2xl border border-line bg-raised/95 p-3 backdrop-blur md:bottom-6">
            <span className="mr-auto px-2 text-[13px] text-muted">Choose products, then:</span>
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
