import type { ResolveResult, ResolvedPage } from "./resolver-types.ts";
import type { CatalogResolver, ResolveInput } from "./resolver-registry.ts";
import { createLogger } from "../logger.ts";

const log = createLogger({ module: "issuu" });

const IMG_BASE = "https://image.isu.pub";
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/**
 * Extract the publisher and document slug from an Issuu publication URL.
 * e.g. "https://issuu.com/kpsverlag/docs/rossmann_20260315_20260321" →
 *   { publisher: "kpsverlag", slug: "rossmann_20260315_20260321" }
 */
export function extractIssuuParts(
  url: string
): { publisher: string; slug: string } | null {
  const match = url.match(
    /issuu\.com\/([^/?#]+)\/docs\/([^/?#]+)/
  );
  if (!match) return null;
  return { publisher: match[1]!, slug: match[2]! };
}

/**
 * Extract the Issuu image document ID from a publication's og:image URL.
 * The og:image is: https://image.isu.pub/{revisionId}-{publicationId}/jpg/page_1_social_preview.jpg
 * We want: "{revisionId}-{publicationId}"
 */
export function extractIssuuDocId(html: string): string | null {
  // og:image meta tag
  const ogMatch = html.match(
    /image\.isu\.pub\/([a-f0-9]+-[a-f0-9]{32})\/jpg\/page_1/
  );
  if (ogMatch) return ogMatch[1]!;

  // Also check JSON-escaped variants
  const jsonMatch = html.match(
    /image\.isu\.pub\\?\/([a-f0-9]+-[a-f0-9]{32})\\?\/jpg\\?\/page_1/
  );
  if (jsonMatch) return jsonMatch[1]!;

  return null;
}

/**
 * Extract the page count from the embedded JSON in the Issuu publication page.
 * Issuu embeds either:
 *   - JSON-escaped in a script tag: pageCount\":20
 *   - Plain JSON: "pageCount":20
 */
export function extractIssuuPageCount(html: string): number | null {
  // JSON-escaped variant (most common in Issuu SSR)
  const escapedMatch = html.match(/pageCount\\+":(\d+)/);
  if (escapedMatch) return parseInt(escapedMatch[1]!, 10);

  // Plain JSON variant
  const plainMatch = html.match(/"pageCount":(\d+)/);
  if (plainMatch) return parseInt(plainMatch[1]!, 10);

  return null;
}

async function resolveViaIssuu(input: ResolveInput): Promise<ResolveResult> {
  const { firstPageUrl, catalogId } = input;

  const parts = extractIssuuParts(firstPageUrl);
  if (!parts) {
    throw new Error(`Could not extract Issuu publisher/slug from: ${firstPageUrl}`);
  }

  const pubUrl = `https://issuu.com/${parts.publisher}/docs/${parts.slug}`;
  log.info(`fetching ${pubUrl}`);

  const resp = await fetch(pubUrl, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5",
    },
    signal: AbortSignal.timeout(30000),
  });

  if (!resp.ok) {
    throw new Error(
      `Issuu publication page returned HTTP ${resp.status}: ${pubUrl}`
    );
  }

  const html = await resp.text();

  const docId = extractIssuuDocId(html);
  if (!docId) {
    throw new Error(
      `Could not extract Issuu image document ID from page: ${pubUrl}`
    );
  }

  const pageCount = extractIssuuPageCount(html);
  if (!pageCount || pageCount <= 0) {
    throw new Error(
      `Could not extract Issuu page count from page: ${pubUrl}`
    );
  }

  const pages: ResolvedPage[] = [];
  for (let n = 1; n <= pageCount; n++) {
    pages.push({
      number: n,
      imageUrl: `${IMG_BASE}/${docId}/jpg/page_${n}.jpg`,
    });
  }

  log.info(`got ${pages.length} pages`, { catalogId, docId });

  return {
    catalogId,
    coverImageUrl: pages[0]?.imageUrl ?? "",
    pages,
  };
}

// --- CatalogResolver implementation ---

export const issuuResolver: CatalogResolver = {
  name: "issuu",
  needsLastPage: false,
  resolve: resolveViaIssuu,
};
