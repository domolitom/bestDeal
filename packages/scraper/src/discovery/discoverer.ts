import { chromium } from "../browser.ts";
import type { Page } from "playwright";
import { buildCatalogId, buildPageURL } from "@bestdeal/shared";
import type { StorageAdapter, CatalogMeta } from "@bestdeal/shared";
import { loadStoreDefinitions } from "../config/store-loader.ts";
import { discoverStore, discoverStoreViaApi } from "./discovery-engine.ts";
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
        catalogs = storeDef.apiDiscovery
          ? await discoverStoreViaApi(page, storeDef)
          : await discoverStore(page, storeDef);
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

          // Write catalog meta through storage adapter
          const meta: CatalogMeta = {
            id: catalogId,
            store: catalog.store,
            country: catalog.country,
            status: "discovered",
            dateFrom: toISODate(
              catalog.dateFrom,
              extractYear(catalog.dateTo)
            ),
            dateTo: toISODate(catalog.dateTo, undefined, true),
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
