import Link from "next/link";
import { startPracticeFleet } from "../actions";
import { FleetMap } from "@/components/fleet-map";
import { Button, ButtonLink, Card, EmptyState, PageHeader, Section, StatusPill, type Tone } from "@/components/ui";
import { requireSession } from "@/lib/auth/session";
import { storesTable } from "@/lib/fleet/queries";
import { formatMoney } from "@/lib/money";

export const metadata = { title: "Stores" };

const STATUS: Record<string, { tone: Tone; label: string }> = {
  connected: { tone: "ok", label: "Connected" },
  needs_attention: { tone: "attention", label: "Needs you" },
  disconnected: { tone: "error", label: "Disconnected" },
  setting_up: { tone: "working", label: "Setting up" },
};

export default async function StoresPage({ searchParams }: PageProps<"/stores">) {
  const session = await requireSession();
  const { group, platform } = await searchParams;
  const all = await storesTable(session.workspaceId);
  const groups = [...new Set(all.map((s) => s.group).filter(Boolean))] as string[];
  const rows = all.filter((s) => (!group || s.group === group) && (!platform || s.platform === platform));

  const filterLink = (label: string, params: Record<string, string | undefined>, active: boolean) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString();
    return (
      <Link
        key={label}
        href={`/stores${q ? `?${q}` : ""}`}
        aria-current={active ? "true" : undefined}
        className={`inline-flex min-h-9 items-center rounded-full border px-3 text-[13px] ${active ? "border-ink bg-ink text-surface" : "border-line-strong hover:bg-sunken"}`}
      >
        {label}
      </Link>
    );
  };

  return (
    <>
      <PageHeader
        title="Stores"
        subtitle={`${all.length} ${all.length === 1 ? "store" : "stores"} across Shopify and eBay. Open one to see its products, orders and health.`}
        actions={<ButtonLink href="/builder/new">Open a new shop</ButtonLink>}
      />

      {all.length === 0 ? (
        <EmptyState
          title="No stores yet"
          body="Connecting real Shopify stores and eBay accounts needs your partner and developer accounts first. Meanwhile, a practice fleet lets you try everything."
          action={
            <form action={startPracticeFleet} className="flex items-center gap-3">
              <input type="hidden" name="count" value="24" />
              <Button type="submit">Start a practice fleet</Button>
            </form>
          }
        />
      ) : (
        <>
          <Section title="Fleet map" className="mb-4">
            <FleetMap tiles={rows} size="lg" />
          </Section>

          <div className="mb-3 flex flex-wrap gap-2">
            {filterLink("All", { platform: platform as string | undefined }, !group)}
            {groups.map((g) => filterLink(g, { group: g, platform: platform as string | undefined }, group === g))}
            <span className="mx-1 w-px self-stretch bg-line" aria-hidden />
            {filterLink("Shopify", { group: group as string | undefined, platform: "shopify" }, platform === "shopify")}
            {filterLink("eBay", { group: group as string | undefined, platform: "ebay" }, platform === "ebay")}
          </div>

          <Card className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-[14px]">
              <thead className="text-[12px] text-muted">
                <tr className="border-b border-line">
                  <th className="px-5 py-3 font-medium">Store</th>
                  <th className="px-3 py-3 font-medium">Group</th>
                  <th className="px-3 py-3 font-medium">Status</th>
                  <th className="px-3 py-3 text-right font-medium">Sold, 7 days</th>
                  <th className="px-3 py-3 text-right font-medium">Profit, 7 days</th>
                  <th className="px-3 py-3 text-right font-medium">Orders</th>
                  <th className="px-5 py-3 text-right font-medium">Live products</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => {
                  const st = STATUS[s.status] ?? STATUS.connected;
                  return (
                    <tr key={s.id} className="border-b border-line last:border-0 hover:bg-sunken">
                      <td className="px-5 py-3">
                        <Link href={`/stores/${s.id}`} className="font-medium hover:underline">
                          {s.name}
                        </Link>
                        <div className="text-[12px] text-muted">
                          {s.platform === "ebay" ? "eBay" : "Shopify"}
                          {s.mode === "practice" ? " · practice" : ""}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-muted">{s.group ?? "None"}</td>
                      <td className="px-3 py-3">
                        <StatusPill tone={st.tone}>{st.label}</StatusPill>
                      </td>
                      <td className="tabular px-3 py-3 text-right">{formatMoney(s.sales7Cents, "USD", { whole: true })}</td>
                      <td className={`tabular px-3 py-3 text-right ${s.profit7Cents < 0 ? "text-negative" : ""}`}>{formatMoney(s.profit7Cents, "USD", { whole: true })}</td>
                      <td className="tabular px-3 py-3 text-right">{s.orders7}</td>
                      <td className="tabular px-5 py-3 text-right">{s.activeListings}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
          <p className="mt-3 text-[13px] text-muted">Profit is after supplier cost, platform fees and refunds, before ad spend.</p>
        </>
      )}
    </>
  );
}
