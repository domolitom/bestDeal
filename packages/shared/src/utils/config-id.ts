import { toISODate } from "./dates";

export interface ConfigIdInput {
  country: string;
  store: string;
  dateFrom: string; // raw DD-MM or DD-MM-YYYY
  dateTo: string; // raw DD-MM-YYYY
  catalogType?: string;
}

/**
 * Build a canonical catalog ID from discovery data.
 * Format: {country}-{store}-{isoDateFrom}-{isoDateTo}[-{catalogType}]
 * Example: "romania-lidl-2026-02-09-2026-02-15"
 */
export function buildCatalogId(input: ConfigIdInput): string {
  const isoFrom = toISODate(input.dateFrom, extractYear(input.dateTo));
  const isoTo = toISODate(input.dateTo);
  const base = `${input.country}-${input.store}-${isoFrom}-${isoTo}`;
  if (input.catalogType) return `${base}-${input.catalogType}`;
  return base;
}

/**
 * Parse a catalog ID back into its parts.
 */
export function parseCatalogId(id: string): {
  country: string;
  store: string;
  dateFrom: string;
  dateTo: string;
  catalogType?: string;
} | null {
  // Format: country-store-YYYY-MM-DD-YYYY-MM-DD[-type]
  // Store group is non-greedy to handle hyphenated names like "mega-image"
  const match = id.match(
    /^([a-z]+)-([a-z]+(?:-[a-z]+)*?)-(\d{4}-\d{2}-\d{2})-(\d{4}-\d{2}-\d{2})(?:-(.+))?$/
  );
  if (!match) return null;
  return {
    country: match[1]!,
    store: match[2]!,
    dateFrom: match[3]!,
    dateTo: match[4]!,
    catalogType: match[5],
  };
}


function extractYear(dateTo: string): number {
  // DD-MM-YYYY → extract year
  const parts = dateTo.split("-");
  if (parts.length === 3) {
    const year = parseInt(parts[2]!, 10);
    if (!isNaN(year)) return year;
  }
  return new Date().getFullYear();
}
