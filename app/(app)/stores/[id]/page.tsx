import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductArt } from "@/components/product-art";
import { Card, PageHeader, platformName, ScoreBadge, Section, Stat, StatusPill, type Tone } from "@/components/ui";
import { chooseIconAction, makeIconAction } from "./icon-actions";
import { RefreshEvery } from "@/components/refresh-every";
import { StoreIcon } from "@/components/store-icon";
import { requireSession } from "@/lib/auth/session";
import { storeDetail } from "@/lib/fleet/queries";
import { formatMoney } from "@/lib/money";
import { unitProfitCents } from "@/lib/pricing";
import { ART_ICONS } from "@/lib/shops/style";
import { iconInProgress } from "@/lib/stores/icon";

export const metadata = { title: "Store" };

const ORDER_TONE: Record<string, { tone: Tone; label: string }> = {
  new: { tone: "working", label: "New" },
  ordered: { tone: "working", label: "With supplier" },
  shipped: { tone: "ok", label: "Shipped" },
  delivered: { tone: "ok", label: "Delivered" },
  problem: { tone: "attention", label: "Stuck" },
  refunded: { tone: "off", label: "Refunded" },
  cancelled: { tone: "off", label: "Cancelled" },
};

export default async function StorePage({ params }: PageProps<"/stores/[id]">) {
  const session = await requireSession();
  const { id } = await params;
  const data = await storeDetail(session.workspaceId, id);
  if (!data) notFound();
  const { store, listings, orders, daily } = data;
  const week = daily.slice(-7).reduce((n, d) => n + d.salesCents, 0);
  const month = daily.reduce((n, d) => n + d.salesCents, 0);
  const max = Math.max(1, ...daily.map((d) => d.salesCents));
  const health = store.health as { note?: string };
  const shopId = (store.meta as { shopId?: string }).shopId;
  const making = await iconInProgress(session.workspaceId, store.id);

  return (
    <>
      <PageHeader
        title={store.name}
        subtitle={
          <>
            {platformName(store.platform, "long")}
            {store.mode === "practice" ? " · practice" : ""}
            {store.group ? ` · ${store.group}` : ""}
            {store.domain ? ` · ${store.domain}` : ""}
          </>
        }
        actions={
          <StatusPill tone={store.status === "needs_attention" ? "attention" : store.status === "connected" ? "ok" : "error"}>
            {store.status === "needs_attention" ? "Needs you" : store.status === "connected" ? "Connected" : "Disconnected"}
          </StatusPill>
        }
      />

      {health?.note ? <p className="mb-4 max-w-3xl rounded-xl bg-attention-soft px-4 py-3 text-[14px] text-attention">{health.note}</p> : null}
      {shopId ? (
        <p className="mb-4 text-[14px] text-muted">
          Built with the shop builder.{" "}
          <Link href={`/builder/${shopId}`} className="text-accent hover:underline">
            See how it was built
          </Link>
        </p>
      ) : null}

      <Card className="mb-4 p-5">
        {making ? <RefreshEvery seconds={3} /> : null}
        <StoreIcon
          icon={store.icon}
          icons={ART_ICONS}
          making={making}
          canEdit={session.role !== "viewer"}
          choose={chooseIconAction.bind(null, store.id)}
          make={makeIconAction.bind(null, store.id)}
        />
      </Card>

      <Card className="mb-4 p-6">
        <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
          <Stat label="Sold in 7 days" value={formatMoney(week, "USD", { whole: true })} />
          <Stat label="Sold in 30 days" value={formatMoney(month, "USD", { whole: true })} />
          <Stat label="Live products" value={listings.filter((l) => l.status === "active").length} hint={`${listings.length} listed in total`} />
          <Stat label="Recent orders" value={orders.length} hint="Last 25 shown below" />
        </div>
        <div className="mt-6 flex h-24 items-end gap-1" role="img" aria-label="Daily sales for the last 30 days">
          {/* The month's bars rise once, left to right, when the store opens: the page's one entrance. */}
          {daily.map((d, i) => (
            <div
              key={d.day}
              title={`${d.day}: ${formatMoney(d.salesCents)}`}
              className="flex-1 origin-bottom animate-[armada-rise_520ms_cubic-bezier(0.2,0.7,0.2,1)_both] rounded-t-[3px] bg-line-strong"
              style={{ height: `${Math.max(2, (d.salesCents / max) * 100)}%`, animationDelay: `${i * 12}ms` }}
            />
          ))}
        </div>
        <div className="mt-1 flex justify-between text-[12px] text-muted">
          <span>30 days ago</span>
          <span>Today</span>
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Section title="Products in this store">
          {listings.length ? (
            <ul className="flex flex-col divide-y divide-line">
              {listings.map((l) => (
                <li key={l.id} className="flex items-center gap-3 py-2.5">
                  <span className="size-10 shrink-0 overflow-hidden rounded-lg bg-sunken" style={{ "--art-bg": "var(--sunken)", "--art-fg": "var(--muted)" } as React.CSSProperties}>
                    <ProductArt images={l.images ?? []} icon={l.art?.icon} title={l.title} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{l.title}</span>
                    <span className="tabular block text-[12px] text-muted">
                      {formatMoney(l.priceCents)} · keeps {formatMoney(unitProfitCents(l.priceCents, l.costCents, l.shipCents, store.platform))} a sale
                      {l.status === "hidden" ? " · hidden, out of stock at the supplier" : ""}
                    </span>
                  </span>
                  <ScoreBadge score={l.score} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted">No products listed yet.</p>
          )}
        </Section>
        <Section title="Recent orders" action={<Link href="/orders" className="text-[13px] text-accent hover:underline">All orders</Link>}>
          {orders.length ? (
            <ul className="flex flex-col divide-y divide-line">
              {orders.map((o) => {
                const st = ORDER_TONE[o.status] ?? ORDER_TONE.new;
                return (
                  <li key={o.id} className="flex items-center gap-3 py-2.5">
                    <span className="tabular w-16 shrink-0 text-muted">{o.externalId}</span>
                    <span className="min-w-0 flex-1 text-[13px] text-muted">
                      {new Date(o.placedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · {o.items}{" "}
                      {o.items === 1 ? "item" : "items"}
                      {o.problem ? ` · ${o.problem}` : ""}
                    </span>
                    <span className="tabular font-medium">{formatMoney(o.totalCents)}</span>
                    <StatusPill tone={st.tone}>{st.label}</StatusPill>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-muted">No orders yet.</p>
          )}
        </Section>
      </div>
    </>
  );
}
