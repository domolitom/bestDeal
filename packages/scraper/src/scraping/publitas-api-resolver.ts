import type { ResolveResult, ResolvedPage } from "./resolver-types.ts";
import type { CatalogResolver, ResolveInput } from "./resolver-registry.ts";
import { registerResolver } from "./resolver-registry.ts";

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
 * e.g. "https://cataloage.carrefour.ro/some-slug/page/1" → "https://cataloage.carrefour.ro/some-slug"
 * Also handles view.publitas.com URLs.
 */
export function extractPublitasBaseUrl(url: string): string | null {
  const match = url.match(/^(https?:\/\/[^/]+\/[^/]+(?:\/[^/]+)*?)\/page\/\d+/);
  if (!match) return null;
  // Trim any trailing path segments that aren't part of the slug
  // The slug is the part right before /page/
  return match[1] ?? null;
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
  console.log(`[publitas-api] fetching ${spreadsUrl}`);

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

  console.log(
    `[publitas-api] got ${pages.length} pages for ${catalogId}`
  );

  return {
    catalogId,
    coverImageUrl: pages[0]?.imageUrl ?? "",
    pages,
  };
}

// --- CatalogResolver implementation ---

const publitasResolver: CatalogResolver = {
  name: "publitas",
  needsLastPage: false,
  resolve: resolveViaPublitasApi,
};

registerResolver(publitasResolver);
