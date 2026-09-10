const whole = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const exact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
});

const int = new Intl.NumberFormat("en-US");

/** "$48,900" — whole dollars for dashboards. */
export function fmtUsd(cents: number): string {
  return whole.format(Math.round(cents / 100));
}

/** "$2,500.00" — exact amounts for ledgers and admin. */
export function fmtUsdExact(cents: number): string {
  return exact.format(cents / 100);
}

/** "$48.9K" — compact for tight spots. */
export function fmtUsdCompact(cents: number): string {
  const d = cents / 100;
  if (Math.abs(d) >= 1_000_000) return `$${(d / 1_000_000).toFixed(1)}M`;
  if (Math.abs(d) >= 10_000) return `$${(d / 1000).toFixed(1)}K`;
  return whole.format(Math.round(d));
}

export const fmtInt = (n: number) => int.format(n);
