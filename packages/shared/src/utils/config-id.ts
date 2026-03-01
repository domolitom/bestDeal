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
 * Example: "ro-lidl-2026-02-09-2026-02-15"
 */
export function buildCatalogId(input: ConfigIdInput): string {
  const isoFrom = toISODate(input.dateFrom, extractYear(input.dateTo));
  const isoTo = toISODate(input.dateTo);
  const base = `${countryCode(input.country)}-${input.store}-${isoFrom}-${isoTo}`;
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
  // Format: cc-store-YYYY-MM-DD-YYYY-MM-DD[-type]
  const match = id.match(
    /^([a-z]{2})-([a-z]+)-(\d{4}-\d{2}-\d{2})-(\d{4}-\d{2}-\d{2})(?:-(.+))?$/
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

/** Map country folder name to 2-letter code */
function countryCode(country: string): string {
  const map: Record<string, string> = {
    romania: "ro",
    germany: "de",
    poland: "pl",
    hungary: "hu",
    bulgaria: "bg",
    czechia: "cz",
  };
  return map[country] || country.slice(0, 2);
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
