import { notFound } from "next/navigation";
import { BagView } from "@/components/storefront/bag";
import { loadStorefront } from "@/lib/shops/storefront";

export const metadata = { title: "Your bag" };

export default async function CartPage({ params }: PageProps<"/s/[slug]/cart">) {
  const { slug } = await params;
  if (!(await loadStorefront(slug))) notFound();
  return (
    <section className="sf-wrap pt-[clamp(2.5rem,6vw,5rem)] pb-[var(--s-section)]">
      <h1 className="sf-display mb-12" style={{ fontSize: "clamp(2.4rem, 1rem + 4vw, 4.5rem)" }}>
        Your bag
      </h1>
      <BagView slug={slug} />
    </section>
  );
}
