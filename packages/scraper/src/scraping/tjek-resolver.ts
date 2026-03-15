import { chromium } from "../browser.ts";
import type { ResolveResult, ResolvedPage } from "./resolver-types.ts";
import type { CatalogResolver, ResolveInput } from "./resolver-registry.ts";
import { registerResolver } from "./resolver-registry.ts";

/**
 * Resolve page images for Tjek-hosted catalogs (e.g. Netto).
 *
 * Tjek embeds catalog page URLs in the HTML. On listing pages (e.g. /prospekte/)
 * we first click the catalog to open the full viewer, then extract all page URLs.
 */
async function resolveViaTjek(
  input: ResolveInput
): Promise<ResolveResult> {
  const { firstPageUrl, catalogId } = input;

  console.log(`[tjek] loading ${firstPageUrl}`);

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(firstPageUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForTimeout(12000);

    // Click the first catalog thumbnail to open the full viewer
    const clicked = await page.evaluate(() => {
      const img = document.querySelector("img[src*='tjek.com']");
      if (img) {
        const parent = img.closest("button, a, [role='button']");
        if (parent) {
          (parent as HTMLElement).click();
          return true;
        }
        (img as HTMLElement).click();
        return true;
      }
      return false;
    });

    if (clicked) {
      console.log(`[tjek] clicked catalog thumbnail, waiting for viewer...`);
      await page.waitForTimeout(8000);
    }

    // Extract all Tjek image URLs from the HTML source
    const html = await page.content();
    const urlMatches = [
      ...html.matchAll(/image-transformer-api\.tjek\.com[^"'\s\\]*/g),
    ];

    // Decode and normalize URLs
    const allUrls: string[] = [];
    for (const m of urlMatches) {
      const raw = "https://" +
        m[0]
          .replace(/&amp;/g, "&")
          .replace(/\\u0026/g, "&")
          .replace(/&#x26;/g, "&");
      let decoded: string;
      try {
        decoded = decodeURIComponent(raw);
      } catch {
        decoded = raw;
      }
      if (decoded.includes("/p-") && decoded.includes("w=700")) {
        allUrls.push(decoded);
      }
    }

    // Group by catalog ID and deduplicate
    const catalogIds = [
      ...new Set(
        allUrls
          .map((u) => {
            const m = u.match(/uploads\/([^/]+)\//);
            return m?.[1] || "";
          })
          .filter(Boolean)
      ),
    ];

    console.log(`[tjek] found ${catalogIds.length} catalog(s): ${catalogIds.join(", ")}`);

    // Use the catalog with the most pages (skip dealer logos)
    let bestId = catalogIds[0] || "";
    let bestPages: string[] = [];
    for (const id of catalogIds) {
      const pages = allUrls.filter((u) => u.includes(id));
      if (pages.length > bestPages.length) {
        bestId = id;
        bestPages = pages;
      }
    }

    // Sort by page number and deduplicate
    const pageMap = new Map<number, string>();
    for (const url of bestPages) {
      const m = url.match(/p-(\d+)/);
      if (!m) continue;
      const num = parseInt(m[1]!);
      if (!pageMap.has(num)) pageMap.set(num, url);
    }

    const sortedPages = [...pageMap.entries()].sort((a, b) => a[0] - b[0]);

    console.log(
      `[tjek] got ${sortedPages.length} pages for ${catalogId} (tjek catalog: ${bestId})`
    );

    const pages: ResolvedPage[] = sortedPages.map(([num, url]) => ({
      number: num,
      imageUrl: url,
    }));

    return {
      catalogId,
      coverImageUrl: pages[0]?.imageUrl ?? "",
      pages,
    };
  } finally {
    await browser.close();
  }
}

const tjekResolver: CatalogResolver = {
  name: "tjek",
  needsLastPage: false,
  resolve: resolveViaTjek,
};

registerResolver(tjekResolver);
