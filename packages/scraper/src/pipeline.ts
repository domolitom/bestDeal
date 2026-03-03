import type { StorageAdapter, CatalogMeta } from "@bestdeal/shared";
import { discoverAll } from "./discovery/discoverer.ts";
import type { DiscoveryReport } from "./discovery/discoverer.ts";
import { resolvePages } from "./scraping/resolver.ts";
import {
  isLeafletsUrl,
  resolveViaLeafletsApi,
} from "./scraping/leaflets-api-resolver.ts";
import { downloadCatalogImages } from "./scraping/downloader.ts";
import { parseCatalogId } from "@bestdeal/shared";

export interface PipelineOptions {
  storage: StorageAdapter;
  country?: string;
  store?: string;
  discoverOnly?: boolean;
}

export interface PipelineReport {
  discovery: DiscoveryReport;
  scraped: string[];
  failed: string[];
}

/**
 * Full scraping pipeline: discover → resolve → download.
 */
export async function runPipeline(
  options: PipelineOptions
): Promise<PipelineReport> {
  const { storage, country, store, discoverOnly } = options;

  // Phase 1: Discovery
  console.log("\n=== Phase 1: Discovery ===\n");
  const discovery = await discoverAll({
    storage,
    country,
    store,
  });

  const report: PipelineReport = {
    discovery,
    scraped: [],
    failed: [],
  };

  if (discoverOnly) {
    console.log("\n[pipeline] discover-only mode, skipping scraping");
    return report;
  }

  // Phase 2: Scrape new catalogs
  const newCatalogs = discovery.stores.flatMap((s) =>
    s.catalogs.filter((c) => c.status === "new")
  );

  if (newCatalogs.length === 0) {
    console.log("\n[pipeline] no new catalogs to scrape");
    return report;
  }

  console.log(
    `\n=== Phase 2: Scraping ${newCatalogs.length} new catalog(s) ===\n`
  );

  for (const catalog of newCatalogs) {
    try {
      const fullCatalog = await storage.getCatalog(catalog.catalogId);
      if (!fullCatalog) {
        console.warn(
          `[pipeline] catalog ${catalog.catalogId} not found in storage`
        );
        report.failed.push(catalog.catalogId);
        continue;
      }

      // Extract scraping info from meta (stored during discovery as extra fields)
      const scrapingInfo = extractScrapingInfo(
        fullCatalog as unknown as Record<string, unknown>
      );
      if (!scrapingInfo) {
        console.warn(
          `[pipeline] no scraping info for ${catalog.catalogId}`
        );
        report.failed.push(catalog.catalogId);
        continue;
      }

      // Update status to scraping
      const metaUpdate: CatalogMeta = {
        id: fullCatalog.id,
        store: fullCatalog.store,
        country: fullCatalog.country,
        status: "scraping",
        dateFrom: fullCatalog.dateFrom,
        dateTo: fullCatalog.dateTo,
        catalogType: fullCatalog.catalogType,
        coverImage: fullCatalog.coverImage,
        pageCount: fullCatalog.pageCount,
        discoveredAt: fullCatalog.discoveredAt,
      };
      await storage.writeCatalogMeta(metaUpdate);

      // Resolve image URLs — use fast API path for leaflets.schwarz URLs
      console.log(`\n[pipeline] resolving ${catalog.catalogId}...`);
      const resolved = isLeafletsUrl(scrapingInfo.firstPageUrl)
        ? await resolveViaLeafletsApi({
            firstPageUrl: scrapingInfo.firstPageUrl,
            catalogId: catalog.catalogId,
          })
        : await resolvePages({
            firstPageUrl: scrapingInfo.firstPageUrl,
            lastPage: scrapingInfo.lastPage,
            coverImageUrl: scrapingInfo.coverImageUrl,
            catalogId: catalog.catalogId,
          });

      // Download images
      console.log(`[pipeline] downloading ${catalog.catalogId}...`);
      await downloadCatalogImages(resolved, storage);

      // Update status to ready
      await storage.writeCatalogMeta({
        ...metaUpdate,
        status: "ready",
        pageCount: resolved.pages.length,
        scrapedAt: new Date().toISOString(),
      });

      report.scraped.push(catalog.catalogId);
      console.log(`[pipeline] completed ${catalog.catalogId}`);
    } catch (err) {
      console.error(
        `[pipeline] failed to scrape ${catalog.catalogId}:`,
        err
      );
      report.failed.push(catalog.catalogId);
    }
  }

  console.log(
    `\n=== Pipeline complete: ${report.scraped.length} scraped, ${report.failed.length} failed ===\n`
  );
  return report;
}

/**
 * Extract the _scraping info from a catalog object.
 * During discovery, we store scraping URLs as an extra _scraping field in meta.json.
 */
function extractScrapingInfo(
  catalog: Record<string, unknown>
): {
  firstPageUrl: string;
  coverImageUrl: string;
  lastPage: number;
} | null {
  const scraping = catalog["_scraping"];
  if (
    scraping &&
    typeof scraping === "object" &&
    scraping !== null &&
    "firstPageUrl" in scraping &&
    "lastPage" in scraping
  ) {
    return scraping as {
      firstPageUrl: string;
      coverImageUrl: string;
      lastPage: number;
    };
  }
  return null;
}
