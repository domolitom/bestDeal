/** Maximum days dateTo may be in the future before a date is considered bogus. */
export const BOGUS_MAX_FUTURE_DAYS = 365;

/** Maximum days past dateTo before a date range is considered bogus. */
export const BOGUS_EXPIRY_DAYS = 30;

/**
 * Returns a reason string if the dateFrom/dateTo pair is bogus, null otherwise.
 * "Bogus" means: unparseable, inverted, too far in the future, or too far expired.
 */
export function hasBogusDate(dateFrom: string, dateTo: string): string | null {
  const from = new Date(dateFrom);
  const to = new Date(dateTo);

  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    return `unparseable dates`;
  }
  if (to < from) {
    return `inverted dates (dateTo before dateFrom)`;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const maxFuture = new Date(today);
  maxFuture.setDate(maxFuture.getDate() + BOGUS_MAX_FUTURE_DAYS);
  if (to > maxFuture) {
    const daysAhead = Math.round((to.getTime() - today.getTime()) / 86400000);
    return `dateTo is ${daysAhead} days in the future`;
  }

  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() - BOGUS_EXPIRY_DAYS);
  if (to < cutoff) {
    const daysAgo = Math.round((today.getTime() - to.getTime()) / 86400000);
    return `expired ${daysAgo} days ago`;
  }

  return null;
}
