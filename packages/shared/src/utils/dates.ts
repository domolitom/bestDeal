import type { DatePattern } from "../types/store";

const MONTH_NAMES: Record<string, string> = {
  ianuarie: "01", februarie: "02", martie: "03", aprilie: "04",
  mai: "05", iunie: "06", iulie: "07", august: "08",
  septembrie: "09", octombrie: "10", noiembrie: "11", decembrie: "12",
  // Romanian abbreviations
  ian: "01", feb: "02", mar: "03", apr: "04",
  iun: "06", iul: "07", aug: "08",
  sep: "09", oct: "10", noi: "11", dec: "12",
  // French
  janvier: "01", février: "02", mars: "03", avril: "04",
  juin: "06", juillet: "07", août: "08",
  septembre: "09", octobre: "10", novembre: "11", décembre: "12",
  // German
  januar: "01", februar: "02", märz: "03",
  juni: "06", juli: "07",
  september: "09", oktober: "10", november: "11", dezember: "12",
  // German abbreviations
  jan: "01", feb: "02", mär: "03", mrz: "03",
  apr: "04", mai: "05", jun: "06", jul: "07",
  aug: "08", sep: "09", okt: "10", nov: "11", dez: "12",
};

/** Replace month name tokens with two-digit month numbers. */
function normalizeMonthNames(s: string): string {
  return s.replace(
    /[a-zăâîșțéûäöü]+/gi,
    (word) => MONTH_NAMES[word.toLowerCase()] ?? word,
  );
}

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
 * Also handles KW (calendar week) format: "KW{n}-{yy}" or "KW{n}-{yyyy}".
 * If no year is provided, uses the given fallback year.
 */
export function toISODate(raw: string, fallbackYear?: number, endOfMonth?: boolean): string {
  // Already ISO format (YYYY-MM-DD)
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }

  // KW (calendar week) format: KW{n}-{yy} or KW{n}-{yyyy}
  // Returns Monday for dateFrom, Saturday for dateTo (endOfMonth=true)
  const kwMatch = raw.match(/^KW(\d+)-(\d{2,4})$/);
  if (kwMatch) {
    const kw = parseInt(kwMatch[1]!);
    let year = parseInt(kwMatch[2]!);
    if (year < 100) year += 2000;
    // ISO 8601 week date: Jan 4 is always in week 1
    const jan4 = new Date(year, 0, 4);
    const dayOfWeek = jan4.getDay() || 7; // Mon=1..Sun=7
    const monday = new Date(year, 0, 4 - dayOfWeek + 1 + (kw - 1) * 7);
    if (endOfMonth) {
      // Aldi weeks run Mon–Sat, return Saturday
      const saturday = new Date(monday);
      saturday.setDate(saturday.getDate() + 5);
      return saturday.toISOString().split("T")[0]!;
    }
    return monday.toISOString().split("T")[0]!;
  }

  // Normalize month names (e.g. "martie" → "03") before splitting
  const normalized = normalizeMonthNames(raw);
  const parts = normalized.split("-");
  if (parts.length === 2) {
    const [a, b] = parts;
    // Check for MM-YYYY (month-year) vs DD-MM (day-month)
    if (b!.length === 4 && parseInt(b!) > 1900) {
      // MM-YYYY format — return first day of month (or last if endOfMonth)
      const mm = a!.padStart(2, "0");
      if (endOfMonth) {
        const lastDay = new Date(parseInt(b!), parseInt(mm), 0).getDate();
        return `${b}-${mm}-${String(lastDay).padStart(2, "0")}`;
      }
      return `${b}-${mm}-01`;
    }
    // DD-MM format
    const [dd, mm] = parts;
    const year = fallbackYear ?? new Date().getFullYear();
    return `${year}-${mm!.padStart(2, "0")}-${dd!.padStart(2, "0")}`;
  }
  if (parts.length === 3) {
    // DD-MM-YYYY format
    const [dd, mm, yyyy] = parts;
    return `${yyyy}-${mm!.padStart(2, "0")}-${dd!.padStart(2, "0")}`;
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
