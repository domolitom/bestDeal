import type { ResolveResult, ResolvedPage } from "./resolver-types.ts";
import type { CatalogResolver, ResolveInput } from "./resolver-registry.ts";
import { createLogger } from "../logger.ts";

const log = createLogger({ module: "rossmann" });

const CDN_BASE = "https://pro-fra-s3-magazine.rossmann.pl";
/** Maximum pages to probe for — Rossmann catalogs are typically ≤ 48 pages. */
const MAX_PAGES = 64;

/**
 * Extract the Rossmann magazine UUID from a CDN image URL.
 * e.g. "https://pro-fra-s3-magazine.rossmann.pl/31ee9269-1a45-4323-9578-a94705d1e939/large/bk_1.jpg"
 *   → "31ee9269-1a45-4323-9578-a94705d1e939"
 */
export function extractRossmannUuid(url: string): string | null {
  const match = url.match(
    /pro-fra-s3-magazine\.rossmann\.pl\/([a-f0-9-]{36})/
  );
  return match?.[1] ?? null;
}

/**
 * Probe how many pages exist for a Rossmann catalog by making HEAD requests.
 * Uses a linear scan capped at MAX_PAGES. Returns the highest page number
 * that returns HTTP 200.
 */
async function probePageCount(uuid: string): Promise<number> {
  let count = 0;
  for (let n = 1; n <= MAX_PAGES; n++) {
    const url = `${CDN_BASE}/${uuid}/large/bk_${n}.jpg`;
    try {
      const resp = await fetch(url, {
        method: "HEAD",
        signal: AbortSignal.timeout(10000),
      });
      if (!resp.ok) break;
      count = n;
    } catch {
      break;
    }
  }
  return count;
}

async function resolveViaRossmann(
  input: ResolveInput
): Promise<ResolveResult> {
  const { firstPageUrl, catalogId } = input;

  const uuid = extractRossmannUuid(firstPageUrl);
  if (!uuid) {
    throw new Error(
      `Could not extract Rossmann magazine UUID from: ${firstPageUrl}`
    );
  }

  log.info(`probing page count for UUID ${uuid}`);
  const pageCount = await probePageCount(uuid);

  if (pageCount === 0) {
    throw new Error(
      `Rossmann CDN returned no pages for UUID: ${uuid}`
    );
  }

  const pages: ResolvedPage[] = [];
  for (let n = 1; n <= pageCount; n++) {
    pages.push({
      number: n,
      imageUrl: `${CDN_BASE}/${uuid}/large/bk_${n}.jpg`,
    });
  }

  log.info(`got ${pages.length} pages`, { catalogId, uuid });

  return {
    catalogId,
    coverImageUrl: pages[0]?.imageUrl ?? "",
    pages,
  };
}

// --- CatalogResolver implementation ---

export const rossmannResolver: CatalogResolver = {
  name: "rossmann",
  needsLastPage: false,
  resolve: resolveViaRossmann,
};
