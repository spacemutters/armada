// Money is whole cents everywhere. These helpers only format it.

export function formatMoney(cents: number, currency = "USD", opts: { whole?: boolean } = {}): string {
  const whole = opts.whole ?? (cents % 100 === 0);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(cents / 100);
}

/** Compact form for dashboards: $18.2K, $3.1M. */
export function formatMoneyCompact(cents: number, currency = "USD"): string {
  const dollars = cents / 100;
  if (Math.abs(dollars) < 10000) return formatMoney(Math.round(dollars) * 100, currency, { whole: true });
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(dollars);
}

export function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100);
}
