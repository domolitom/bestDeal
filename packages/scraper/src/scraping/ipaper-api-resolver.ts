import type { ResolveResult, ResolvedPage } from "./resolver-types.ts";
import type { CatalogResolver, ResolveInput } from "./resolver-registry.ts";
import { registerResolver } from "./resolver-registry.ts";

interface IPaperSettings {
  pages: number[];
  aws: {
    url: string;
    policy: string;
  };
}

/**
 * Extract the iPaper staticSettings JSON from raw HTML.
 * iPaper embeds `window.staticSettings = { ... };` in the page.
 */
export function parseIPaperSettings(html: string): IPaperSettings | null {
  const match = html.match(
    /window\.staticSettings\s*=\s*(\{[\s\S]*?\});\s*(?:window\.|<\/script>)/
  );
  if (!match?.[1]) return null;

  try {
    const settings = JSON.parse(match[1]);
    const pages: number[] = settings.pages;
    const aws = settings.aws;

    if (!Array.isArray(pages) || !aws?.url || !aws?.policy) return null;

    return { pages, aws: { url: aws.url, policy: aws.policy } };
  } catch {
    return null;
  }
}

async function resolveViaIPaperApi(
  input: ResolveInput
): Promise<ResolveResult> {
  const { firstPageUrl, catalogId } = input;

  console.log(`[ipaper-api] fetching ${firstPageUrl}`);

  const resp = await fetch(firstPageUrl);
  if (!resp.ok) {
    throw new Error(
      `iPaper page returned ${resp.status}: ${resp.statusText}`
    );
  }

  const html = await resp.text();
  const settings = parseIPaperSettings(html);

  if (!settings) {
    throw new Error(
      `Could not extract iPaper settings from: ${firstPageUrl}`
    );
  }

  const { pages: pageNumbers, aws } = settings;
  const pages: ResolvedPage[] = pageNumbers.map((nr) => ({
    number: nr,
    imageUrl: `${aws.url}Pages/${nr}.jpg?${aws.policy}`,
  }));

  console.log(
    `[ipaper-api] got ${pages.length} pages for ${catalogId}`
  );

  return {
    catalogId,
    coverImageUrl: pages[0]?.imageUrl ?? "",
    pages,
  };
}

// --- CatalogResolver implementation ---

const ipaperResolver: CatalogResolver = {
  name: "ipaper",
  needsLastPage: false,
  resolve: resolveViaIPaperApi,
};

registerResolver(ipaperResolver);
