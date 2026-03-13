import type { ResolveResult, ResolvedPage } from "./resolver-types.ts";
import type { CatalogResolver, ResolveInput } from "./resolver-registry.ts";
import { registerResolver } from "./resolver-registry.ts";

/**
 * digital-catalogue.com resolver.
 *
 * Page images are at:
 *   {origin}/storage/{account-storage}/{pub-id}/common/data/{NNNN}.webp
 *
 * Both the storage path and page count are found in the server-rendered HTML.
 */

async function resolveViaDigitalCatalogue(
  input: ResolveInput
): Promise<ResolveResult> {
  const { firstPageUrl, catalogId } = input;

  console.log(`[digital-catalogue] fetching ${firstPageUrl}`);

  const resp = await fetch(firstPageUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    },
  });
  if (!resp.ok) {
    throw new Error(
      `digital-catalogue returned ${resp.status}: ${resp.statusText}`
    );
  }

  const html = await resp.text();

  // Extract page count from "pagesNumber":26
  const pagesMatch = html.match(/pagesNumber["']\s*:\s*(\d+)/);
  if (!pagesMatch) {
    throw new Error(
      `Could not extract pagesNumber from: ${firstPageUrl}`
    );
  }
  const pageCount = parseInt(pagesMatch[1]!, 10);

  // Extract the storage path from the HTML.
  // The HTML contains references like:
  //   storage/s1/catalogs/account_name/pub-id/common/data/cover.jpg
  const storageMatch = html.match(
    /storage\/[\w/.-]+\/common\/data/
  );
  if (!storageMatch) {
    throw new Error(
      `Could not extract storage path from: ${firstPageUrl}`
    );
  }

  const url = new URL(firstPageUrl);
  const imageBase = `${url.origin}/${storageMatch[0]}`;

  const resolvedPages: ResolvedPage[] = [];
  for (let i = 1; i <= pageCount; i++) {
    const filename = String(i).padStart(4, "0");
    resolvedPages.push({
      number: i,
      imageUrl: `${imageBase}/${filename}.webp`,
    });
  }

  console.log(
    `[digital-catalogue] got ${resolvedPages.length} pages for ${catalogId}`
  );

  return {
    catalogId,
    coverImageUrl: resolvedPages[0]?.imageUrl ?? "",
    pages: resolvedPages,
  };
}

// --- CatalogResolver implementation ---

const digitalCatalogueResolver: CatalogResolver = {
  name: "digital-catalogue",
  needsLastPage: false,
  resolve: resolveViaDigitalCatalogue,
};

registerResolver(digitalCatalogueResolver);
