import type { ResolveResult, ResolvedPage } from "./resolver-types.ts";
import type { CatalogResolver, ResolveInput } from "./resolver-registry.ts";
import { renderPdfPages } from "./pdf-render.ts";
import { createLogger } from "../logger.ts";

const log = createLogger({ module: "shopfully" });

/**
 * Shopfully Cloud resolver.
 *
 * Shopfully catalogs are stored as PDFs on it-it-media-publications.shopfully.cloud
 * (or equivalent regional CDNs). The firstPageUrl stored in catalog meta is the
 * direct PDF URL from the flyer's lastPubblication.pdf_url field.
 *
 * This resolver downloads the PDF and renders it to JPEG images via pdf.js in
 * a headless browser, identical to the existing PDF resolver but scoped to the
 * Shopfully CDN domain for auto-detection purposes.
 */

async function resolveViaShopfully(
  input: ResolveInput
): Promise<ResolveResult> {
  const { firstPageUrl, catalogId } = input;

  log.info(`rendering ${firstPageUrl}`);

  const imageBuffers = await renderPdfPages(firstPageUrl, "Shopfully PDF", log);

  if (imageBuffers.length === 0) {
    throw new Error(`Shopfully PDF rendered no pages: ${firstPageUrl}`);
  }

  log.info(`rendered ${imageBuffers.length} pages`, { catalogId });

  const pages: ResolvedPage[] = imageBuffers.map((data, i) => ({
    number: i + 1,
    imageUrl: firstPageUrl, // placeholder — imageData is used instead
    imageData: data,
  }));

  return {
    catalogId,
    coverImageUrl: firstPageUrl,
    pages,
  };
}

// --- CatalogResolver implementation ---

export const shopfullyResolver: CatalogResolver = {
  name: "shopfully",
  needsLastPage: false,
  resolve: resolveViaShopfully,
};
