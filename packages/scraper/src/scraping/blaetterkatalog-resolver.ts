import type { ResolveResult, ResolvedPage } from "./resolver-types.ts";
import type { CatalogResolver, ResolveInput } from "./resolver-registry.ts";
import { createLogger } from "../logger.ts";

const log = createLogger({ module: "blaetterkatalog" });

/**
 * Extract the blaetterkatalog catalogId and version from a viewer URL.
 *
 * Supported formats:
 *   https://penny-publish.blaetterkatalog.de/frontend/getcatalog.do?catalogId=1293977
 *   https://penny-publish.blaetterkatalog.de/frontend/getcatalog.do?catalogId=1293977&catalogVersion=2
 *
 * Returns { origin, catalogId, catalogVersion } or null if not matched.
 */
export function parseBlaetterkatalogUrl(
  url: string
): { origin: string; catalogId: string; catalogVersion: string } | null {
  try {
    const parsed = new URL(url);
    const catalogId = parsed.searchParams.get("catalogId");
    if (!catalogId) return null;
    const catalogVersion = parsed.searchParams.get("catalogVersion") ?? "1";
    return { origin: parsed.origin, catalogId, catalogVersion };
  } catch {
    return null;
  }
}

/**
 * Build the base URL for the blaetterkatalog MVC API.
 * All assets for a catalog live under this path.
 *
 * e.g. https://penny-publish.blaetterkatalog.de/frontend/mvc/api/catalogs/1293977/v1
 */
export function buildApiBase(
  origin: string,
  catalogId: string,
  catalogVersion: string
): string {
  return `${origin}/frontend/mvc/api/catalogs/${catalogId}/v${catalogVersion}`;
}

/**
 * Fetch the catalog.xml and extract the total page count.
 * The XML root element has the attribute: <catalog nofpages="38" ...>
 */
export async function fetchPageCount(apiBase: string): Promise<number> {
  const xmlUrl = `${apiBase}/xml/catalog.xml`;
  const resp = await fetch(xmlUrl, {
    signal: AbortSignal.timeout(15000),
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    },
  });

  if (!resp.ok) {
    throw new Error(
      `blaetterkatalog catalog.xml returned ${resp.status}: ${resp.statusText} (${xmlUrl})`
    );
  }

  const xml = await resp.text();

  // Extract nofpages from: <catalog name="..." nofpages="38">
  const match = xml.match(/nofpages=["'](\d+)["']/);
  if (!match) {
    throw new Error(
      `blaetterkatalog catalog.xml missing nofpages attribute: ${xmlUrl}`
    );
  }

  const count = parseInt(match[1]!, 10);
  if (isNaN(count) || count <= 0) {
    throw new Error(
      `blaetterkatalog catalog.xml has invalid nofpages="${match[1]}": ${xmlUrl}`
    );
  }

  return count;
}

async function resolveViaBlaetterkatalog(
  input: ResolveInput
): Promise<ResolveResult> {
  const { firstPageUrl, catalogId } = input;

  const parsed = parseBlaetterkatalogUrl(firstPageUrl);
  if (!parsed) {
    throw new Error(
      `blaetterkatalog: cannot parse catalogId from URL: ${firstPageUrl}`
    );
  }

  const { origin, catalogId: bkCatalogId, catalogVersion } = parsed;
  const apiBase = buildApiBase(origin, bkCatalogId, catalogVersion);

  log.info(`fetching catalog.xml from ${apiBase}`);

  const pageCount = await fetchPageCount(apiBase);

  log.info(`got ${pageCount} pages`, { catalogId });

  // Page image URLs follow: {apiBase}/normal/bk_{N}.jpg  (1-indexed, no padding)
  const pages: ResolvedPage[] = [];
  for (let n = 1; n <= pageCount; n++) {
    pages.push({
      number: n,
      imageUrl: `${apiBase}/normal/bk_${n}.jpg`,
    });
  }

  const coverImageUrl =
    `${origin}/frontend/getwebdata.do?path=img&f=catcover.jpg&catalogid=${bkCatalogId}`;

  return {
    catalogId,
    coverImageUrl,
    pages,
  };
}

// --- CatalogResolver implementation ---

export const blaetterkatalogResolver: CatalogResolver = {
  name: "blaetterkatalog",
  needsLastPage: false,
  resolve: resolveViaBlaetterkatalog,
};
