import { Expand } from "@/components/fx/expand";
import { Stat, StatusPill, cx } from "@/components/ui";
import { formatMoney } from "@/lib/money";

// What the ads did, in the order a shop owner asks: how many people saw them, how many came to the
// shop, how many bought, what it cost. Practice numbers are labelled as made up every time they show.

export interface ResultTotals {
  impressions: number;
  reach: number;
  clicks: number;
  addToCarts: number;
  purchases: number;
  spendCents: number;
  salesCents: number;
  days: number;
  practice: boolean;
}

const n = (x: number) => x.toLocaleString("en-US");

export function costPerSale(t: ResultTotals, currency: string): string {
  return t.purchases ? formatMoney(Math.round(t.spendCents / t.purchases), currency) : "No sales yet";
}

export function PracticeNote({ lines, label }: { lines: string[]; label: string }) {
  return (
    <div className="rounded-xl bg-attention-soft px-4 py-3 text-[13px] text-attention">
      <p className="font-medium">{label}</p>
      <Expand summary={<span className="text-[13px]">How practice numbers are made</span>} className="mt-1" buttonClassName="min-h-11 md:min-h-9 text-attention">
        <ul className="mt-1 flex list-disc flex-col gap-1 pl-5">
          {lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </Expand>
    </div>
  );
}

export function ResultsPanel({
  totals,
  reach,
  capCents,
  currency,
  perAd,
  practiceLabel,
  practiceLines,
  dayLine,
}: {
  totals: ResultTotals;
  /** People reached; real platforms report it once for the whole period. */
  reach: number;
  capCents: number;
  currency: string;
  perAd: { id: string; label: string; idea: string; totals: ResultTotals }[];
  practiceLabel?: string;
  practiceLines?: string[];
  dayLine?: string;
}) {
  const money = (c: number) => formatMoney(c, currency, { whole: c % 100 === 0 });
  const withData = perAd.filter((a) => a.totals.impressions > 0);
  // "Doing best": the most sales, then the cheapest visits. Only once there are at least two to compare.
  const best =
    withData.length >= 2
      ? [...withData].sort((a, b) => b.totals.purchases - a.totals.purchases || a.totals.spendCents / Math.max(1, a.totals.clicks) - b.totals.spendCents / Math.max(1, b.totals.clicks))[0]
      : null;
  return (
    <section aria-labelledby="results-heading" className="flex flex-col gap-5 rounded-2xl border border-line bg-raised p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="results-heading" className="text-[15px] font-semibold">
          {totals.practice ? "Practice results" : "Results"}
        </h2>
        {dayLine ? <span className="text-[13px] text-muted">{dayLine}</span> : null}
      </div>
      {totals.practice && practiceLabel && practiceLines ? <PracticeNote label={practiceLabel} lines={practiceLines} /> : null}
      <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3">
        <Stat label="People reached" value={n(reach)} hint={`Shown ${n(totals.impressions)} times`} />
        <Stat label="Visits to the shop" value={n(totals.clicks)} hint={totals.impressions ? `${((totals.clicks / totals.impressions) * 100).toFixed(1)}% of views` : undefined} />
        <Stat label="Added to bag" value={n(totals.addToCarts)} />
        <Stat label="Sales" value={n(totals.purchases)} hint={totals.salesCents ? `${money(totals.salesCents)} in` : undefined} tone={totals.purchases ? "positive" : undefined} />
        <Stat label="Spent" value={money(totals.spendCents)} hint={`of ${money(capCents)} at most`} />
        <Stat label="Cost per sale" value={costPerSale(totals, currency)} />
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-sunken" role="img" aria-label={`${money(totals.spendCents)} of ${money(capCents)} spent`}>
        <div className="h-full rounded-full bg-ink transition-[width] duration-500" style={{ width: `${Math.min(100, (totals.spendCents / Math.max(1, capCents)) * 100)}%` }} />
      </div>

      {perAd.length > 1 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-[14px]">
            <caption className="sr-only">Results for each ad</caption>
            <thead>
              <tr className="border-b border-line text-[13px] text-muted">
                <th scope="col" className="py-2 pr-3 font-normal">
                  Ad
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-normal">
                  Spent
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-normal">
                  Visits
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-normal">
                  Sales
                </th>
                <th scope="col" className="py-2 text-right font-normal">
                  Cost per sale
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {perAd.map((a) => (
                <tr key={a.id} data-ad={a.id}>
                  <td className="py-2.5 pr-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{a.label}</span>
                      {best?.id === a.id ? <StatusPill tone="ok">Doing best</StatusPill> : null}
                    </div>
                    <div className="max-w-sm truncate text-[13px] text-muted">{a.idea}</div>
                  </td>
                  <td className="py-2.5 pr-3 text-right tabular">{money(a.totals.spendCents)}</td>
                  <td className="py-2.5 pr-3 text-right tabular">{n(a.totals.clicks)}</td>
                  <td className={cx("py-2.5 pr-3 text-right tabular", a.totals.purchases ? "text-positive" : "")}>{n(a.totals.purchases)}</td>
                  <td className="py-2.5 text-right tabular">{costPerSale(a.totals, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
