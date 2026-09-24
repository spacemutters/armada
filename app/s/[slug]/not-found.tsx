import { BackToShop } from "@/components/storefront/back-to-shop";

export default function StorefrontNotFound() {
  return (
    <section className="sf-wrap pt-[clamp(2.5rem,6vw,5rem)] pb-[var(--s-section)]">
      <h1 className="sf-display" style={{ fontSize: "clamp(2.4rem, 1rem + 4vw, 4.5rem)" }}>
        That page isn&apos;t here
      </h1>
      <p className="sf-lead sf-muted mt-5">The product may have moved or sold out.</p>
      <BackToShop />
    </section>
  );
}
