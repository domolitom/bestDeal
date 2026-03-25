import type { ResolveResult, ResolvedPage } from "./resolver-types.ts";
import type { CatalogResolver, ResolveInput } from "./resolver-registry.ts";
import { createLogger } from "../logger.ts";

const log = createLogger({ module: "tjek" });

/**
 * Extract all Tjek image page URLs from raw HTML.
 *
 * Tjek embeds the full catalog as image-transformer-api.tjek.com URLs directly
 * in the server-rendered HTML — no JavaScript execution required.
 *
 * The URLs look like:
 *   image-transformer-api.tjek.com/?u=s3%3A%2F%2F...%2Fuploads%2F{id}%2Fp-{n}.webp&w=700&s={sig}
 *
 * We decode them, filter to page images (p-N), group by upload ID, and pick
 * the catalog with the most pages (skipping small dealer-logo assets).
 */
export function parseTjekPages(html: string): {
  tjekCatalogId: string;
  pages: ResolvedPage[];
} {
  const urlMatches = [
    ...html.matchAll(/image-transformer-api\.tjek\.com[^"'\s\\<>]*/g),
  ];

  // Decode and normalize URLs
  const allUrls: string[] = [];
  for (const m of urlMatches) {
    const raw =
      "https://" +
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

  // Group by catalog upload ID
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

  // Use the catalog with the most pages (skip dealer logos / tiny assets)
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
    const num = parseInt(m[1]!, 10);
    if (!pageMap.has(num)) pageMap.set(num, url);
  }

  const sortedPages = [...pageMap.entries()].sort((a, b) => a[0] - b[0]);
  const pages: ResolvedPage[] = sortedPages.map(([num, url]) => ({
    number: num,
    imageUrl: url,
  }));

  return { tjekCatalogId: bestId, pages };
}

/**
 * Resolve page images for Tjek-hosted catalogs (e.g. Netto Poland).
 *
 * Tjek embeds all catalog page image URLs in the server-rendered HTML of the
 * listing page — a plain fetch() is sufficient. No Playwright browser needed.
 */
async function resolveViaTjek(input: ResolveInput): Promise<ResolveResult> {
  const { firstPageUrl, catalogId } = input;

  log.info(`fetching ${firstPageUrl}`);

  const response = await fetch(firstPageUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5",
    },
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} fetching Tjek page: ${firstPageUrl}`
    );
  }

  const html = await response.text();
  const { tjekCatalogId, pages } = parseTjekPages(html);

  if (pages.length === 0) {
    throw new Error(`No Tjek page images found in HTML from: ${firstPageUrl}`);
  }

  log.info(`got ${pages.length} pages`, { catalogId, tjekCatalog: tjekCatalogId });

  return {
    catalogId,
    coverImageUrl: pages[0]?.imageUrl ?? "",
    pages,
  };
}

export const tjekResolver: CatalogResolver = {
  name: "tjek",
  needsLastPage: false,
  resolve: resolveViaTjek,
};
