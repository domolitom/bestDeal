import type { DatePattern } from "../types/store";

/**
 * Parse dates from text using regex patterns with group references ($1, $2, etc.)
 * Returns raw matched groups assembled by the template — no format conversion.
 */
export function parseDates(
  text: string,
  patterns: DatePattern[]
): { dateFrom: string; dateTo: string } | null {
  for (const p of patterns) {
    const match = text.match(new RegExp(p.match));
    if (!match) continue;

    const dateFrom = applyGroupRefs(p.dateFrom, match);
    const dateTo = applyGroupRefs(p.dateTo, match);
    return { dateFrom, dateTo };
  }
  return null;
}

function applyGroupRefs(template: string, match: RegExpMatchArray): string {
  return template.replace(/\$(\d+)/g, (_, idx) => match[parseInt(idx)] || "");
}

/**
 * Convert a DD-MM or DD-MM-YYYY date string to ISO 8601 (YYYY-MM-DD).
 * If no year is provided, uses the given fallback year.
 */
export function toISODate(raw: string, fallbackYear?: number): string {
  // Already ISO format (YYYY-MM-DD)
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }

  const parts = raw.split("-");
  if (parts.length === 2) {
    // DD-MM format
    const [dd, mm] = parts;
    const year = fallbackYear ?? new Date().getFullYear();
    return `${year}-${mm}-${dd}`;
  }
  if (parts.length === 3) {
    // DD-MM-YYYY format
    const [dd, mm, yyyy] = parts;
    return `${yyyy}-${mm}-${dd}`;
  }
  return raw; // unknown format
}

/**
 * Format an ISO date as a localized display string.
 */
export function formatDate(isoDate: string, locale = "en-GB"): string {
  const date = new Date(isoDate);
  if (isNaN(date.getTime())) return isoDate;
  return date.toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Check if a catalog with given dateTo is still current (not expired).
 */
export function isCatalogActive(dateTo: string): boolean {
  const end = new Date(dateTo);
  if (isNaN(end.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return end >= today;
}

/**
 * Get a human-readable freshness string.
 */
export function getFreshnessLabel(dateTo: string): string {
  const end = new Date(dateTo);
  if (isNaN(end.getTime())) return "";

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);

  const diffDays = Math.round((end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return `Expired ${Math.abs(diffDays)} day${Math.abs(diffDays) !== 1 ? "s" : ""} ago`;
  }
  if (diffDays === 0) return "Expires today";
  if (diffDays === 1) return "Expires tomorrow";
  return `Valid for ${diffDays} more days`;
}
