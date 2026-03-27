import type { ResolveResult, ResolvedPage } from "./resolver-types.ts";
import type { CatalogResolver, ResolveInput } from "./resolver-registry.ts";
import { createLogger } from "../logger.ts";

const log = createLogger({ module: "publitas-api" });

interface PublitasSpreadPage {
  images: Record<string, string>;
}

interface PublitasSpread {
  pages: PublitasSpreadPage[];
}

/** Preferred image size key (1200px wide ≈ 300KB, good balance). */
const PREFERRED_SIZE = "at1200";

/**
 * Derive the base URL for a Publitas catalog from its firstPageUrl.
 * Handles two URL forms:
 *  1. "/page/N" style: "https://cataloage.carrefour.ro/some-slug/page/1"
 *     → "https://cataloage.carrefour.ro/some-slug"
 *  2. Embed URL style with query params (e.g. Rossmann CZ iframe):
 *     "https://publikace.rossmann.cz/some-slug/?publitas_embed=maximized"
 *     → "https://publikace.rossmann.cz/some-slug"
 */
export function extractPublitasBaseUrl(url: string): string | null {
  // Form 1: URL contains /page/{n}
  const pageMatch = url.match(/^(https?:\/\/[^/]+\/[^/]+(?:\/[^/]+)*?)\/page\/\d+/);
  if (pageMatch) return pageMatch[1] ?? null;

  // Form 2: URL has a query string — strip it (and any trailing slash) to get base
  const queryIdx = url.indexOf("?");
  if (queryIdx !== -1) {
    const base = url.slice(0, queryIdx).replace(/\/$/, "");
    // Must have at least one path segment to be a valid publication URL
    if (/^https?:\/\/[^/]+\/[^/]+/.test(base)) return base;
  }

  return null;
}

/**
 * Derive the origin (scheme + host) from a URL.
 */
function getOrigin(url: string): string {
  const match = url.match(/^(https?:\/\/[^/]+)/);
  return match?.[1] ?? "";
}

async function resolveViaPublitasApi(
  input: ResolveInput
): Promise<ResolveResult> {
  const { firstPageUrl, catalogId } = input;

  const baseUrl = extractPublitasBaseUrl(firstPageUrl);
  if (!baseUrl) {
    throw new Error(
      `Could not extract Publitas base URL from: ${firstPageUrl}`
    );
  }

  const spreadsUrl = `${baseUrl}/spreads.json`;
  log.info(`fetching ${spreadsUrl}`);

  const resp = await fetch(spreadsUrl);
  if (!resp.ok) {
    throw new Error(
      `Publitas spreads.json returned ${resp.status}: ${resp.statusText}`
    );
  }

  const spreads: PublitasSpread[] = await resp.json();

  if (!spreads.length) {
    throw new Error(`Publitas spreads.json returned no spreads for: ${baseUrl}`);
  }

  const origin = getOrigin(firstPageUrl);
  const pages: ResolvedPage[] = [];
  let pageNumber = 0;

  for (const spread of spreads) {
    for (const spreadPage of spread.pages) {
      pageNumber++;
      const imagePath =
        spreadPage.images[PREFERRED_SIZE] ??
        spreadPage.images["at1000"] ??
        Object.values(spreadPage.images)[0];
      if (imagePath) {
        pages.push({
          number: pageNumber,
          imageUrl: `${origin}${imagePath}`,
        });
      }
    }
  }

  log.info(`got ${pages.length} pages`, { catalogId });

  return {
    catalogId,
    coverImageUrl: pages[0]?.imageUrl ?? "",
    pages,
  };
}

// --- CatalogResolver implementation ---

export const publitasResolver: CatalogResolver = {
  name: "publitas",
  needsLastPage: false,
  resolve: resolveViaPublitasApi,
};

