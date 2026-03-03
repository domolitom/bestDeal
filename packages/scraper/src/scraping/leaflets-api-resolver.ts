import type { ResolveResult } from "./resolver.ts";

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
 * Extract the flyer slug from a leaflets.schwarz viewer URL.
 * e.g. ".../du-26-02-au-04-03-les-promos-de-la-semaine/view/flyer/page/1" → "du-26-02-au-04-03-les-promos-de-la-semaine"
 */
export function extractFlyerSlug(url: string): string | null {
  const match = url.match(/\/([^/]+)\/(?:view\/flyer\/page\/|ar\/)\d+/);
  return match?.[1] ?? null;
}

/**
 * Check if a firstPageUrl can be resolved via the leaflets.schwarz API.
 */
export function isLeafletsUrl(url: string): boolean {
  return url.includes("leaflets.schwarz") || url.includes("/view/flyer/page/");
}

/**
 * Resolve all page image URLs via the leaflets.schwarz API.
 * Returns the same ResolveResult shape as the browser-based resolver.
 */
export async function resolveViaLeafletsApi(options: {
  firstPageUrl: string;
  catalogId: string;
}): Promise<ResolveResult> {
  const { firstPageUrl, catalogId } = options;

  const slug = extractFlyerSlug(firstPageUrl);
  if (!slug) {
    throw new Error(
      `Could not extract flyer slug from URL: ${firstPageUrl}`
    );
  }

  const apiUrl = `https://endpoints.leaflets.schwarz/v4/flyer?flyer_identifier=${encodeURIComponent(slug)}`;
  console.log(`[leaflets-api] fetching ${apiUrl}`);

  const resp = await fetch(apiUrl);
  if (!resp.ok) {
    throw new Error(`Leaflets API returned ${resp.status}: ${resp.statusText}`);
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
