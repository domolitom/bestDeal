import type { ResolveResult, ResolvedPage } from "./resolver-types.ts";
import type { CatalogResolver, ResolveInput } from "./resolver-registry.ts";
import { renderPdfPages } from "./pdf-render.ts";
import { createLogger } from "../logger.ts";

const log = createLogger({ module: "pdf" });

async function resolveViaPdf(input: ResolveInput): Promise<ResolveResult> {
  const { firstPageUrl, catalogId } = input;

  log.info(`rendering ${firstPageUrl}`);

  const imageBuffers = await renderPdfPages(firstPageUrl, "PDF", log);

  if (imageBuffers.length === 0) {
    throw new Error(`PDF rendered no pages: ${firstPageUrl}`);
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

export const pdfResolver: CatalogResolver = {
  name: "pdf",
  needsLastPage: false,
  resolve: resolveViaPdf,
};

