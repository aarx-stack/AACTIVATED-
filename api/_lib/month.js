/**
 * Calendar-month window helpers, timezone-aware without external deps.
 *
 * The tier system counts "the current calendar month" in a configurable IANA
 * timezone (TIER_TIMEZONE, default UTC). Conversions are fetched from
 * Tapfiliate with a date window padded by one day on each side, then filtered
 * exactly by formatting each conversion's created_at into the target timezone
 * and comparing its YYYY-MM against the current month.
 */

function partsInZone(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  // en-CA yields YYYY-MM-DD
  const [year, month, day] = fmt.format(date).split('-').map(Number);
  return { year, month, day };
}

export function yearMonthInZone(date, timeZone) {
  const { year, month } = partsInZone(date, timeZone);
  return `${year}-${String(month).padStart(2, '0')}`;
}

/**
 * Returns the current-month window for API queries and exact filtering:
 *  - yearMonth: "2026-08" in the target timezone
 *  - dateFrom / dateTo: YYYY-MM-DD strings for Tapfiliate's date_from/date_to
 *    query params, padded by one day on each side so timezone offsets can
 *    never exclude a conversion that belongs to the month.
 */
export function currentMonthWindow(now, timeZone) {
  const { year, month } = partsInZone(now, timeZone);
  const yearMonth = `${year}-${String(month).padStart(2, '0')}`;

  // First/last day of the month in the target timezone, as plain dates.
  const firstUtc = new Date(Date.UTC(year, month - 1, 1));
  const lastUtc = new Date(Date.UTC(year, month, 0));

  const pad = (d) => new Date(d.getTime());
  const dayMs = 24 * 60 * 60 * 1000;
  const fromPadded = new Date(pad(firstUtc).getTime() - dayMs);
  const toPadded = new Date(pad(lastUtc).getTime() + dayMs);

  const iso = (d) => d.toISOString().slice(0, 10);
  return {
    yearMonth,
    dateFrom: iso(fromPadded),
    dateTo: iso(toPadded),
  };
}

/** Predicate: does this ISO timestamp fall inside yearMonth for the given timezone? */
export function makeInMonth(yearMonth, timeZone) {
  return (conversion) => {
    const ts = conversion?.created_at;
    if (!ts) return false;
    const date = new Date(ts);
    if (Number.isNaN(date.getTime())) return false;
    return yearMonthInZone(date, timeZone) === yearMonth;
  };
}
