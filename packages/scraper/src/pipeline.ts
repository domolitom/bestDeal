import type { StorageAdapter, CatalogMeta } from "@bestdeal/shared";
import { discoverAll } from "./discovery/discoverer.ts";
import type { DiscoveryReport } from "./discovery/discoverer.ts";
import { getResolver } from "./scraping/resolver-registry.ts";
import { downloadCatalogImages } from "./scraping/downloader.ts";

// Side-effect imports: register resolvers
import "./scraping/leaflets-api-resolver.ts";
import "./scraping/resolver.ts";

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

      const scrapingInfo = fullCatalog._scraping ?? null;
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

      // Resolve image URLs via registry-dispatched resolver
      console.log(`\n[pipeline] resolving ${catalog.catalogId}...`);
      const resolver = getResolver(
        scrapingInfo.firstPageUrl,
        scrapingInfo.resolver
      );
      const resolved = await resolver.resolve({
        catalogId: catalog.catalogId,
        firstPageUrl: scrapingInfo.firstPageUrl,
        coverImageUrl: scrapingInfo.coverImageUrl,
        lastPage: scrapingInfo.lastPage,
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
