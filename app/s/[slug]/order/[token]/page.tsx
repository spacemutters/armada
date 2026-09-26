import { notFound } from "next/navigation";
import { BackToShop } from "@/components/storefront/back-to-shop";
import { formatMoney } from "@/lib/money";
import { shopperOrder, type OrderStep } from "@/lib/shops/order-status";
import { loadStorefront } from "@/lib/shops/storefront";

// A shopper's own order: where it stands, and the tracking link once it has shipped.

export const metadata = { title: "Your order", robots: { index: false } };
export const dynamic = "force-dynamic";

const STEPS: { key: OrderStep; label: string }[] = [
  { key: "paid", label: "Paid" },
  { key: "ordered", label: "Being packed" },
  { key: "shipped", label: "On its way" },
  { key: "delivered", label: "Delivered" },
];

export default async function OrderPage({ params }: { params: Promise<{ slug: string; token: string }> }) {
  const { slug, token } = await params;
  const data = await loadStorefront(slug);
  if (!data) notFound();
  const order = await shopperOrder(data.shop.id, token);
  if (!order) notFound();
  const reached = STEPS.findIndex((s) => s.key === order.step);
  return (
    <section className="sf-wrap pt-[clamp(2.5rem,6vw,5rem)] pb-[var(--s-section)]">
      <h1 className="sf-display" style={{ fontSize: "clamp(2.2rem, 1rem + 3.5vw, 4rem)" }}>
        Your order
      </h1>
      <p className="sf-muted mt-3 text-[15px]">
        {order.placedAt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })} · {formatMoney(order.totalCents)}
      </p>

      <ol className="mt-10 flex flex-col gap-4" aria-label="Where your order is">
        {STEPS.map((s, i) => {
          const done = i <= reached;
          return (
            <li key={s.key} className="flex items-center gap-4" aria-current={i === reached ? "step" : undefined}>
              <span
                aria-hidden
                className="flex size-7 shrink-0 items-center justify-center rounded-full border text-[13px]"
                style={done ? { background: "var(--s-ink)", color: "var(--s-bg)", borderColor: "var(--s-ink)" } : { borderColor: "var(--s-muted)" }}
              >
                {done ? "✓" : ""}
              </span>
              <span className={done ? "text-[17px]" : "sf-muted text-[17px]"}>{s.label}</span>
            </li>
          );
        })}
      </ol>

      {order.tracking ? (
        <p className="mt-8 text-[15px]">
          Tracking {order.tracking.carrier ? `(${order.tracking.carrier}) ` : ""}
          <a href={order.tracking.url} target="_blank" rel="noreferrer" className="underline underline-offset-4">
            {order.tracking.number}
          </a>
        </p>
      ) : null}
      {order.problem ? <p className="mt-8 text-[15px]">There&apos;s a problem with this order. Contact the shop with the email on your receipt.</p> : null}

      <ul className="sf-line mt-10 flex flex-col divide-y border-y">
        {order.lines.map((l) => (
          <li key={l.title} className="flex justify-between py-3 text-[15px]">
            <span>{l.title}</span>
            <span className="sf-muted tabular-nums">× {l.qty}</span>
          </li>
        ))}
      </ul>
      <BackToShop />
    </section>
  );
}
