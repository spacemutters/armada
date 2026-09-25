import Link from "next/link";
import { FleetMark } from "@/components/auth-frame";

export const metadata = { title: "Privacy", description: "What Armada keeps, why, and how to have it removed." };

// Plain-language privacy page. eBay and Shopify ask apps for one; it says only what Armada really does.
const SECTIONS: { title: string; body: string[] }[] = [
  {
    title: "What Armada keeps",
    body: [
      "Your account: your name, your email if you add one, a scrambled version of your password (never the password itself), and the passkeys you make. A passkey stays on your device; Armada keeps only the public half.",
      "Your fleet: the stores you connect or open, the products you choose, prices, listings and the changes you approve, with a record of who did what.",
      "Orders from your stores: what was bought and where it ships, so each order can be sent to your supplier. Buyers' details are used for that and nothing else.",
      "Connections: the keys that let Armada act for you on Shopify, eBay, Facebook, CJ and ad platforms are stored encrypted, and are used only to do what you ask.",
    ],
  },
  {
    title: "What Armada does with it",
    body: [
      "It runs your stores for you: listing products, keeping prices and stock in step, sending orders to suppliers and showing you how things are going.",
      "When you use the AI features, the text needed for that job (for example a shop idea, product details or a headline) is sent to the AI service that writes the answer. Buyers' personal details are never sent for this.",
      "Armada doesn't sell data, doesn't show ads to you, and doesn't share your information except with the platforms you connect, to do what you asked.",
    ],
  },
  {
    title: "Shoppers on Armada-built shops",
    body: [
      "A shop page may set one small cookie with a random number, so a headline test shows each visitor the same version. It isn't linked to a name or email, and it isn't shared.",
    ],
  },
  {
    title: "Removing your data",
    body: [
      "Disconnecting a store or account removes Armada's access to it straight away. When a platform tells Armada a buyer or seller has asked to be deleted (eBay and Shopify both do), Armada removes what it holds for them.",
      "To have your whole account and fleet removed, ask the person who invited you to Armada, or reply to any message from Armada, and it will be deleted.",
    ],
  },
];

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-12 md:py-16">
      <Link href="/" className="mb-10 inline-flex items-center gap-2.5 text-[15px] font-semibold">
        <FleetMark /> Armada
      </Link>
      <h1 className="text-[32px] leading-tight font-semibold tracking-tight">Privacy</h1>
      <p className="mt-3 text-[16px] text-muted">What Armada keeps, why, and how to have it removed. Last updated September 24, 2026.</p>
      {SECTIONS.map((s) => (
        <section key={s.title} className="mt-10">
          <h2 className="text-[19px] font-semibold tracking-tight">{s.title}</h2>
          {s.body.map((p) => (
            <p key={p} className="mt-3 text-[16px] leading-relaxed">
              {p}
            </p>
          ))}
        </section>
      ))}
    </main>
  );
}
