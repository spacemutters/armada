import { notFound } from "next/navigation";
import { BackToShop } from "@/components/storefront/back-to-shop";
import { ClearBag } from "@/components/storefront/clear-bag";
import { confirmShopCheckout } from "@/lib/shops/checkout";
import { loadStorefront } from "@/lib/shops/storefront";

// Where Stripe sends a shopper after paying. The payment is checked with Stripe before the page says
// thank you, and the order is recorded here too in case Stripe's notification is late.

export const metadata = { title: "Thank you" };
export const dynamic = "force-dynamic";

export default async function ThanksPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const data = await loadStorefront(slug);
  if (!data) notFound();
  const session = typeof sp.session === "string" ? sp.session : "";
  const { paid, test, orderToken } = await confirmShopCheckout(data.shop, session);
  return (
    <section className="sf-wrap pt-[clamp(2.5rem,6vw,5rem)] pb-[var(--s-section)]">
      <h1 className="sf-display" style={{ fontSize: "clamp(2.4rem, 1rem + 4vw, 4.5rem)" }}>
        {paid ? "Thank you" : "Payment not confirmed"}
      </h1>
      <p className="sf-lead sf-muted mt-5">
        {paid
          ? `Your order is in${test ? " (a test payment: no card was charged)" : ""}. Your receipt has a link to follow it.`
          : "We couldn't confirm this payment. If you were charged, your receipt from Stripe has the details."}
      </p>
      {paid ? (
        <>
          <ClearBag slug={slug} />
          {orderToken ? (
            <a href={`/s/${slug}/order/${orderToken}`} className="sf-button mt-10 mr-3">
              Track your order
            </a>
          ) : null}
        </>
      ) : null}
      <BackToShop />
    </section>
  );
}
