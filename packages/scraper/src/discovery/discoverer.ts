import { chromium } from "../browser.ts";
import type { Page } from "playwright";
import { buildCatalogId, buildPageURL } from "@bestdeal/shared";
import type { StorageAdapter, CatalogMeta } from "@bestdeal/shared";
import { loadStoreDefinitions } from "../config/store-loader.ts";
import { discoverStore, discoverStoreViaApi, discoverStoreViaRestApi } from "./discovery-engine.ts";
import type { DiscoveredCatalog } from "./discovery-engine.ts";
import { toISODate } from "@bestdeal/shared";
import { detectResolverName } from "../scraping/resolver-registry.ts";
import { createLogger } from "../logger.ts";

const log = createLogger({ module: "discovery" });

// --- Types ---

export interface CatalogResult {
  catalogId: string;
  status: "new" | "existing";
  lastPage?: number;
}

export interface DiscoveryReport {
  timestamp: string;
  stores: { store: string; country: string; catalogs: CatalogResult[] }[];
  summary: { total: number; new: number; existing: number };
}

// --- Page validation ---

async function isPageValid(page: Page, url: string): Promise<boolean> {
  try {
    const response = await page.goto(url, { waitUntil: "domcontentloaded" });
    if (!response || response.status() >= 400) return false;
    await page.waitForTimeout(2000);

    const requestedPage = url.match(/\/page\/(\d+)/)?.[1];
    const actualUrl = page.url();
    const actualPage = actualUrl.match(/\/page\/(\d+)/)?.[1];
    if (requestedPage && actualPage && requestedPage !== actualPage) {
      return false;
    }

    const hasLargeImage = await page.evaluate(() => {
      const images = Array.from(
        document.querySelectorAll("img")
      ) as HTMLImageElement[];
      return images.some((img) => {
        const w = img.naturalWidth || img.width || 0;
        const h = img.naturalHeight || img.height || 0;
        return img.complete && w > 500 && h > 500;
      });
    });
    return hasLargeImage;
  } catch {
    return false;
  }
}

// --- Date sanity validation ---

const MAX_DATE_TO_FUTURE_DAYS = 365;
const MAX_DATE_SPAN_DAYS = 365;

/**
 * Validate that a catalog's ISO dates are sane:
 * - dateTo must not be before dateFrom (inverted dates)
 * - dateTo must not be more than 1 year in the future from today
 * - the span (dateTo - dateFrom) must not exceed 365 days
 *
 * Returns null when valid, or a human-readable rejection reason string.
 */
export function validateCatalogDates(
  dateFrom: string,
  dateTo: string
): string | null {
  const from = new Date(dateFrom);
  const to = new Date(dateTo);

  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    return `unparseable dates: dateFrom="${dateFrom}" dateTo="${dateTo}"`;
  }

  if (to < from) {
    return `dateTo "${dateTo}" is before dateFrom "${dateFrom}" (inverted dates)`;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const maxDateTo = new Date(today);
  maxDateTo.setDate(maxDateTo.getDate() + MAX_DATE_TO_FUTURE_DAYS);

  if (to > maxDateTo) {
    const daysAhead = Math.round((to.getTime() - today.getTime()) / 86400000);
    return `dateTo "${dateTo}" is ${daysAhead} days in the future (max ${MAX_DATE_TO_FUTURE_DAYS})`;
  }

  const spanDays = Math.round((to.getTime() - from.getTime()) / 86400000);
  if (spanDays > MAX_DATE_SPAN_DAYS) {
    return `date span is ${spanDays} days (max ${MAX_DATE_SPAN_DAYS})`;
  }

  return null;
}

// --- Last page detection ---

export async function findLastPage(
  page: Page,
  firstPageUrl: string
): Promise<number> {
  const probes = [10, 20, 40, 60, 80, 100, 120];
  let lastValid = 1;
  let firstInvalid = -1;

  for (const probe of probes) {
    const url = buildPageURL(firstPageUrl, probe);
    log.info(`probing page ${probe}...`);
    const valid = await isPageValid(page, url);
    if (valid) {
      lastValid = probe;
    } else {
      firstInvalid = probe;
      break;
    }
  }

  if (firstInvalid === -1) {
    return lastValid;
  }

  let lo = lastValid;
  let hi = firstInvalid;

  while (lo + 1 < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const url = buildPageURL(firstPageUrl, mid);
    log.info(`binary search page ${mid}...`);
    const valid = await isPageValid(page, url);
    if (valid) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  return lo;
}

// --- Main discovery function ---

export interface DiscoverOptions {
  country?: string;
  store?: string;
  discoverOnly?: boolean;
  storage: StorageAdapter;
}

export async function discoverAll(
  options: DiscoverOptions
): Promise<DiscoveryReport> {
  const report: DiscoveryReport = {
    timestamp: new Date().toISOString(),
    stores: [],
    summary: { total: 0, new: 0, existing: 0 },
  };

  let storeDefinitions = await loadStoreDefinitions();

  // Filter by country/store if specified
  if (options.country) {
    storeDefinitions = storeDefinitions.filter(
      (d) => d.country === options.country
    );
  }
  if (options.store) {
    storeDefinitions = storeDefinitions.filter(
      (d) => d.name === options.store
    );
  }

  if (storeDefinitions.length === 0) {
    log.info("no matching store definitions found");
    return report;
  }

  // Get existing catalog IDs for deduplication
  const existingCatalogs = await options.storage.listCatalogs();
  const existingIds = new Set(existingCatalogs.map((c) => c.id));
  const seenIds = new Set<string>();

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 800, height: 1200 },
  });
  const page = await context.newPage();

  try {
    for (const storeDef of storeDefinitions) {
      const storeResult: {
        store: string;
        country: string;
        catalogs: CatalogResult[];
      } = {
        store: storeDef.name,
        country: storeDef.country,
        catalogs: [],
      };

      let catalogs: DiscoveredCatalog[];
      try {
        if (storeDef.restApiDiscovery) {
          catalogs = await discoverStoreViaRestApi(storeDef);
        } else if (storeDef.apiDiscovery) {
          catalogs = await discoverStoreViaApi(page, storeDef);
        } else {
          catalogs = await discoverStore(page, storeDef);
        }
      } catch (err) {
        log.error(`failed to discover ${storeDef.name}`, { err: String(err) });
        report.stores.push(storeResult);
        continue;
      }

      for (const catalog of catalogs) {
        const catalogId = buildCatalogId({
          country: catalog.country,
          store: catalog.store,
          dateFrom: catalog.dateFrom,
          dateTo: catalog.dateTo,
          catalogType: catalog.catalogType,
        });
        report.summary.total++;

        if (existingIds.has(catalogId) || seenIds.has(catalogId)) {
          log.info(`existing: ${catalogId}`);
          storeResult.catalogs.push({ catalogId, status: "existing" });
          report.summary.existing++;
          continue;
        }
        seenIds.add(catalogId);

        try {
          const resolverName = detectResolverName(
            catalog.firstPageUrl,
            storeDef.resolver
          );
          const needsLastPage = resolverName === "browser";

          let lastPage: number | undefined;
          if (needsLastPage) {
            log.info(`new catalog: ${catalogId} — probing pages...`);
            lastPage = await findLastPage(page, catalog.firstPageUrl);
          } else {
            log.info(`new catalog: ${catalogId} — resolver "${resolverName}" (skipping page probe)`);
          }

          // Resolve ISO dates and validate before persisting
          const isoDateFrom = toISODate(
            catalog.dateFrom,
            extractYear(catalog.dateTo)
          );
          const isoDateTo = toISODate(catalog.dateTo, undefined, true);

          const dateError = validateCatalogDates(isoDateFrom, isoDateTo);
          if (dateError) {
            log.warn(`skipping bogus catalog: ${catalogId} — ${dateError}`);
            continue;
          }

          // Write catalog meta through storage adapter
          const meta: CatalogMeta = {
            id: catalogId,
            store: catalog.store,
            country: catalog.country,
            status: "discovered",
            dateFrom: isoDateFrom,
            dateTo: isoDateTo,
            catalogType: catalog.catalogType,
            coverImage: "cover.jpg",
            pageCount: lastPage ?? 0,
            discoveredAt: new Date().toISOString(),
            _scraping: {
              resolver: resolverName,
              firstPageUrl: catalog.firstPageUrl,
              coverImageUrl: catalog.coverImageUrl,
              lastPage,
            },
          };

          await options.storage.writeCatalogMeta(meta);

          storeResult.catalogs.push({
            catalogId,
            status: "new",
            lastPage,
          });
          report.summary.new++;
        } catch (err) {
          log.error(`failed to probe ${catalogId}`, { err: String(err) });
        }
      }

      report.stores.push(storeResult);
    }
  } finally {
    await browser.close();
  }

  log.info(`done`, {
    total: report.summary.total,
    new: report.summary.new,
    existing: report.summary.existing,
  });
  return report;
}

function extractYear(dateTo: string): number {
  const parts = dateTo.split("-");
  if (parts.length === 3) {
    const year = parseInt(parts[2]!, 10);
    if (!isNaN(year)) return year;
  }
  return new Date().getFullYear();
}
