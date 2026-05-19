import type { StorageAdapter, CatalogMeta, CatalogSummary } from "@bestdeal/shared";
import { isCatalogActive } from "@bestdeal/shared";
import { discoverAll } from "./discovery/discoverer.ts";
import type { DiscoveryReport } from "./discovery/discoverer.ts";
import { getResolver } from "./scraping/resolver-registry.ts";
import { downloadCatalogImages } from "./scraping/downloader.ts";
import { createLogger } from "./logger.ts";

const log = createLogger({ module: "pipeline" });



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
  recovered: string[];
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
    log.warn(`recovered stale catalog: ${summary.id}`);
  }

  if (recovered.length > 0) {
    log.warn(`Recovered ${recovered.length} stale catalog(s)`);
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
    log.info(`expired catalog: ${summary.id}`);
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

  const expired = await expireOldCatalogs(storage);
  if (expired.length > 0) {
    log.info(`expired ${expired.length} old catalog(s)`);
  }

  const pipelineTimer = log.time();

  // Phase 1: Discovery
  log.info("=== Phase 1: Discovery ===");
  const discovery = await discoverAll({
    storage,
    country,
    store,
  });

  const report: PipelineReport = {
    discovery,
    scraped: [],
    failed: [],
    recovered,
  };

  if (discoverOnly) {
    log.info("discover-only mode, skipping scraping");
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
    log.info("no catalogs to scrape");
    await generateManifest(storage, country);
    return report;
  }

  log.info(`=== Phase 2: Scraping ${toScrape.length} catalog(s) ===`);

  for (const catalog of toScrape) {
    try {
      const fullCatalog = await storage.getCatalog(catalog.catalogId);
      if (!fullCatalog) {
        log.warn(`catalog not found in storage`, { catalogId: catalog.catalogId });
        report.failed.push(catalog.catalogId);
        continue;
      }

      const scrapingInfo = fullCatalog._scraping ?? null;
      if (!scrapingInfo) {
        log.warn(`no scraping info`, { catalogId: catalog.catalogId });
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
      const catalogTimer = log.time();
      log.info(`resolving`, { catalogId: catalog.catalogId });
      const resolver = getResolver(
        scrapingInfo.firstPageUrl,
        scrapingInfo.resolver
      );

      const CATALOG_TIMEOUT_MS = 300000; // 5 minutes per catalog

      const resolveAndDownload = async () => {
        const resolved = await resolver.resolve({
          catalogId: catalog.catalogId,
          firstPageUrl: scrapingInfo.firstPageUrl,
          coverImageUrl: scrapingInfo.coverImageUrl,
          lastPage: scrapingInfo.lastPage,
        });

        if (resolved.pages.length === 0) {
          throw new Error("resolver returned 0 pages");
        }

        // Download images
        log.info(`downloading`, { catalogId: catalog.catalogId });
        const downloadResult = await downloadCatalogImages(resolved, storage);
        return { ...downloadResult, pageCount: resolved.pages.length };
      };

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`catalog timed out after ${CATALOG_TIMEOUT_MS}ms`)),
          CATALOG_TIMEOUT_MS
        )
      );

      const { coverThumb, pageCount } = await Promise.race([resolveAndDownload(), timeoutPromise]);

      // Update status to ready
      await storage.writeCatalogMeta({
        ...metaUpdate,
        status: "ready",
        pageCount: pageCount,
        scrapedAt: new Date().toISOString(),
        ...(coverThumb ? { coverThumb } : {}),
      });

      report.scraped.push(catalog.catalogId);
      log.info(`completed`, { catalogId: catalog.catalogId, durationMs: catalogTimer() });
    } catch (err) {
      log.error(`failed to scrape`, { catalogId: catalog.catalogId, err: String(err) });
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

  log.info(`pipeline complete`, {
    scraped: report.scraped.length,
    failed: report.failed.length,
    durationMs: pipelineTimer(),
  });

  // Generate per-country manifest.json for CDN-based web app
  await generateManifest(storage, country);

  return report;
}

/** Maximum days past dateTo before a catalog is excluded from the manifest. */
const MANIFEST_EXPIRY_DAYS = 30;

/** Maximum days dateTo may be in the future before a catalog is excluded from the manifest. */
const MANIFEST_MAX_FUTURE_DAYS = 365;

/** Maximum allowed span (dateFrom → dateTo) in days before a catalog is excluded from the manifest. */
const MANIFEST_MAX_SPAN_DAYS = 60;

/**
 * Return true when a catalog's dates are sane enough to include in the manifest:
 * - dateFrom and dateTo must be parseable
 * - dateTo must not be before dateFrom (inverted)
 * - dateTo must not be more than 1 year ahead of today
 * - dateTo must not be more than 30 days in the past
 */
export function isManifestEligible(meta: Pick<CatalogMeta, "id" | "dateFrom" | "dateTo">): boolean {
  const from = new Date(meta.dateFrom);
  const to = new Date(meta.dateTo);

  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    log.warn(`manifest: skipping ${meta.id} — unparseable dates`);
    return false;
  }

  if (to < from) {
    log.warn(`manifest: skipping ${meta.id} — inverted dates (dateTo before dateFrom)`);
    return false;
  }

  const spanDays = (to.getTime() - from.getTime()) / 86400000;
  if (spanDays > MANIFEST_MAX_SPAN_DAYS) {
    log.warn(`manifest: skipping ${meta.id} — span is ${Math.round(spanDays)} days (max 60)`);
    return false;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const maxFuture = new Date(today);
  maxFuture.setDate(maxFuture.getDate() + MANIFEST_MAX_FUTURE_DAYS);
  if (to > maxFuture) {
    const daysAhead = Math.round((to.getTime() - today.getTime()) / 86400000);
    log.warn(`manifest: skipping ${meta.id} — dateTo ${meta.dateTo} is ${daysAhead} days ahead`);
    return false;
  }

  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() - MANIFEST_EXPIRY_DAYS);
  if (to < cutoff) {
    const daysAgo = Math.round((today.getTime() - to.getTime()) / 86400000);
    log.warn(`manifest: skipping ${meta.id} — expired ${daysAgo} days ago`);
    return false;
  }

  return true;
}

/**
 * Write per-country and root manifest.json files listing all ready catalogs.
 * When `country` is set, writes only that country's manifest plus the root.
 * When no country, writes a manifest for every country that has ready catalogs
 * and a single root manifest.json containing all catalogs across all countries.
 * Catalogs with bogus or stale dates are silently excluded from the manifest.
 *
 * Uses CatalogSummary data from listCatalogs() directly — no per-catalog
 * getCatalog() calls needed, eliminating the N+1 reads against R2.
 */
export async function generateManifest(
  storage: StorageAdapter,
  country?: string
): Promise<void> {
  if (!storage.writeManifest) {
    return;
  }

  const summaries = await storage.listCatalogs({ status: "ready" });

  // Group summaries by country, filtering out any with bogus dates.
  // CatalogSummary has all fields needed for the manifest and for eligibility
  // checks — no need to re-fetch each catalog individually.
  const byCountry = new Map<string, CatalogSummary[]>();
  for (const summary of summaries) {
    if (!isManifestEligible(summary)) continue;
    const arr = byCountry.get(summary.country) ?? [];
    arr.push(summary);
    byCountry.set(summary.country, arr);
  }

  const updatedAt = new Date().toISOString();

  // Determine which countries to write
  const countries = country ? [country] : [...byCountry.keys()];

  for (const c of countries) {
    const countryCatalogs = byCountry.get(c) ?? [];
    const manifest = { updatedAt, catalogs: countryCatalogs };
    await storage.writeManifest!(JSON.stringify(manifest, null, 2), c);
    log.info(`wrote ${c}/manifest.json`, { catalogs: countryCatalogs.length });
  }

  // Always write a root manifest.json covering all countries so the web app
  // can fetch a single file instead of one per country.
  const allCatalogs = [...byCountry.values()].flat();
  const rootManifest = { updatedAt, catalogs: allCatalogs };
  await storage.writeManifest!(JSON.stringify(rootManifest, null, 2));
  log.info(`wrote manifest.json`, { catalogs: allCatalogs.length });
}
