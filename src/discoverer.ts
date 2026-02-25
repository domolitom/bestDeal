import { chromium, type Page } from "playwright";
import { readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildPageURL } from "./resolver.ts";
import { resolveManifest } from "./resolver.ts";
import { downloadFromManifest } from "./downloader.ts";
import { loadStoreDefinitions } from "./store-config.ts";
import { discoverStore } from "./discovery-engine.ts";

// --- Types ---

export interface DiscoveredCatalog {
  store: string;
  slug: string;
  dateFrom: string;
  dateTo: string;
  firstPageUrl: string;
  coverImageUrl: string;
  catalogType?: string;
}

export interface CatalogResult {
  configId: string;
  status: "new" | "existing";
  lastPage?: number;
  configPath?: string;
}

export interface DiscoveryReport {
  timestamp: string;
  stores: { store: string; catalogs: CatalogResult[] }[];
  summary: { total: number; new: number; existing: number };
}

// --- Pure helpers (exported for testing) ---

export function buildConfigId(catalog: DiscoveredCatalog): string {
  const base = `${catalog.store}-${catalog.dateFrom}-${catalog.dateTo}`;
  if (catalog.catalogType) return `${base}-${catalog.catalogType}`;
  return base;
}

// --- Page validation ---

async function isPageValid(page: Page, url: string): Promise<boolean> {
  try {
    const response = await page.goto(url, { waitUntil: "domcontentloaded" });
    if (!response || response.status() >= 400) return false;
    await page.waitForTimeout(2000);

    // Check if the viewer redirected us to a different page number
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
    console.log(`[discoverer] probing page ${probe}...`);
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
    console.log(`[discoverer] binary search page ${mid}...`);
    const valid = await isPageValid(page, url);
    if (valid) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  return lo;
}

// --- Deduplication ---

async function getExistingConfigIds(): Promise<Set<string>> {
  try {
    const files = await readdir("configs");
    return new Set(
      files.filter((f) => f.endsWith(".json")).map((f) => f.replace(".json", ""))
    );
  } catch {
    return new Set();
  }
}

// --- Config writing ---

async function writeConfig(
  catalog: DiscoveredCatalog,
  lastPage: number
): Promise<string> {
  const configId = buildConfigId(catalog);
  const config = {
    id: configId,
    cover_image: catalog.coverImageUrl,
    first_page: catalog.firstPageUrl,
    last_page: buildPageURL(catalog.firstPageUrl, lastPage),
  };
  const configPath = join("configs", `${configId}.json`);
  await writeFile(configPath, JSON.stringify(config, null, 4));
  console.log(`[discoverer] wrote config: ${configPath}`);
  return configPath;
}

// --- Main function ---

export async function discoverAll(
  options?: { autoScrape?: boolean }
): Promise<DiscoveryReport> {
  const report: DiscoveryReport = {
    timestamp: new Date().toISOString(),
    stores: [],
    summary: { total: 0, new: 0, existing: 0 },
  };

  const existingIds = await getExistingConfigIds();
  const seenIds = new Set<string>();
  const storeDefinitions = await loadStoreDefinitions();

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 800, height: 1200 },
  });
  const page = await context.newPage();

  try {
    for (const storeDef of storeDefinitions) {
      const storeResult: { store: string; catalogs: CatalogResult[] } = {
        store: storeDef.name,
        catalogs: [],
      };

      let catalogs: DiscoveredCatalog[];
      try {
        catalogs = await discoverStore(page, storeDef);
      } catch (err) {
        console.error(`[discoverer] failed to discover ${storeDef.name}:`, err);
        report.stores.push(storeResult);
        continue;
      }

      for (const catalog of catalogs) {
        const configId = buildConfigId(catalog);
        report.summary.total++;

        if (existingIds.has(configId) || seenIds.has(configId)) {
          console.log(`[discoverer] existing: ${configId}`);
          storeResult.catalogs.push({ configId, status: "existing" });
          report.summary.existing++;
          continue;
        }
        seenIds.add(configId);

        try {
          console.log(
            `[discoverer] new catalog: ${configId} — probing pages...`
          );
          const lastPage = await findLastPage(page, catalog.firstPageUrl);
          const configPath = await writeConfig(catalog, lastPage);

          storeResult.catalogs.push({
            configId,
            status: "new",
            lastPage,
            configPath,
          });
          report.summary.new++;

          if (options?.autoScrape) {
            console.log(`[discoverer] auto-scraping: ${configId}`);
            (async () => {
              try {
                const manifest = await resolveManifest(configPath);
                await downloadFromManifest(manifest);
                console.log(`[discoverer] auto-scrape done: ${configId}`);
              } catch (err) {
                console.error(
                  `[discoverer] auto-scrape failed: ${configId}`,
                  err
                );
              }
            })();
          }
        } catch (err) {
          console.error(
            `[discoverer] failed to probe ${configId}:`,
            err
          );
        }
      }

      report.stores.push(storeResult);
    }
  } finally {
    await browser.close();
  }

  console.log(
    `[discoverer] done — ${report.summary.total} catalogs found (${report.summary.new} new, ${report.summary.existing} existing)`
  );
  return report;
}

// --- CLI entry point ---

if (import.meta.main) {
  const autoScrape = process.argv.includes("--auto-scrape");
  discoverAll({ autoScrape })
    .then((report) => {
      console.log("\n" + JSON.stringify(report, null, 2));
    })
    .catch((err) => {
      console.error("[discoverer] fatal:", err);
      process.exit(1);
    });
}
