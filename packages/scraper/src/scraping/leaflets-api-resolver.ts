import type { ResolveResult } from "./resolver-types.ts";
import type { CatalogResolver, ResolveInput } from "./resolver-registry.ts";
import { registerResolver } from "./resolver-registry.ts";

interface LeafletsPage {
  number: number;
  image: string;
  thumbnail: string;
}

interface LeafletsFlyer {
  pages: LeafletsPage[];
  thumbnailUrl: string;
}

/**
 * Extract the flyer slug from a leaflets viewer URL.
 * e.g. ".../du-26-02-au-04-03-les-promos-de-la-semaine/view/flyer/page/1" → "du-26-02-au-04-03-les-promos-de-la-semaine"
 */
export function extractFlyerSlug(url: string): string | null {
  const match = url.match(/\/([^/]+)\/(?:view\/flyer\/page\/|ar\/)\d+/);
  return match?.[1] ?? null;
}

/**
 * Derive the API endpoint host from the viewer URL.
 * "leaflets.schwarz" → "endpoints.leaflets.schwarz"
 * "leaflets.kaufland.com" → "endpoints.leaflets.kaufland.com"
 */
function deriveApiHost(url: string): string {
  const match = url.match(/https?:\/\/([^/]*leaflets\.[^/]+)/);
  if (!match) return "endpoints.leaflets.schwarz";
  const host = match[1]!;
  return `endpoints.${host}`;
}

async function resolveViaLeafletsApi(
  input: ResolveInput
): Promise<ResolveResult> {
  const { firstPageUrl, catalogId } = input;

  const slug = extractFlyerSlug(firstPageUrl);
  if (!slug) {
    throw new Error(
      `Could not extract flyer slug from URL: ${firstPageUrl}`
    );
  }

  const apiHost = deriveApiHost(firstPageUrl);
  const apiUrl = `https://${apiHost}/v4/flyer?flyer_identifier=${encodeURIComponent(slug)}`;
  console.log(`[leaflets-api] fetching ${apiUrl}`);

  const resp = await fetch(apiUrl);
  if (!resp.ok) {
    throw new Error(
      `Leaflets API returned ${resp.status}: ${resp.statusText}`
    );
  }

  const data = await resp.json();
  const flyer: LeafletsFlyer = data.flyer;

  if (!flyer?.pages?.length) {
    throw new Error(`Leaflets API returned no pages for slug: ${slug}`);
  }

  console.log(
    `[leaflets-api] got ${flyer.pages.length} pages for ${catalogId}`
  );

  return {
    catalogId,
    coverImageUrl: flyer.pages[0]!.image,
    pages: flyer.pages.map((p) => ({
      number: p.number,
      imageUrl: p.image,
    })),
  };
}

// --- CatalogResolver implementation ---

const leafletsResolver: CatalogResolver = {
  name: "leaflets",
  needsLastPage: false,
  resolve: resolveViaLeafletsApi,
};

registerResolver(leafletsResolver);
