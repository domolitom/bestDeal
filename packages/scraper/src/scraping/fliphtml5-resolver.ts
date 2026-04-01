import { chromium } from "../browser.ts";
import type { ResolveResult, ResolvedPage } from "./resolver-types.ts";
import type { CatalogResolver, ResolveInput } from "./resolver-registry.ts";
import { createLogger } from "../logger.ts";

const log = createLogger({ module: "fliphtml5" });

/**
 * Extract the base URL for a FlipHTML5 book from its viewer URL.
 * e.g. "https://online.fliphtml5.com/wmhel/Catalog-Animax-Martie-2026/" → same (normalised)
 */
export function normalizeFlipHtml5Url(url: string): string {
  // Remove trailing slash, query, hash
  return url.replace(/[?#].*$/, "").replace(/\/$/, "");
}

interface FlipHtml5Page {
  /** Normal/large image path, e.g. "files/large/{hash}.webp?ts" */
  n: string;
  /** Thumbnail path */
  t: string;
  /** Large jpg fallback, e.g. "files/large/1.jpg?ts" */
  l: string;
  /** Preview thumbnail */
  p: string;
}

/**
 * Resolve page image URLs for a FlipHTML5-hosted catalog.
 *
 * FlipHTML5 encodes its page list in config.js using a WASM-based decoder
 * (deString.js). We load the viewer page in Playwright just long enough
 * to let the decoder run, then extract the decoded `window.fliphtml5_pages`
 * array which contains all page image paths.
 */
async function resolveViaFlipHtml5(
  input: ResolveInput
): Promise<ResolveResult> {
  const { firstPageUrl, catalogId } = input;
  const baseUrl = normalizeFlipHtml5Url(firstPageUrl);

  log.info(`loading ${baseUrl}`);

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();

    await page.goto(baseUrl, {
      waitUntil: "load",
      timeout: 30000,
    });

    // Wait for the WASM decoder to populate window.fliphtml5_pages
    await page.waitForFunction(
      () => {
        const pages = (window as any).fliphtml5_pages;
        return Array.isArray(pages) && pages.length > 0;
      },
      null,
      { timeout: 15000 }
    );

    const pageData: FlipHtml5Page[] = await page.evaluate(
      () => (window as any).fliphtml5_pages
    );

    if (!pageData || pageData.length === 0) {
      throw new Error(`FlipHTML5 decoded no pages: ${baseUrl}`);
    }

    log.info(`got ${pageData.length} pages`, { catalogId });

    const pages: ResolvedPage[] = pageData.map((p, i) => ({
      number: i + 1,
      imageUrl: `${baseUrl}/${p.n}`,
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

// --- CatalogResolver implementation ---

export const flipHtml5Resolver: CatalogResolver = {
  name: "fliphtml5",
  needsLastPage: false,
  resolve: resolveViaFlipHtml5,
};

