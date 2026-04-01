import type { ResolveResult, ResolvedPage } from "./resolver-types.ts";
import type { CatalogResolver, ResolveInput } from "./resolver-registry.ts";
import { createLogger } from "../logger.ts";

const log = createLogger({ module: "flippingbook" });

/**
 * FlippingBook resolver.
 *
 * FlippingBook publications host page images at a predictable URL pattern:
 *   {baseUrl}/files/assets/common/page-html5-substrates/page{NNNN}_{quality}.jpg
 *
 * The page count is determined from the HTML source which contains numbered
 * page links (href="./2/", href="./3/", etc.).
 */

/**
 * Extract the total page count from a FlippingBook HTML page.
 * Pages are linked as href="./2/", href="./3/", ... href="./N/"
 */
function extractPageCount(html: string): number {
  const matches = html.matchAll(/href=["']\.\/(\d+)\/["']/g);
  let max = 1;
  for (const m of matches) {
    const n = parseInt(m[1]!, 10);
    if (n > max) max = n;
  }
  return max;
}

async function resolveViaFlippingBook(
  input: ResolveInput
): Promise<ResolveResult> {
  const { firstPageUrl, catalogId } = input;

  // Ensure base URL ends without trailing slash
  const baseUrl = firstPageUrl.replace(/\/+$/, "");

  log.info(`fetching ${baseUrl}`);

  const resp = await fetch(baseUrl, { signal: AbortSignal.timeout(30000) });
  if (!resp.ok) {
    throw new Error(
      `FlippingBook page returned ${resp.status}: ${resp.statusText}`
    );
  }

  const html = await resp.text();
  const pageCount = extractPageCount(html);

  if (pageCount === 0) {
    throw new Error(`Could not determine page count from: ${baseUrl}`);
  }

  // Quality levels: _1 (small), _2 (medium), _3 (large)
  const quality = 3;
  const pages: ResolvedPage[] = [];

  for (let i = 1; i <= pageCount; i++) {
    const pageNum = String(i).padStart(4, "0");
    const imageUrl = `${baseUrl}/files/assets/common/page-html5-substrates/page${pageNum}_${quality}.jpg`;
    pages.push({ number: i, imageUrl });
  }

  log.info(`got ${pages.length} pages`, { catalogId });

  return {
    catalogId,
    coverImageUrl: pages[0]?.imageUrl ?? "",
    pages,
  };
}

// --- CatalogResolver implementation ---

export const flippingbookResolver: CatalogResolver = {
  name: "flippingbook",
  needsLastPage: false,
  resolve: resolveViaFlippingBook,
};

