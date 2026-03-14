import type { CatalogSummary } from "@bestdeal/shared";

/**
 * Build a cover image URL for a catalog.
 * Uses R2_PUBLIC_URL when deployed, falls back to local rewrite path.
 * Safe for client components (no Node.js deps).
 */
export function getCoverUrl(catalog: CatalogSummary): string {
  const base = process.env.NEXT_PUBLIC_CDN_URL;
  if (base) {
    return `${base}/${catalog.country}/${catalog.store}/${catalog.id}/cover.jpg`;
  }
  return `/data/catalogs/${catalog.country}/${catalog.store}/${catalog.id}/cover.jpg`;
}
