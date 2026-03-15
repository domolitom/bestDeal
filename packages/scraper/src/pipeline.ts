import type { StorageAdapter, CatalogMeta } from "@bestdeal/shared";
import { isCatalogActive } from "@bestdeal/shared";
import { discoverAll } from "./discovery/discoverer.ts";
import type { DiscoveryReport } from "./discovery/discoverer.ts";
import { getResolver } from "./scraping/resolver-registry.ts";
import { downloadCatalogImages } from "./scraping/downloader.ts";

// Side-effect imports: register resolvers
import "./scraping/leaflets-api-resolver.ts";
import "./scraping/publitas-api-resolver.ts";
import "./scraping/yumpu-api-resolver.ts";
import "./scraping/ipaper-api-resolver.ts";
import "./scraping/pdf-resolver.ts";
import "./scraping/fliphtml5-resolver.ts";
import "./scraping/flippingbook-resolver.ts";
import "./scraping/digital-catalogue-resolver.ts";
import "./scraping/tjek-resolver.ts";
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
 * Recover catalogs stuck in "scraping" status from a previous crashed run.
 * Resets them to "discovered" so they get retried on the next scrape phase.
 */
export async function recoverStaleCatalogs(
  storage: StorageAdapter
): Promise<string[]> {
  const stale = await storage.listCatalogs({ status: "scraping" });
  const recovered: string[] = [];

  for (const summary of stale) {
    const catalog = await storage.getCatalog(summary.id);
    if (!catalog) continue;

    const { pages, ...meta } = catalog;
    await storage.writeCatalogMeta({ ...meta, status: "discovered" });
    recovered.push(summary.id);
    console.log(`[pipeline] recovered stale catalog: ${summary.id}`);
  }

  return recovered;
}

/**
 * Mark catalogs whose dateTo has passed as "expired".
 */
export async function expireOldCatalogs(
  storage: StorageAdapter
): Promise<string[]> {
  const ready = await storage.listCatalogs({ status: "ready" });
  const expired: string[] = [];

  for (const summary of ready) {
    if (isCatalogActive(summary.dateTo)) continue;

    const catalog = await storage.getCatalog(summary.id);
    if (!catalog) continue;

    const { pages, ...meta } = catalog;
    await storage.writeCatalogMeta({ ...meta, status: "expired" });
    expired.push(summary.id);
    console.log(`[pipeline] expired catalog: ${summary.id}`);
  }

  return expired;
}

/**
 * Full scraping pipeline: recover → expire → discover → resolve → download.
 */
export async function runPipeline(
  options: PipelineOptions
): Promise<PipelineReport> {
  const { storage, country, store, discoverOnly } = options;

  // Phase 0: Housekeeping — recover stale + expire old catalogs
  const recovered = await recoverStaleCatalogs(storage);
  if (recovered.length > 0) {
    console.log(
      `[pipeline] recovered ${recovered.length} stale catalog(s)`
    );
  }

  const expired = await expireOldCatalogs(storage);
  if (expired.length > 0) {
    console.log(
      `[pipeline] expired ${expired.length} old catalog(s)\n`
    );
  }

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

  // Phase 2: Scrape new + previously-discovered-but-not-yet-scraped catalogs
  const allCatalogIds = discovery.stores.flatMap((s) =>
    s.catalogs.map((c) => c.catalogId)
  );

  // Collect catalogs that need scraping (status = "discovered" in storage)
  const toScrape: { catalogId: string }[] = [];
  for (const id of [...new Set(allCatalogIds)]) {
    const cat = await storage.getCatalog(id);
    if (cat && cat.status === "discovered") {
      toScrape.push({ catalogId: id });
    }
  }

  if (toScrape.length === 0) {
    console.log("\n[pipeline] no catalogs to scrape");
    await generateManifest(storage);
    return report;
  }

  console.log(
    `\n=== Phase 2: Scraping ${toScrape.length} catalog(s) ===\n`
  );

  for (const catalog of toScrape) {
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

      // Mark as failed so it doesn't stay stuck in "scraping"
      try {
        const failedCatalog = await storage.getCatalog(catalog.catalogId);
        if (failedCatalog) {
          const { pages, ...meta } = failedCatalog;
          await storage.writeCatalogMeta({ ...meta, status: "failed" });
        }
      } catch {
        // Best effort — don't mask the original error
      }
    }
  }

  console.log(
    `\n=== Pipeline complete: ${report.scraped.length} scraped, ${report.failed.length} failed ===\n`
  );

  // Generate manifest.json for CDN-based web app
  await generateManifest(storage);

  return report;
}

/**
 * Write a manifest.json listing all ready catalogs.
 * The web app reads this via fetch() from the CDN — no S3 SDK needed at runtime.
 */
export async function generateManifest(storage: StorageAdapter): Promise<void> {
  const catalogs = await storage.listCatalogs({ status: "ready" });
  const manifest = {
    updatedAt: new Date().toISOString(),
    catalogs: [] as CatalogMeta[],
  };

  for (const summary of catalogs) {
    const catalog = await storage.getCatalog(summary.id);
    if (!catalog) continue;
    const { pages, ...meta } = catalog;
    manifest.catalogs.push(meta);
  }

  // Use writeManifest if available (R2 adapter), otherwise skip
  if ("writeManifest" in storage && typeof storage.writeManifest === "function") {
    await (storage as any).writeManifest(JSON.stringify(manifest, null, 2));
    console.log(`[pipeline] wrote manifest.json (${manifest.catalogs.length} catalogs)`);
  }
}
