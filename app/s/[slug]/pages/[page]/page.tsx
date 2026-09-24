import { notFound } from "next/navigation";
import { loadStorefront, supportEmail } from "@/lib/shops/storefront";
import { Markdown } from "@/lib/markdown";

const TITLES: Record<string, string> = {
  about: "About",
  faq: "Questions",
  shipping: "Shipping and returns",
  contact: "Contact",
};

export async function generateMetadata({ params }: PageProps<"/s/[slug]/pages/[page]">) {
  const { slug, page } = await params;
  const data = await loadStorefront(slug);
  if (!data || !TITLES[page]) return {};
  return { title: { absolute: `${TITLES[page]} · ${data.shop.blueprint.brand?.name}` } };
}

export default async function InfoPage({ params }: PageProps<"/s/[slug]/pages/[page]">) {
  const { slug, page } = await params;
  const data = await loadStorefront(slug);
  if (!data || !TITLES[page]) notFound();
  const bp = data.shop.blueprint;
  const pages = bp.pages;
  if (!pages) notFound();
  const vars = { support_email: supportEmail(bp) };

  return (
    <article className="sf-wrap pt-[clamp(2.5rem,6vw,5rem)] pb-[var(--s-section)]">
      <h1 className="sf-display" style={{ fontSize: "clamp(2.4rem, 1rem + 4.5vw, 5rem)" }}>
        {page === "about" ? `About ${bp.brand?.name}` : TITLES[page]}
      </h1>
      <div className="mt-12 grid gap-12 lg:grid-cols-[4fr_8fr]">
        <p className="sf-muted text-[15px]">
          {page === "contact"
            ? `We read every message. Practice shops use a reserved example address, so nothing sent here reaches anyone.`
            : bp.brand?.tagline}
        </p>
        {page === "faq" ? (
          <div className="sf-prose !max-w-[70ch]">
            {pages.faq.map((f) => (
              <details key={f.question} className="sf-line border-b py-5" open>
                <summary className="text-[18px] font-medium">{f.question}</summary>
                <p className="sf-muted mt-3">{f.answer}</p>
              </details>
            ))}
          </div>
        ) : (
          <Markdown
            text={page === "about" ? pages.about : page === "shipping" ? pages.shipping : pages.contact}
            vars={vars}
            className="sf-prose"
          />
        )}
      </div>
    </article>
  );
}
