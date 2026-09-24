import { Card, PageHeader, Section, StatusPill } from "@/components/ui";
import { requireSession } from "@/lib/auth/session";

export const metadata = { title: "Ads" };

const PLATFORMS = [
  {
    name: "eBay Promoted Listings",
    state: "Built next",
    body: "Needs no extra review from eBay, so it comes first. It switches on once your eBay developer account is connected.",
  },
  {
    name: "Google Ads and Shopping",
    state: "Waiting on you",
    body: "Needs brand verification in Google Cloud. After that, basic access is approved within minutes.",
  },
  {
    name: "Facebook and Instagram",
    state: "Waiting on you",
    body: "Needs Meta's Business Verification, then App Review once this screen can show them a working ad flow.",
  },
  {
    name: "TikTok",
    state: "Waiting on you",
    body: "Needs a TikTok developer profile under a company email and website, then an app review. About three business days each.",
  },
];

const RAILS = [
  { title: "Every ad starts switched off", body: "Nothing spends until a person presses Go live. A build check fails if any code tries otherwise." },
  { title: "Caps per ad, store, day and account", body: "Set inside Meta, Google and eBay too, so they hold even if Armada is down." },
  { title: "One stop button", body: "Pauses every ad in every store within a minute." },
  { title: "Rules with limits", body: "Pause what loses money and grow what earns, never past the caps." },
];

export default async function AdsPage() {
  await requireSession();
  return (
    <>
      <PageHeader title="Ads" subtitle="Ads for every store from one screen. Each ad platform needs its own approval first, so they switch on one at a time." />
      <Card className="mb-4 overflow-hidden">
        <ul className="flex flex-col divide-y divide-line">
          {PLATFORMS.map((p) => (
            <li key={p.name} className="flex flex-wrap items-start gap-3 px-5 py-4">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{p.name}</div>
                <p className="mt-0.5 max-w-2xl text-[13px] text-muted">{p.body}</p>
              </div>
              <StatusPill tone={p.state === "Built next" ? "working" : "off"}>{p.state}</StatusPill>
            </li>
          ))}
        </ul>
      </Card>
      <Section title="How spending stays safe">
        <ul className="grid gap-5 sm:grid-cols-2">
          {RAILS.map((r) => (
            <li key={r.title}>
              <div className="font-medium">{r.title}</div>
              <p className="mt-0.5 text-[13px] text-muted">{r.body}</p>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}
