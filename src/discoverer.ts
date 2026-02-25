import { chromium, type Page } from "playwright";
import { readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildPageURL } from "./resolver.ts";
import { resolveManifest } from "./resolver.ts";
import { downloadFromManifest } from "./downloader.ts";

// --- Types ---

export interface DiscoveredCatalog {
  store: string;
  slug: string;
  dateFrom: string;
  dateTo: string;
  firstPageUrl: string;
  coverImageUrl: string;
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
  return `${catalog.store}-${catalog.dateFrom}-${catalog.dateTo}`;
}

export function parseLidlDates(
  slug: string
): { dateFrom: string; dateTo: string } | null {
  // Slug like "catalogul-saptamanal-pentru-perioada-09-02-15-02-2026"
  const match = slug.match(/(\d{2}-\d{2})-(\d{2}-\d{2}-\d{4})$/);
  if (!match) return null;
  return { dateFrom: match[1]!, dateTo: match[2]! };
}

export function parseKauflandDates(
  text: string
): { dateFrom: string; dateTo: string } | null {
  // Text like "25.02.2026-03.03.2026" or "25.02.2026 - 03.03.2026"
  const match = text.match(
    /(\d{2})\.(\d{2})\.(\d{4})\s*-\s*(\d{2})\.(\d{2})\.(\d{4})/
  );
  if (!match) return null;
  return {
    dateFrom: `${match[1]}-${match[2]}`,
    dateTo: `${match[4]}-${match[5]}-${match[6]}`,
  };
}

// --- Page validation ---

async function isPageValid(page: Page, url: string): Promise<boolean> {
  try {
    const response = await page.goto(url, { waitUntil: "domcontentloaded" });
    if (!response || response.status() >= 400) return false;
    await page.waitForTimeout(2000);
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
  // Exponential probe to find upper bound
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

  // If all probes were valid, the catalog is very large
  if (firstInvalid === -1) {
    return lastValid;
  }

  // Binary search between lastValid and firstInvalid
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

// --- Per-store discovery functions ---

async function discoverLidl(page: Page): Promise<DiscoveredCatalog[]> {
  console.log("[discoverer] discovering Lidl catalogs...");
  await page.goto("https://www.lidl.ro/l/ro/cataloage", {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(3000);

  const catalogs = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll("a[href]"));
    const results: {
      slug: string;
      firstPageUrl: string;
      coverImageUrl: string;
    }[] = [];

    for (const link of links) {
      const href = (link as HTMLAnchorElement).href;
      // Match catalog page links like /cataloage/.../view/flyer/page/
      const match = href.match(
        /\/cataloage\/([^/]+)\/view\/flyer\/page\/\d+/
      );
      if (!match) continue;

      const slug = match[1]!;
      // Skip if we already found this slug
      if (results.some((r) => r.slug === slug)) continue;

      // Build first page URL from the matched pattern
      const firstPageUrl = href.replace(/\/page\/\d+/, "/page/1");
      results.push({
        slug,
        firstPageUrl,
        coverImageUrl: firstPageUrl,
      });
    }
    return results;
  });

  const discovered: DiscoveredCatalog[] = [];
  for (const c of catalogs) {
    const dates = parseLidlDates(c.slug);
    if (!dates) {
      console.log(`[discoverer] skipping Lidl slug (no dates): ${c.slug}`);
      continue;
    }
    discovered.push({
      store: "lidl",
      slug: c.slug,
      dateFrom: dates.dateFrom,
      dateTo: dates.dateTo,
      firstPageUrl: c.firstPageUrl,
      coverImageUrl: c.coverImageUrl,
    });
  }

  console.log(`[discoverer] found ${discovered.length} Lidl catalog(s)`);
  return discovered;
}

async function discoverKaufland(page: Page): Promise<DiscoveredCatalog[]> {
  console.log("[discoverer] discovering Kaufland catalogs...");
  await page.goto("https://www.kaufland.ro/cataloage-cu-reduceri.html", {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(3000);

  const catalogs = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll("a[href]"));
    const results: {
      href: string;
      dateText: string;
    }[] = [];

    for (const link of links) {
      const href = (link as HTMLAnchorElement).href;
      if (!href.includes("leaflets.kaufland.com")) continue;
      // Skip if we already found this href
      if (results.some((r) => r.href === href)) continue;

      // Look for date text near this link
      const card = link.closest("[class*='card']") || link.parentElement;
      const dateText = card?.textContent || "";

      results.push({ href, dateText });
    }
    return results;
  });

  const discovered: DiscoveredCatalog[] = [];
  for (const c of catalogs) {
    const dates = parseKauflandDates(c.dateText);
    if (!dates) {
      console.log(
        `[discoverer] skipping Kaufland link (no dates): ${c.href}`
      );
      continue;
    }

    // Normalize the leaflet URL to page 1
    const firstPageUrl = c.href.includes("/page/")
      ? c.href.replace(/\/page\/\d+/, "/page/1")
      : c.href.replace(/\/?$/, "/view/flyer/page/1");

    discovered.push({
      store: "kaufland",
      slug: c.href,
      dateFrom: dates.dateFrom,
      dateTo: dates.dateTo,
      firstPageUrl,
      coverImageUrl: firstPageUrl,
    });
  }

  console.log(`[discoverer] found ${discovered.length} Kaufland catalog(s)`);
  return discovered;
}

// --- Store registry ---

const STORE_DISCOVERERS: Record<
  string,
  (page: Page) => Promise<DiscoveredCatalog[]>
> = {
  lidl: discoverLidl,
  kaufland: discoverKaufland,
};

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

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 800, height: 1200 },
  });
  const page = await context.newPage();

  try {
    for (const [store, discover] of Object.entries(STORE_DISCOVERERS)) {
      const storeResult: { store: string; catalogs: CatalogResult[] } = {
        store,
        catalogs: [],
      };

      let catalogs: DiscoveredCatalog[];
      try {
        catalogs = await discover(page);
      } catch (err) {
        console.error(`[discoverer] failed to discover ${store}:`, err);
        report.stores.push(storeResult);
        continue;
      }

      for (const catalog of catalogs) {
        const configId = buildConfigId(catalog);
        report.summary.total++;

        if (existingIds.has(configId)) {
          console.log(`[discoverer] existing: ${configId}`);
          storeResult.catalogs.push({ configId, status: "existing" });
          report.summary.existing++;
          continue;
        }

        // New catalog — find last page
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
