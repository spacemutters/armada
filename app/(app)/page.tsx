import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { startPracticeFleet } from "./actions";
import { FleetMap } from "@/components/fleet-map";
import { Button, ButtonLink, Card, PageHeader, Section, Stat, StatusPill } from "@/components/ui";
import { helperStatus } from "@/lib/ai/jobs";
import { requireSession } from "@/lib/auth/session";
import { homeSummary } from "@/lib/fleet/queries";
import { formatMoney, formatMoneyCompact } from "@/lib/money";

export const metadata = { title: "Home" };

export default async function HomePage() {
  const session = await requireSession();
  const [summary, helper] = await Promise.all([homeSummary(session.workspaceId), helperStatus()]);
  const { yesterday, week, tiles, needs, counts } = summary;
  const firstName = session.name.split(" ")[0];

  if (counts.stores === 0) {
    return (
      <>
        <PageHeader title={`Welcome, ${firstName}`} subtitle="Two ways to start. Both work before any real store is connected." />
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="flex flex-col gap-4 p-6">
            <h2 className="text-[18px] font-semibold">Build a shop with AI</h2>
            <p className="text-muted">
              Type an idea. The AI names the brand, picks the look, chooses and writes the products, and writes every page. You watch it happen,
              then open the finished shop.
            </p>
            <div className="mt-auto">
              <ButtonLink href="/builder/new">Build a shop</ButtonLink>
            </div>
          </Card>
          <Card className="flex flex-col gap-4 p-6">
            <h2 className="text-[18px] font-semibold">Start a practice fleet</h2>
            <p className="text-muted">
              Pretend Shopify stores and eBay accounts with a month of believable orders, a stock problem and a late-shipping warning. Use it to try
              everything safely. Practice stores never touch real money.
            </p>
            <form action={startPracticeFleet} className="mt-auto flex flex-wrap items-center gap-3">
              <label className="text-[14px] text-muted" htmlFor="count">
                Stores
              </label>
              <select id="count" name="count" defaultValue="24" className="min-h-10 rounded-xl border border-line-strong bg-raised px-3">
                <option value="12">12</option>
                <option value="24">24</option>
                <option value="60">60</option>
                <option value="120">120</option>
              </select>
              <Button type="submit" variant="secondary">
                Start a practice fleet
              </Button>
            </form>
          </Card>
        </div>
      </>
    );
  }

  const summaryLine = [
    `${counts.stores} ${counts.stores === 1 ? "store" : "stores"}`,
    `${formatMoneyCompact(yesterday.salesCents)} sold yesterday`,
    `${formatMoneyCompact(yesterday.profitCents)} profit`,
    needs.length ? `${needs.length} ${needs.length === 1 ? "thing needs" : "things need"} you` : "nothing needs you",
  ].join(" · ");

  return (
    <>
      <PageHeader
        title={`Hello, ${firstName}`}
        subtitle={summaryLine}
        actions={
          <>
            <ButtonLink href="/builder/new" variant="secondary">
              Build a shop
            </ButtonLink>
            <ButtonLink href="/stores">All stores</ButtonLink>
          </>
        }
      />

      <Card className="mb-4 grid grid-cols-2 gap-6 p-6 md:grid-cols-4">
        <Stat label="Sold yesterday" value={formatMoney(yesterday.salesCents, "USD", { whole: true })} hint={`${yesterday.orders} orders`} />
        <Stat label="Profit yesterday" value={formatMoney(yesterday.profitCents, "USD", { whole: true })} hint="Before ad spend" tone={yesterday.profitCents >= 0 ? "positive" : "negative"} />
        <Stat label="Sold in 7 days" value={formatMoneyCompact(week.salesCents)} hint={`${week.orders} orders`} />
        <Stat label="Profit in 7 days" value={formatMoneyCompact(week.profitCents)} hint="Before ad spend" tone={week.profitCents >= 0 ? "positive" : "negative"} />
      </Card>

      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <Section title="Your fleet" action={<span className="text-[13px] text-muted">{tiles.length} stores · last 24 hours</span>}>
          <FleetMap tiles={tiles} />
        </Section>

        <Section title={needs.length ? "Needs you" : "All clear"}>
          {needs.length ? (
            <ul className="flex flex-col divide-y divide-line">
              {needs.map((n, i) => (
                <li key={i}>
                  <Link href={n.href} className="group flex items-start gap-3 py-3">
                    <span aria-hidden className="mt-1.5 size-2 shrink-0 rotate-45 bg-attention" />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium group-hover:underline">{n.title}</span>
                      <span className="block text-[13px] text-muted">{n.body}</span>
                    </span>
                    <ArrowRight aria-hidden className="mt-1 size-4 shrink-0 text-muted" />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted">Nothing needs you. Every store is connected, stocked and shipping on time.</p>
          )}
          <div className="mt-4 flex items-center justify-between border-t border-line pt-4 text-[13px]">
            <span className="text-muted">AI helper on your computer</span>
            <StatusPill tone={helper.online ? "ok" : "off"}>{helper.online ? (helper.busy ? "Working" : "On") : "Off"}</StatusPill>
          </div>
          {counts.building ? (
            <Link href="/builder" className="mt-2 block text-[13px] text-accent hover:underline">
              {counts.building} {counts.building === 1 ? "shop is" : "shops are"} being built
            </Link>
          ) : null}
        </Section>
      </div>
    </>
  );
}
