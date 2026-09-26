import { notFound } from "next/navigation";
import { shopContactEmail } from "@/lib/shops/contact";
import { loadStorefront } from "@/lib/shops/storefront";
import { Markdown } from "@/lib/markdown";

const TITLES: Record<string, string> = { refund: "Refund policy", shipping: "Shipping policy" };

export default async function PolicyPage({ params }: PageProps<"/s/[slug]/policies/[policy]">) {
  const { slug, policy } = await params;
  const data = await loadStorefront(slug);
  if (!data || !TITLES[policy]) notFound();
  const bp = data.shop.blueprint;
  const text = policy === "refund" ? bp.policies?.refund : bp.policies?.shipping;
  if (!text) notFound();

  return (
    <article className="sf-wrap pt-[clamp(2.5rem,6vw,5rem)] pb-[var(--s-section)]">
      <p className="sf-label">Draft</p>
      <h1 className="sf-display mt-4" style={{ fontSize: "clamp(2.2rem, 1rem + 4vw, 4.5rem)" }}>
        {TITLES[policy]}
      </h1>
      <p className="sf-muted mt-5 max-w-[60ch] text-[15px]">
        Drafted from this shop&apos;s delivery and returns facts. The owner reviews it before the shop takes real orders.
      </p>
      <Markdown text={text} vars={{ support_email: (await shopContactEmail(data.shop)).email }} className="sf-prose mt-10" />
    </article>
  );
}
